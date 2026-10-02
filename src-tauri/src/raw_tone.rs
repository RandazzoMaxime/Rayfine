//! Approximate scene statistics for Basic RAW contrast, not an Adobe DCP pipeline.
//!
//! The source is calibrated linear sRGB. We mimic Rayfine's neutral Basic transfer,
//! decode its display result and estimate log luminance in linear ProPhoto. Large
//! sources use a uniform grid of pixel centers with at most 1600 on the long edge;
//! this bounds allocation/work without introducing per-photo calibration.

const FLARE: f64 = 1.0 / 4096.0;
const MAX_EDGE: u64 = 1600;
const TO_PROPHOTO: [[f64; 3]; 3] = [
    [0.52934593, 0.33007280, 0.14058127],
    [0.09837434, 0.87346102, 0.02816463],
    [0.01688322, 0.11767247, 0.86544431],
];

pub(crate) struct SceneStats {
    pub contrast_key: f32,
    pub mean_log: f32,
    pub low_log: f32,
    pub high_log: f32,
}

pub(crate) fn prepare(image: &image::DynamicImage) -> SceneStats {
    let (width, height) = (image.width() as u64, image.height() as u64);
    if width == 0 || height == 0 {
        return SceneStats {
            contrast_key: 0.18,
            mean_log: -12.0,
            low_log: -12.0,
            high_log: -12.0,
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
    let edge = width.max(height);
    let (sw, sh) = if edge > MAX_EDGE {
        (
            (width * MAX_EDGE / edge).max(1),
            (height * MAX_EDGE / edge).max(1),
        )
    } else {
        (width, height)
    };
    let count = (sw * sh) as usize;
    let mut filtered = Vec::with_capacity(count);
    let mut sum = 0.0;
    let threshold = FLARE.log2() + 1.0;
    for sy in 0..sh {
        let y = ((2 * sy + 1) * height / (2 * sh)).min(height - 1);
        for sx in 0..sw {
            let x = ((2 * sx + 1) * width / (2 * sw)).min(width - 1);
            let offset = ((y * width + x) as usize) * channels;
            let rgb = [source[offset], source[offset + 1], source[offset + 2]];
            let log = basic_log_luminance(rgb);
            sum += log;
            if log > threshold {
                filtered.push(log);
            }
        }
    }
    // The mean includes shadows excluded from the filtered quantile bounds.
    let mean = sum / count as f64;
    let (low, high) = if filtered.is_empty() {
        (-12.0, -12.0)
    } else {
        let n = filtered.len();
        let low_index = (n as f64 * 0.0001).floor() as usize;
        let high_index = ((n as f64 * 0.9999).floor() as usize).min(n - 1);
        let low = *filtered.select_nth_unstable_by(low_index, f64::total_cmp).1;
        let high = *filtered
            .select_nth_unstable_by(high_index, f64::total_cmp)
            .1;
        (low, high)
    };
    let key = if high - low <= 1.0e-12 {
        0.18
    } else {
        (0.18 * 4.0_f64.powf((2.0 * mean - low - high) / (high - low))).clamp(0.09, 0.36)
    };
    SceneStats {
        contrast_key: key as f32,
        mean_log: mean as f32,
        low_log: low as f32,
        high_log: high as f32,
    }
}

pub(crate) fn basic_log_luminance(rgb: [f32; 3]) -> f64 {
    let decoded = rgb.map(|v| {
        let input = if v.is_finite() { v as f64 } else { 0.0 };
        let linear = (input * 2.0_f64.powf(0.25)).clamp(0.0, 1.0);
        let encoded = if linear <= 0.0031308 {
            linear * 12.92
        } else {
            1.055 * linear.powf(1.0 / 2.4) - 0.055
        };
        let perceptual = encoded.powf(1.0 / 1.378);
        let display = perceptual * perceptual * (3.0 - 2.0 * perceptual);
        if display <= 0.04045 {
            display / 12.92
        } else {
            ((display + 0.055) / 1.055).powf(2.4)
        }
    });
    let prophoto =
        TO_PROPHOTO.map(|row| row[0] * decoded[0] + row[1] * decoded[1] + row[2] * decoded[2]);
    let y = 0.30 * prophoto[0] + 0.59 * prophoto[1] + 0.11 * prophoto[2];
    (y.max(0.0) + FLARE).log2()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_constant_scenes_use_neutral_key() {
        for (w, h, value) in [(0, 0, 0.0), (1, 1, 0.0), (23, 19, 0.18), (7, 9, 2.0)] {
            let image = image::DynamicImage::ImageRgb32F(image::Rgb32FImage::from_pixel(
                w,
                h,
                image::Rgb([value; 3]),
            ));
            assert_eq!(prepare(&image).contrast_key, 0.18);
        }
    }

    #[test]
    fn matches_independent_f64_python_reference() {
        // Python f64 reference independently applies the piecewise sRGB transfers,
        // Basic gamma/smoothstep, ProPhoto matrix, log flare, and sorted quantiles.
        let colorful = image::Rgb32FImage::from_fn(37, 29, |x, y| {
            image::Rgb([
                ((x * 7 + y * 11) % 101) as f32 / 130.0 + 0.08,
                ((x * 13 + y * 3) % 103) as f32 / 140.0 + 0.03,
                ((x * 5 + y * 17) % 107) as f32 / 150.0 + 0.1,
            ])
        });
        let shadow_skewed =
            image::Rgb32FImage::from_fn(128, 1, |x, _| image::Rgb([(x as f32 / 127.0).powi(6); 3]));
        for (image, expected) in [
            (
                colorful,
                [
                    -0.590155576018,
                    -3.364481908760223,
                    -0.020983542514920225,
                    0.36,
                ],
            ),
            (
                shadow_skewed,
                [
                    -6.095227198824461,
                    -10.955755856010722,
                    0.0003521689704777909,
                    0.15395861829819538,
                ],
            ),
        ] {
            let s = prepare(&image::DynamicImage::ImageRgb32F(image));
            for (actual, expected) in [s.mean_log, s.low_log, s.high_log, s.contrast_key]
                .into_iter()
                .zip(expected)
            {
                assert!(
                    (actual as f64 - expected).abs() < 0.00001,
                    "{actual} vs {expected}"
                );
            }
        }
    }

    #[test]
    fn neutral_gray_transfer_matches_reference() {
        let image = image::DynamicImage::ImageRgb32F(image::Rgb32FImage::from_pixel(
            4,
            3,
            image::Rgb([0.18; 3]),
        ));
        assert!((prepare(&image).mean_log + 1.3713675709178694).abs() < 0.00001);
    }
}
