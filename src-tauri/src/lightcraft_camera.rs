// Port of LightCraft's JPEG-fitted camera look (storytold/lightcraft, MIT / Apache-2.0).
//
// Copyright (c) 2026 ArtCraft Team and the LightCraft contributors
// Copyright (c) 2026 Rayfine contributors (integration)
//
// Licensed under MIT or Apache-2.0 (see THIRD_PARTY/lightcraft/).
// Algorithm from `crates/engine/src/camera_preview.rs` at LightCraft 0.13.0
// (`38f8d2508`): chromaticity 3×3 (`fit_matrix`) and quantile CameraTone
// (`fit_tone`). All output pixels still come from the RAW; the JPEG is
// correspondences only.
//
// Spectral / DNG camera matrices are Apache-2.0 rawtoaces-data via LightCraft
// `spectral_table.rs`. This file does not embed Adobe profiles.

    use crate::lightcraft_develop::{
    apply_chroma_scale, camera_tone_apply, lum2020, srgb_to_rec2020, CHROMA_N, IDENTITY3,
    IDENTITY_CHROMA, SONY_DRO_OFF,
};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Minimum scene-luminance range (brightest knot / darkest) LightCraft requires.
const MIN_TONE_RANGE: f32 = 1.2;
const PROXY: u32 = 96;

/// Fitted per-photo look: chromaticity matrix in Rec.2020, 32-knot tone,
/// and 8-node chroma-by-display-luminance (LightCraft `CameraTone.chroma`).
#[derive(Clone, Copy, Debug)]
pub struct CameraLook {
    pub matrix: [[f32; 3]; 3],
    pub knots: [[f32; 2]; 32],
    pub chroma: [f32; CHROMA_N],
}

impl Default for CameraLook {
    fn default() -> Self {
        Self {
            matrix: [
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            knots: SONY_DRO_OFF,
            chroma: IDENTITY_CHROMA,
        }
    }
}

fn look_cache() -> &'static Mutex<HashMap<String, CameraLook>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CameraLook>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Remember a fitted look (preview load) so slider updates reuse it.
pub fn remember_look(path: &str, look: CameraLook) {
    if let Ok(mut cache) = look_cache().lock() {
        cache.insert(path.to_string(), look);
    }
}

/// Cached look for a source path, if the RAW has already been fitted.
pub fn look_for_path(path: &str) -> Option<CameraLook> {
    look_cache().lock().ok()?.get(path).copied()
}

/// Sony DRO-off ceiling: never brighter than the pooled Sony curve (LightCraft
/// `dro_off`). Applied when the file is a Sony body — DRO is on by default and
/// only brightens the JPEG.
pub fn apply_sony_dro_off_ceiling(knots: [[f32; 2]; 32]) -> [[f32; 2]; 32] {
    let mut out = knots;
    for knot in &mut out {
        let ceiling = camera_tone_apply(knot[0], &SONY_DRO_OFF);
        if ceiling < knot[1] {
            knot[1] = ceiling;
        }
    }
    for i in 1..32 {
        if out[i][1] < out[i - 1][1] {
            out[i][1] = out[i - 1][1];
        }
        if out[i][1] >= 1.0 {
            out[i][1] = 0.999;
        }
        if out[i][0] <= out[i - 1][0] {
            out[i][0] = out[i - 1][0] + 1e-4;
        }
    }
    out
}

fn raw_is_sony(bytes: &[u8]) -> bool {
    let n = bytes.len().min(262_144);
    let hay = &bytes[..n];
    hay.windows(4).any(|w| w.eq_ignore_ascii_case(b"SONY"))
        || hay.windows(4).any(|w| w == b"ILCE" || w == b"ILCA" || w == b"ILME")
}

/// Largest *displayable* embedded JPEG in a RAW container (preview, not the
/// 160 px thumbnail).
///
/// A naive first-`FF D9` scan is wrong on Panasonic RW2 (and some Sony ARW):
/// EXIF thumbnails embed their own EOI, and the CFA payload is full of stray
/// `FF D8 … FF D9` runs. LightCraft `preview.rs` `walk_jpeg` rejects those;
/// g95-0273's largest naive slice is 2.4 MB of sensor data that does not
/// decode, so CameraTone never fitted and the night scene stayed on Hdr.
pub fn extract_embedded_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut best: Option<&[u8]> = None;
    let mut i = 0;
    while i + 3 < bytes.len() {
        if bytes[i] == 0xff && bytes[i + 1] == 0xd8 {
            if let Some((end, w, h, components)) = jpeg_extent(&bytes[i..]) {
                let slice = &bytes[i..i + end];
                if components == 3
                    && w.max(h) >= 200
                    && slice.len() > best.map(|b| b.len()).unwrap_or(0)
                {
                    best = Some(slice);
                }
                i += end.max(2);
                continue;
            }
        }
        i += 1;
    }
    best.map(|b| b.to_vec())
}

