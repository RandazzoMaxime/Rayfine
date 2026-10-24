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
/// Log-EV peak at Highlights UI = ±100 (after ÷120). Keep in sync with `shader.wgsl`.
/// Calibrated on public LR pairs (`bench/lr-compare/MAPPING.md`); identity at 0.
pub const HIGHLIGHT_LOG_STRENGTH: f32 = 2.35;
pub const SHADOW_LOG_STRENGTH: f32 = 2.0;
pub const WHITES_LOG_STRENGTH: f32 = 0.28;
pub const BLACKS_LOG_STRENGTH: f32 = 0.20;
/// Reinhard `k` for overrange when Highlights/Whites pull. Larger = stronger recovery.
pub const OVERRANGE_PULL_K: f32 = 5.0;

/// Uniforms already divided by the UI scales (see module docs).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ToneSliders {
    pub exposure: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub contrast: f32,
}

impl ToneSliders {
    pub fn from_ui(exposure: f32, highlights: f32, shadows: f32, whites: f32, blacks: f32) -> Self {
        Self::from_ui_full(exposure, highlights, shadows, whites, blacks, 0.0)
    }

    pub fn from_ui_full(
        exposure: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        contrast: f32,
    ) -> Self {
        Self {
            exposure,
            highlights: highlights / 120.0,
            shadows: shadows / 120.0,
            whites: whites / 30.0,
            blacks: blacks / 40.0,
            contrast: contrast / 100.0,
        }
    }

    pub fn is_identity(&self) -> bool {
        self.exposure.abs() < 1e-6
            && self.highlights.abs() < 1e-6
            && self.shadows.abs() < 1e-6
            && self.whites.abs() < 1e-6
            && self.blacks.abs() < 1e-6
            && self.contrast.abs() < 1e-6
    }

    pub fn needs_local_mask(&self) -> bool {
        self.highlights.abs() > 1e-6
            || self.shadows.abs() > 1e-6
            || self.whites.abs() > 1e-6
            || self.blacks.abs() > 1e-6
    }

