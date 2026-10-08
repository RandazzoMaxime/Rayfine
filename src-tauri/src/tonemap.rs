//! Prepared-log local-Laplacian ToneMap mask. Input preparation belongs to the caller.
//! Gaussian phase/weights and source-coarsest collapse follow recovered arithmetic.
//! Scene-distribution filtering is explicitly approximate: exclude logs <= -11.

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct LogStats {
    pub low: f32,
    pub high: f32,
    pub anchor: f32,
    pub mean: f32,
    pub mean_filtered: f32,
    pub max: f32,
    pub skew: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct ToneMask {
    pub filtered: Vec<f32>,
    pub mask: Vec<f32>,
    pub source: LogStats,
    pub filtered_stats: LogStats,
}

const FLARE: f64 = 1.0 / 4096.0;
use rayon::prelude::*;

const MAX_LEVELS: usize = 16;

/// Input is already prepared GrayLogImage, row-major with no padding.
/// The flare-floor distribution filter is approximate; source RGB/profile/log
/// preparation and the native upper-tail duplicate filter belong to the caller.
pub(crate) fn prepare(logs: &[f32], width: u32, height: u32) -> ToneMask {
    prepare_with_options(logs, width, height, None, MAX_LEVELS)
}

fn prepare_with_options(
    logs: &[f32],
    width: u32,
    height: u32,
    mask_width: Option<f64>,
    max_levels: usize,
) -> ToneMask {
    assert!(width > 0 && height > 0, "empty prepared-log image");
    assert_eq!(
        logs.len(),
        (width as usize)
            .checked_mul(height as usize)
            .expect("image dimensions overflow")
    );
    assert!(logs.iter().all(|x| x.is_finite()), "nonfinite prepared log");
    assert!(
        (1..=MAX_LEVELS).contains(&max_levels),
        "invalid pyramid level count"
    );
    let source_stats = statistics(logs);
    let range = source_stats.high - source_stats.low;
    let remap_width = mask_width.unwrap_or_else(|| configured_width(range));
    assert!(
        remap_width.is_finite() && remap_width > 0.0,
        "invalid remap width"
    );
    let reference_count = (range.ceil() as usize)
        .checked_add(1)
        .expect("prepared-log range overflow")
        .max(2);
    let original = pyramid(
        Image::new(width as usize, height as usize, logs.to_vec()),
        max_levels,
    );
    let mut accumulated: Vec<Image> = original[..original.len() - 1]
        .iter()
        .map(|level| Image::new(level.width, level.height, vec![0.0; level.data.len()]))
        .collect();
    for reference_index in 0..reference_count {
        let reference = if reference_index == reference_count - 1 {
            source_stats.high
        } else {
            source_stats.low + reference_index as f64 * range / (reference_count - 1) as f64
        };
        let remapped: Vec<f32> = logs
            .par_iter()
            .map(|&x| (x as f64).clamp(reference - remap_width, reference + remap_width) as f32)
            .collect();
        // One reference pyramid at a time: memory does not scale with bin count.
        let remap_pyramid = pyramid(
            Image::new(width as usize, height as usize, remapped),
            original.len(),
        );
        for level in 0..accumulated.len() {
            let current = &remap_pyramid[level];
            let expanded = resize(&remap_pyramid[level + 1], current.width, current.height);
            // Per pixel in parallel; references stay sequential, so each pixel sums in order.
            let source_level = &original[level];
            accumulated[level].data.par_iter_mut().enumerate().for_each(|(index, output)| {
                let coordinate = if range > 0.0 {
                    (((source_level.data[index] - source_stats.low as f32) / range as f32)
                        * (reference_count - 1) as f32)
                        .clamp(0.0, (reference_count - 1) as f32)
                } else {
                    0.0
                };
                // Interpolation is between reference values, not between pixels.
                let weight = (1.0 - (coordinate - reference_index as f32).abs()).max(0.0);
                *output += (current.data[index] - expanded.data[index]) * weight;
            });
        }
    }
    // Native collapse starts by copying the original source Gaussian coarsest.
    let mut filtered = original.last().unwrap().clone();
    for laplacian in accumulated.iter().rev() {
        filtered = resize(&filtered, laplacian.width, laplacian.height);
        for (value, detail) in filtered.data.iter_mut().zip(&laplacian.data) {
            *value += detail;
        }
    }
    let filtered_stats = statistics(&filtered.data);
    let anchor_shift = (source_stats.anchor - filtered_stats.anchor) as f32;
    let mask = filtered
        .data
        .par_iter()
        .zip(logs)
        .map(|(&filtered, &source)| (filtered + anchor_shift - source).min(4.0))
        .collect();
    ToneMask {
        filtered: filtered.data,
        mask,
        source: source_stats.public(),
        filtered_stats: filtered_stats.public(),
    }
}

#[derive(Clone)]
struct Image {
    width: usize,
    height: usize,
    data: Vec<f32>,
}

impl Image {
    fn new(width: usize, height: usize, data: Vec<f32>) -> Self {
        Self {
            width,
            height,
            data,
        }
    }
}

fn pyramid(source: Image, max_levels: usize) -> Vec<Image> {
    let mut levels = vec![source];
    while levels.len() < max_levels {
        let current = levels.last().unwrap();
        if current.width == 1 && current.height == 1 {
            break;
        }
        levels.push(resize(
            current,
            current.width.div_ceil(2),
            current.height.div_ceil(2),
        ));
    }
    levels
}

struct AxisSample {
    indices: [usize; 8],
    weights: [f32; 8],
    count: usize,
}

fn axis_plan(source_size: usize, destination_size: usize) -> Vec<AxisSample> {
    const UNIT: f64 = 4294967296.0;
    let step = (source_size as f64 / destination_size as f64 * UNIT + 0.5) as i64;
    let scale = (UNIT / step as f64).min(1.0);
    let radius = (2.0 / scale).ceil() as usize;
    let count = 2 * radius;
    // Consecutive ceil-half pyramid levels / their inverses use at most 8 taps.
    assert!(count <= 8, "non-pyramid Gaussian scale");
    let mut table = [[0.0f32; 8]; 128];
    for (phase, weights) in table.iter_mut().enumerate() {
        let mut total = 0.0f64;
        for (tap, weight) in weights[..count].iter_mut().enumerate() {
            let distance = (tap as f64 - radius as f64 + 1.0 - phase as f64 / 128.0) * scale;
            // Recovered table generator's positive-support cutoff. Do not replace
            // this with a textbook symmetric tap table or quantized int weights.
            *weight = if distance >= 2.0 {
                0.0
            } else {
                (-2.0 * distance * distance).exp() as f32
            };
            total += *weight as f64;
        }
        let normalization = (1.0 / total) as f32;
        for weight in &mut weights[..count] {
            *weight *= normalization;
        }
    }
    let base = (step >> 1) - 0x7f000000 + ((1 - radius as i64) << 32);
    (0..destination_size)
        .map(|destination| {
            let coordinate = base + destination as i64 * step;
            let start = coordinate >> 32;
            let phase = ((coordinate >> 25) & 127) as usize;
            let mut indices = [0; 8];
            for (tap, index) in indices[..count].iter_mut().enumerate() {
                *index = (start + tap as i64).clamp(0, source_size as i64 - 1) as usize;
            }
            AxisSample {
                indices,
                weights: table[phase],
                count,
            }
        })
        .collect()
}

/// Same recovered separable Gaussian for both downsampling and expansion.
/// Vertical stage always precedes horizontal; boundaries replicate source edges.
/// Rows run in parallel; each output value keeps its serial tap order (bit-identical).
fn resize(source: &Image, width: usize, height: usize) -> Image {
    use rayon::prelude::*;
    let vertical_plan = axis_plan(source.height, height);
    let mut vertical = vec![0.0f32; source.width * height];
    vertical.par_chunks_exact_mut(source.width.max(1)).zip(&vertical_plan).for_each(|(output, sample)| {
        for tap in 0..sample.count {
            let row = sample.indices[tap] * source.width;
            let input = &source.data[row..row + source.width];
            let weight = sample.weights[tap];
            for (value, input) in output.iter_mut().zip(input) {
                *value += input * weight;
            }
        }
    });
    let horizontal_plan = axis_plan(source.width, width);
    let mut data = vec![0.0f32; width * height];
    data.par_chunks_exact_mut(width.max(1)).enumerate().for_each(|(y, output)| {
        let input = &vertical[y * source.width..(y + 1) * source.width];
        for (value, sample) in output.iter_mut().zip(&horizontal_plan) {
            for tap in 0..sample.count {
                *value += input[sample.indices[tap]] * sample.weights[tap];
            }
        }
    });
    Image::new(width, height, data)
}

fn configured_width(range: f64) -> f64 {
    let knots = [(2.0, 1.4), (3.5, 1.6), (5.0, 2.3), (6.5, 2.5), (12.0, 2.5)];
    let mut result = knots[0].1;
    for pair in knots.windows(2) {
        if range <= pair[0].0 {
            break;
        }
        let fraction = ((range - pair[0].0) / (pair[1].0 - pair[0].0)).clamp(0.0, 1.0);
        result = pair[0].1 + fraction * (pair[1].1 - pair[0].1);
    }
    f64::log2(result)
}

struct Stats64 {
    low: f64,
    high: f64,
    anchor: f64,
    mean: f64,
    mean_filtered: f64,
    max: f64,
    skew: f64,
}

impl Stats64 {
    fn public(&self) -> LogStats {
        LogStats {
            low: self.low as f32,
            high: self.high as f32,
            anchor: self.anchor as f32,
            mean: self.mean as f32,
            mean_filtered: self.mean_filtered as f32,
            max: self.max as f32,
            skew: self.skew as f32,
        }
    }
}

fn srgb_encode(x: f64) -> f64 {
    if x <= 0.0031308 {
        12.92 * x
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

fn srgb_decode(x: f64) -> f64 {
    if x > 0.040449936 {
        ((x + 0.055) / 1.055).powf(2.4)
    } else {
        x / 12.92
    }
}

fn statistics(logs: &[f32]) -> Stats64 {
    let mean = logs.iter().map(|&x| x as f64).sum::<f64>() / logs.len() as f64;
    let floor = FLARE.log2() + 1.0;
    let mut kept: Vec<f64> = logs
        .iter()
        .filter(|&&x| x as f64 > floor)
        .map(|&x| x as f64)
        .collect();
    if kept.is_empty() {
        kept.extend(logs.iter().map(|&x| x as f64));
    }
    // total_cmp is a total order: the sorted result is unique, parallel or not.
    kept.par_sort_unstable_by(f64::total_cmp);
    let n = kept.len();
    let lower = ((n as f64 * 0.0001) as usize).min(n - 1);
    let upper = ((n as f64 * 0.9999) as usize).min(n - 1);
    let low = kept[lower];
    let high = kept[upper];
    let mean_filtered = kept.iter().sum::<f64>() / n as f64;
    let mut m2 = 0.0;
    let mut m3 = 0.0;
    for &value in &kept {
        let centered = value - mean_filtered;
        m2 += centered * centered;
        m3 += centered * centered * centered;
    }
    let variance = m2 / n as f64;
    let skew = if variance > 1e-20 {
        m3 / n as f64 / variance.powf(1.5)
    } else {
        0.0
    };
    let ymin = (low.clamp(-120.0, 120.0).exp2() - FLARE).max(0.0);
    let ymax = (high.clamp(-120.0, 120.0).exp2() - FLARE).max(0.0);
    let anchor_linear = if ymax == ymin {
        ymin
    } else {
        // Transcendentals in parallel, then summed serially in order (bit-identical).
        let encoded: Vec<f64> = kept[lower..=upper]
            .par_iter()
            .map(|&x| {
                let linear = (x.clamp(-120.0, 120.0).exp2() - FLARE).max(0.0);
                srgb_encode(((linear - ymin) / (ymax - ymin)).clamp(0.0, 1.0))
            })
            .collect();
        let sum: f64 = encoded.iter().sum();
        ymin + (ymax - ymin) * srgb_decode(sum / (upper - lower + 1) as f64)
    };
    Stats64 {
        low,
        high,
        anchor: (anchor_linear.max(0.0) + FLARE).log2(),
        mean,
        mean_filtered,
        max: *kept.last().unwrap(),
        skew,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn decode_golden(hex: &str) -> Vec<f32> {
        hex.as_bytes()
            .chunks_exact(8)
            .map(|b| {
                f32::from_bits(u32::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
            })
            .collect()
    }
    #[test]
    fn independent_python_37_by_29_golden() {
        let source: Vec<f32> = (0..29)
            .flat_map(|y| {
                (0..37).map(move |x| {
                    (-12.0f64 + ((x * 17 + y * 23 + x * y * 5) % 113) as f64 / 10.0) as f32
                })
            })
            .collect();
        let actual = prepare(&source, 37, 29);
        let expected_filtered = decode_golden(FILTERED);
        let expected_mask = decode_golden(MASK);
        assert_eq!(actual.filtered.len(), 1073);
        assert_eq!(actual.mask.len(), 1073);
        let filtered_error = actual
            .filtered
            .iter()
            .zip(expected_filtered)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        let mask_error = actual
            .mask
            .iter()
            .zip(expected_mask)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            filtered_error < 1e-5,
            "filtered golden max error {filtered_error}"
        );
        assert!(mask_error < 1e-5, "delta golden max error {mask_error}");
        println!("37x29 golden max errors: filtered={filtered_error}, delta={mask_error}");
        assert!((actual.source.anchor - SOURCE_ANCHOR).abs() < 1e-5);
        assert!((actual.filtered_stats.anchor - FILTERED_ANCHOR).abs() < 1e-5);
        let source = actual.source;
        let filtered = actual.filtered_stats;
        for (actual, expected) in [
            (source.low, -10.899999618530273),
            (source.high, -0.800000011920929),
            (source.mean, -6.369524695777716),
            (source.mean_filtered, -5.8585040994354936),
            (source.max, -0.800000011920929),
            (source.skew, -0.03701784817912342),
            (filtered.low, -8.899425506591797),
            (filtered.high, -4.734389781951904),
            (filtered.mean, -6.422507225189493),
            (filtered.mean_filtered, -6.422507225189493),
            (filtered.max, -4.734389781951904),
            (filtered.skew, -0.351407977663402),
        ] {
            assert!(
                (actual as f64 - expected).abs() < 1e-5,
                "statistic {actual} != {expected}"
            );
        }
    }
    #[test]
    fn parallel_result_is_bit_identical_to_single_thread() {
        let (w, h) = (301u32, 197u32);
        let mut x: u32 = 0x9e37_79b9;
        let logs: Vec<f32> = (0..w * h)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                -12.0 + (x % 10_000) as f32 / 10_000.0 * 14.0
            })
            .collect();
        let serial = rayon::ThreadPoolBuilder::new()
            .num_threads(1)
            .build()
            .unwrap()
            .install(|| prepare(&logs, w, h));
        let parallel = prepare(&logs, w, h);
        let bits = |v: &[f32]| v.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&serial.mask), bits(&parallel.mask));
        assert_eq!(bits(&serial.filtered), bits(&parallel.filtered));
    }

    #[test]
    fn constant_image_preserves_source_and_zero_mask() {
        let actual = prepare(&vec![-3.0; 35], 7, 5);
        assert!(actual.filtered.iter().all(|x| (x + 3.0).abs() < 3e-6));
        assert!(actual.mask.iter().all(|x| x.abs() < 3e-6));
    }
    #[test]
    fn wide_remap_preserves_nonconstant_source() {
        let source: Vec<f32> = (0..35)
            .map(|i| -8.0 + (((i % 7) * 7 + (i / 7) * 11) % 23) as f32 / 3.0)
            .collect();
        let actual = prepare_with_options(&source, 7, 5, Some(20.0), MAX_LEVELS);
        assert!(
            actual
                .filtered
                .iter()
                .zip(&source)
                .all(|(a, b)| (a - b).abs() < 3e-6)
        );
        assert!(actual.mask.iter().all(|x| x.abs() < 3e-6));
    }
    #[test]
    fn dark_single_pixel_has_finite_identity() {
        let actual = prepare(&[-12.0], 1, 1);
        assert_eq!(actual.filtered, [-12.0]);
        assert_eq!(actual.mask, [0.0]);
        assert_eq!(actual.source.anchor, -12.0);
        assert_eq!(actual.source.skew, 0.0);
    }
    #[test]
    #[should_panic(expected = "nonfinite prepared log")]
    fn rejects_nonfinite_source() {
        prepare(&[f32::NAN], 1, 1);
    }
    #[test]
    #[should_panic(expected = "empty prepared-log image")]
    fn rejects_empty_geometry() {
        prepare(&[], 0, 1);
    }
    #[test]
    #[should_panic]
    fn rejects_mismatched_geometry() {
        prepare(&[-3.0], 2, 1);
    }
    #[test]
    #[ignore] // Deliberate cold-path timing, independent of the GPU oracle.
    fn benchmark_1600_proxy() {
        let source: Vec<f32> = (0..1069)
            .flat_map(|y| {
                (0..1600).map(move |x| {
                    (-12.0f64 + ((x * 17 + y * 23 + x * y * 5) % 113) as f64 / 10.0) as f32
                })
            })
            .collect();
        let started = std::time::Instant::now();
        let actual = prepare(&source, 1600, 1069);
        println!("1600x1069 prepared-log cold mask: {:?}", started.elapsed());
        assert!(actual.mask.iter().all(|x| x.is_finite() && *x <= 4.0));
        assert_eq!(actual.mask.len(), source.len());
    }
    const SOURCE_ANCHOR: f32 = -4.728101994035;
    const FILTERED_ANCHOR: f32 = -6.357627434550;
    const FILTERED: &str = concat!(
        "c10e640cc0f1ed8fc0e22c88c0d1668ec0c2faabc0b4809ac0aa8cf2c0feefeac0e95a3ec0da7a4cc0cb7a59c0bc038ac0ad7a54c0a32912c0ec5274c0e24ad2",
        "c0d5a398c0c7e1b7c0b963ebc0b1938dc1093ad0c0f114f8c0e20214c0d07182c0c19533c0b5281cc0a9912dc0fe4e40c0e70150c0d9158ec0c8f91ec0bbab2f",
        "c0acbb27c0a31c58c0e957ccc0df3c48c0cc7488c0e944c5c0d48082c0c23663c0b18c5bc0a0e071c0e41ff7c0d6268dc0c83934c0baca57c0ab16d4c0ece380",
        "c0dbae94c0ca293ac0ba2679c0ac3fa2c0f0a738c0e0e8e7c0cc2afcc0b9484fc0ad4684c0f2b2c4c0e08ec4c0cc0cdfc0b9963dc0a734dcc0f30be2c0dce53a",
        "c0cefd63c0bfa7b1c0aef06dc10109cfc0e218f9c0d16c02c0c223a5c0b40bd1c10726ecc0e67bcbc0d58759c0be4992c0ab4addc0ecb766c0d90730c0c402b1",
        "c0affd85c0f51b98c0dc27a4c0c75758c0b26272c102463ac0e01f9fc0cbbea1c0b83f4cc0a762d4c0e86751c0d04b3cc0b91b6ac0a8e8dbc0ea5863c0d30a6f",
        "c0bc5152c0a96a34c0ea4789c0d5f936c0c29a7bc0aef712c0ef65d5c0da2c69c0c51df0c0b09e9ac0fcab42c0dcb62cc0c98d6bc0b5a0b9c105254ac0c1e0a9",
        "c0a87528c0e6b21ec0cfca88c0b83e1fc103f5f5c0dc4d3bc0c4bb13c0acf031c0e92cadc0d180f0c0ba12f3c1077ba2c0de251cc0c6943fc0b012b2c0ef2b4b",
        "c0d3b791c0b95483c0a5e4a9c0e188f2c0c80fc8c0ad6ef4c0ebdb12c0d4317bc0bc7085c0a6dfe2c0e19596c0c9085ec0b09465c0ed5f7ac0d5546ec0bd8ddd",
        "c0a68219c0e20ae9c0ca51dcc0aff622c0b2fbd4c0e8cce0c0cf0547c0b35812c0ec761ac0d06dcfc0b3c200c0edaa6ac0d2d187c0b73fedc0f208acc0d41df1",
        "c0b87eaac0f821b0c0d578abc0bafcc6c10016c8c0d70a04c0b9dc3ec10213a4c0d95095c0bc97aac10514e0c0d943e4c0bda309c1087924c0dc276dc0c028bc",
        "c0a5b896c0dbbd82c0c0ae90c0a58d92c0dde8a3c0c15663c0a63ca6c0e04da7c0c1553ec105e52ac0d5dda6c0b775d1c0ebd92ac0cb5ca2c0ab0db2c0df1c48",
        "c0c27c36c0a53cf8c0d9f444c0b9afa8c0edf16fc0ce2407c0ae6927c0e50ebec0c58ad2c0a86fd8c0da1500c0b9f275c0f44c5bc0d0038fc0b0fb53c0e56fba",
        "c0c73bd5c0a986c0c0dda164c0be1034c0fe406cc0d254fac0b26be6c0e9ab12c0c9a012c0a9a15cc0dd7f69c0bd8d6cc1044826c0d530c3c0e68072c0c15bf8",
        "c10007b4c0ce97ddc0aa4064c0db0643c0b7811ac0eaa18bc0c830d4c0a7ebb9c0d84f72c0b4250bc0e4e7e9c0c183c1c1015682c0cef9eac0ac0b1ec0dcbf66",
        "c0b9c1fec0eb7b56c0c7c275c0a7c886c0d76124c0b43bf7c0e54e6ac0c2408bc1022d03c0d01dd2c0adffb6c0de8556c0bc466fc0ed2208c0c9aa80c0a719b8",
        "c0d70397c0b6ca8fc0e7108dc0d29a88c0ac138ac0da3f67c0b1f889c0de33f8c0b75bf6c0e51d23c0bebf3bc0ec8834c0c7072ec103ebc7c0cd76f4c0a745c6",
        "c0d46069c0ad8406c0d9c947c0b2cc4cc0dfcd98c0b99882c0e7882dc0bfdf9cc0f1cf39c0c80032c10756b7c0ceb62cc0a9b06dc0d564f6c0aed4e7c0dd42ce",
        "c0b5dc46c0e3da78c0bc904ec0ea0222c0c2fcdec0f71fccc0ca0eb6c0a65140c0bfb15ec0e997cac0bf9cb8c0e9a3c4c0bec9c2c0e8b495c0bdf8fbc0e7c437",
        "c0bd1049c0e762aac0bd7edcc0e7d455c0bd0713c0e69a41c0bba70dc0e4eb96c0ba0580c0e40281c0b97c3fc0e34aeec0b88752c0e34ffac0b94415c0e2fde6",
        "c0b802f3c0e21196c0b793bac0e201e7c0b76fc2c0e15db1c0b6ba11c0e0dcccc0b6327bc0dfc443c0b45982c0dd9369c0b1dcacc0aee8b4c0d5d072c0a754d0",
        "c0ce5942c10355bac0c6213ac0ebf308c0bbed14c0e155c2c0b2ac49c0da1adfc0ad38edc0d3bd7ec0a58154c0cb7e5fc0fbe1a3c0c2f036c0e8ca5bc0b9a19d",
        "c0deab0cc0b01352c0d687b6c0aa48e5c0d0317ec108def8c0c79e53c0ef92fec0c19a4cc0e7587bc0b88c12c0dd6baec0aed318c0d4f041c0a74d62c0cd60d8",
        "c101d350c0c43762c10296d3c0c30f60c0e335c7c0b1e918c0d3e701c107960cc0c49b15c0e48a63c0b289b4c0d4d83fc0a462ddc0c7f3a6c0ea33c5c0b8e096",
        "c0dab9fcc0a8b2ecc0c93aefc0ec50c4c0b9db20c0dc1f50c0aaf495c0cd066fc0f52a58c0bc92e0c0df0dacc0ad0298c0d0877dc1012ec6c0c16d8cc0e42c33",
        "c0afee28c0d29adec106c309c0c2a59ec0e69955c0b35c58c0d7954ac0e36debc0ae944cc0caf66cc0e96f23c0b3b160c0d2ca02c0fa984ec0b99810c0d8351a",
        "c0a31792c0c2c9a2c0e1ebbcc0abc0aac0cad89ac0e895a1c0b35c90c0d1be81c0f74bc4c0b9d049c0d93f34c0a66ecec0c2b7cec0e1294fc0aa2f96c0c8eb7e",
        "c0e73625c0b202cfc0d1f5bbc0f5a6acc0bac431c0d75b8dc0a3fb02c0c0be5ac0df9546c0aa1992c0c80424c0e8fc19c0d164dfc0ef09e7c0b29383c0cd3938",
        "c0e8218ac0ae0d6bc0c90218c0e34700c0aae766c0c5f2aec0e088e1c0a6f49ec0c10f4fc0dc4130c0a2ae4ec0bedcfbc0dabf78c103a9d2c0b98b68c0d609fe",
        "c0f9eb84c0b7bf63c0d1cf2ac0ec1e8bc0b38928c0ce25e3c0e8e7bec0af2713c0ca761cc0e59f0dc0ab4df2c0c6c4adc0e10ec0c0a79b39c0c1d8afc0daf6af",
        "c0a6232fc0bdc71dc0d7a289c0ef2b7cc0b0f5a8c0c7a01dc0de1665c108a424c0b8929ac0d06b96c0e80c50c0aa9a84c0c0a923c0d78c36c0f31f58c0b05386",
        "c0c9c8dac0e2a7f6c0a62ce4c0b8ce88c0d25b20c0ec9217c0ad20bbc0c24fa8c0d9d2c8c0fb9794c0b478fec0cac7a7c0e1ae20c0a57a38c0bc33fdc0d353d9",
        "c0eb1fb9c0ad85dcc0c44ba5c0d9fa9ac0fdbfe6c0b37e8cc0a93e5cc0c16e2cc0d648e0c0e9e462c0a7f1bcc0bb13fdc0cec7b8c0e24dc9c106a8efc0b405fe",
        "c0c7dba2c0db0a80c0f09bb3c0ad0156c0bf7405c0d488b9c0e8c60cc0a6cae3c0b7d150c0cea044c0e5a7bdc10633efc0b3cad7c0c71bddc0db81d8c0ef270b",
        "c0ad3073c0c0c4c9c0d44ef2c0e78c70c0a7111cc0b9ee19c0cdc4bac0e0aa78c1037822c0afa7c6c0c5d6fdc0feaa61c0af107ac0bddd72c0cc18ddc0db7179",
        "c0eb804dc0a8634bc0b7c98dc0c65d8cc0d5ec15c0e5e2c1c106ef32c0afb24fc0bf07a2c0ce9b03c0dc786bc0ee37b8c0a59449c0b681aac0cb1cbbc0df3e0f",
        "c0efc5dbc0acd4bec0b7b135c0c53f1ec0d41e23c0e334c7c102c1cec0aec435c0bd731ac0cdf174c0ddb431c0edf5fcc0a9ae8dc0b838c8c0c81d2cc0d98980",
        "c0e3e46cc0f12ccac0a5ab23c0affb6ac0bb2575c0c84046c0d485c6c0e1ad85c0ebe470c0a51c0bc0ae516cc0ba74b8c0c66629c0d1e5aac0dd60a3c0e4d952",
        "c09a9c6cc0a4433ec0b52730c0c75f12c0d6d19dc0e57ffec0f2f5bfc10a2d3ec0af1a16c0b9db78c0c60968c0d1a258c0ddc457c0e88390c105f006c0ad07d2",
        "c0b99368c0c46c97c0d17558c0deed8cc0ef4b2dc0d264bdc0dac316c0e0a277c0e8cd65c0f8c237c0a565c2c0aca991c0b711aac0bf2330c0c6db71c0cd9080",
        "c0d6287bc0ddbc84c0e29cd9c0e61a2cc100166ec09854f5c0a2aa2cc0b3d2bfc0c40145c0cf77eec0da2e98c0e24f4fc0e8c852c0ee7548c104eeacc0a9ea43",
        "c0af3f4ac0b661d7c0be2f2fc0c8de00c0d1ddefc0d98f2ac0dfd3a1c0e79698c0fb1bd0c0a47e96c0bbd840c0c1a08fc0c68bf6c0cc7b0ec0d298d6c0d70c55",
        "c0daa72dc0e01d24c0e46666c0e964fac0edaa06c0f6fc95c103c602c0a55c98c0a0c19fc09e1ae4c09e7777c0a737f6c0b2ec9dc0bc92b6c0c3ec7bc0c90bab",
        "c0ccdb4dc0d16129c0d5c9c1c0da660ec0df4323c0e1f371c0e58cebc0e9ba9bc0f5519bc103e7b4c0a76574c0a8659bc0abd7dfc0aeba4fc0b390b3c0b08139",
        "c0b0d349c0b0b63ec0b151e6c0b26477c0b2ff58c0b36e15c0b4605fc0b54342c0b62a66c0b6e077c0b7186ec0b6a07ac0b4bd33c0b1f531c0af3a3ac0adb8a4",
        "c0afae3ec0b2dc74c0b4bed4c0b5bef1c0b6afd5c0b7a2b9c0ba30a5c0bca47ac0be9973c0bfccdcc0bfbaf5c0bff3ccc0c0b282c0c1df89c0c300b0c0c3ebfd",
        "c0c4cafbc0c54f10c0c54ae1c0c5ac00c0fb3739c0f06ec9c0ebde97c0e81610c0e53a9ac0e2c517c0e088a7c0dd13fcc0dad30bc0d80092c0d58779c0d1ff60",
        "c0ce64e3c0cb7913c0c87353c0c4fbf3c0bf6446c0ba3bf3c0b30339c0ab1111c0a5a64fc0a2fad4c0a303f8c0a31b3ec0a2e753c0a29e5cc0a28484c10111ec",
        "c0f6e979c0ecac52c0e90f21c0e661c5c0e46893c0e2cf16c0e07d22c0ddecbcc0da831dc0e2a152c0dae336c0d2fe05c0cb7919c0c4da2dc0bf4739c0b9b49c",
        "c0b0d618c0a9db8ac0a48a36c0f7a734c0ea1560c0e4b6aac0dfb9bdc0d9c52bc0d331fac0ca4216c0c0c91ac0b35577c0a48185c09b8c6ac09ca0f2c1018430",
        "c0ec21b7c0e65aa5c0dfef55c0d8fee8c0d3be60c0cd4edbc0c5045ec0bb2594c0b504d3c0af2e26c0a85d96c0a1faf6c0f81bdcc0e7141ec0cdb277c0c0806f",
        "c0b7423fc0ac3267c0a3a1fac0edeb58c0e56426c0d9ab02c0d04348c0c51022c0bb036cc0b0ffbec0aa2a00c0f8039bc0eba67cc0e09f7dc0d3b026c0c5ee72",
        "c0b42568c0a1d5d1c097801fc0ecbf75c0e5b35dc0db63cac0d0313ac0c5c274c0baac9dc0b207aec0a8d298c0f7e423c0e3d0d9c0db4611c0d11ba2c0c6d5eb",
        "c0badbb3c0b0ab5cc0a38e25c0bb39d6c0abe9e4c1057654c0e77eb9c0d8da62c0caaca7c0bd411cc0adfadec103d1e2c0e5e79fc0d7954ac0c9dca6c0bc087d",
        "c0b0148dc1048d7ac0eae93fc0dc16d5c0c9d130c0b61010c0a5aca8c0fa02c4c0e23cffc0d756d2c0c81eebc0b9bee0c0ac190ac0ffc41cc0e523c9c0d6b77b",
        "c0c79e60c0b7d1bcc0aa6e89c0fb6975c0e326f5c0d4e149c0c5ee38c0b4f6d3c0a9970ec0ea8868c0db5bafc0cacd59c0b93420c0a6dd8cc0e98165c0d6eb4d",
        "c0c55d8ac0b35378c1078a14c0e4a256c0d2b67ec0c148c5c0b19ee4c0fcf266c0e4184dc0ccee88c0b758bcc0a7f53dc0ebf517c0d956cfc0c68022c0b41ac8",
        "c0a1fbdbc0e51f7cc0d4a86ac0c2bdf3c0b05869c10104a8c0e07ac4c0cef02fc0bcd8e2c0ac502ac0f03892c0de1c00c0c9582fc0f47028c0d8f2fac0c3187f",
        "c0ae3de9c0ee1fcfc0d81586c0c1c5ecc0ac0eddc0ea64cbc0d409f6c0be03bec0aa2f5bc0e8e206c0d31d2ac0be29b1c0ab2d9bc0ea6827c0d0b805c0b7f2ce",
        "c0a7b7dec0e6514cc0ceec54c0b75328c0a2d140c0e18f06c0cbbf58c0b7048cc105f69ec0e061f6c0ca201fc0b3eecbc100849ec0dbc9e3c0c6f9f8c0b30a42",
        "c0fb8dd2c0dc3b2dc0e07214c0c3e0f2c0aa80f3c0e5cfddc0ccd160c0b3c2ecc0ee5338c0d4f68bc0bb829fc1087276c0dc3f00c0c34b98c0ab2412c0e58626",
        "c0cca535c0b41ff9c0f13563c0d46b58c0b8ba22c1070da4c0de93cac0c40027c0a805eec0e483c2c0cb48e9c0b20fd2c0ed1548c0d3ffd7c0ba3893c105a292",
        "c0dc2d24c0c1395ec0a7edd5c0e32cfdc0caec14c0b46f1bc0ede9d3c0cd1b9ec0aaea9ac0e6c2ccc0c93cb6c0ab2062c0e2eca6c0c51981c0a9d17fc0e07a0e",
        "c0c440b3c0a78223c0ddcd66c0c07306c0a32abbc0dabb24c0be3306c105cab7c0d8c07ac0ba3200c0fe2118c0d5b3bcc0b905e2c0f1ff58c0d21708c0b4744a",
        "c0ec960ec0cf4780c0b05774c0e85148c0cb68f6c0b012f8c0e5e042c0c8cbeec0abf427c0e27799c0c6c9d1c0a31fc2c0b4e464c0ee41b6c0cf5234c0ad1437",
        "c0df0cd9c0bdd4bfc10184acc0d220d0c0b16510c0e62604c0c4d593c0a2f984c0d5f64ec0b4478ac0eaf94dc0c9663fc0acf458c0dcffd0c0bae7aac0ee1257",
        "c0cbaee5c0ad8c3ac0dfab52c0c06a96c10045b1c0d338abc0b167eac0e2eb0cc0c1e5cac0a38c3cc0d7980fc0b5c070c0e9394bc0c8a61dc0a51689c0d72022",
        "c0b64705",
    );
    const MASK: &str = concat!(
        "4080000040800000404a577c3ffe2d443f3c8670bf02dc40bff3391840800000408000004033558c3fc911503eb54bb0bf6443a4c0113b3240800000406a1ae8",
        "40169c8e3f8aa708be27db00bfcf53844080000040800000404445fc3ff534a83f2e1898bf21b1e8bffc16d04080000040800000402fb8a23fc649683e879e40",
        "bf77e3d8c0178824408000004069d1944022944840800000401f49203f5c4250bf51a0acc01fdd2440800000402f30403f78f888bf4ec3b8c02116b640800000",
        "403753643f9b2294bef9aff8c010351f40800000404011f03fb981f0be246780bffe1f60408000004053f9683fe060d03e050e00bfbf725a40800000406e7fb0",
        "3ffb05283e7612a0bfb7fa364080000040774b68400bd8863eece3b0bfa6016040800000408000004016d50e3ec41e60bfdc972a40800000402fd55e3f344640",
        "bfaf61ca40800000404994743f8cd080bf71eafc408000004061a4803fbb3360bf20d1d0c03348504071151c3fe900f0be1ecb00c016545e40800000400f0214",
        "3e7a7800bfeeae2040800000402924843f0c54c0bfc4e198408000004040be203f783910bf8b7fb840800000405baa983faa5ea0bf3f1064408000003f2bbce8",
        "bfde0d23408000003ff7d090bf072ec840800000404fafb03f481cd0bfd65fae4080000040054844bec54468408000004058ccb83f6c86a0bfc9501840800000",
        "400da7d0be25ee00c0304bfa405ed1d83f89eec0bfa5278640800000401980cabd728600c025759f406b85603f9fa604bf9823b040800000402407ae3dd900c0",
        "c017ed40407767883fb419a4bf782214bf94f4a0408000003fee18c8bf7997fc4080000040010822bf49b4384080000040090d7ebf3270684080000040134178",
        "bf09332840800000401d58d0bed3e1a840800000402702e8be36e58040800000402f4296bd830c8040800000403c28c43dd3b5c04080000040432e803e65f120",
        "c0298d6e4050cf203ed101c0c01c6a98405945ac3f167580c010fbf4406148703f49b1d0408000004022f53ebf341f88408000003fc98828bfced5b24076de60",
        "3f0d46e0c02efc98402dfb36bef242f8408000003fe4d0fcbfb5dd1e407e2ca83f419ed0c0222f244040ecf0be39ac40408000004001dca2bf99bf6840800000",
        "3f8071c4c01129c2404d075cbc2310004080000040106cfcbf72369c408000003f9d4734bffc578c40607e883e9cad9040800000401de8a0407b49403ec62b40",
        "408000003fefce70bfd86d464058a408be51e760408000003f963760c02126e64024780cbf7fffc4408000003ef6e1f0408000003ffb1308bfd2cb62405b9824",
        "be339d80408000003fa4bdacc01a7a1a402cbb10bf671d88408000003f0f2440408000004001a81abfcdd0f4405e72acbe1dc520408000003fa9ea48c012b618",
        "4033dc92bf61f8ac40800000400fe1e0bfdfb9de403a31c0bf841aa6406be234be99d4a8408000003ebcc3e0408000003f81445c408000003fdab878c0130e34",
        "401922eebfcbe2344047eaccbf5ba03440757bc0be2e6e00408000003f089218408000003f96f9e8408000003fef5530c00b16b54023e69ebfb78c1e404dc488",
        "bf40ecd4407a2eccbd813580408000003f22db38408000003fa85970c03125283f0a0408408000003ee21f40408000003ebc1b60408000003e95f4b040800000",
        "3e629940408000003ddcc0c0408000003cb79a0040800000bd0dca0040800000bdab4ec040800000be2ae58040800000be72ae6040800000beb85688407be7f0",
        "bed7779840775a2cbf01dba840711324bf1a5580406bf52cbf2e41884066908cbf439e7440625b38bf4e704c40605688bf542334bf9e41ba4029760cc0065f7b",
        "3fe3fc0c408000003f701ec0408000003e20996040800000bf276ce8404dae00bfcab5d04014025cc01c521c3fbc3468408000003f23407840800000be2f9140",
        "40715a74bf790b94403b3ab8bff228e4400180c2408000003f988168408000003e8f12c040800000bf099e68405a3f94bfaab8164024d00ac00cb7063fdb10e8",
        "408000003f65d3e8408000003ede27f040800000bf90a9b0401a15be408000003f491cc040800000bf3ff1d84031ccdcc01a152e3f8a5f4840800000bf0c4288",
        "403fa2f8c0091bb33fb8755c40800000be36c1c0405671ecbfe80ad73fdc7a90408000003e0bdfe0406a2eccbfbd0fb04000d4c6408000003ec5120040798b58",
        "bf958abc4016479c408000003f3f2ed040800000bf6020944025ec5c4074a184bfdcf01a3fbe543040800000bf62c8d4400f82ec40800000bd8ff2c04044acbc",
        "c01de4ff3f24751840713f78bfde6e5e3fb1feac40800000bf79bbec400b338a40800000be3566c0403c3224c02af9de3f0b6a20406c5df0bfe4f6db3face650",
        "40800000bf8443be40045eb040800000be9d25104039930cc02c78ac3f019c2840691f98bff16b983fa3b6ec408000004005806840800000bf86868e3fdbaf68",
        "40800000bfb46e2e3fac8be840800000bfe7d61b3f719320406d9eccc00c057e3f18ae2040562e2cc02378de3e2903004039319c40800000be2ccac040229c8e",
        "40800000bf1cd280400b123640800000bf7b20ac3fe4c98c40800000bfac08023fb388a440800000bfdca37e3f824e644072f970c006ec4d3f2bfcb8405f2994",
        "c023fc393ecc45c0402c384840800000bf99a8bc3f987a404065b6f440800000bead3ee840010c9240800000bff36f603f0245e8403931b840800000bf7b0d34",
        "3fa970e0406960a0c02a760abe152ec04009fa4a40800000bfe3eea23f2844e84041716040800000bf6905c83fbf0f4840782118c01c43e4bd5442004014d5a8",
        "40800000bfcbe98c3f4b9840404dee8840800000bf2dff00bfa131f23f15b73040221eca40800000c0079953bdeeedc03fef0f004076e1c840800000bf4bd428",
        "3f978c28404bcebc40800000bfbd0aa83f0beed8401f38b440800000c00bb208bdeb0f803fe2e0044069c77840800000bf63948c3f8dbe70404479a840800000",
        "bfca93e83ecf9e40401945da40800000c012a4e0be8fc3903fd98160406d5b9c40800000bf5c159c3f86052440800000bfd21404bb7630003fd3640c40516734",
        "40800000c00ee2d8bf1d23d03f83eae440293ec84080000040800000bf949b583eeb70a04004adba406f595040800000bfd289a7bd9726003fb0ee2c40369ad4",
        "40800000c02af8f0bf692ddc3f43fc704019a77a4080000040800000bfb749563e563f003fe59b444059ae9040800000c004ac8ebedad4f83f968600402ed0be",
        "4066e7b440800000c0230c21bfa28c92bc99fc003f95f9984018d8324064ef1c40800000c0285458bfa8b166bdc71cc03f9095404017b2044067227840800000",
        "c019bb80bf8d457abd010f003f7fc998400773b840507d5c4080000040800000bfc56da8be8e99903f70dd50400b6bda40598e444080000040800000bfc9f164",
        "bebd4bc83f642a4840055f744050d574408000003fed67c0402c5d92406705384080000040800000c022815fbfd5452ebf64318cbd3242003f50b3783fda5248",
        "40225f9640599de8408000004080000040800000bfaa5924bf0dc2643c24a7003f1ab8083fac4e2840072028403d45204076b9804080000040800000c00b8a61",
        "bf9f9c12bebd65d83ef8f7e03fa04f7c40048e48403b923840756fb04080000040800000c013e63a3e84cd203f2dbdb83f8ffe083fc50e783ff96424401a317c",
        "403962344054dca84072b08c40800000408000004080000040800000c0226f0bbfe5a565bf8e3dacbf05c658be48c2d03d1c3ac03eac58f03f34f7f03f92cc08",
        "3fd05a4c400587d440231d0a40404ad4405cf714407dfcdc40800000408000004080000040800000c0201a5cbff76888bfb864ccbf6e437cbef6ba08bfd7d700",
        "bfcc5274bfbf117abfb4b34ebfac30c6bfa1cf7cbf96bda4bf8db9fcbf8478c0bf769108bf62a7ecbf4ace14bf2d74d8bf04c100bea9ceb8be15d8203a410000",
        "3d21d0c03d244f403da65c403e1991003e61db003e94f2703e9f46e03eab3cb03ebf20603edf1d003f09b7583f218a303f352e183f455f803f55efe03f682f18",
        "3f7ad0c03f8824d43f9502603fa04ab04080000040800000408000004080000040800000406f8cc4405a6c0c4047bbc44032a410401eaf66400a08003feefd30",
        "3fca33f43fa2b0003f7727983f2c7c303ee5a6603e56bda03d10ecc0bdee32e0beb1ad60bf29e140bf884862bfbbd8aebfee3c35c01025c6c0298bb040800000",
        "40800000408000004080000040800000408000004075df2c4060e978404c70ac4039aa54405ca118403283b84008b4823fbc49803f4724003d555380bf2c7c50",
        "bfa5f74abffd4044c02d97144080000040800000407876684048d6ac401b26363fdd65f83f8df2583f0146283ccf9b80bed293f8bf8403c4bffb891840800000",
        "408000004080000040686b7c403cb2bc400d9a303fc1bf483f5f6c083e8ff7e0bedac8d0bf928ab4bfea7ba8c022122e40800000408000003fe6973c3f505850",
        "be983928bfad021ec01ef9cf40800000407d81d8403b5a883fe920c03f457450bea118d0bfb36aaec025a37440800000407763944033d7f83fe83a183f581b68",
        "b82c0000bf53ec5cbff3d29840800000408000004044b5c44001814a3f7314f0bdd515c0bf9df0d4c01627d84080000040800000404b579c400612e03f82096c",
        "bc207400bf8bb2c0c005388c3da13580bfabe0124080000040800000403695603fb2ae7cbdad6900bfc0f0c840800000408000004032b92a3fa921b0be1606e0",
        "bfd6245040800000407f447440234fb03f9c82bcbd757f00bfb9518a40800000408000004026694c3f967f08be8cd010bfdfcfde40800000407e029440214196",
        "3f8bb460bea13108bfe5f2a740800000407b95d4401e87943f85a834bea6b598bfd5c7ee40800000405192c83fb22bb4beea8a78c0123dc040800000402da6c0",
        "3f5ca2a8bf79732c40800000407f05784009438e3e942b40bfcf80e04080000040534cc03fd00d5cbdccea80c00139ee40800000403c02f03f902d58bf32e0e0",
        "c02213f840800000401892ea3f0b3900bfa4008e40800000406dbb043fee6d283ce5ca00bfed792b408000004045abbc3fab339040800000403cca983f3b97d0",
        "bfc1fcf440800000402b524c3ef2bf30bfdfa72a40800000402036383e954870bffe8f8840800000400edc9cbc560800c014777840800000400073b6bdf36f00",
        "c020bf30407ba78c3fe1afc4becc7af8c02a25284071f8e43fc7fd50bf3095684080000040611fd03fa813d0bf64b42c4080000040571cc83f8e4600bf952e58",
        "4080000040430700405432c83f4eedd0bfe63c4f408000003fd081fcbf7ceecc40800000401e5d10be054b20408000004056328c3f39ff00bff5959840800000",
        "3fc465e0bf8cb8664080000040190d0ebe12a20040800000404b22903f1ac0f8bff5e9d4408000003fbd0a40bf9144984080000040137dacbe946b3040800000",
        "404989743f175da0c0012b1e408000003fb1b0c4bfa78e86408000003fcf5904bf9b161e408000003faba170bfcf2072408000003f88fb14bffd1818406dbc70",
        "3f325630c01386ee40597c243ed4ba60c02471b8404607103dafb64040800000403062cabe419dc040800000401ce2acbf0d6ce840800000400a827abf4f468c",
        "408000003fed0fe0bf8a6320408000003fc956d8bfbc8462408000003fa097c4bfdf3c52407cf48c3f6ada10bfef1df13d9cf840408000003fe01844bfca22f8",
        "407096dc3ecb6ba0408000004010d550bf8e9990408000003f4748d0c0240f4a402f90bcbf1aad58408000003f9e2e84c0119e8b4047e41cbe58530040800000",
        "3fe1d8b8bfd8cfd24068f3803e5db5e04080000040083f36bf9b71c4408000003f452d70c02b9b204025e6d4bf400e24408000003f946240c0084954404d3d14",
        "be2aa4a0",
    );
}
