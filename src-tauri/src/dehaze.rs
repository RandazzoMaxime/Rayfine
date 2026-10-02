//! Transmission maps for positive dehaze, in linear ProPhoto RGB.

use rayon::prelude::*;
use std::collections::VecDeque;

const FLOOR: f32 = 1.0 / 8_388_608.0;
const COEFF: [f32; 3] = [0.299, 0.587, 0.114];
const TO_PROPHOTO: [[f32; 3]; 3] = [
    [0.52934593, 0.33007280, 0.14058127],
    [0.09837434, 0.87346102, 0.02816463],
    [0.01688322, 0.11767247, 0.86544431],
];

pub struct DehazeMaps {
    pub width: u32,
    pub height: u32,
    pub airlight: [f32; 3],
    pub transmission: Vec<f32>,
}

pub fn prepare(image: &image::DynamicImage) -> DehazeMaps {
    let (width, height) = (image.width(), image.height());
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 {
        return DehazeMaps {
            width,
            height,
            airlight: [FLOOR; 3],
            transmission: Vec::new(),
        };
    }
    let converted;
    let (source, channels) = if let Some(rgb) = image.as_rgb32f() {
        (rgb.as_raw().as_slice(), 3)
    } else if let Some(rgba) = image.as_rgba32f() {
        (rgba.as_raw().as_slice(), 4)
    } else {
        converted = image.to_rgb32f();
        (converted.as_raw().as_slice(), 3)
    };
    let rgb: Vec<[f32; 3]> = source
        .par_chunks_exact(channels)
        .map(|pixel| {
            TO_PROPHOTO.map(|row| {
                let v = row[0] * pixel[0] + row[1] * pixel[1] + row[2] * pixel[2];
                if v.is_finite() {
                    v.clamp(0.0, 1.0)
                } else {
                    0.0
                }
            })
        })
        .collect();
    let airlight = pick_airlight(&rgb, w, h);
    let intensity: Vec<f32> = rgb.par_iter().map(|p| luminance(*p)).collect();
    let (dark_radius, r1, r2) = radii(w, h);
    let normalized_dark: Vec<f32> = rgb
        .par_iter()
        .map(|p| {
            (p[0] / airlight[0])
                .min(p[1] / airlight[1])
                .min(p[2] / airlight[2])
        })
        .collect();
    drop(rgb);
    let mut initial = spatial_min(&normalized_dark, w, h, dark_radius);
    drop(normalized_dark);
    initial
        .par_iter_mut()
        .for_each(|v| *v = (1.0 - *v).clamp(0.2, 1.0));
    let mut transmission = guided(&intensity, initial, w, h, r1, 0.01);
    if r2 < w.min(h) {
        let ay = luminance(airlight);
        transmission
            .par_iter_mut()
            .zip(&intensity)
            .for_each(|(t, i)| {
                let j = i + FLOOR;
                let f1 = 1.0 - (j - 0.000390625) / ay;
                let f2 = if j < 1.0 / 256.0 {
                    (1.0 - j / ay) / (1.0 - j * ((1.0 / 256.0) / ay)).max(FLOOR)
                } else {
                    f1
                };
                *t = t.max(f1).max(f2).min(1.0);
            });
        transmission = guided(&intensity, transmission, w, h, r2, 0.0001);
    }
    DehazeMaps {
        width,
        height,
        airlight,
        transmission,
    }
}

fn luminance(p: [f32; 3]) -> f32 {
    p[0] * COEFF[0] + p[1] * COEFF[1] + p[2] * COEFF[2]
}

fn radii(w: usize, h: usize) -> (usize, usize, usize) {
    let ratio = (w as f64).hypot(h as f64) / 768.0_f64.hypot(768.0);
    (
        (((9.0 * ratio + 0.5).floor() as usize) >> 1).max(1),
        (75.0 * ratio).round().max(1.0) as usize,
        (5.0 * ratio).round().max(1.0) as usize,
    )
}

