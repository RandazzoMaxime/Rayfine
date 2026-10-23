//! Scene-linear highlight recovery, local Highlights/Shadows, and a soft display shoulder.
//!
//! Inspired by LightCraft's develop pipeline (https://github.com/storytold/lightcraft,
//! MIT / Apache-2.0): exposure is a linear gain, Highlights/Shadows are log-luminance
//! masks, Whites/Blacks move the extremes, and the display curve uses a soft shoulder
//! instead of clipping at 1.0. The code here is original; only the approach is shared.
//!
//! Slider units match the GPU uniforms (UI value divided by [`crate::image_processing`]
//! scales: Highlights/Shadows ÷ 120, Whites ÷ 30, Blacks ÷ 40, Exposure in EV).

use rayon::prelude::*;

/// Middle grey in scene-linear (same pivot LightCraft uses around 0.18).
pub const GREY: f32 = 0.18;
/// Sensor-white after Rayfine's white-level rescale. Channels at or above this are clipped.
pub const SENSOR_WHITE: f32 = 1.0;
/// Treat a channel as clipped from this fraction of [`SENSOR_WHITE`].
pub const CLIP_START: f32 = 0.98;
/// Quality-path headroom kept after reconstruct (stops above sensor white).
pub const SCENE_HEADROOM: f32 = 16.0;
/// Preview/fast demosaic still keeps a few stops so library proxies can recover.
pub const FAST_HEADROOM: f32 = 4.0;

/// Uniforms already divided by the UI scales (see module docs).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ToneSliders {
    pub exposure: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
}

impl ToneSliders {
    pub fn from_ui(exposure: f32, highlights: f32, shadows: f32, whites: f32, blacks: f32) -> Self {
        Self {
            exposure,
            highlights: highlights / 120.0,
            shadows: shadows / 120.0,
            whites: whites / 30.0,
            blacks: blacks / 40.0,
        }
    }

    pub fn is_identity(&self) -> bool {
        self.exposure.abs() < 1e-6
            && self.highlights.abs() < 1e-6
            && self.shadows.abs() < 1e-6
            && self.whites.abs() < 1e-6
            && self.blacks.abs() < 1e-6
    }
}

