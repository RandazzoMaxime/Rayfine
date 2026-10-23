//! Develop a public RAW with mapped Lightroom sliders (legacy vs scene-linear).
//!
//! Usage:
//!   cargo run -p Rayfine --bin lr_public_compare -- \
//!     --raw FILE --sliders sliders.json --out DIR [--long-edge 640]

use image::{Rgb, RgbImage};
use rapidraw_lib::{ToneSliders, develop_image, develop_raw_image, legacy_develop_pixel};
use serde::Deserialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct SliderFile {
    #[serde(default)]
    exposure: f32,
    #[serde(default)]
    highlights: f32,
    #[serde(default)]
    shadows: f32,
    #[serde(default)]
    whites: f32,
    #[serde(default)]
    blacks: f32,
    #[serde(default)]
    contrast: f32,
}

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn pixels_to_image(pixels: &[[f32; 3]], w: u32, h: u32) -> RgbImage {
    let mut img = RgbImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let p = pixels[(y * w + x) as usize];
            img.put_pixel(x, y, Rgb([to_u8(p[0]), to_u8(p[1]), to_u8(p[2])]));
        }
    }
    img
}

fn load_linear(path: &Path, long_edge: u32) -> (u32, u32, Vec<[f32; 3]>) {
    let bytes = fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    eprintln!(
        "developing {} ({} bytes, long_edge={long_edge})",
        path.display(),
        bytes.len()
    );
    let img = develop_raw_image(&bytes, false, 16.0, "default".to_string(), None)
        .unwrap_or_else(|e| panic!("develop {}: {e}", path.display()));
    let rgb = img.to_rgb32f();
    let (w, h) = rgb.dimensions();
    let scale = long_edge as f32 / w.max(h) as f32;
    let dw = ((w as f32 * scale).round() as u32).max(1);
    let dh = ((h as f32 * scale).round() as u32).max(1);
    let mut pixels = Vec::with_capacity((dw * dh) as usize);
    for y in 0..dh {
        for x in 0..dw {
            let sx = (x as f32 / dw as f32 * w as f32) as u32;
            let sy = (y as f32 / dh as f32 * h as f32) as u32;
            let p = rgb.get_pixel(sx.min(w - 1), sy.min(h - 1));
            pixels.push([p[0], p[1], p[2]]);
        }
    }
    (dw, dh, pixels)
}

fn parse_args() -> (PathBuf, PathBuf, PathBuf, u32) {
    let mut raw = None;
    let mut sliders = None;
    let mut out = None;
    let mut long_edge = 640u32;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--raw" => raw = args.next().map(PathBuf::from),
            "--sliders" => sliders = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--long-edge" => {
                long_edge = args
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(640);
            }
            other => panic!("unknown arg {other}"),
        }
    }
    (
        raw.expect("--raw"),
        sliders.expect("--sliders"),
        out.expect("--out"),
        long_edge,
    )
}

fn main() {
    let (raw, sliders_path, out, long_edge) = parse_args();
    fs::create_dir_all(&out).expect("mkdir");
    let parsed: SliderFile =
        serde_json::from_str(&fs::read_to_string(&sliders_path).expect("sliders")).expect("json");
    let sliders = ToneSliders::from_ui_full(
        parsed.exposure,
        parsed.highlights,
        parsed.shadows,
        parsed.whites,
        parsed.blacks,
        parsed.contrast,
    );
    let (w, h, linear) = load_linear(&raw, long_edge);
    let after = develop_image(&linear, w as usize, h as usize, sliders, true, false);
    let before: Vec<[f32; 3]> = linear
        .iter()
        .map(|p| {
            let clamped = [p[0].clamp(0.0, 1.0), p[1].clamp(0.0, 1.0), p[2].clamp(0.0, 1.0)];
            legacy_develop_pixel(clamped, sliders)
        })
        .collect();
    pixels_to_image(&before, w, h)
        .save(out.join("rayfine_before.png"))
        .expect("before png");
    pixels_to_image(&after, w, h)
        .save(out.join("rayfine_after.png"))
        .expect("after png");
    eprintln!("{}", sliders.ui_label("quality"));
}
