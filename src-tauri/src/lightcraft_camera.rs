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

use crate::lightcraft_develop::{camera_tone_apply, lum2020, srgb_to_rec2020, SONY_DRO_OFF};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Minimum scene-luminance range (brightest knot / darkest) LightCraft requires.
const MIN_TONE_RANGE: f32 = 1.2;
const PROXY: u32 = 96;

/// Fitted per-photo look: chromaticity matrix in Rec.2020 and 32-knot tone.
#[derive(Clone, Copy, Debug)]
pub struct CameraLook {
    pub matrix: [[f32; 3]; 3],
    pub knots: [[f32; 2]; 32],
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

/// Largest embedded JPEG in a RAW container (preview, not the 160 px thumbnail).
pub fn extract_embedded_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut best: Option<&[u8]> = None;
    let mut i = 0;
    while i + 4 < bytes.len() {
        if bytes[i] == 0xff && bytes[i + 1] == 0xd8 {
            if let Some(end) = find_jpeg_eoi(&bytes[i..]) {
                let slice = &bytes[i..i + end];
                if slice.len() > best.map(|b| b.len()).unwrap_or(0) {
                    best = Some(slice);
                }
                i += end;
                continue;
            }
        }
        i += 1;
    }
    best.filter(|b| b.len() >= 8_000).map(|b| b.to_vec())
}

fn find_jpeg_eoi(bytes: &[u8]) -> Option<usize> {
    let mut i = 2;
    while i + 1 < bytes.len() {
        if bytes[i] == 0xff && bytes[i + 1] == 0xd9 {
            return Some(i + 2);
        }
        i += 1;
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

/// Fit a look from the RAW's embedded JPEG onto already-developed linear sRGB pixels.
pub fn fit_look_from_raw(
    raw_bytes: &[u8],
    developed_srgb: &[[f32; 3]],
    width: usize,
    height: usize,
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
        if !ys.is_finite() || ys < 1e-4 || ys > 1.4 {
            continue;
        }
        if !yj.is_finite() || yj < 0.003 || yj > 0.98 {
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
    let matrix = fit_chromaticity_matrix(&pairs).unwrap_or([
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]);
    Some(CameraLook { matrix, knots })
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

    #[test]
    fn extract_jpeg_finds_largest_soi() {
        let mut bytes = vec![0u8; 32];
        // tiny JPEG stub: SOI + a few bytes + EOI
        let small = [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x00, 0xff, 0xd9];
        bytes.extend_from_slice(&small);
        assert!(extract_embedded_jpeg(&bytes).is_none());
        let mut big = vec![0xff, 0xd8];
        big.extend(std::iter::repeat(0x11).take(10_000));
        big.extend_from_slice(&[0xff, 0xd9]);
        bytes.extend_from_slice(&big);
        let found = extract_embedded_jpeg(&bytes).expect("preview");
        assert_eq!(found.len(), big.len());
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
    }
}