    /// Human-readable UI values for contact-sheet banners.
    pub fn ui_label(&self, mode: &str) -> String {
        format!(
            "Exp {:+.2}  H {:+.0}  S {:+.0}  W {:+.0}  B {:+.0}  C {:+.0}  mode={}",
            self.exposure,
            self.highlights * 120.0,
            self.shadows * 120.0,
            self.whites * 30.0,
            self.blacks * 40.0,
            self.contrast * 100.0,
            mode
        )
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
/// Strengths are chosen so UI Highlights −100 recovers about 1.6–1.8 stops on a
/// clipped sky (LightCraft uses `1.7 * mask` on a −1..1 slider). Slightly above
/// LightCraft so FiveK-style HighlightRecovery + positive EV still pulls the
/// sky (see `bench/lr-compare/MAPPING.md`). Overrange is compressed separately
/// by [`overrange_scale`] so the curve stays monotone.
#[inline]
pub fn local_tone_delta(log_base: f32, _linear_luma: f32, sliders: ToneSliders) -> f32 {
    let ws = shadow_mask(log_base);
    sliders.highlights * HIGHLIGHT_LOG_STRENGTH * highlight_mask(log_base)
        + sliders.shadows * SHADOW_LOG_STRENGTH * ws * ws.sqrt()
        + sliders.whites * WHITES_LOG_STRENGTH * whites_mask(log_base)
        + sliders.blacks * BLACKS_LOG_STRENGTH * blacks_mask(log_base)
}

/// Monotone Reinhard rolloff for values above sensor white when Highlights or
/// Whites are pulled. Continuous with the log gain at luma = 1 (C1), so an HDR
/// ramp stays increasing instead of folding back.
#[inline]
pub fn overrange_scale(linear_luma: f32, gain: f32, sliders: ToneSliders) -> f32 {
    let pull = (-sliders.highlights).max(0.0) + (-sliders.whites).max(0.0) * 0.35;
    if pull <= 1e-6 || linear_luma <= 1.0 || gain <= 0.0 {
        return 1.0;
    }
    let k = pull * OVERRANGE_PULL_K;
    let excess = linear_luma - 1.0;
    let y_out = gain + excess * gain / (1.0 + excess * k);
    y_out / (linear_luma * gain)
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
    let y = luma(rgb).max(0.0);
    let delta = local_tone_delta(log_base, y, sliders);
    let g = if delta.abs() < 1e-8 {
        1.0
    } else {
        2f32.powf(delta)
    };
    let s = g * overrange_scale(y, g, sliders);
    if (s - 1.0).abs() < 1e-8 {
        return rgb;
    }
    [rgb[0] * s, rgb[1] * s, rgb[2] * s]
}

/// Contrast around middle grey in log EV. Identity at 0.
#[inline]
pub fn apply_contrast(rgb: [f32; 3], contrast: f32) -> [f32; 3] {
    if contrast.abs() < 1e-8 {
        return rgb;
    }
    let y = luma(rgb).max(1e-8);
    let slope = if contrast >= 0.0 {
        1.0 + 0.55 * contrast
    } else {
        1.0 + 0.4 * contrast
    };
    let ev = (y / GREY).log2();
    let g = (GREY * 2f32.powf(ev * slope)) / y;
    [rgb[0] * g, rgb[1] * g, rgb[2] * g]
}

/// Per-channel saturation point after white-balance.
///
/// Developed pixels are already WB-multiplied: a channel that was scaled up
/// clips at `wb[i] / wb_green` (green-normalized) times sensor white.
pub fn channel_clip_levels(wb: [f32; 3]) -> [f32; 3] {
    let g = wb[1].abs().max(1e-6);
    [
        SENSOR_WHITE * CLIP_START * (wb[0] / g).abs().max(1.0),
        SENSOR_WHITE * CLIP_START,
        SENSOR_WHITE * CLIP_START * (wb[2] / g).abs().max(1.0),
    ]
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

fn channel_clipped(rgb: [f32; 3], clip: [f32; 3]) -> [bool; 3] {
    [
        rgb[0] >= clip[0],
        rgb[1] >= clip[1],
        rgb[2] >= clip[2],
    ]
}

/// Reconstruct clipped channels (darktable-style “inpaint opposed”).
///
/// Unclipped channels and a reliable neighbourhood supply chroma ratios.
/// Clipped values are a lower bound: the reconstructed channel is at least the
/// recorded sample and can rise above sensor white so Highlights can pull it
/// back without inventing magenta.
pub fn reconstruct_pixel(rgb: [f32; 3], neighborhood: Option<[f32; 3]>) -> [f32; 3] {
    reconstruct_pixel_at(rgb, neighborhood, [SENSOR_WHITE * CLIP_START; 3])
}

pub fn reconstruct_pixel_at(
    rgb: [f32; 3],
    neighborhood: Option<[f32; 3]>,
    clip: [f32; 3],
) -> [f32; 3] {
    let clipped = channel_clipped(rgb, clip);
    let n = clipped.iter().filter(|c| **c).count();
    if n == 0 {
        return rgb;
    }
    let peak = rgb[0].max(rgb[1]).max(rgb[2]);
    let chroma = neighborhood.filter(|ch| {
        !channel_clipped(*ch, clip).iter().any(|c| *c)
            && (ch[0] + ch[1] + ch[2]) > 0.05
            && ch[0] > 0.0
            && ch[1] > 0.0
            && ch[2] > 0.0
    });

    if n == 3 {
        if let Some(ch) = chroma {
            let sum = (ch[0] + ch[1] + ch[2]).max(1e-4);
            let energy = (rgb[0] + rgb[1] + rgb[2]).max(1e-4);
            return [
                (ch[0] / sum * energy).max(rgb[0]),
                (ch[1] / sum * energy).max(rgb[1]),
                (ch[2] / sum * energy).max(rgb[2]),
            ];
        }
        return [peak, peak, peak];
    }

    let mut out = rgb;
    if let Some(ch) = chroma {
        for i in 0..3 {
            if !clipped[i] {
                continue;
            }
            let mut acc = 0.0;
            let mut w = 0.0;
            for j in 0..3 {
                if clipped[j] || ch[j] <= 1e-5 {
                    continue;
                }
                acc += rgb[j] * (ch[i] / ch[j]);
                w += 1.0;
            }
            if w > 0.0 {
                out[i] = out[i].max(acc / w);
            }
        }
        return out;
    }

    // No trustworthy neighbour: opposed from the pixel's own unclipped channels
    // (assume they share a near-neutral chroma ratio of 1).
    for i in 0..3 {
        if clipped[i] {
            out[i] = out[i].max(peak);
        }
    }
    out
}

fn neighbor_chroma_at(
    data: &[[f32; 3]],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    radius: usize,
    clip: [f32; 3],
) -> Option<[f32; 3]> {
    let t = clip[0].max(clip[1]).max(clip[2]);
    let mut acc = [0.0f32; 3];
    let mut wsum = 0.0f32;
    let y0 = y.saturating_sub(radius);
    let y1 = (y + radius).min(height.saturating_sub(1));
    let x0 = x.saturating_sub(radius);
    let x1 = (x + radius).min(width.saturating_sub(1));
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            if xx == x && yy == y {
                continue;
            }
            let p = data[yy * width + xx];
            if channel_clipped(p, clip).iter().any(|c| *c) {
                continue;
            }
            let peak = p[0].max(p[1]).max(p[2]);
            if peak < t && peak > 0.05 {
                let dx = xx as f32 - x as f32;
                let dy = yy as f32 - y as f32;
                let w = smoothstep(0.25, 0.6, peak) / (1.0 + 0.25 * (dx * dx + dy * dy));
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

/// In-place reconstruction after demosaic / white-level rescale.
///
/// Two expanding passes (r=2 then r=8) so a fully clipped core can inherit
/// chroma from the ring of reliable pixels — guided-inpaint, not a desaturate.
pub fn reconstruct_image(data: &mut [[f32; 3]], width: usize, height: usize) {
    reconstruct_image_at(data, width, height, [SENSOR_WHITE * CLIP_START; 3]);
}

pub fn reconstruct_image_at(
    data: &mut [[f32; 3]],
    width: usize,
    height: usize,
    clip: [f32; 3],
) {
    if width == 0 || height == 0 || data.len() < width * height {
        return;
    }
    for radius in [2usize, 8] {
        let source = data.to_vec();
        data.par_chunks_mut(width)
            .enumerate()
            .take(height)
            .for_each(|(y, row)| {
                for (x, px) in row.iter_mut().enumerate() {
                    if !channel_clipped(*px, clip).iter().any(|c| *c) {
                        continue;
                    }
                    let neigh = neighbor_chroma_at(&source, width, height, x, y, radius, clip);
                    *px = reconstruct_pixel_at(*px, neigh, clip);
                }
            });
    }
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
    let contrasted = apply_contrast(toned, sliders.contrast);
    if raw {
        basic_raw_display(contrasted)
    } else {
        display_encode(contrasted)
    }
}

/// Box mean via a prefix sum (He 2012 guided-filter building block).
pub fn box_mean(src: &[f32], width: usize, height: usize, radius: usize) -> Vec<f32> {
    let n = width * height;
    let mut sat = vec![0.0f64; n];
    for y in 0..height {
        let mut row = 0.0f64;
        for x in 0..width {
            row += src[y * width + x] as f64;
            sat[y * width + x] = row + if y == 0 { 0.0 } else { sat[(y - 1) * width + x] };
        }
    }
    let rect = |x0: i32, y0: i32, x1: i32, y1: i32| -> f64 {
        let x1 = x1.clamp(0, width as i32 - 1) as usize;
        let y1 = y1.clamp(0, height as i32 - 1) as usize;
        let x0c = (x0 - 1).clamp(-1, width as i32 - 1);
        let y0c = (y0 - 1).clamp(-1, height as i32 - 1);
        let a = sat[y1 * width + x1];
        let b = if x0c >= 0 { sat[y1 * width + x0c as usize] } else { 0.0 };
        let c = if y0c >= 0 { sat[y0c as usize * width + x1] } else { 0.0 };
        let d = if x0c >= 0 && y0c >= 0 {
            sat[y0c as usize * width + x0c as usize]
        } else {
            0.0
        };
        a - b - c + d
    };
    let mut out = vec![0.0f32; n];
    for y in 0..height {
        for x in 0..width {
            let x0 = x as i32 - radius as i32;
            let y0 = y as i32 - radius as i32;
            let x1 = x as i32 + radius as i32;
            let y1 = y as i32 + radius as i32;
            let count = ((x1.min(width as i32 - 1) - x0.max(0) + 1)
                * (y1.min(height as i32 - 1) - y0.max(0) + 1)) as f64;
            out[y * width + x] = (rect(x0, y0, x1, y1) / count.max(1.0)) as f32;
        }
    }
    out
}

/// Edge-preserving guided filter (He, Sun, Tang 2012). Guide and signal are luma.
///
/// Approach shared with LightCraft / darktable local masks; this implementation
/// is original (same math as the paper, MIT/Apache-2.0 compatible).
pub fn guided_filter(
    guide: &[f32],
    signal: &[f32],
    width: usize,
    height: usize,
    radius: usize,
    eps: f32,
) -> Vec<f32> {
    let n = width * height;
    if guide.len() < n || signal.len() < n || radius == 0 {
        return signal[..n].to_vec();
    }
    let mean_i = box_mean(guide, width, height, radius);
    let mean_p = box_mean(signal, width, height, radius);
    let mut corr_i = vec![0.0f32; n];
    let mut corr_ip = vec![0.0f32; n];
    for i in 0..n {
        corr_i[i] = guide[i] * guide[i];
        corr_ip[i] = guide[i] * signal[i];
    }
    let mean_ii = box_mean(&corr_i, width, height, radius);
    let mean_ip = box_mean(&corr_ip, width, height, radius);
    let mut a = vec![0.0f32; n];
    let mut b = vec![0.0f32; n];
    for i in 0..n {
        let var = (mean_ii[i] - mean_i[i] * mean_i[i]).max(0.0);
        a[i] = (mean_ip[i] - mean_i[i] * mean_p[i]) / (var + eps);
        b[i] = mean_p[i] - a[i] * mean_i[i];
    }
    let mean_a = box_mean(&a, width, height, radius);
    let mean_b = box_mean(&b, width, height, radius);
    let mut out = vec![0.0f32; n];
    for i in 0..n {
        out[i] = mean_a[i] * guide[i] + mean_b[i];
    }
    out
}

/// Two-scale guided luma: coarse flats + fine edges (no halo across sky / relief).
///
/// Preview uses smaller radii so the same relative smoothing applies on proxies.
pub fn multi_scale_guided_luma(
    luma: &[f32],
    width: usize,
    height: usize,
    preview: bool,
) -> Vec<f32> {
    let r_fine = if preview { 2 } else { 3 };
    let r_coarse = if preview { 6 } else { 10 };
    let fine = guided_filter(luma, luma, width, height, r_fine, 1e-3);
    let coarse = guided_filter(luma, luma, width, height, r_coarse, 4e-3);
    fine.iter()
        .zip(coarse.iter())
        .zip(luma.iter())
        .map(|((f, c), i)| {
            let edge = (*i - *c).abs();
            let w_c = 1.0 - smoothstep(0.03, 0.18, edge);
            f * (1.0 - 0.7 * w_c) + c * 0.7 * w_c
        })
        .collect()
}

/// Develop a whole image with guided H/S masks (CPU reference for the GPU path).
pub fn develop_image(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    sliders: ToneSliders,
    raw: bool,
    preview: bool,
) -> Vec<[f32; 3]> {
    let n = width * height;
    let mut work = pixels[..n].to_vec();
    reconstruct_image(&mut work, width, height);
    for px in &mut work {
        *px = apply_exposure(*px, sliders.exposure);
    }
    let lumas: Vec<f32> = work.iter().map(|p| luma(*p).max(1e-8)).collect();
    let mask_luma = if sliders.needs_local_mask() {
        multi_scale_guided_luma(&lumas, width, height, preview)
    } else {
        lumas.clone()
    };
    work.iter()
        .zip(mask_luma.iter())
        .map(|(rgb, m)| {
            let toned = apply_local_tone(*rgb, log_grey(*m), sliders);
            let contrasted = apply_contrast(toned, sliders.contrast);
            if raw {
                basic_raw_display(contrasted)
            } else {
                display_encode(contrasted)
            }
        })
        .collect()
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
    fn reconstruction_opposed_uses_neighbour_chroma() {
        // Green clipped, red/blue still rising — classic WB magenta sky.
        let magenta = [1.6, 1.0, 1.8];
        let sky = [0.72, 0.60, 0.92];
        let out = reconstruct_pixel(magenta, Some(sky));
        assert!(out[1] > 1.0, "G should rise above the clip: {out:?}");
        let ratio_gb = out[1] / out[2];
        let sky_gb = sky[1] / sky[2];
        assert!(
            (ratio_gb - sky_gb).abs() < 0.12,
            "G/B not inherited from sky: {out:?}"
        );
        let fallback = reconstruct_pixel(magenta, None);
        assert!(fallback[1] >= 1.59);
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
        let mid0 = develop_pixel([0.18, 0.18, 0.18], 0.18, ToneSliders::default(), true);
        assert!(luma(mid) < luma(mid0) + 0.04);
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
        assert!(c[1] > 1.0);
        assert!((c[0] / c[1] - 1.0).abs() < 0.2, "should inherit grey chroma: {c:?}");
    }

    #[test]
    fn reconstruct_image_inpaints_a_clipped_core() {
        let mut img = vec![[0.70, 0.58, 0.90]; 25];
        for y in 1..4 {
            for x in 1..4 {
                img[y * 5 + x] = [2.2, 2.2, 2.2];
            }
        }
        reconstruct_image(&mut img, 5, 5);
        let c = img[12];
        assert!(c[2] > c[1], "core should inherit blue sky, got {c:?}");
        assert!(c[1] > 1.5);
    }

    #[test]
    fn guided_filter_preserves_a_step_edge() {
        let w = 64;
        let h = 16;
        let mut luma = vec![0.08f32; w * h];
        for y in 0..h {
            for x in 32..w {
                luma[y * w + x] = 1.6;
            }
        }
        let guided = multi_scale_guided_luma(&luma, w, h, false);
        let gauss = box_mean(&luma, w, h, 8);
        // Dark side, 4 px from the edge: guided stays close to 0.08, box blur leaks.
        let di = 8 * w + 28;
        let bi = 8 * w + 36;
        assert!(
            (guided[di] - 0.08).abs() < 0.08,
            "guided leaked into the dark side: {}",
            guided[di]
        );
        assert!(
            gauss[di] > guided[di] + 0.05,
            "box blur should halo more than guided"
        );
        assert!(guided[bi] > 1.2, "bright side crushed: {}", guided[bi]);
    }

    #[test]
    fn guided_mask_does_not_halo_highlights() {
        let w = 48;
        let h = 12;
        let mut pixels = vec![[0.04, 0.05, 0.03]; w * h];
        for y in 0..h {
            for x in 24..w {
                pixels[y * w + x] = [1.8, 1.6, 2.2];
            }
        }
        let sliders = ToneSliders::from_ui(0.0, -100.0, 0.0, 0.0, 0.0);
        let out = develop_image(&pixels, w, h, sliders, true, false);
        let dark_edge = out[6 * w + 22];
        let dark_far = out[6 * w + 4];
        let sky = out[6 * w + 40];
        assert!(
            (luma(dark_edge) - luma(dark_far)).abs() < 0.04,
            "halo on the dark side of the edge: edge={} far={}",
            luma(dark_edge),
            luma(dark_far)
        );
        assert!(luma(sky) < 0.92);
        assert!(luma(sky) > luma(dark_edge));
    }

    #[test]
    fn preview_and_quality_masks_agree_on_flats() {
        let w = 40;
        let h = 20;
        let luma: Vec<f32> = (0..w * h)
            .map(|i| 0.2 + 0.01 * ((i % w) as f32 / w as f32))
            .collect();
        let q = multi_scale_guided_luma(&luma, w, h, false);
        let p = multi_scale_guided_luma(&luma, w, h, true);
        let mut err = 0.0;
        for i in 0..luma.len() {
            err += (q[i] - p[i]).abs();
        }
        err /= luma.len() as f32;
        assert!(err < 0.04, "preview/quality mask drift {err}");
    }

    #[test]
    fn reports_filter_and_reconstruct_cost() {
        let wq = 1280;
        let hq = 800;
        let wp = 320;
        let hp = 200;
        let mut quality = vec![[0.2, 0.18, 0.16]; wq * hq];
        for y in 0..hq {
            for x in (wq * 3 / 4)..wq {
                quality[y * wq + x] = [1.7, 1.0, 1.9];
            }
        }
        let preview: Vec<[f32; 3]> = (0..wp * hp)
            .map(|i| quality[(i / wp) * 4 * wq + (i % wp) * 4])
            .collect();
        let luma_q: Vec<f32> = quality.iter().map(|p| luma(*p)).collect();
        let luma_p: Vec<f32> = preview.iter().map(|p| luma(*p)).collect();

        let t0 = std::time::Instant::now();
        let _ = multi_scale_guided_luma(&luma_q, wq, hq, false);
        let guided_q = t0.elapsed();
        let t1 = std::time::Instant::now();
        let _ = multi_scale_guided_luma(&luma_p, wp, hp, true);
        let guided_p = t1.elapsed();

        let mut rec_q = quality.clone();
        let t2 = std::time::Instant::now();
        reconstruct_image(&mut rec_q, wq, hq);
        let rec_q_ms = t2.elapsed();
        let mut rec_p = preview.clone();
        let t3 = std::time::Instant::now();
        reconstruct_image(&mut rec_p, wp, hp);
        let rec_p_ms = t3.elapsed();

        eprintln!(
            "cost quality {}x{}: guided {:.2}ms reconstruct {:.2}ms",
            wq,
            hq,
            guided_q.as_secs_f64() * 1000.0,
            rec_q_ms.as_secs_f64() * 1000.0
        );
        eprintln!(
            "cost preview {}x{}: guided {:.2}ms reconstruct {:.2}ms",
            wp,
            hp,
            guided_p.as_secs_f64() * 1000.0,
            rec_p_ms.as_secs_f64() * 1000.0
        );
        assert!(rec_q[hq / 2 * wq + wq - 8][1] > 1.0);
    }

    #[test]
    fn channel_clip_follows_white_balance() {
        let clip = channel_clip_levels([1.8, 1.0, 1.5]);
        assert!((clip[0] - 0.98 * 1.8).abs() < 1e-5);
        assert!((clip[1] - 0.98).abs() < 1e-5);
        assert!(clip[0] > clip[1]);
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