/// End (exclusive) of the DCT JPEG at offset 0, plus SOF width / height /
/// component count. Port of LightCraft `walk_jpeg`: baseline or progressive
/// only, so a stray `FF D8` in CFA data is rejected.
fn jpeg_extent(bytes: &[u8]) -> Option<(usize, u32, u32, u8)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut i = 2;
    let mut frame: Option<(u32, u32, u8)> = None;
    for _ in 0..4096 {
        if *bytes.get(i)? != 0xff {
            return None;
        }
        while *bytes.get(i)? == 0xff {
            i += 1;
        }
        let marker = *bytes.get(i)?;
        i += 1;
        match marker {
            0xd9 => {
                let (w, h, c) = frame?;
                return Some((i, w, h, c));
            }
            0x01 | 0xd0..=0xd8 => continue,
            _ => {}
        }
        let len = u16::from_be_bytes([*bytes.get(i)?, *bytes.get(i + 1)?]) as usize;
        if len < 2 {
            return None;
        }
        match marker {
            0xc0..=0xc2 => {
                let h = u16::from_be_bytes([*bytes.get(i + 3)?, *bytes.get(i + 4)?]) as u32;
                let w = u16::from_be_bytes([*bytes.get(i + 5)?, *bytes.get(i + 6)?]) as u32;
                if h == 0 || w == 0 || frame.is_some() {
                    return None;
                }
                frame = Some((w, h, *bytes.get(i + 7)?));
            }
            0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf => return None,
            _ => {}
        }
        i += len;
        if marker == 0xda {
            loop {
                i += bytes.get(i..)?.iter().position(|&x| x == 0xff)?;
                match *bytes.get(i + 1)? {
                    0x00 | 0xd0..=0xd7 => i += 2,
                    0xff => i += 1,
                    _ => break,
                }
            }
        }
    }
    None
}

/// Quantile CameraTone: knot *i* is the median of the *i*-th 1/32 of sorted
/// scene luminances paired with the same quantile of JPEG luminances.
pub fn fit_tone_quantiles(scene: &[f32], jpeg: &[f32]) -> Option<[[f32; 2]; 32]> {
    if scene.len() < 128 || scene.len() != jpeg.len() {
        return None;
    }
    if scene.iter().any(|v| !v.is_finite() || *v <= 0.0) || jpeg.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let mut xs = scene.to_vec();
    let mut ys = jpeg.to_vec();
    xs.sort_by(f32::total_cmp);
    ys.sort_by(f32::total_cmp);
    let n = xs.len();
    let mut knots = [[0.0f32; 2]; 32];
    let mut prev = [0.0f32, 0.0];
    for (i, knot) in knots.iter_mut().enumerate() {
        let a = i * n / 32;
        let b = (i + 1) * n / 32;
        let mid = a + (b - a) / 2;
        let x = *xs.get(mid)?;
        let mut y = *ys.get(mid)?;
        if x <= prev[0] {
            return None;
        }
        if y < prev[1] {
            y = prev[1];
        }
        if y >= 1.0 {
            y = 0.999;
        }
        *knot = [x, y];
        prev = *knot;
    }
    if knots[31][0] < knots[0][0] * MIN_TONE_RANGE {
        return None;
    }
    Some(knots)
}

