//! `lightcraft-flashraw`: [FlashRaw](https://github.com/ybouane/flashraw) as an optional raw backend.
//!
//! FlashRaw is a pure-Rust raw decoder (MIT OR Apache-2.0) with a small built-in developer. [`install`] registers
//! it with `lightcraft_raw::backend`; the user then picks it (`--raw-backend flashraw|auto`,
//! `LIGHTCRAFT_RAW_BACKEND`) and `lightcraft_raw::decode`, `probe_info` and `demosaic` route to it:
//!
//! - **decode**: sensor samples, CFA, levels, active area, crop, orientation and as-shot white balance mapped into
//!   our [`RawImage`] ([`map`]). What FlashRaw takes from its camera database rather than the file is left out
//!   (see [`map`]), and what it does not expose is empty: DNG profile look tables, opcode lists, lens-correction
//!   records and semantic masks. A DNG therefore develops without them under this backend; `auto` keeps our own
//!   decoder for every file it can read.
//! - **demosaic**: FlashRaw's bilinear / nearest-same-colour kernel ([`demosaic`]), on the CPU.
//!
//! Every call into FlashRaw runs under `catch_unwind`: a panic inside it becomes a [`RawError`], never a crash.

#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

mod demosaic;
mod map;

use flashraw::{DecodeOptions, FlashRaw, OutputFormat, RawPixelData};
use lightcraft_raw::backend::{External, install as register};
use lightcraft_raw::{Normalized, OpcodeLists, RawData, RawError, RawImage, RawInfo, Result, Rgb32f};
use std::panic::{AssertUnwindSafe, catch_unwind};

/// Register FlashRaw as `lightcraft_raw`'s external backend. Call once at start-up, before any decode; `false`
/// when a backend was already registered.
pub fn install() -> bool {
    register(External { decode, probe, demosaic })
}

/// The FlashRaw crate's version this build links (for `--version`, bug reports and the comparison tables).
pub const VERSION: &str = "0.1.1";

fn guarded<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err(RawError::Corrupt("the FlashRaw decoder panicked on this file".into())))
}

/// Everything FlashRaw knows of `bytes` before decoding a sample, as our [`RawInfo`].
fn describe(bytes: &[u8], fr: &FlashRaw<'_>) -> Result<RawInfo> {
    let info = fr.frame_info();
    let (area, crop) = (map::rect(info.active_area), map::rect(info.crop));
    // ours is relative to the active area, FlashRaw's is in buffer coordinates
    let crop = lightcraft_raw::Rect::new(crop.x.saturating_sub(area.x), crop.y.saturating_sub(area.y), crop.width, crop.height);
    let format = map::format(fr.format());
    let mut metadata = lightcraft_meta::extract(bytes);
    metadata.width = u32::try_from(crop.width).ok();
    metadata.height = u32::try_from(crop.height).ok();
    Ok(RawInfo {
        format,
        width: info.width as usize,
        height: info.height as usize,
        cpp: info.cpp as usize,
        cfa: info.cfa.as_ref().map(map::cfa).transpose()?,
        bits: u32::from(info.bits_per_sample),
        active_area: area,
        crop,
        orientation: map::orientation(info.orientation),
        color: map::color_data(&info.color_matrices, info.white_balance.as_ref(), format == lightcraft_raw::RawFormat::Dng),
        wb_multipliers: map::wb_multipliers(info).filter(|_| format != lightcraft_raw::RawFormat::Dng),
        opcodes: OpcodeLists::default(),
        metadata,
        lens_metadata: Default::default(),
        pixel_aspect: info.pixel_aspect,
    })
}

/// [`lightcraft_raw::probe_info`] through FlashRaw, whatever backend is selected.
pub fn probe_bytes(bytes: &[u8]) -> Result<RawInfo> {
    probe(bytes)
}

/// [`lightcraft_raw::decode`] through FlashRaw, whatever backend is selected (for comparisons and tests).
pub fn decode_bytes(bytes: &[u8]) -> Result<RawImage> {
    decode(bytes)
}

fn probe(bytes: &[u8]) -> Result<RawInfo> {
    guarded(|| describe(bytes, &FlashRaw::open(bytes).map_err(map::error)?))
}

fn decode(bytes: &[u8]) -> Result<RawImage> {
    guarded(|| {
        let fr = FlashRaw::open(bytes).map_err(map::error)?;
        let info = describe(bytes, &fr)?;
        let frame = fr.decode(DecodeOptions { output: OutputFormat::RawU16, ..Default::default() }).map_err(map::error)?;
        let RawPixelData::U16(samples) = frame.data else {
            return Err(RawError::Unsupported("FlashRaw returned something other than 16-bit samples".into()));
        };
        let cpp = info.cpp;
        let image = RawImage {
            format: info.format,
            width: info.width,
            height: info.height,
            cpp,
            data: RawData::U16(samples),
            cfa: info.cfa,
            bits: info.bits,
            black: map::black(&frame.black_level, frame.active_area),
            white: map::white(&frame.white_level, cpp),
            active_area: info.active_area,
            crop: info.crop,
            orientation: info.orientation,
            color: info.color,
            wb_multipliers: info.wb_multipliers,
            linearized: false,
            pixel_aspect: info.pixel_aspect,
            opcodes: info.opcodes,
            metadata: info.metadata,
            lens_metadata: info.lens_metadata,
        };
        image.validate()?;
        Ok(image)
    })
}

/// FlashRaw's demosaic of a normalised mosaic (camera RGB, white = 1.0); `None` when it cannot take the mosaic.
pub fn demosaic(n: &Normalized) -> Option<Rgb32f> {
    catch_unwind(AssertUnwindSafe(|| demosaic::develop(n))).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(decode(&[]).is_err());
        assert!(decode(b"definitely not a raw file").is_err());
        assert!(probe(&[0u8; 64]).is_err());
    }
}
