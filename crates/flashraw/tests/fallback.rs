//! The default backend (`auto`): our decoders first, FlashRaw only for a file they refuse. A compressed Olympus ORF is
//! the case that matters: every Olympus / OM body since about 2008 writes one and `lightcraft-raw` does not decode it.

use lightcraft_raw::backend::{self, RawBackend};

#[test]
fn a_file_we_refuse_is_decoded_by_flashraw_by_default() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../corpus/raw");
    let Ok(bytes) = std::fs::read(dir.join("orf-olympus-em1.orf")) else {
        lightcraft_testkit::skip!(Corpus, "no corpus/raw/orf-olympus-em1.orf (cargo xtask corpus --download)");
        return;
    };
    assert!(lightcraft_flashraw::install());
    assert_eq!(backend::backend(), RawBackend::Auto);

    let raw = lightcraft_raw::decode(&bytes).expect("auto falls back to FlashRaw for a compressed ORF");
    assert_eq!((raw.width, raw.height, raw.cpp), (4640, 3472, 1));
    assert!(raw.cfa.is_some());
    assert!(raw.develop(lightcraft_raw::Method::Bilinear).is_ok());
    assert!(lightcraft_raw::probe_info(&bytes).is_ok());

    backend::set_backend(RawBackend::Native).unwrap();
    let ours = lightcraft_raw::decode(&bytes).unwrap_err();
    assert!(ours.to_string().contains("Olympus compressed ORF"), "{ours}");
}
