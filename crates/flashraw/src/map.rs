//! FlashRaw's descriptions of a raw file → ours.
//!
//! What crosses over: what the file states, and the colour matrices FlashRaw takes from its camera database for
//! the non-DNG files that carry none (maintainer decision, 2026-10-27: the dcraw-derived camera matrices are
//! accepted for this backend, as other open-source raw tools do; the rest of the clean-room rules stand).

use flashraw::{BlackLevel, CfaPattern, ColorMatrices, ColorMatrix, ColorSource, FrameInfo, Orientation, Rect, WhiteBalance, WhiteLevel};
use lightcraft_raw::{Cfa, ColorData, Mat3, RawError, RawFormat, Result};

pub(crate) fn error(e: flashraw::Error) -> RawError {
    match e {
        flashraw::Error::UnsupportedFormat(_) => RawError::NotRaw,
        flashraw::Error::CorruptFile { what, .. } => RawError::Corrupt(what),
        other => RawError::Unsupported(other.to_string()),
    }
}

pub(crate) fn cfa(p: &CfaPattern) -> Result<Cfa> {
    let (width, height) = (p.width(), p.height());
    let pattern = (0..height)
        .flat_map(|y| (0..width).map(move |x| (x, y)))
        .map(|(x, y)| match p.color_at(x, y) as u8 {
            c @ 0..=2 => Ok(c),
            c => Err(RawError::Unsupported(format!("CFA colour {c} (only red, green and blue filters are developed)"))),
        })
        .collect::<Result<Vec<u8>>>()?;
    Ok(Cfa { width, height, pattern })
}

pub(crate) fn rect(r: Rect) -> lightcraft_raw::Rect {
    lightcraft_raw::Rect::new(r.x as usize, r.y as usize, r.width as usize, r.height as usize)
}

pub(crate) fn orientation(o: Orientation) -> lightcraft_raw::Orientation {
    lightcraft_raw::Orientation::from_exif(o as u16)
}

pub(crate) fn format(f: flashraw::RawFormat) -> RawFormat {
    use flashraw::RawFormat as F;
    match f {
        F::Dng => RawFormat::Dng,
        F::Cr2 => RawFormat::Cr2,
        F::Cr3 => RawFormat::Cr3,
        F::Nef => RawFormat::Nef,
        F::Arw => RawFormat::Arw,
        F::Raf => RawFormat::Raf,
        F::Orf => RawFormat::Orf,
        F::Rw2 => RawFormat::Rw2,
        F::Pef => RawFormat::Pef,
        F::Srw => RawFormat::Srw,
        _ => RawFormat::OtherTiff,
    }
}

/// Our black level (pattern and deltas anchored at the active area) from FlashRaw's (anchored at the buffer).
pub(crate) fn black(b: &BlackLevel, active: Rect) -> lightcraft_raw::BlackLevel {
    let (rows, cols, samples) = (usize::from(b.rows.max(1)), usize::from(b.cols.max(1)), usize::from(b.samples.max(1)));
    let (ax, ay) = (active.x as usize, active.y as usize);
    let value = |r: usize, c: usize, s: usize| b.values.get((r * cols + c) * samples + s).or(b.values.first()).copied().unwrap_or(0.0);
    let values = (0..rows)
        .flat_map(|j| (0..cols).map(move |i| (j, i)))
        .flat_map(|(j, i)| (0..samples).map(move |s| (j, i, s)))
        .map(|(j, i, s)| value((j + ay) % rows, (i + ax) % cols, s))
        .collect();
    let window = |d: &[f32], start: usize, len: usize| d.get(start..start.saturating_add(len)).map(<[f32]>::to_vec).unwrap_or_default();
    lightcraft_raw::BlackLevel {
        repeat_rows: rows,
        repeat_cols: cols,
        values,
        delta_h: window(&b.col_deltas, ax, active.width as usize),
        delta_v: window(&b.row_deltas, ay, active.height as usize),
    }
}

/// One white level per sample. A CFA sensor has a single plane here, so FlashRaw's per-colour levels become their
/// largest (the clip point of the colour that saturates last).
pub(crate) fn white(w: &WhiteLevel, cpp: usize) -> Vec<f32> {
    if cpp == 1 {
        return vec![w.max() as f32];
    }
    (0..cpp).map(|s| w.at(s) as f32).collect()
}

