//! Hand-written Bayer demosaic (Malvar–He–Cutler, 2004) fused with camera calibration and the
//! default crop, replacing rawler's PPG path for plain RGB Bayer sensors.
//!
//! Why: rawler's develop clones the whole raw image, runs PPG in four passes, then maps colour
//! and crops in separate full-image passes. Here a single parallel pass reads the scaled CFA
//! data and writes calibrated linear sRGB for the cropped area only.
//!
//! MHC is a gradient-corrected bilinear interpolation (5x5 kernels). It is sharper than
//! bilinear, has far less zippering, and every output pixel is independent (trivially parallel).

use rawler::cfa::{CFA_COLOR_B, CFA_COLOR_G, CFA_COLOR_R};
use rawler::imgop::develop::Intermediate;
use rawler::imgop::matrix::{multiply, normalize, pseudo_inverse};
use rawler::imgop::raw::clip_euclidean_norm_avg;
use rawler::imgop::xyz::{Illuminant, SRGB_TO_XYZ_D65};
use rawler::imgop::{Dim2, Point, Rect};
use rawler::pixarray::Color2D;
use rawler::rawimage::{RawImage, RawPhotometricInterpretation};
use rayon::prelude::*;

/// True when this image can use the custom path (single-channel 2x2 RGB Bayer CFA).
pub fn is_supported(raw: &RawImage) -> bool {
    if raw.cpp != 1 {
        return false;
    }
    match &raw.photometric {
        RawPhotometricInterpretation::Cfa(config) => {
            config.cfa.is_rgb() && config.cfa.width == 2 && config.cfa.height == 2
        }
        _ => false,
    }
}

/// Equivalent of rawler `RawDevelop::develop_intermediate` with steps
/// Rescale + Demosaic + CropActiveArea + WhiteBalance + Calibrate + CropDefault (no sRGB gamma).
/// Caller must check `is_supported` first. Mutates `raw` (scaling in place, no clone).
pub fn develop_bayer(raw: &mut RawImage) -> anyhow::Result<Intermediate> {
    let cfa = match &raw.photometric {
        RawPhotometricInterpretation::Cfa(config) => config.cfa.clone(),
        _ => anyhow::bail!("not a CFA image"),
    };
    raw.apply_scaling().map_err(|e| anyhow::anyhow!("{e}"))?;

    let width = raw.width;
    let height = raw.height;
    let roi = raw.active_area.unwrap_or(Rect {
        p: Point { x: 0, y: 0 },
        d: Dim2 { w: width, h: height },
    });

    // Default crop, expressed relative to the active area (same logic as rawler).
    let mut out_rect = Rect {
        p: Point { x: 0, y: 0 },
        d: roi.d,
    };
    if let Some(mut crop) = raw.crop_area {
        if let Some(active) = raw.active_area {
            crop = crop.intersection(&active).adapt(&active);
        }
        if !crop.is_empty() && crop.d != roi.d {
            out_rect = crop;
        }
    }

    let cam2rgb = camera_to_srgb(raw);
    let wb = if raw.wb_coeffs[0].is_nan() {
        [1.0, 1.0, 1.0, 1.0]
    } else {
        raw.wb_coeffs
    };

    let data = raw.data.as_f32();
    let src: &[f32] = &data;
    let cfa_roi = cfa.shift(roi.p.x, roi.p.y);

    let out_w = out_rect.d.w;
    let out_h = out_rect.d.h;
    let mut out = vec![[0f32; 3]; out_w * out_h];
    // 2x2 CFA phase table (row parity, col parity) -> colour index; avoids per-sample modulo.
    let pattern = [
        [cfa_roi.color_at(0, 0), cfa_roi.color_at(0, 1)],
        [cfa_roi.color_at(1, 0), cfa_roi.color_at(1, 1)],
    ];

    out.par_chunks_mut(out_w).enumerate().for_each(|(oy, row)| {
        let y = oy + out_rect.p.y; // row within ROI
        for (ox, px) in row.iter_mut().enumerate() {
            let x = ox + out_rect.p.x; // column within ROI
            let rgb_cam = mhc_pixel(src, width, roi, &pattern, x, y);
            let r = rgb_cam[0] * wb[0];
            let g = rgb_cam[1] * wb[1];
            let b = rgb_cam[2] * wb[2];
            *px = match &cam2rgb {
                Some(m) => clip_euclidean_norm_avg(&[
                    m[0][0] * r + m[0][1] * g + m[0][2] * b,
                    m[1][0] * r + m[1][1] * g + m[1][2] * b,
                    m[2][0] * r + m[2][1] * g + m[2][2] * b,
                ]),
                None => [r, g, b],
            };
        }
    });

    Ok(Intermediate::ThreeColor(Color2D::new_with(out, out_w, out_h)))
}