#[inline]
pub fn luma(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

#[inline]
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Log2 luminance relative to middle grey. Matches LightCraft's `log_l + ev` domain.
#[inline]
pub fn log_grey(linear_luma: f32) -> f32 {
    (linear_luma.max(1e-8) / GREY).log2()
}

#[inline]
pub fn highlight_mask(log_base: f32) -> f32 {
    smoothstep(-1.0, 2.8, log_base)
}

#[inline]
pub fn shadow_mask(log_base: f32) -> f32 {
    1.0 - smoothstep(-4.8, 0.3, log_base)
}

#[inline]
pub fn whites_mask(log_base: f32) -> f32 {
    smoothstep(0.5, 3.0, log_base)
}

#[inline]
pub fn blacks_mask(log_base: f32) -> f32 {
    1.0 - smoothstep(-6.0, -1.5, log_base)
}

/// Log-domain local tone. `log_base` should be edge-aware (guided/blurred) when available.
///
/// Strengths are chosen so UI Highlights −100 recovers about 1.6 stops on a clipped sky
/// (LightCraft uses `1.7 * mask` on a −1..1 slider). Values well above sensor white get
/// extra tail compression so an HDR ramp does not pile up at display 1.0.
#[inline]
pub fn local_tone_delta(log_base: f32, linear_luma: f32, sliders: ToneSliders) -> f32 {
    let ws = shadow_mask(log_base);
    let mut delta = sliders.highlights * 2.0 * highlight_mask(log_base)
        + sliders.shadows * 2.0 * ws * ws.sqrt()
        + sliders.whites * 0.24 * whites_mask(log_base)
        + sliders.blacks * 0.32 * blacks_mask(log_base);
    if sliders.highlights < 0.0 && linear_luma > 1.0 {
        delta += sliders.highlights
            * 1.4
            * highlight_mask(log_base)
            * linear_luma.log2().max(0.0);
    }
    delta
}

#[inline]
pub fn apply_exposure(rgb: [f32; 3], exposure_ev: f32) -> [f32; 3] {
    if exposure_ev.abs() < 1e-8 {
        return rgb;
    }
    let g = 2f32.powf(exposure_ev);
    [rgb[0] * g, rgb[1] * g, rgb[2] * g]
}

#[inline]
pub fn apply_local_tone(rgb: [f32; 3], log_base: f32, sliders: ToneSliders) -> [f32; 3] {
    let delta = local_tone_delta(log_base, luma(rgb).max(0.0), sliders);
    if delta.abs() < 1e-8 {
        return rgb;
    }
    let g = 2f32.powf(delta);
    [rgb[0] * g, rgb[1] * g, rgb[2] * g]
}

/// Soft shoulder above 0.95 scene-linear. Identity at and below 0.95 so default midtones
/// match the previous Basic transfer; HDR values roll off instead of clipping at 1.0.
///
/// Extended Reinhard-style knee, same idea as LightCraft's display shoulder (start at 0.95,
/// finite asymptote) but kept tight so a value of 1.0 barely moves.
#[inline]
pub fn soft_shoulder(x: f32) -> f32 {
    if !x.is_finite() {
        return 0.0;
    }
    if x <= 0.95 {
        return x.max(0.0);
    }
    let d = x - 0.95;
    0.95 + d / (1.0 + d / 0.12)
}

#[inline]
pub fn soft_shoulder_rgb(rgb: [f32; 3]) -> [f32; 3] {
    [soft_shoulder(rgb[0]), soft_shoulder(rgb[1]), soft_shoulder(rgb[2])]
}

#[inline]
pub fn linear_to_srgb_extended(x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    if x <= 0.0031308 {
        x * 12.92
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

#[inline]
pub fn linear_to_srgb_clamped(x: f32) -> f32 {
    linear_to_srgb_extended(x.clamp(0.0, 1.0))
}

/// Previous Basic RAW display path: `* 2^0.25`, clamp to 1, sRGB, gamma 1.378, smoothstep.
pub fn legacy_basic_raw_display(rgb: [f32; 3]) -> [f32; 3] {
    let boosted = [rgb[0] * 2f32.powf(0.25), rgb[1] * 2f32.powf(0.25), rgb[2] * 2f32.powf(0.25)];
    let mut enc = [
        linear_to_srgb_clamped(boosted[0]),
        linear_to_srgb_clamped(boosted[1]),
        linear_to_srgb_clamped(boosted[2]),
    ];
    const INV_G: f32 = 1.0 / 1.378;
    enc = [enc[0].powf(INV_G), enc[1].powf(INV_G), enc[2].powf(INV_G)];
    [
        enc[0] * enc[0] * (3.0 - 2.0 * enc[0]),
        enc[1] * enc[1] * (3.0 - 2.0 * enc[1]),
        enc[2] * enc[2] * (3.0 - 2.0 * enc[2]),
    ]
}

/// Basic RAW display with a shoulder instead of a hard 1.0 clamp.
///
/// Values whose `* 2^0.25` result stays ≤ 0.95 are bit-for-bit the previous look (same
/// sRGB + gamma + smoothstep). Overrange is compressed first, then encoded in [0, 1].
pub fn basic_raw_display(rgb: [f32; 3]) -> [f32; 3] {
    let boosted = [rgb[0] * 2f32.powf(0.25), rgb[1] * 2f32.powf(0.25), rgb[2] * 2f32.powf(0.25)];
    let compressed = soft_shoulder_rgb(boosted);
    let mut enc = [
        linear_to_srgb_extended(compressed[0].clamp(0.0, 1.0)),
        linear_to_srgb_extended(compressed[1].clamp(0.0, 1.0)),
        linear_to_srgb_extended(compressed[2].clamp(0.0, 1.0)),
    ];
    const INV_G: f32 = 1.0 / 1.378;
    enc = [enc[0].max(0.0).powf(INV_G), enc[1].max(0.0).powf(INV_G), enc[2].max(0.0).powf(INV_G)];
    [
        enc[0] * enc[0] * (3.0 - 2.0 * enc[0]),
        enc[1] * enc[1] * (3.0 - 2.0 * enc[1]),
        enc[2] * enc[2] * (3.0 - 2.0 * enc[2]),
    ]
}

/// Display-referred encode used for JPEGs: extended sRGB, then a short shoulder above 0.95.
pub fn display_encode(rgb: [f32; 3]) -> [f32; 3] {
    let compressed = soft_shoulder_rgb(rgb);
    [
        linear_to_srgb_extended(compressed[0].clamp(0.0, 1.0)),
        linear_to_srgb_extended(compressed[1].clamp(0.0, 1.0)),
        linear_to_srgb_extended(compressed[2].clamp(0.0, 1.0)),
    ]
}

/// Reconstruct clipped channels of one pixel.
///
/// Fully clipped pixels become neutral at their peak (so Highlights can darken a blown sky
/// without magenta). Partly clipped pixels lift the clipped channels to the pixel peak
/// (green usually clips first after white balance). `neighborhood` is optional unclipped
/// chromaticity borrowed from nearby reliable pixels.
pub fn reconstruct_pixel(rgb: [f32; 3], neighborhood: Option<[f32; 3]>) -> [f32; 3] {
    let peak = rgb[0].max(rgb[1]).max(rgb[2]);
    if peak < SENSOR_WHITE * CLIP_START {
        return rgb;
    }
    let t = SENSOR_WHITE * CLIP_START;
    let clipped = [rgb[0] >= t, rgb[1] >= t, rgb[2] >= t];
    let n = clipped.iter().filter(|c| **c).count();
    if n == 3 {
        return [peak, peak, peak];
    }
    let mut out = rgb;
    for (i, is_clipped) in clipped.iter().enumerate() {
        if *is_clipped {
            out[i] = out[i].max(peak);
        }
    }
    if let Some(neigh) = neighborhood {
        let sum = (neigh[0] + neigh[1] + neigh[2]).max(1e-4);
        if neigh[0].max(neigh[1]).max(neigh[2]) < t {
            let energy = (out[0] + out[1] + out[2]).max(1e-4);
            let borrowed = [neigh[0] / sum * energy, neigh[1] / sum * energy, neigh[2] / sum * energy];
            for i in 0..3 {
                if clipped[i] {
                    out[i] = out[i].max(borrowed[i]);
                }
            }
        }
    }
    out
}

fn neighbor_chroma(data: &[[f32; 3]], width: usize, height: usize, x: usize, y: usize) -> Option<[f32; 3]> {
    let t = SENSOR_WHITE * CLIP_START;
    let mut acc = [0.0f32; 3];
    let mut wsum = 0.0f32;
    let y0 = y.saturating_sub(2);
    let y1 = (y + 2).min(height.saturating_sub(1));
    let x0 = x.saturating_sub(2);
    let x1 = (x + 2).min(width.saturating_sub(1));
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            if xx == x && yy == y {
                continue;
            }
            let p = data[yy * width + xx];
            let peak = p[0].max(p[1]).max(p[2]);
            if peak < t && peak > 0.05 {
                let w = smoothstep(0.25, 0.6, peak);
                acc[0] += p[0] * w;
                acc[1] += p[1] * w;
                acc[2] += p[2] * w;
                wsum += w;
            }
        }
    }
    if wsum > 1e-4 {
        Some([acc[0] / wsum, acc[1] / wsum, acc[2] / wsum])
    } else {
        None
    }
}

/// In-place reconstruction after demosaic / white-level rescale (sensor white ≈ 1.0).
pub fn reconstruct_image(data: &mut [[f32; 3]], width: usize, height: usize) {
    if width == 0 || height == 0 || data.len() < width * height {
        return;
    }
    let source = data.to_vec();
    data.par_chunks_mut(width)
        .enumerate()
        .take(height)
        .for_each(|(y, row)| {
            for (x, px) in row.iter_mut().enumerate() {
                let neigh = neighbor_chroma(&source, width, height, x, y);
                *px = reconstruct_pixel(*px, neigh);
            }
        });
}

pub fn clamp_headroom(rgb: [f32; 3], limit: f32) -> [f32; 3] {
    [
        rgb[0].clamp(0.0, limit),
        rgb[1].clamp(0.0, limit),
        rgb[2].clamp(0.0, limit),
    ]
}

/// Full scene-linear preview used by tests and the proof binary.
///
/// `mask_luma` is the edge-aware luminance for Highlights/Shadows (pass a guided/blurred
/// luma, or the pixel luma when no spatial filter is available).
pub fn develop_pixel(rgb: [f32; 3], mask_luma: f32, sliders: ToneSliders, raw: bool) -> [f32; 3] {
    let reconstructed = reconstruct_pixel(rgb, None);
    let exposed = apply_exposure(reconstructed, sliders.exposure);
    let mask = log_grey(mask_luma.max(1e-8) * 2f32.powf(sliders.exposure));
    let toned = apply_local_tone(exposed, mask, sliders);
    if raw {
        basic_raw_display(toned)
    } else {
        display_encode(toned)
    }
}

/// Previous Highlights path: `pow(luma, 1 + 0.65*|h|)` for luma ≤ 1, which is a no-op at 1.0.
pub fn legacy_highlights(rgb: [f32; 3], highlights: f32) -> [f32; 3] {
    if highlights == 0.0 {
        return rgb;
    }
    let y = luma([rgb[0].max(0.0), rgb[1].max(0.0), rgb[2].max(0.0)]).max(1e-4);
    let mask_in = (y * 1.5).tanh();
    let highlight_mask = smoothstep(0.0, 0.61, mask_in);
    let new_y = if y <= 1.0 {
        let gamma = 1.0 - highlights * 0.65;
        y.powf(gamma)
    } else {
        let excess = y - 1.0;
        let strength = -highlights * 6.0;
        1.0 + excess / (1.0 + excess * strength)
    };
    let adjusted = [rgb[0] * new_y / y, rgb[1] * new_y / y, rgb[2] * new_y / y];
    [
        rgb[0] + (adjusted[0] - rgb[0]) * highlight_mask,
        rgb[1] + (adjusted[1] - rgb[1]) * highlight_mask,
        rgb[2] + (adjusted[2] - rgb[2]) * highlight_mask,
    ]
}

pub fn legacy_develop_pixel(rgb: [f32; 3], sliders: ToneSliders) -> [f32; 3] {
    let exposed = apply_exposure(rgb, sliders.exposure);
    let highlighted = legacy_highlights(exposed, sliders.highlights);
    legacy_basic_raw_display(highlighted)
}

/// LightCraft-inspired reference (not a copy): Reinhard shoulder + log H/S.
/// Used only in proofs / tests as an external benchmark.
pub fn lightcraft_like_display(y: f32, contrast: f32, whites_ui: f32, blacks_ui: f32) -> f32 {
    let c = contrast / 100.0;
    let slope = if c >= 0.0 { 1.0 + 0.55 * c } else { 1.0 + 0.4 * c };
    let white_ev = 2.9 - 1.6 * (whites_ui / 100.0);
    let wl = GREY * 2f32.powf(white_ev);
    let pre = 1.0 + GREY / wl;
    let ev = (y.max(1e-8) / GREY).log2();
    let yy = GREY * 2f32.powf(ev * slope) * pre;
    let mut o = yy * (1.0 + yy / (wl * wl)) / (1.0 + yy);
    o = o.min(1.0);
    let b = blacks_ui / 100.0;
    if b < 0.0 {
        let k = -b * 0.035;
        let e = 0.004;
        let soft = |v: f32| ((v - k) + ((v - k) * (v - k) + e * e).sqrt()) * 0.5;
        o = (soft(o) - soft(0.0)) / (soft(1.0) - soft(0.0));
    } else if b > 0.0 {
        let k = b * 0.03;
        o = k + (1.0 - k) * o;
    }
    o.clamp(0.0, 1.0)
}

pub fn lightcraft_like_pixel(rgb: [f32; 3], sliders: ToneSliders) -> [f32; 3] {
    let exposed = apply_exposure(rgb, sliders.exposure);
    let y = luma(exposed).max(0.0);
    let log_b = log_grey(y);
    let hl_ui = sliders.highlights * 120.0;
    let sh_ui = sliders.shadows * 120.0;
    let ws = shadow_mask(log_b);
    let delta = (hl_ui / 100.0) * 1.7 * highlight_mask(log_b)
        + (sh_ui / 100.0) * 1.7 * ws * ws.sqrt();
    let scaled = apply_exposure(exposed, delta);
    let y2 = luma(scaled).max(1e-9);
    let o = lightcraft_like_display(y2, 0.0, sliders.whites * 30.0, sliders.blacks * 40.0);
    let g = o / y2;
    [
        (scaled[0] * g).clamp(0.0, 1.0),
        (scaled[1] * g).clamp(0.0, 1.0),
        (scaled[2] * g).clamp(0.0, 1.0),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn almost(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() <= eps
    }

    #[test]
    fn identity_at_zero_sliders() {
        let sliders = ToneSliders::default();
        for y in [0.01, 0.05, 0.18, 0.4, 0.7, 0.9] {
            let rgb = [y, y, y];
            let out = develop_pixel(rgb, y, sliders, true);
            let legacy = legacy_basic_raw_display(rgb);
            assert!(
                almost(out[1], legacy[1], 2e-3),
                "midtone drift at {y}: {out:?} vs {legacy:?}"
            );
        }
    }

    #[test]
    fn highlights_minus_100_does_not_clip_hdr_ramp() {
        let sliders = ToneSliders::from_ui(0.0, -100.0, 0.0, 0.0, 0.0);
        let mut prev = -1.0;
        for i in 0..=800 {
            let y = 0.01 * 1.012f32.powi(i);
            let rgb = [y, y, y];
            let out = develop_pixel(rgb, y, sliders, true);
            let v = luma(out);
            assert!((0.0..=0.985).contains(&v), "clipped at y={y}: {v}");
            assert!(v + 1e-4 >= prev, "non-monotone at y={y}: {v} < {prev}");
            prev = v;
        }
    }

    #[test]
    fn synthetic_sky_is_recovered() {
        let sliders = ToneSliders::from_ui(0.0, -100.0, 0.0, 0.0, 0.0);
        let sky = [1.8, 1.6, 2.2];
        let recovered = develop_pixel(sky, luma(sky), sliders, true);
        let legacy = legacy_develop_pixel(sky, sliders);
        let rec_y = luma(recovered);
        let leg_y = luma(legacy);
        assert!(
            rec_y < 0.92,
            "recovered sky still blown: {rec_y} ({recovered:?})"
        );
        assert!(
            rec_y + 0.04 < leg_y,
            "no extra recovery vs legacy: {rec_y} vs {leg_y}"
        );
        assert!(rec_y > 0.25, "sky crushed: {rec_y}");
    }

    #[test]
    fn monotone_tone_curves() {
        for (h, s, w, b) in [
            (0.0, 0.0, 0.0, 0.0),
            (-100.0, 0.0, 0.0, 0.0),
            (0.0, 100.0, 0.0, 0.0),
            (0.0, 0.0, -80.0, 0.0),
            (0.0, 0.0, 0.0, -80.0),
            (-80.0, 60.0, -40.0, -20.0),
        ] {
            let sliders = ToneSliders::from_ui(0.0, h, s, w, b);
            let mut prev = -1.0;
            for i in 0..400 {
                let y = 1e-4 * 1.03f32.powi(i);
                let v = luma(develop_pixel([y, y, y], y, sliders, true));
                assert!(
                    v + 2e-4 >= prev,
                    "non-monotone {h}/{s}/{w}/{b} at {y}: {v} < {prev}"
                );
                prev = v;
            }
        }
    }

    #[test]
    fn exposure_is_linear_gain_before_display() {
        let rgb = [0.12, 0.10, 0.08];
        let plus = apply_exposure(rgb, 1.0);
        assert!(almost(plus[0], 0.24, 1e-5));
        let minus = apply_exposure(rgb, -1.0);
        assert!(almost(minus[0], 0.06, 1e-5));
    }

    #[test]
    fn reconstruction_neutralizes_magenta_clip() {
        // Green clipped, red/blue still rising — classic WB magenta sky.
        let magenta = [1.6, 1.0, 1.8];
        let out = reconstruct_pixel(magenta, None);
        let chroma = (out[0] - out[1]).abs() + (out[2] - out[1]).abs();
        let before = (magenta[0] - magenta[1]).abs() + (magenta[2] - magenta[1]).abs();
        assert!(chroma < before * 0.15, "still magenta: {out:?}");
        assert!(out[1] >= 1.59);
    }

    #[test]
    fn reconstruction_leaves_unclipped_colour() {
        let flower = [0.4, 0.15, 0.12];
        assert_eq!(reconstruct_pixel(flower, None), flower);
    }

    #[test]
    fn legacy_highlights_cannot_recover_clipped_white() {
        let sliders = ToneSliders::from_ui(0.0, -100.0, 0.0, 0.0, 0.0);
        let white = [1.0, 1.0, 1.0];
        let legacy = legacy_highlights(white, sliders.highlights);
        assert!(
            almost(luma(legacy), 1.0, 1e-4),
            "legacy unexpectedly recovered {legacy:?}"
        );
        let recovered = apply_local_tone(white, log_grey(1.0), sliders);
        assert!(luma(recovered) < 0.55, "new path did not pull 1.0 down");
    }

    #[test]
    fn shadows_lift_without_blowing_highlights() {
        let sliders = ToneSliders::from_ui(0.0, 0.0, 100.0, 0.0, 0.0);
        let shadow = develop_pixel([0.02, 0.02, 0.02], 0.02, sliders, true);
        let mid = develop_pixel([0.18, 0.18, 0.18], 0.18, sliders, true);
        let hi = develop_pixel([0.8, 0.8, 0.8], 0.8, sliders, true);
        let shadow0 = develop_pixel([0.02, 0.02, 0.02], 0.02, ToneSliders::default(), true);
        let hi0 = develop_pixel([0.8, 0.8, 0.8], 0.8, ToneSliders::default(), true);
        assert!(luma(shadow) > luma(shadow0) + 0.01);
        assert!((luma(hi) - luma(hi0)).abs() < 0.03);
        assert!(luma(mid) < 0.55);
    }

    #[test]
    fn whites_and_blacks_move_the_extremes() {
        let base = ToneSliders::default();
        let dark = [0.015, 0.015, 0.015];
        let bright = [1.4, 1.4, 1.4];
        let crushed = develop_pixel(dark, 0.015, ToneSliders::from_ui(0.0, 0.0, 0.0, 0.0, -80.0), true);
        let lifted = develop_pixel(dark, 0.015, ToneSliders::from_ui(0.0, 0.0, 0.0, 0.0, 80.0), true);
        let pulled = develop_pixel(bright, 1.4, ToneSliders::from_ui(0.0, 0.0, 0.0, -80.0, 0.0), true);
        let pushed = develop_pixel(bright, 1.4, ToneSliders::from_ui(0.0, 0.0, 0.0, 80.0, 0.0), true);
        let dark0 = develop_pixel(dark, 0.015, base, true);
        let bright0 = develop_pixel(bright, 1.4, base, true);
        assert!(luma(crushed) < luma(dark0));
        assert!(luma(lifted) > luma(dark0));
        assert!(luma(pulled) < luma(bright0));
        assert!(luma(pushed) >= luma(pulled));
    }

    #[test]
    fn combined_sky_recovery_preset() {
        let sliders = ToneSliders::from_ui(0.35, -100.0, 70.0, -35.0, 15.0);
        let sky = [2.4, 2.1, 2.8];
        let ground = [0.03, 0.04, 0.02];
        let sky_out = develop_pixel(sky, luma(sky), sliders, true);
        let ground_out = develop_pixel(ground, luma(ground), sliders, true);
        assert!(luma(sky_out) < 0.9);
        assert!(luma(ground_out) > luma(develop_pixel(ground, 0.03, ToneSliders::default(), true)));
        assert!(luma(sky_out) > luma(ground_out));
    }

    #[test]
    fn reconstruct_image_repairs_a_clipped_patch() {
        let mut img = vec![[0.3, 0.3, 0.3]; 9];
        img[4] = [1.7, 1.0, 1.9];
        reconstruct_image(&mut img, 3, 3);
        let c = img[4];
        assert!((c[0] - c[1]).abs() < 0.25);
        assert!(c[1] > 1.5);
    }

    #[test]
    fn shoulder_is_identity_below_threshold() {
        for x in [0.0, 0.1, 0.5, 0.94, 0.95] {
            assert!(almost(soft_shoulder(x), x, 1e-6), "{x}");
        }
        assert!(soft_shoulder(1.0) < 1.0);
        assert!(soft_shoulder(1.0) > 0.98);
        assert!(soft_shoulder(4.0) > soft_shoulder(2.0));
        assert!(soft_shoulder(8.0) < 1.08);
    }
}
