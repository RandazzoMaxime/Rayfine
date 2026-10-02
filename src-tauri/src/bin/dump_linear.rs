//! Dump Rayfine's linear MHC demosaic (no develop sliders) to a 16-bit TIFF.
//! Usage: cargo run -p Rayfine --bin dump_linear -- INPUT.ARW OUTPUT.tif

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args
        .next()
        .expect("usage: dump_linear INPUT.raw OUTPUT.tif");
    let output = args
        .next()
        .expect("usage: dump_linear INPUT.raw OUTPUT.tif");
    let bytes = std::fs::read(&input).unwrap_or_else(|e| panic!("read {input}: {e}"));
    let img = rapidraw_lib::develop_raw_image(&bytes, false, 4.0, "default".to_string(), None)
        .unwrap_or_else(|e| panic!("develop: {e}"));
    img.save(&output)
        .unwrap_or_else(|e| panic!("write {output}: {e}"));
    eprintln!(
        "dump_linear {} -> {} ({}x{})",
        input,
        output,
        img.width(),
        img.height()
    );
}