/// As-shot multipliers `[R, 1, B]`, unless the camera already applied them to the samples.
pub(crate) fn wb_multipliers(info: &FrameInfo) -> Option<[f32; 3]> {
    if info.white_balance_applied {
        return None;
    }
    let c = info.white_balance.as_ref()?.coeffs;
    Some([c[0], 1.0, c[2]])
}

fn mat3(m: &ColorMatrix) -> Option<Mat3> {
    (m.rows == 3).then(|| Mat3(std::array::from_fn(|r| std::array::from_fn(|c| f64::from(m.get(r, c))))))
}

fn pair(ms: &[ColorMatrix]) -> ([u16; 2], [Option<Mat3>; 2]) {
    let at = |i: usize| ms.get(i);
    ([at(0).map_or(0, |m| m.illuminant.0), at(1).map_or(0, |m| m.illuminant.0)], [at(0).and_then(mat3), at(1).and_then(mat3)])
}

/// The colour tags FlashRaw has: the file's own, else its camera database's.
pub(crate) fn color_data(m: &ColorMatrices, wb: Option<&WhiteBalance>, dng: bool) -> ColorData {
    let mut c = ColorData::default();
    if m.source == ColorSource::None || m.color.is_empty() {
        return c;
    }
    (c.illuminant, c.color_matrix) = pair(&m.color);
    c.forward_matrix = pair(&m.forward).1;
    c.camera_calibration = pair(&m.calibration).1;
    c.analog_balance = (m.analog_balance.len() == 3).then(|| std::array::from_fn(|i| f64::from(m.analog_balance[i])));
    if dng && let Some(w) = wb {
        c.as_shot_neutral = Some([1.0 / f64::from(w.coeffs[0]), 1.0 / f64::from(w.coeffs[1]), 1.0 / f64::from(w.coeffs[2])]);
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_pattern_follows_the_active_area_origin() {
        let b = BlackLevel::pattern2x2([10.0, 20.0, 30.0, 40.0]);
        let b = black(&b, Rect { x: 1, y: 0, width: 4, height: 4 });
        // the active area starts on the second column: its (0, 0) is the buffer's (1, 0)
        assert_eq!(b.values, [20.0, 10.0, 40.0, 30.0]);
        let b = black(&BlackLevel::pattern2x2([10.0, 20.0, 30.0, 40.0]), Rect { x: 0, y: 1, width: 4, height: 4 });
        assert_eq!(b.values, [30.0, 40.0, 10.0, 20.0]);
    }

    #[test]
    fn deltas_are_cut_to_the_active_area() {
        let mut b = BlackLevel::uniform(5.0);
        b.col_deltas = (0..10).map(|i| i as f32).collect();
        b.row_deltas = vec![1.0; 3];
        let ours = black(&b, Rect { x: 2, y: 0, width: 4, height: 8 });
        assert_eq!(ours.delta_h, [2.0, 3.0, 4.0, 5.0]);
        // shorter than the active area's rows: dropped rather than read out of range
        assert!(ours.delta_v.is_empty());
    }

    #[test]
    fn database_matrices_cross_over() {
        let m = ColorMatrices {
            color: vec![ColorMatrix::new(flashraw::Illuminant::D65, 3, vec![1.0; 9]).unwrap()],
            source: ColorSource::CameraDb,
            ..Default::default()
        };
        let c = color_data(&m, None, false);
        assert_eq!((c.color_matrix[0].is_some(), c.illuminant[0]), (true, 21));
        assert_eq!(color_data(&ColorMatrices::default(), None, false), ColorData::default());
    }

    #[test]
    fn unsupported_cfa_colours_are_refused() {
        let cmyg = CfaPattern::parse("CMYG").map(|p| cfa(&p));
        assert!(matches!(cmyg, Some(Err(RawError::Unsupported(_)))) || cmyg.is_none());
        assert_eq!(CfaPattern::parse("RGGB").map(|p| cfa(&p)), Some(Ok(Cfa { width: 2, height: 2, pattern: vec![0, 1, 1, 2] })));
    }
}