fn pick_airlight(rgb: &[[f32; 3]], w: usize, h: usize) -> [f32; 3] {
    // Only the picker is downsampled; transmission retains the render dimensions.
    let reduced;
    let (pixels, sw, sh) = if rgb.len() > 1_048_576 {
        let scale = (1_048_576.0 / rgb.len() as f64).sqrt();
        let mut sw = ((w as f64 * scale).floor() as usize).max(1);
        let mut sh = ((h as f64 * scale).floor() as usize).max(1);
        // The one-pixel minimum can exceed the budget for extreme panoramas.
        if sw * sh > 1_048_576 {
            if sw >= sh {
                sw = 1_048_576 / sh;
            } else {
                sh = 1_048_576 / sw;
            }
        }
        reduced = area_resize(rgb, w, h, sw, sh);
        (reduced.as_slice(), sw, sh)
    } else {
        (rgb, w, h)
    };
    let raw_dark: Vec<f32> = pixels
        .par_iter()
        .map(|p| p[0].min(p[1]).min(p[2]))
        .collect();
    let dark = spatial_min(&raw_dark, sw, sh, radii(sw, sh).0);
    let n = pixels.len();
    let k = n.min(((n as f64 * 0.001).ceil() as usize).clamp(10, 2000));
    let mut indices: Vec<usize> = (0..n).collect();
    // Resolve equally dark candidates deterministically by raster index.
    let compare = |a: &usize, b: &usize| dark[*b].total_cmp(&dark[*a]).then(a.cmp(b));
    if k < n {
        indices.select_nth_unstable_by(k, compare);
    }
    indices.truncate(k);
    let q = (k / 4).saturating_sub(1);
    let mut planes: [Vec<f32>; 4] = std::array::from_fn(|_| Vec::with_capacity(k));
    for index in indices {
        let p = pixels[index];
        for c in 0..3 {
            planes[c].push(p[c]);
        }
        planes[3].push(luminance(p));
    }
    let quantiles: [f32; 4] = planes.map(|mut plane| {
        plane.select_nth_unstable_by(q, f32::total_cmp);
        plane[q]
    });
    let a = [quantiles[0], quantiles[1], quantiles[2]];
    let factor = (quantiles[3] + FLOOR) / (luminance(a) + FLOOR);
    a.map(|v| (v * factor).max(FLOOR))
}

fn area_resize(rgb: &[[f32; 3]], w: usize, h: usize, sw: usize, sh: usize) -> Vec<[f32; 3]> {
    let sx = w as f64 / sw as f64;
    let sy = h as f64 / sh as f64;
    (0..sw * sh)
        .into_par_iter()
        .map(|index| {
            let (x, y) = (index % sw, index / sw);
            let (left, right) = (x as f64 * sx, (x + 1) as f64 * sx);
            let (top, bottom) = (y as f64 * sy, (y + 1) as f64 * sy);
            let mut sum = [0.0_f64; 3];
            for iy in top.floor() as usize..(bottom.ceil() as usize).min(h) {
                let wy = bottom.min((iy + 1) as f64) - top.max(iy as f64);
                for ix in left.floor() as usize..(right.ceil() as usize).min(w) {
                    let weight = wy * (right.min((ix + 1) as f64) - left.max(ix as f64));
                    for c in 0..3 {
                        sum[c] += rgb[iy * w + ix][c] as f64 * weight;
                    }
                }
            }
            sum.map(|v| (v / (sx * sy)) as f32)
        })
        .collect()
}