/// cam -> linear sRGB matrix (rawler's map_3ch_to_rgb math). None if no usable colour matrix.
pub(crate) fn camera_to_srgb(raw: &RawImage) -> Option<[[f32; 4]; 3]> {
    let (_, color_matrix) = raw
        .color_matrix
        .iter()
        .find(|(illuminant, _)| **illuminant == Illuminant::D65)
        .or_else(|| raw.color_matrix.iter().next())?;
    if color_matrix.len() % 3 != 0 {
        return None;
    }
    let mut xyz2cam: [[f32; 3]; 4] = [[0.0; 3]; 4];
    for i in 0..(color_matrix.len() / 3).min(4) {
        for j in 0..3 {
            xyz2cam[i][j] = color_matrix[i * 3 + j];
        }
    }
    let rgb2cam = normalize(multiply(&xyz2cam, &SRGB_TO_XYZ_D65));
    Some(pseudo_inverse(rgb2cam))
}

/// Malvar–He–Cutler interpolation of one pixel. `x`,`y` are ROI coordinates; samples outside
/// the ROI are mirrored (reflect-101, which keeps the CFA phase). Interior pixels take a
/// branch-free direct-index path.
#[inline(always)]
fn mhc_pixel(src: &[f32], stride: usize, roi: Rect, pattern: &[[usize; 2]; 2], x: usize, y: usize) -> [f32; 3] {
    let w = roi.d.w;
    let h = roi.d.h;
    let color = pattern[y & 1][x & 1];
    let horiz = pattern[y & 1][(x + 1) & 1];
    if x >= 2 && y >= 2 && x + 2 < w && y + 2 < h {
        let base = (roi.p.y + y) * stride + roi.p.x + x;
        let s = |dx: isize, dy: isize| -> f32 {
            // SAFETY-free: indices proven in range by the interior test above.
            src[(base as isize + dy * stride as isize + dx) as usize]
        };
        mhc_kernel(&s, color, horiz)
    } else {
        let (wi, hi) = (w as isize, h as isize);
        let s = |dx: isize, dy: isize| -> f32 {
            let mut xx = x as isize + dx;
            let mut yy = y as isize + dy;
            if xx < 0 {
                xx = -xx;
            } else if xx >= wi {
                xx = 2 * (wi - 1) - xx;
            }
            if yy < 0 {
                yy = -yy;
            } else if yy >= hi {
                yy = 2 * (hi - 1) - yy;
            }
            src[(roi.p.y + yy as usize) * stride + roi.p.x + xx as usize]
        };
        mhc_kernel(&s, color, horiz)
    }
}

#[inline(always)]
fn mhc_kernel(s: &impl Fn(isize, isize) -> f32, color: usize, horiz: usize) -> [f32; 3] {
    let c = s(0, 0);
    if color == CFA_COLOR_G {
        let n4 = s(-1, -1) + s(1, -1) + s(-1, 1) + s(1, 1);
        let theta = (5.0 * c + 4.0 * (s(-1, 0) + s(1, 0)) - (s(-2, 0) + s(2, 0)) - n4
            + 0.5 * (s(0, -2) + s(0, 2)))
            * 0.125;
        let phi = (5.0 * c + 4.0 * (s(0, -1) + s(0, 1)) - (s(0, -2) + s(0, 2)) - n4
            + 0.5 * (s(-2, 0) + s(2, 0)))
            * 0.125;
        let (r, b) = if horiz == CFA_COLOR_R { (theta, phi) } else { (phi, theta) };
        [r, c, b]
    } else {
        let cross2 = s(-2, 0) + s(2, 0) + s(0, -2) + s(0, 2);
        let g = (4.0 * c + 2.0 * (s(-1, 0) + s(1, 0) + s(0, -1) + s(0, 1)) - cross2) * 0.125;
        let opp = (6.0 * c + 2.0 * (s(-1, -1) + s(1, -1) + s(-1, 1) + s(1, 1)) - 1.5 * cross2) * 0.125;
        if color == CFA_COLOR_R {
            [c, g, opp]
        } else {
            debug_assert_eq!(color, CFA_COLOR_B);
            [opp, g, c]
        }
    }
}

