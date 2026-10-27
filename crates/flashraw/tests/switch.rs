//! Choosing the backend changes what `lightcraft_raw::decode` does. One test: the choice is process-wide.

use lightcraft_raw::backend::{self, RawBackend};

#[test]
fn the_selected_backend_decides_who_decodes() {
    assert!(backend::set_backend(RawBackend::Flashraw).is_err(), "nothing installed yet");
    assert!(lightcraft_flashraw::install());
    assert!(!lightcraft_flashraw::install(), "the first registration stays");
    assert_eq!(backend::available(), RawBackend::ALL);
    assert_eq!(backend::backend(), RawBackend::Auto, "FlashRaw is the default safety net once installed");

    let garbage = b"not a raw file at all, just some bytes".to_vec();
    for b in RawBackend::ALL {
        backend::set_backend(b).unwrap();
        assert_eq!(backend::backend(), b);
        assert!(lightcraft_raw::decode(&garbage).is_err(), "{b:?}");
        assert!(lightcraft_raw::probe_info(&garbage).is_err(), "{b:?}");
    }
    // `auto` reports our decoder's error, not the second opinion's
    backend::set_backend(RawBackend::Native).unwrap();
    let native = lightcraft_raw::decode(&garbage).unwrap_err();
    backend::set_backend(RawBackend::Auto).unwrap();
    assert_eq!(lightcraft_raw::decode(&garbage).unwrap_err(), native);
}