fn min_line(input: &[f32], output: &mut [f32], radius: usize) {
    let mut queue: VecDeque<usize> = VecDeque::new();
    let mut next = 0;
    for (x, out) in output.iter_mut().enumerate() {
        let right = x.saturating_add(radius).min(input.len() - 1);
        while next <= right {
            while queue.back().is_some_and(|&i| input[i] >= input[next]) {
                queue.pop_back();
            }
            queue.push_back(next);
            next += 1;
        }
        let left = x.saturating_sub(radius);
        while queue.front().is_some_and(|&i| i < left) {
            queue.pop_front();
        }
        *out = input[*queue.front().unwrap()];
    }
}

fn spatial_min(input: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let mut horizontal = vec![0.0; input.len()];
    horizontal
        .par_chunks_mut(w)
        .zip(input.par_chunks(w))
        .for_each(|(out, row)| min_line(row, out, radius));
    let mut result = vec![0.0; input.len()];
    // Columns use a deque of row indices, avoiding radius-dependent work.
    for x in 0..w {
        let mut queue: VecDeque<usize> = VecDeque::new();
        let mut next = 0;
        for y in 0..h {
            while next <= y.saturating_add(radius).min(h - 1) {
                while queue
                    .back()
                    .is_some_and(|&i| horizontal[i * w + x] >= horizontal[next * w + x])
                {
                    queue.pop_back();
                }
                queue.push_back(next);
                next += 1;
            }
            while queue.front().is_some_and(|&i| i < y.saturating_sub(radius)) {
                queue.pop_front();
            }
            result[y * w + x] = horizontal[*queue.front().unwrap() * w + x];
        }
    }
    result
}

fn box_mean(input: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let divisor = (2 * radius + 1) as f64;
    let mut horizontal = vec![0.0; input.len()];
    horizontal
        .par_chunks_mut(w)
        .zip(input.par_chunks(w))
        .for_each(|(out, row)| {
            let mut sum = row[0] as f64 * (radius + 1) as f64;
            sum += row
                .iter()
                .take(radius + 1)
                .skip(1)
                .map(|v| *v as f64)
                .sum::<f64>();
            sum += row[w - 1] as f64 * radius.saturating_sub(w - 1) as f64;
            for x in 0..w {
                out[x] = (sum / divisor) as f32;
                sum += row[x.saturating_add(radius + 1).min(w - 1)] as f64
                    - row[x.saturating_sub(radius)] as f64;
            }
        });
    let mut sums: Vec<f64> = horizontal[..w]
        .iter()
        .map(|v| *v as f64 * (radius + 1) as f64)
        .collect();
    for y in 1..=radius.min(h - 1) {
        for x in 0..w {
            sums[x] += horizontal[y * w + x] as f64;
        }
    }
    for x in 0..w {
        sums[x] += horizontal[(h - 1) * w + x] as f64 * radius.saturating_sub(h - 1) as f64;
    }
    let mut result = vec![0.0; input.len()];
    for y in 0..h {
        let add = y.saturating_add(radius + 1).min(h - 1) * w;
        let subtract = y.saturating_sub(radius) * w;
        for x in 0..w {
            result[y * w + x] = (sums[x] / divisor) as f32;
            sums[x] += horizontal[add + x] as f64 - horizontal[subtract + x] as f64;
        }
    }
    result
}

