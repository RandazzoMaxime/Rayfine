//! The raw backend chosen at start-up (`--raw-backend`, `LIGHTCRAFT_RAW_BACKEND`).
//!
//! `lightcraft_raw::backend` holds the switch; this registers the optional backends the build includes (FlashRaw,
//! with the `flashraw` feature) and lets the apps select one by name. It is a start-up choice: files already
//! decoded in a session keep what they were decoded with.

use lightcraft_raw::backend::{self, RawBackend};

/// Register the optional backends this build has. Idempotent; call once at start-up, before any file is opened.
pub fn init() {
    #[cfg(feature = "flashraw")]
    lightcraft_flashraw::install();
}

/// Select the backend named `name` (`native`, `flashraw` or `auto`).
pub fn select(name: &str) -> Result<(), String> {
    init();
    let b = RawBackend::parse(name).ok_or_else(|| format!("unknown raw backend `{name}` (use native, flashraw or auto)"))?;
    backend::set_backend(b)
}

/// One line for `--version` and logs: the backend in use and the ones this build offers.
pub fn describe() -> String {
    init();
    let offered: Vec<&str> = backend::available().into_iter().map(RawBackend::name).collect();
    format!("raw backend {} (available: {})", backend::backend().name(), offered.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_names_are_refused() {
        assert!(select("libraw").unwrap_err().contains("unknown raw backend"));
    }

    #[cfg(not(feature = "flashraw"))]
    #[test]
    fn flashraw_needs_the_feature() {
        assert!(select("flashraw").unwrap_err().contains("not built into this binary"));
        assert_eq!(describe(), "raw backend native (available: native)");
    }

    #[cfg(feature = "flashraw")]
    #[test]
    fn flashraw_is_offered_with_the_feature() {
        assert!(describe().contains("native, flashraw, auto"));
    }
}