/// Ridge-regularised chromaticity 3×3 (LightCraft `fit_matrix`).
/// Pairs are linear Rec.2020. Every third pair is held out.
pub fn fit_chromaticity_matrix(pairs: &[([f32; 3], [f32; 3])]) -> Option<[[f32; 3]; 3]> {
    if pairs.len() < 256 {
        return None;
    }
    let mut gram = [[0.0f64; 3]; 3];
    let mut cross = [[0.0f64; 3]; 3];
    let mut used = 0usize;
    for (i, (x, y)) in pairs.iter().enumerate() {
        if i % 3 == 0 {
            continue;
        }
        let lx = lum2020(*x) as f64;
        let ly = lum2020(*y) as f64;
        if lx <= 1e-6 || ly <= 1e-6 {
            continue;
        }
        for row in 0..3 {
            for col in 0..3 {
                gram[row][col] += x[row] as f64 * x[col] as f64 / (lx * lx);
                cross[row][col] += y[row] as f64 * x[col] as f64 / (ly * lx);
            }
        }
        used += 1;
    }
    if used < 128 {
        return None;
    }
    let trace: f64 = (0..3).map(|i| gram[i][i]).sum();
    let regularization = trace * 1e-4;
    for i in 0..3 {
        gram[i][i] += regularization;
        cross[i][i] += regularization;
    }
    let inv = invert3(gram)?;
    let mut matrix = [[0.0f32; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let v = cross[i][0] * inv[0][j] + cross[i][1] * inv[1][j] + cross[i][2] * inv[2][j];
            if !v.is_finite() || v.abs() >= 8.0 {
                return None;
            }
            matrix[i][j] = v as f32;
        }
    }
    Some(matrix)
}

fn invert3(m: [[f64; 3]; 3]) -> Option<[[f64; 3]; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if !det.is_finite() || det.abs() < 1e-12 {
        return None;
    }
    let inv_det = 1.0 / det;
    Some([
        [
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv_det,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv_det,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv_det,
        ],
        [
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv_det,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv_det,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv_det,
        ],
        [
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv_det,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv_det,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv_det,
        ],
    ])
}

fn downsample(pixels: &[[f32; 3]], width: usize, height: usize, long: u32) -> (u32, u32, Vec<[f32; 3]>) {
    let scale = long as f32 / width.max(height) as f32;
    let dw = ((width as f32 * scale).round() as u32).max(1);
    let dh = ((height as f32 * scale).round() as u32).max(1);
    let mut out = Vec::with_capacity((dw * dh) as usize);
    for y in 0..dh {
        for x in 0..dw {
            let sx = (x as f32 / dw as f32 * width as f32) as usize;
            let sy = (y as f32 / dh as f32 * height as f32) as usize;
            out.push(pixels[sy.min(height - 1) * width + sx.min(width - 1)]);
        }
    }
    (dw, dh, out)
}

fn jpeg_to_rec2020(bytes: &[u8], long: u32) -> Option<(u32, u32, Vec<[f32; 3]>)> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg).ok()?;
    let img = img.thumbnail(long, long);
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut linear = Vec::with_capacity((w * h) as usize);
    for p in rgb.pixels() {
        let s = [
            p[0] as f32 / 255.0,
            p[1] as f32 / 255.0,
            p[2] as f32 / 255.0,
        ];
        linear.push(srgb_to_rec2020([
            crate::lightcraft_develop::srgb_to_linear_f32(s[0]),
            crate::lightcraft_develop::srgb_to_linear_f32(s[1]),
            crate::lightcraft_develop::srgb_to_linear_f32(s[2]),
        ]));
    }
    Some((w, h, linear))
}

/// Kernel width of the chroma curve's nodes (display luminance) and the weight
/// at which a node keeps half of its estimate (LightCraft `fit_chroma`).
const CHROMA_KERNEL: f64 = 0.08;
const CHROMA_SHRINK: f64 = 2.0;

fn pair_chroma(p: [f32; 3]) -> Option<f32> {
    let y = lum2020(p);
    if y <= 1e-8 {
        return None;
    }
    Some(
        (0..3)
            .map(|i| {
                let t = p[i] / y - 1.0;
                t * t
            })
            .sum::<f32>()
            .sqrt(),
    )
}

fn displayed_chroma(scene: [f32; 3], knots: &[[f32; 2]; 32], chroma: &[f32; CHROMA_N]) -> [f32; 3] {
    let y = lum2020(scene);
    if y <= 0.0 {
        return [0.0; 3];
    }
    let o = camera_tone_apply(y, knots);
    let d = [scene[0] * o / y, scene[1] * o / y, scene[2] * o / y];
    apply_chroma_scale(d, o, chroma)
}