fn guided(intensity: &[f32], p: Vec<f32>, w: usize, h: usize, radius: usize, eps: f32) -> Vec<f32> {
    let mi = box_mean(intensity, w, h, radius);
    let mp = box_mean(&p, w, h, radius);
    let mut moment: Vec<f32> = intensity.par_iter().map(|i| i * i).collect();
    let mut a = box_mean(&moment, w, h, radius);
    moment
        .par_iter_mut()
        .zip(intensity)
        .zip(&p)
        .for_each(|((m, i), p)| *m = i * p);
    drop(p);
    let mut b = box_mean(&moment, w, h, radius);
    drop(moment);
    a.par_iter_mut()
        .zip(&mut b)
        .zip(&mi)
        .zip(&mp)
        .for_each(|(((a, b), mi), mp)| {
            let variance = (*a - mi * mi).max(0.0);
            *a = (*b - mi * mp) / (variance + eps);
            *b = mp - *a * mi;
        });
    drop(mi);
    drop(mp);
    let ma = box_mean(&a, w, h, radius);
    drop(a);
    let mut result = box_mean(&b, w, h, radius);
    result
        .par_iter_mut()
        .zip(&ma)
        .zip(intensity)
        .for_each(|((t, a), i)| *t = (a * i + *t).clamp(0.2, 1.0));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_replicate_borders_when_radius_exceeds_dimensions() {
        let input = [1.0, 8.0, 2.0, 5.0, 3.0, 9.0];
        assert_eq!(spatial_min(&input, 3, 2, 1), [1.0, 1.0, 2.0, 1.0, 1.0, 2.0]);
        assert_eq!(spatial_min(&input, 3, 2, 4), [1.0; 6]);
        let expected = [
            3.8888888, 4.148148, 4.4074073, 4.3333335, 4.6296296, 4.9259257,
        ];
        for (actual, expected) in box_mean(&input, 3, 2, 4).iter().zip(expected) {
            assert!(
                (actual - expected).abs() < 0.000002,
                "{actual} vs {expected}"
            );
        }
    }

    #[test]
    #[ignore = "manual 12MP performance check"]
    fn twelve_megapixel_map() {
        let input = image::Rgb32FImage::from_fn(4000, 3000, |x, y| {
            image::Rgb([
                (x % 257) as f32 / 256.0,
                (y % 257) as f32 / 256.0,
                ((x + y) % 257) as f32 / 256.0,
            ])
        });
        let start = std::time::Instant::now();
        let result = prepare(&image::DynamicImage::ImageRgb32F(input));
        eprintln!("12MP prepare: {:?}", start.elapsed());
        assert_eq!(result.transmission.len(), 12_000_000);
        assert!(
            result
                .transmission
                .iter()
                .all(|v| v.is_finite() && (0.2..=1.0).contains(v))
        );
    }
    #[test]
    fn matches_independent_numpy_opencv_reference() {
        let input = image::Rgb32FImage::from_fn(37, 29, |x, y| {
            image::Rgb([
                ((x * 7 + y * 11) % 101) as f32 / 130.0 + 0.08,
                ((x * 13 + y * 3) % 103) as f32 / 140.0 + 0.03,
                ((x * 5 + y * 17) % 107) as f32 / 150.0 + 0.1,
            ])
        });
        let maps = prepare(&image::DynamicImage::ImageRgb32F(input));
        let expected: Vec<f32> =
            include_str!("../../bench/lr-compare/fixtures/guided-dehaze-reference.txt")
                .lines()
                .filter(|line| !line.starts_with('#'))
                .flat_map(str::split_whitespace)
                .map(|value| value.parse().unwrap())
                .collect();
        for (actual, reference) in maps
            .airlight
            .iter()
            .chain(&maps.transmission)
            .zip(&expected)
        {
            assert!(
                (actual - reference).abs() < 0.00002,
                "actual {actual}, reference {reference}"
            );
        }
        assert_eq!(maps.transmission.len() + 3, expected.len());
    }
    #[test]
    fn empty_and_constant_images_are_finite() {
        for (w, h, value) in [(0, 0, 0.0), (1, 1, 0.0), (1, 23, 0.4), (31, 27, 0.7)] {
            let maps = prepare(&image::DynamicImage::ImageRgb32F(
                image::Rgb32FImage::from_pixel(w, h, image::Rgb([value; 3])),
            ));
            assert_eq!((maps.width, maps.height), (w, h));
            assert_eq!(maps.transmission.len(), (w * h) as usize);
            assert!(maps.airlight.iter().all(|v| v.is_finite() && *v > 0.0));
            assert!(
                maps.transmission
                    .iter()
                    .all(|v| v.is_finite() && (0.2..=1.0).contains(v))
            );
        }
    }
}
