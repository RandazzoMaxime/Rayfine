//! The FlashRaw backend reads what our own decoders read: a synthetic DNG field by field, and the corpus files
//! whose sensor data the two decoders agree on (the rest of the comparison is `examples/compare.rs`).

use lightcraft_raw::{BlackLevel, Cfa, ColorData, DngWriteOptions, Normalized, OpcodeLists, Orientation, RawData, RawFormat, RawImage, Rect};
use lightcraft_raw::{Method, demosaic};

fn synthetic_dng() -> Vec<u8> {
    let (w, h) = (64usize, 48usize);
    let data: Vec<u16> = (0..w * h).map(|i| (64 + (i * 97) % 4000) as u16).collect();
    let raw = RawImage {
        format: RawFormat::Dng,
        width: w,
        height: h,
        cpp: 1,
        data: RawData::U16(data),
        cfa: Some(Cfa::bayer("GBRG").unwrap()),
        bits: 12,
        black: BlackLevel::uniform(64.0),
        white: vec![4095.0],
        active_area: Rect::new(4, 2, 56, 44),
        crop: Rect::new(2, 2, 50, 40),
        orientation: Orientation::Rotate90,
        color: ColorData::default(),
        wb_multipliers: None,
        linearized: false,
        pixel_aspect: 1.0,
        opcodes: OpcodeLists::default(),
        metadata: Default::default(),
        lens_metadata: Default::default(),
    };
    lightcraft_raw::write_dng(&raw, &DngWriteOptions::default()).unwrap()
}

/// Where the developed picture starts and how big it is, in sensor coordinates.
fn developed_window(r: &RawImage) -> (usize, usize, usize, usize) {
    let c = r.crop;
    (r.active_area.x + c.x, r.active_area.y + c.y, c.width, c.height)
}

#[test]
fn a_synthetic_dng_reads_the_same_either_way() {
    let bytes = synthetic_dng();
    let ours = lightcraft_raw::decode(&bytes).unwrap();
    let theirs = lightcraft_flashraw::decode_bytes(&bytes).unwrap();
    assert_eq!((ours.width, ours.height, ours.cpp, ours.bits), (theirs.width, theirs.height, theirs.cpp, theirs.bits));
    assert_eq!(ours.cfa, theirs.cfa);
    assert_eq!(ours.orientation, theirs.orientation);
    assert_eq!(developed_window(&ours), developed_window(&theirs));
    assert_eq!((ours.white_at(0), ours.black.mean()), (theirs.white_at(0), theirs.black.mean()));
    assert_eq!(ours.normalized().unwrap(), theirs.normalized().unwrap());
}

#[test]
fn the_probe_agrees_with_the_decode() {
    let bytes = synthetic_dng();
    let info = lightcraft_flashraw::probe_bytes(&bytes).unwrap();
    let full = lightcraft_flashraw::decode_bytes(&bytes).unwrap();
    assert_eq!(info, full.info());
}

#[test]
fn flashraw_bilinear_is_our_bilinear_away_from_the_border() {
    let (w, h) = (40usize, 32usize);
    let cfa = Cfa::bayer("RGGB").unwrap();
    let data = (0..w * h).map(|i| 0.2 + 0.6 * (((i % w) as f32 * 0.3).sin() * ((i / w) as f32 * 0.2).cos()).abs()).collect();
    let n = Normalized { width: w, height: h, cpp: 1, data, cfa: Some(cfa) };
    let theirs = lightcraft_flashraw::demosaic(&n).unwrap();
    let ours = demosaic(&n, Method::Bilinear);
    for y in 2..h - 2 {
        for x in 2..w - 2 {
            for c in 0..3 {
                let (a, b) = (ours.get(x, y)[c], theirs.get(x, y)[c]);
                assert!((a - b).abs() < 2e-3, "({x},{y}) channel {c}: {a} vs {b}");
            }
        }
    }
}

/// Real files the two decoders agree on sample for sample (the Sony ARW sample is not one of them: see
/// `docs/flashraw-backend.md`).
#[test]
fn corpus_files_decode_to_the_same_samples() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../corpus/raw");
    let mut seen = 0;
    for name in [
        "cr2-canon-80d.cr2",
        "cr3-canon-m50-raw.cr3",
        "raf-fuji-xt2-compressed.raf",
        "raf-fuji-xt20-14bit.raf",
        "coverage-4720.nef",
        "coverage-3372.dng",
    ] {
        let Ok(bytes) = std::fs::read(dir.join(name)) else { continue };
        seen += 1;
        let (ours, theirs) = (lightcraft_raw::decode(&bytes).unwrap(), lightcraft_flashraw::decode_bytes(&bytes).unwrap());
        assert!(ours.data == theirs.data, "{name}: sensor samples differ");
        assert_eq!(developed_window(&ours), developed_window(&theirs), "{name}");
    }
    if seen == 0 {
        lightcraft_testkit::skip!(Corpus, "no corpus/raw files (cargo xtask corpus --download)");
    }
}

/// The Sony ARW2 tone curve climbs to 17,220; we stop it at the 14-bit white level (16,383), FlashRaw lets it run.
/// Every sample the two decoders disagree on is a saturated one, above white in both.
#[test]
fn arw2_decoders_differ_only_on_saturated_samples() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../corpus/raw/arw-sony-a7m3-compressed.arw");
    let Ok(bytes) = std::fs::read(path) else {
        lightcraft_testkit::skip!(Corpus, "no corpus/raw/arw-sony-a7m3-compressed.arw (cargo xtask corpus --download)");
        return;
    };
    let (ours, theirs) = (lightcraft_raw::decode(&bytes).unwrap(), lightcraft_flashraw::decode_bytes(&bytes).unwrap());
    assert_eq!(ours.data.len(), theirs.data.len());
    let white = ours.white_at(0);
    let differing: Vec<usize> = (0..ours.data.len()).filter(|&i| ours.data.get(i) != theirs.data.get(i)).collect();
    assert!(!differing.is_empty(), "the sample is expected to hold saturated pixels");
    for i in differing {
        assert!(ours.data.get(i) >= white && theirs.data.get(i) >= white, "sample {i}: {} vs {}", ours.data.get(i), theirs.data.get(i));
    }
}
