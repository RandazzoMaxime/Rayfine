//! FlashRaw's develop kernel on one of our normalised mosaics.
//!
//! Our [`Normalized`] data is black-subtracted with white at 1.0. FlashRaw's kernel wants raw sample units, a frame
//! description and a parameter block, so the mosaic goes in as `f32` samples scaled to [`SCALE`] with a zero black
//! level, and the parameters are its own with the white balance, colour matrix and levels removed: what comes out
//! is demosaiced camera RGB again, white = 1.0, which is what `lightcraft_raw::demosaic` returns.
//!
//! Its kernel clamps every channel to `[0, 1]`: highlights above white and the negative noise that our normalised
//! data keeps are lost, which the native demosaics leave to the highlight reconstruction downstream.

use flashraw::low_level::core::{Limits, RawImage};
use flashraw::process::{self, DevelopParams};
use flashraw::{Demosaic, FrameInfo, Rect, SampleFormat, SensorLayout, WhiteLevel};
use lightcraft_raw::{Normalized, Rgb32f};

/// Raw units per 1.0 of normalised value.
const SCALE: f32 = 16383.0;

pub(crate) fn develop(n: &Normalized) -> Option<Rgb32f> {
    let pattern = flashraw::CfaPattern::new(n.cfa.as_ref()?.width, n.cfa.as_ref()?.height, &colors(n.cfa.as_ref()?)?)?;
    let (w, h) = (u32::try_from(n.width).ok()?, u32::try_from(n.height).ok()?);
    if n.cpp != 1 || n.data.len() != n.width.checked_mul(n.height)? {
        return None;
    }
    let mut info = FrameInfo::new(w, h, 14);
    info.cfa = Some(pattern);
    info.layout = if n.cfa.as_ref()?.is_bayer() {
        SensorLayout::Bayer
    } else if n.cfa.as_ref()?.width == 6 {
        SensorLayout::XTrans
    } else {
        SensorLayout::OtherCfa
    };
    info.sample_format = SampleFormat::F32;
    info.white_level = WhiteLevel::uniform(SCALE as u32);
    let mut img = RawImage::new_f32(w, h, 1, &Limits::default()).ok()?;
    img.f32_mut().iter_mut().zip(&n.data).for_each(|(d, s)| *d = s * SCALE);
    let base = DevelopParams::new(&info, Demosaic::Bilinear, Rect::full(w, h));
    let params =
        DevelopParams { wb: [1.0; 4], cam_to_rgb: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], cam4_to_rgb: None, levels: None, ..base };
    let d = process::develop(&img, &info, (0, 0), &params, true).ok()?;
    let data = d.rgb.as_chunks::<3>().0.to_vec();
    Some(Rgb32f { width: d.width as usize, height: d.height as usize, data })
}

fn colors(c: &lightcraft_raw::Cfa) -> Option<Vec<flashraw::CfaColor>> {
    c.pattern
        .iter()
        .map(|&v| match v {
            0 => Some(flashraw::CfaColor::Red),
            1 => Some(flashraw::CfaColor::Green),
            2 => Some(flashraw::CfaColor::Blue),
            _ => None,
        })
        .collect()
}
