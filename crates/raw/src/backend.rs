//! Which decoder and demosaic the raw path uses: ours, or an optional external backend.
//!
//! The application registers the external backend once at start-up ([`install`]; today only
//! `lightcraft-flashraw`, behind the apps' `flashraw` feature). Nothing here depends on it, so a build without
//! the feature has exactly one backend and [`set_backend`] refuses the others.
//!
//! - [`RawBackend::Native`] (default): our decoders and demosaic ([`crate::demosaic`]).
//! - [`RawBackend::Flashraw`]: the external decoder for every file, and its demosaic for every mosaic.
//!   A file it cannot decode is an error, so a comparison never silently falls back.
//! - [`RawBackend::Auto`]: ours first; the external decoder only for a file ours refuses.
//!
//! The choice comes from [`set_backend`] (the apps' `--raw-backend` flag) or, when that was never called, from the
//! `LIGHTCRAFT_RAW_BACKEND` environment variable (`native`, `flashraw`, `auto`).

use crate::{Normalized, RawImage, RawInfo, Result, Rgb32f};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU8, Ordering};

/// The raw backend in use. See the module documentation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum RawBackend {
    #[default]
    Native,
    Flashraw,
    Auto,
}

impl RawBackend {
    pub const ALL: [RawBackend; 3] = [RawBackend::Native, RawBackend::Flashraw, RawBackend::Auto];

    /// Parse a backend name (`native`, `flashraw`, `auto`; case-insensitive).
    pub fn parse(s: &str) -> Option<RawBackend> {
        match s.trim().to_ascii_lowercase().as_str() {
            "native" | "lightcraft" | "default" => Some(RawBackend::Native),
            "flashraw" => Some(RawBackend::Flashraw),
            "auto" => Some(RawBackend::Auto),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            RawBackend::Native => "native",
            RawBackend::Flashraw => "flashraw",
            RawBackend::Auto => "auto",
        }
    }
}

/// The functions an external backend provides.
#[derive(Clone, Copy)]
pub struct External {
    /// Full decode: sensor data and everything [`RawImage`] carries.
    pub decode: fn(&[u8]) -> Result<RawImage>,
    /// Headers only, like [`crate::probe_info`].
    pub probe: fn(&[u8]) -> Result<RawInfo>,
    /// Mosaic → camera RGB (white = 1.0, not white balanced), for a CFA mosaic; `None` leaves it to ours.
    pub demosaic: fn(&Normalized) -> Option<Rgb32f>,
}

static EXTERNAL: OnceLock<External> = OnceLock::new();
static ENV: OnceLock<Option<RawBackend>> = OnceLock::new();
/// `0` = never set; else `1 + RawBackend as u8`.
static SELECTED: AtomicU8 = AtomicU8::new(0);

/// Register the external backend. `false` when one is already registered (the first stays).
pub fn install(external: External) -> bool {
    EXTERNAL.set(external).is_ok()
}

pub fn is_installed() -> bool {
    EXTERNAL.get().is_some()
}

/// Backends this build can use: `native`, plus `flashraw` and `auto` once an external one is installed.
pub fn available() -> Vec<RawBackend> {
    RawBackend::ALL.into_iter().filter(|b| *b == RawBackend::Native || is_installed()).collect()
}

/// Choose the backend. `Err` (nothing changes) when it needs an external backend this build lacks.
pub fn set_backend(b: RawBackend) -> std::result::Result<(), String> {
    if b != RawBackend::Native && !is_installed() {
        return Err(format!("raw backend `{}` is not built into this binary (build with `--features flashraw`)", b.name()));
    }
    SELECTED.store(1 + b as u8, Ordering::Relaxed);
    Ok(())
}

/// The backend in use: [`set_backend`]'s, else the environment's, else native. One that needs an external
/// backend this build lacks reads as native.
pub fn backend() -> RawBackend {
    let chosen = match SELECTED.load(Ordering::Relaxed) {
        0 => ENV.get_or_init(|| std::env::var("LIGHTCRAFT_RAW_BACKEND").ok().as_deref().and_then(RawBackend::parse)).unwrap_or_default(),
        n => RawBackend::ALL.get(usize::from(n) - 1).copied().unwrap_or_default(),
    };
    if chosen != RawBackend::Native && !is_installed() { RawBackend::Native } else { chosen }
}

pub(crate) fn external() -> Option<&'static External> {
    EXTERNAL.get()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for b in RawBackend::ALL {
            assert_eq!(RawBackend::parse(b.name()), Some(b));
        }
        assert_eq!(RawBackend::parse(" FlashRaw "), Some(RawBackend::Flashraw));
        assert_eq!(RawBackend::parse("libraw"), None);
    }

    #[test]
    fn without_an_external_backend_only_native_is_available() {
        // this crate's own tests never install one
        assert!(!is_installed());
        assert_eq!(available(), [RawBackend::Native]);
        assert!(set_backend(RawBackend::Flashraw).is_err());
        assert_eq!(backend(), RawBackend::Native);
    }
}