/// Invert a monotone CameraTone: scene luminance whose display value is `o`.
fn invert_camera_tone(knots: &[[f32; 2]; 32], o: f32) -> f32 {
    let target = o.clamp(1e-4, 0.98);
    let mut lo = knots[0][0] * 0.25;
    let mut hi = knots[31][0] * 4.0;
    for _ in 0..24 {
        let mid = 0.5 * (lo + hi);
        if camera_tone_apply(mid, knots) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// Adobe hue-preserving RGB vs luma scale, sampled on the CameraTone knots.
/// Not a hardcoded sat boost: `k(o)` is the per-channel / luma-scale chroma
/// ratio of *this* curve at display luminance `o`.
pub fn chroma_from_hue_preserving(knots: &[[f32; 2]; 32]) -> [f32; CHROMA_N] {
    let dirs: [[f32; 3]; 5] = [
        [1.15, 0.95, 0.80],
        [0.75, 0.90, 1.20],
        [0.70, 1.15, 0.70],
        [1.25, 0.80, 0.70],
        [0.85, 0.85, 1.20],
    ];
    let mut out = IDENTITY_CHROMA;
    for j in 0..CHROMA_N {
        let target_o = j as f32 / (CHROMA_N - 1) as f32;
        let y = invert_camera_tone(knots, target_o.max(0.04));
        if y <= 1e-6 {
            continue;
        }
        let mut wsum = 0.0f32;
        let mut ksum = 0.0f32;
        for dir in dirs {
            let rgb = [dir[0] * y, dir[1] * y, dir[2] * y];
            let yl = lum2020(rgb);
            if yl <= 1e-6 {
                continue;
            }
            let o = camera_tone_apply(yl, knots);
            if o <= 1e-6 {
                continue;
            }
            let luma_s = [rgb[0] * o / yl, rgb[1] * o / yl, rgb[2] * o / yl];
            let per = [
                camera_tone_apply(rgb[0], knots),
                camera_tone_apply(rgb[1], knots),
                camera_tone_apply(rgb[2], knots),
            ];
            let yp = lum2020(per);
            if yp <= 1e-6 {
                continue;
            }
            let hp = [per[0] * o / yp, per[1] * o / yp, per[2] * o / yp];
            let Some(cl) = pair_chroma(luma_s) else {
                continue;
            };
            let Some(ch) = pair_chroma(hp) else {
                continue;
            };
            if cl > 1e-4 {
                ksum += (ch / cl).clamp(0.05, 4.0);
                wsum += 1.0;
            }
        }
        if wsum > 0.0 {
            out[j] = (ksum / wsum).clamp(0.0, 4.0);
        }
    }
    out
}

/// Nadaraya–Watson chroma curve (LightCraft `fit_chroma`). Held-out every
/// third pair; accepted only when held-out RGB error drops.
fn fit_chroma(
    pairs: &[([f32; 3], [f32; 3])],
    matrix: [[f32; 3]; 3],
    knots: &[[f32; 2]; 32],
) -> Option<[f32; CHROMA_N]> {
    let apply_m = |v: [f32; 3]| -> [f32; 3] {
        [
            matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
            matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
            matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2],
        ]
    };
    let samples: Vec<(f64, f64, f64)> = pairs
        .iter()
        .enumerate()
        .filter(|(i, _)| i % 3 != 0)
        .filter_map(|(_, (x, y))| {
            let p = displayed_chroma(apply_m(*x), knots, &IDENTITY_CHROMA);
            let (cp, cy) = (pair_chroma(p)?, pair_chroma(*y)?);
            (cp > 0.05).then(|| {
                (
                    lum2020(p) as f64,
                    cp as f64,
                    ((cy.max(1e-3) / cp) as f64).ln().clamp(0.05f64.ln(), 2.5f64.ln()),
                )
            })
        })
        .collect();
    if samples.len() < 64 {
        return None;
    }
    let mut curve = IDENTITY_CHROMA;
    for (j, node) in curve.iter_mut().enumerate() {
        let at = j as f64 / (CHROMA_N - 1) as f64;
        let (mut weight, mut sum) = (0.0, 0.0);
        for &(o, cp, log_ratio) in &samples {
            let k = (-0.5 * ((o - at) / CHROMA_KERNEL).powi(2)).exp() * cp;
            weight += k;
            sum += k * log_ratio;
        }
        *node = (sum / (weight + CHROMA_SHRINK)).exp() as f32;
        if !node.is_finite() || !(0.0..=4.0).contains(node) {
            return None;
        }
    }
    let error = |chroma: &[f32; CHROMA_N]| -> f64 {
        pairs
            .iter()
            .step_by(3)
            .map(|(x, y)| {
                let p = displayed_chroma(apply_m(*x), knots, chroma);
                (0..3).map(|c| (p[c] - y[c]).powi(2) as f64).sum::<f64>()
            })
            .sum()
    };
    let (before, after) = (error(&IDENTITY_CHROMA), error(&curve));
    (after.is_finite() && after < before).then_some(curve)
}

/// Fit a look from the RAW's embedded JPEG onto already-developed linear sRGB pixels.
/// `colour_locked` skips the JPEG 3×3 (Adobe HSM+Look already owns colour) and
/// derives chroma from the CameraTone itself instead of the JPEG.
pub fn fit_look_from_raw(
    raw_bytes: &[u8],
    developed_srgb: &[[f32; 3]],
    width: usize,
    height: usize,
) -> Option<CameraLook> {
    fit_look_from_raw_opts(raw_bytes, developed_srgb, width, height, false)
}

/// Tone-only JPEG fit: identity matrix, chroma from the hue-preserving CameraTone.
pub fn fit_look_tone_only(
    raw_bytes: &[u8],
    developed_srgb: &[[f32; 3]],
    width: usize,
    height: usize,
) -> Option<CameraLook> {
    fit_look_from_raw_opts(raw_bytes, developed_srgb, width, height, true)
}

fn fit_look_from_raw_opts(
    raw_bytes: &[u8],
    developed_srgb: &[[f32; 3]],
    width: usize,
    height: usize,
    colour_locked: bool,
) -> Option<CameraLook> {
    let jpeg = extract_embedded_jpeg(raw_bytes)?;
    let (jw, jh, jpix) = jpeg_to_rec2020(&jpeg, PROXY)?;
    let (sw, sh, small) = downsample(developed_srgb, width, height, PROXY);
    let spix: Vec<[f32; 3]> = small
        .iter()
        .map(|p| srgb_to_rec2020([p[0].max(0.0), p[1].max(0.0), p[2].max(0.0)]))
        .collect();
    if jw != sw || jh != sh || jpix.len() != spix.len() {
        // Aspect mismatch: still try if counts match after a second resize.
        if (jw as i32 - sw as i32).abs() > 2 || (jh as i32 - sh as i32).abs() > 2 {
            return None;
        }
    }
    let n = spix.len().min(jpix.len());
    let mut scene = Vec::with_capacity(n);
    let mut jpeg_y = Vec::with_capacity(n);
    let mut pairs = Vec::with_capacity(n);
    for i in 0..n {
        let s = spix[i];
        let j = jpix[i];
        let ys = lum2020(s);
        let yj = lum2020(j);
        if !ys.is_finite() || ys < 1e-5 || ys > 1.8 {
            continue;
        }
        if !yj.is_finite() || yj < 0.001 || yj > 0.99 {
            continue;
        }
        if s.iter().any(|c| *c >= 0.99) {
            continue;
        }
        scene.push(ys);
        jpeg_y.push(yj);
        pairs.push((s, j));
    }
    let mut knots = fit_tone_quantiles(&scene, &jpeg_y)?;
    if raw_is_sony(raw_bytes) {
        knots = apply_sony_dro_off_ceiling(knots);
    }
    let matrix = if colour_locked {
        IDENTITY3
    } else {
        fit_chromaticity_matrix(&pairs).unwrap_or(IDENTITY3)
    };
    // Daylight Adobe path: HSM+Look already owns saturation. A night / dusk
    // camera JPEG (mean Y < 0.08) is near-black: Landscape at the lifted
    // CameraTone luma reads as neon (g95-0273 C* 3.5× LR). LightCraft's
    // fit_chroma toward that JPEG is the available chroma reference — not a
    // global sat slider, and not applied on the daylight IR set.
    let jpeg_mean_y = if jpix.is_empty() {
        1.0
    } else {
        jpix.iter().map(|p| lum2020(*p)).sum::<f32>() / jpix.len() as f32
    };
    let chroma = if colour_locked && jpeg_mean_y >= 0.08 {
        IDENTITY_CHROMA
    } else {
        fit_chroma(&pairs, matrix, &knots).unwrap_or(IDENTITY_CHROMA)
    };
    Some(CameraLook {
        matrix,
        knots,
        chroma,
    })
}

/// Fit from an already-developed linear RGB32F image (preview / export load).
pub fn fit_look_from_rgb32f(raw_bytes: &[u8], img: &image::Rgb32FImage) -> Option<CameraLook> {
    let (w, h) = img.dimensions();
    let (dw, dh, small) = downsample_rgb32f(img, PROXY);
    if dw == 0 || dh == 0 {
        return None;
    }
    let _ = (w, h);
    fit_look_from_raw(raw_bytes, &small, dw as usize, dh as usize)
}

fn downsample_rgb32f(img: &image::Rgb32FImage, long: u32) -> (u32, u32, Vec<[f32; 3]>) {
    let (width, height) = img.dimensions();
    let scale = long as f32 / width.max(height) as f32;
    let dw = ((width as f32 * scale).round() as u32).max(1);
    let dh = ((height as f32 * scale).round() as u32).max(1);
    let mut out = Vec::with_capacity((dw * dh) as usize);
    for y in 0..dh {
        for x in 0..dw {
            let sx = (x as f32 / dw as f32 * width as f32) as u32;
            let sy = (y as f32 / dh as f32 * height as f32) as u32;
            let p = img.get_pixel(sx.min(width - 1), sy.min(height - 1));
            out.push([p[0], p[1], p[2]]);
        }
    }
    (dw, dh, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, ImageFormat, RgbImage};
    use std::io::Cursor;
    use std::path::Path;

    fn encode_jpeg(width: u32, height: u32, rgb: [u8; 3]) -> Vec<u8> {
        let img = RgbImage::from_pixel(width, height, image::Rgb(rgb));
        let mut buf = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut buf), 80)
            .write_image(
                img.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgb8,
            )
            .expect("jpeg");
        buf
    }

    #[test]
    fn extract_jpeg_finds_largest_displayable_soi() {
        let mut bytes = vec![0u8; 32];
        let thumb = encode_jpeg(32, 24, [10, 10, 10]);
        bytes.extend_from_slice(&thumb);
        assert!(
            extract_embedded_jpeg(&bytes).is_none(),
            "sub-200 px thumbnail must be ignored"
        );
        let preview = encode_jpeg(320, 240, [40, 80, 120]);
        bytes.extend_from_slice(&preview);
        // Panasonic-style CFA junk: SOI, 20 kB of noise, first EOI. A first-EOI
        // scan would pick this over the real 320×240 preview.
        bytes.push(0xff);
        bytes.push(0xd8);
        bytes.extend(std::iter::repeat(0x11).take(20_000));
        bytes.extend_from_slice(&[0xff, 0xd9]);
        let found = extract_embedded_jpeg(&bytes).expect("preview");
        assert_eq!(found, preview);
    }

    #[test]
    fn extract_jpeg_skips_exif_thumbnail_eoi() {
        let preview = encode_jpeg(200, 160, [200, 180, 40]);
        // APP1 with a nested SOI/EOI (the classic "first FF D9 is the thumb").
        let mut wrapped = vec![0xff, 0xd8, 0xff, 0xe1, 0x00, 12];
        wrapped.extend_from_slice(&[0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        // Re-stamp the real JPEG after a prefix that a first-EOI scan would stop at.
        let mut file = vec![0u8; 16];
        file.extend_from_slice(&preview);
        file.extend_from_slice(&wrapped);
        let found = extract_embedded_jpeg(&file).expect("preview");
        assert_eq!(found, preview);
    }

    #[test]
    fn g95_0273_preview_is_the_1920_jpeg_not_cfa_junk() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/datasets/ir/g95-0273/raw.rw2"
        );
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let jpeg = extract_embedded_jpeg(&bytes).expect("g95-0273 preview");
        let img = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).expect("decode");
        assert_eq!(img.width(), 1920);
        assert_eq!(img.height(), 1440);
        assert!(
            jpeg.len() < 1_500_000,
            "must not pick the 2.4 MB CFA run: {}",
            jpeg.len()
        );
    }

    #[test]
    fn a6600_0156_preview_is_not_the_8mb_cfa_run() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/datasets/ir/a6600-0156/raw.arw"
        );
        if !Path::new(path).is_file() {
            return;
        }
        let bytes = std::fs::read(path).expect("0156");
        let jpeg = extract_embedded_jpeg(&bytes).expect("a6600-0156 preview");
        let img = image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).expect("decode");
        assert_eq!((img.width(), img.height()), (1616, 1080));
        assert!(
            jpeg.len() < 2_000_000,
            "must not pick the 8.5 MB CFA run: {}",
            jpeg.len()
        );
    }

    #[test]
    fn quantile_tone_lifts_a_brighter_jpeg() {
        let scene: Vec<f32> = (1..=256).map(|i| i as f32 / 300.0).collect();
        let jpeg: Vec<f32> = scene.iter().map(|y| (y * 1.35).min(0.95)).collect();
        let knots = fit_tone_quantiles(&scene, &jpeg).expect("knots");
        assert!(knots[16][1] > knots[16][0], "midtone should lift, {:?}", knots[16]);
        for w in knots.windows(2) {
            assert!(w[1][0] > w[0][0]);
            assert!(w[1][1] >= w[0][1]);
        }
    }

    #[test]
    fn chromaticity_identity_on_matched_pairs() {
        let mut pairs = Vec::new();
        for i in 0..300 {
            let t = 0.05 + i as f32 * 0.003;
            let rgb = [t, t * 0.9, t * 0.8];
            pairs.push((rgb, rgb));
        }
        let m = fit_chromaticity_matrix(&pairs).expect("matrix");
        for i in 0..3 {
            assert!((m[i][i] - 1.0).abs() < 0.15, "{m:?}");
        }
    }

    #[test]
    fn sony_dro_off_ceiling_never_brightens() {
        let mut lifted = SONY_DRO_OFF;
        for k in &mut lifted {
            k[1] = (k[1] * 1.2).min(0.99);
        }
        let out = apply_sony_dro_off_ceiling(lifted);
        for i in 0..32 {
            let sony = camera_tone_apply(out[i][0], &SONY_DRO_OFF);
            assert!(out[i][1] <= sony + 1e-4, "{i}: {} > {sony}", out[i][1]);
        }
    }

    #[test]
    fn look_cache_roundtrip() {
        let look = CameraLook::default();
        remember_look("/tmp/cache-test.arw", look);
        let got = look_for_path("/tmp/cache-test.arw").expect("cached");
        assert_eq!(got.knots[0], look.knots[0]);
        assert_eq!(got.chroma, IDENTITY_CHROMA);
    }

    #[test]
    fn hue_preserving_chroma_is_finite_and_not_a_global_boost() {
        let k = chroma_from_hue_preserving(&SONY_DRO_OFF);
        assert!(k.iter().all(|v| v.is_finite() && (0.0..=4.0).contains(v)));
        // A global sat slider would be a constant > 1. The curve must vary
        // with display luminance (shadows vs highlights).
        let span = k.iter().copied().fold(0.0f32, f32::max)
            - k.iter().copied().fold(4.0f32, f32::min);
        assert!(span > 0.05, "chroma nodes must depend on the tone: {k:?}");
    }

    #[test]
    fn fit_chroma_accepts_a_more_colourful_reference() {
        let mut pairs = Vec::new();
        for i in 0..300 {
            let t = 0.08 + i as f32 * 0.002;
            let scene = [t * 1.05, t * 0.95, t * 0.80];
            let jpeg = [t * 1.25, t * 0.90, t * 0.65];
            pairs.push((scene, jpeg));
        }
        let curve = fit_chroma(&pairs, IDENTITY3, &SONY_DRO_OFF).expect("chroma");
        let mid = curve[3];
        assert!(mid > 1.05, "vivid JPEG must lift midtone chroma: {curve:?}");
    }

    #[test]
    fn fit_chroma_pulls_toward_a_muted_night_jpeg() {
        let mut pairs = Vec::new();
        for i in 0..300 {
            let t = 0.04 + i as f32 * 0.0015;
            let scene = [t * 1.35, t * 0.85, t * 0.55];
            let jpeg = [t * 1.05, t * 0.98, t * 0.90];
            pairs.push((scene, jpeg));
        }
        let curve = fit_chroma(&pairs, IDENTITY3, &SONY_DRO_OFF).expect("chroma");
        let mid = curve[3];
        assert!(mid < 0.95, "muted JPEG must drop midtone chroma: {curve:?}");
    }
}
