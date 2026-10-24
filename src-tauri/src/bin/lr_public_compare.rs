//! Develop a public RAW with mapped Lightroom sliders.
//!
//! Usage:
//!   cargo run -p Rayfine --bin lr_public_compare -- \
//!     --raw FILE --sliders sliders.json --out DIR [--long-edge 640] \
//!     [--path legacy|adobe] [--stage wb|profile|exposure|curve|hs|all]

use image::{Rgb, RgbImage};
use rapidraw_lib::{
    AdobeSettings, AdobeStage, NamedCurve, ToneSliders, develop_adobe_image,
    develop_image, develop_raw_camera_linear, develop_raw_image, legacy_develop_pixel,
    parse_dng_profile,
};
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
    #[serde(default)]
    brightness: f32,
    #[serde(default)]
    temperature_k: Option<f32>,
    #[serde(default)]
    tint: Option<f32>,
    #[serde(default)]
    use_as_shot: bool,
    #[serde(default)]
    tone_curve: Option<String>,
    #[serde(default = "default_true")]
    use_forward_matrix: bool,
    #[serde(default = "default_true")]
    apply_look: bool,
}

fn default_true() -> bool {
    true
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

fn downsample_rgb32f(img: &image::DynamicImage, long_edge: u32) -> (u32, u32, Vec<[f32; 3]>) {
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

fn load_linear(path: &Path, long_edge: u32) -> (u32, u32, Vec<[f32; 3]>) {
    let bytes = fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    eprintln!(
        "developing {} ({} bytes, long_edge={long_edge})",
        path.display(),
        bytes.len()
    );
    let img = develop_raw_image(&bytes, false, 16.0, "default".to_string(), None)
        .unwrap_or_else(|e| panic!("develop {}: {e}", path.display()));
    downsample_rgb32f(&img, long_edge)
}

fn load_camera_linear(path: &Path, long_edge: u32) -> (u32, u32, Vec<[f32; 3]>, Vec<u8>) {
    let bytes = fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    eprintln!(
        "camera-linear {} ({} bytes, long_edge={long_edge})",
        path.display(),
        bytes.len()
    );
    let img = develop_raw_camera_linear(&bytes)
        .unwrap_or_else(|e| panic!("camera-linear {}: {e}", path.display()));
    let (w, h, pixels) = downsample_rgb32f(&img, long_edge);
    (w, h, pixels, bytes)
}

fn parse_args() -> (PathBuf, PathBuf, PathBuf, u32, String, String) {
    let mut raw = None;
    let mut sliders = None;
    let mut out = None;
    let mut long_edge = 640u32;
    let mut path = "legacy".to_string();
    let mut stage = "hs".to_string();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--raw" => raw = args.next().map(PathBuf::from),
            "--sliders" => sliders = args.next().map(PathBuf::from),
            "--out" => out = args.next().map(PathBuf::from),
            "--long-edge" => {
                long_edge = args.next().and_then(|s| s.parse().ok()).unwrap_or(640);
            }
            "--path" => path = args.next().unwrap_or_else(|| "legacy".into()),
            "--stage" => stage = args.next().unwrap_or_else(|| "hs".into()),
            other => panic!("unknown arg {other}"),
        }
    }
    (
        raw.expect("--raw"),
        sliders.expect("--sliders"),
        out.expect("--out"),
        long_edge,
        path,
        stage,
    )
}

fn adobe_settings(parsed: &SliderFile) -> AdobeSettings {
    AdobeSettings {
        temperature_k: parsed.temperature_k,
        tint: parsed.tint,
        use_as_shot: parsed.use_as_shot,
        exposure: parsed.exposure,
        brightness: parsed.brightness,
        contrast: parsed.contrast,
        highlights: parsed.highlights,
        shadows: parsed.shadows,
        whites: parsed.whites,
        blacks: parsed.blacks,
        tone_curve: NamedCurve::parse(parsed.tone_curve.as_deref().unwrap_or("Linear")),
        use_forward_matrix: parsed.use_forward_matrix,
        apply_look: parsed.apply_look,
    }
}

fn write_profile_notes(out: &Path, profile: &rapidraw_lib::DngProfile, settings: AdobeSettings) {
    let notes = serde_json::json!({
        "baseline_exposure": profile.baseline_exposure,
        "as_shot_neutral": profile.as_shot_neutral,
        "analog_balance": profile.analog_balance,
        "has_forward": profile.has_forward,
        "has_look": profile.has_look,
        "has_hue_sat_map": profile.has_hue_sat_map,
        "look_dims": profile.look_dims,
        "illuminant1_k": profile.illuminant1_k,
        "illuminant2_k": profile.illuminant2_k,
        "temperature_k": settings.temperature_k,
        "tint": settings.tint,
        "use_as_shot": settings.use_as_shot,
        "exposure": settings.exposure,
        "brightness": settings.brightness,
        "tone_curve": settings.tone_curve.label(),
        "use_forward_matrix": settings.use_forward_matrix,
        "apply_look": settings.apply_look,
        "notes": profile.notes,
    });
    fs::write(out.join("adobe_profile.json"), serde_json::to_string_pretty(&notes).unwrap())
        .expect("profile json");
}

fn main() {
    let (raw, sliders_path, out, long_edge, path, stage_arg) = parse_args();
    fs::create_dir_all(&out).expect("mkdir");
    let parsed: SliderFile =
        serde_json::from_str(&fs::read_to_string(&sliders_path).expect("sliders")).expect("json");

    if path == "adobe" {
        let settings = adobe_settings(&parsed);
        let (w, h, camera, bytes) = load_camera_linear(&raw, long_edge);
        let profile = parse_dng_profile(&bytes).expect("DNG profile");
        write_profile_notes(&out, &profile, settings);
        let stages: Vec<AdobeStage> = if stage_arg == "all" {
            AdobeStage::all().to_vec()
        } else {
            vec![AdobeStage::parse(&stage_arg).unwrap_or_else(|e| panic!("{e}"))]
        };
        for stage in stages {
            let pixels = develop_adobe_image(
                &camera,
                w as usize,
                h as usize,
                &profile,
                settings,
                stage,
            );
            let name = format!("adobe_{}.png", stage.label());
            pixels_to_image(&pixels, w, h)
                .save(out.join(&name))
                .unwrap_or_else(|e| panic!("write {name}: {e}"));
            eprintln!("wrote {name}  {}x{}", w, h);
        }
        return;
    }

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
