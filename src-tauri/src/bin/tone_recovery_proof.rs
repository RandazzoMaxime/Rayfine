//! Before/after contact sheets for highlight recovery.
//!
//! Usage:
//!   cargo run -p Rayfine --bin tone_recovery_proof -- OUT_DIR [optional.RAW]
//!
//! Renders the previous (legacy) Basic path and the new scene-linear path on a
//! synthetic HDR sky plus, when given, a developed public RAW.

use image::{Rgb, RgbImage};
use rapidraw_lib::{
    ToneSliders, develop_image, develop_pixel, legacy_develop_pixel, lightcraft_like_pixel,
};
use std::env;
use std::path::{Path, PathBuf};

const W: u32 = 640;
const H: u32 = 360;

#[derive(Clone, Copy)]
struct ScenePixel {
    rgb: [f32; 3],
}

fn synthetic_sky(x: u32, y: u32) -> ScenePixel {
    let u = x as f32 / (W - 1) as f32;
    let v = y as f32 / (H - 1) as f32;
    let sky = 1.0 - v;
    let ground = (v - 0.55).max(0.0) / 0.45;
    let sun = ((u - 0.78).powi(2) + (v - 0.12).powi(2)).sqrt();
    let cloud = (0.5 + 0.5 * ((u * 18.0).sin() * (v * 9.0 + 0.4).cos())).powf(3.0);
    let sky_l = 0.55 + sky * 2.4 + (1.0 - (sun / 0.22).clamp(0.0, 1.0)).powf(4.0) * 6.0;
    let sky_rgb = [
        sky_l * (1.05 + 0.15 * cloud),
        sky_l * (0.92 + 0.05 * cloud),
        sky_l * (1.25 - 0.1 * cloud),
    ];
    let ground_rgb = [
        0.012 + ground * 0.06,
        0.018 + ground * 0.08,
        0.010 + ground * 0.03,
    ];
    let w = smooth(0.52, 0.62, v);
    ScenePixel {
        rgb: [
            sky_rgb[0] * (1.0 - w) + ground_rgb[0] * w,
            sky_rgb[1] * (1.0 - w) + ground_rgb[1] * w,
            sky_rgb[2] * (1.0 - w) + ground_rgb[2] * w,
        ],
    }
}

fn hdr_ramp(x: u32, _y: u32) -> ScenePixel {
    let t = x as f32 / (W - 1) as f32;
    let y = 0.002 * (8.0f32 / 0.002).powf(t);
    ScenePixel { rgb: [y, y, y] }
}

fn magenta_sky(x: u32, y: u32) -> ScenePixel {
    let u = x as f32 / (W - 1) as f32;
    let v = y as f32 / (H - 1) as f32;
    let sky = 1.0 - v;
    let peak = 0.7 + sky * 1.8 + u * 0.4;
    ScenePixel {
        rgb: [peak * 1.15, peak * 0.72, peak * 1.25],
    }
}

fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

#[derive(Clone, Copy)]
enum PathKind {
    Legacy,
    New,
    Lightcraft,
}

fn collect_scene(scene: impl Fn(u32, u32) -> ScenePixel, w: u32, h: u32) -> Vec<[f32; 3]> {
    let mut px = Vec::with_capacity((w * h) as usize);
    for y in 0..h {
        for x in 0..w {
            px.push(scene(x, y).rgb);
        }
    }
    px
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

fn develop_buffer(pixels: &[[f32; 3]], w: u32, h: u32, sliders: ToneSliders, kind: PathKind, preview: bool) -> Vec<[f32; 3]> {
    match kind {
        PathKind::New => develop_image(pixels, w as usize, h as usize, sliders, true, preview),
        PathKind::Legacy => pixels
            .iter()
            .map(|p| {
                let clamped = [p[0].clamp(0.0, 1.0), p[1].clamp(0.0, 1.0), p[2].clamp(0.0, 1.0)];
                legacy_develop_pixel(clamped, sliders)
            })
            .collect(),
        PathKind::Lightcraft => pixels.iter().map(|p| lightcraft_like_pixel(*p, sliders)).collect(),
    }
}

fn render_scene(scene: impl Fn(u32, u32) -> ScenePixel, sliders: ToneSliders, kind: PathKind) -> RgbImage {
    let buf = collect_scene(scene, W, H);
    let out = develop_buffer(&buf, W, H, sliders, kind, false);
    pixels_to_image(&out, W, H)
}

fn luma(rgb: [f32; 3]) -> f32 {
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

fn clipping_map(scene: impl Fn(u32, u32) -> ScenePixel, sliders: ToneSliders, kind: PathKind) -> RgbImage {
    let buf = collect_scene(scene, W, H);
    let out = develop_buffer(&buf, W, H, sliders, kind, false);
    let mut img = RgbImage::new(W, H);
    for y in 0..H {
        for x in 0..W {
            let p = out[(y * W + x) as usize];
            let hi = p.iter().any(|c| *c >= 0.998);
            let lo = p.iter().any(|c| *c <= 0.002);
            let px = if hi {
                [255, 0, 0]
            } else if lo {
                [0, 0, 255]
            } else {
                [to_u8(p[0]), to_u8(p[1]), to_u8(p[2])]
            };
            img.put_pixel(x, y, Rgb(px));
        }
    }
    img
}

fn clip_stats(img: &RgbImage) -> (f32, f32) {
    let n = (img.width() * img.height()) as f32;
    let mut hi = 0u32;
    let mut lo = 0u32;
    for p in img.pixels() {
        if p[0] >= 254 || p[1] >= 254 || p[2] >= 254 {
            hi += 1;
        }
        if p[0] <= 1 || p[1] <= 1 || p[2] <= 1 {
            lo += 1;
        }
    }
    (hi as f32 / n, lo as f32 / n)
}

fn histogram(img: &RgbImage) -> RgbImage {
    let mut bins = [0u32; 256];
    for p in img.pixels() {
        let y = ((0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32) as u8) as usize;
        bins[y] += 1;
    }
    let max = bins.iter().copied().max().unwrap_or(1).max(1);
    let mut out = RgbImage::from_pixel(W, 80, Rgb([18, 18, 20]));
    for x in 0..W {
        let i = (x as usize * 255 / (W as usize - 1)).min(255);
        let h = (bins[i] as f32 / max as f32 * 76.0) as u32;
        for y in 0..h {
            let color = if i > 250 {
                Rgb([220, 60, 60])
            } else if i < 5 {
                Rgb([70, 90, 220])
            } else {
                Rgb([210, 210, 210])
            };
            out.put_pixel(x, 79 - y, color);
        }
    }
    out
}

fn label_bar(text: &str, width: u32) -> RgbImage {
    let mut bar = RgbImage::from_pixel(width, 28, Rgb([28, 28, 32]));
    // Tiny 3x5 bitmap font for ASCII captions (avoids a font dependency).
    let glyphs: &[(char, [u8; 5])] = &[
        (' ', [0, 0, 0, 0, 0]),
        ('-', [0, 0, 0x1F, 0, 0]),
        ('+', [0x04, 0x04, 0x1F, 0x04, 0x04]),
        ('0', [0x0E, 0x11, 0x11, 0x11, 0x0E]),
        ('1', [0x04, 0x0C, 0x04, 0x04, 0x0E]),
        ('2', [0x0E, 0x11, 0x02, 0x08, 0x1F]),
        ('3', [0x1E, 0x01, 0x0E, 0x01, 0x1E]),
        ('4', [0x02, 0x06, 0x0A, 0x1F, 0x02]),
        ('5', [0x1F, 0x10, 0x1E, 0x01, 0x1E]),
        ('6', [0x0E, 0x10, 0x1E, 0x11, 0x0E]),
        ('7', [0x1F, 0x01, 0x02, 0x04, 0x04]),
        ('8', [0x0E, 0x11, 0x0E, 0x11, 0x0E]),
        ('9', [0x0E, 0x11, 0x0F, 0x01, 0x0E]),
        ('A', [0x0E, 0x11, 0x1F, 0x11, 0x11]),
        ('B', [0x1E, 0x11, 0x1E, 0x11, 0x1E]),
        ('C', [0x0E, 0x11, 0x10, 0x11, 0x0E]),
        ('D', [0x1E, 0x11, 0x11, 0x11, 0x1E]),
        ('E', [0x1F, 0x10, 0x1E, 0x10, 0x1F]),
        ('K', [0x11, 0x12, 0x1C, 0x12, 0x11]),
        ('Q', [0x0E, 0x11, 0x11, 0x13, 0x0F]),
        ('Z', [0x1F, 0x02, 0x04, 0x08, 0x1F]),
        ('(', [0x04, 0x08, 0x08, 0x08, 0x04]),
        (')', [0x08, 0x04, 0x04, 0x04, 0x08]),
        ('F', [0x1F, 0x10, 0x1E, 0x10, 0x10]),
        ('G', [0x0E, 0x10, 0x13, 0x11, 0x0E]),
        ('H', [0x11, 0x11, 0x1F, 0x11, 0x11]),
        ('I', [0x0E, 0x04, 0x04, 0x04, 0x0E]),
        ('L', [0x10, 0x10, 0x10, 0x10, 0x1F]),
        ('M', [0x11, 0x1B, 0x15, 0x11, 0x11]),
        ('N', [0x11, 0x19, 0x15, 0x13, 0x11]),
        ('O', [0x0E, 0x11, 0x11, 0x11, 0x0E]),
        ('P', [0x1E, 0x11, 0x1E, 0x10, 0x10]),
        ('R', [0x1E, 0x11, 0x1E, 0x12, 0x11]),
        ('S', [0x0F, 0x10, 0x0E, 0x01, 0x1E]),
        ('T', [0x1F, 0x04, 0x04, 0x04, 0x04]),
        ('U', [0x11, 0x11, 0x11, 0x11, 0x0E]),
        ('V', [0x11, 0x11, 0x11, 0x0A, 0x04]),
        ('W', [0x11, 0x11, 0x15, 0x1B, 0x11]),
        ('X', [0x11, 0x0A, 0x04, 0x0A, 0x11]),
        ('Y', [0x11, 0x0A, 0x04, 0x04, 0x04]),
        ('/', [0x01, 0x02, 0x04, 0x08, 0x10]),
        (':', [0x00, 0x04, 0x00, 0x04, 0x00]),
        ('=', [0x00, 0x1F, 0x00, 0x1F, 0x00]),
        ('.', [0x00, 0x00, 0x00, 0x00, 0x04]),
    ];
    let mut cx = 6i32;
    for ch in text.chars() {
        let g = glyphs
            .iter()
            .find(|(c, _)| *c == ch)
            .or_else(|| glyphs.iter().find(|(c, _)| *c == ch.to_ascii_uppercase()))
            .map(|(_, b)| *b)
            .unwrap_or([0x1F, 0x11, 0x1F, 0x11, 0x1F]);
        for (row, bits) in g.iter().enumerate() {
            for col in 0..5 {
                if bits & (1 << (4 - col)) != 0 {
                    let px = cx + col as i32;
                    let py = 8 + row as i32 * 2;
                    if px >= 0 && px < width as i32 && py < 26 {
                        bar.put_pixel(px as u32, py as u32, Rgb([235, 235, 235]));
                        if py + 1 < 28 {
                            bar.put_pixel(px as u32, (py + 1) as u32, Rgb([235, 235, 235]));
                        }
                    }
                }
            }
        }
        cx += 7;
    }
    bar
}

fn stack_vertical(parts: &[RgbImage]) -> RgbImage {
    let w = parts.iter().map(|p| p.width()).max().unwrap_or(1);
    let h = parts.iter().map(|p| p.height()).sum();
    let mut out = RgbImage::from_pixel(w, h, Rgb([12, 12, 14]));
    let mut y = 0u32;
    for p in parts {
        for (yy, row) in p.rows().enumerate() {
            for (xx, px) in row.enumerate() {
                if xx < w as usize {
                    out.put_pixel(xx as u32, y + yy as u32, *px);
                }
            }
        }
        y += p.height();
    }
    out
}

fn stack_horizontal(parts: &[RgbImage]) -> RgbImage {
    let h = parts.iter().map(|p| p.height()).max().unwrap_or(1);
    let w = parts.iter().map(|p| p.width()).sum();
    let mut out = RgbImage::from_pixel(w, h, Rgb([12, 12, 14]));
    let mut x = 0u32;
    for p in parts {
        for (yy, row) in p.rows().enumerate() {
            for (xx, px) in row.enumerate() {
                if yy < h as usize {
                    out.put_pixel(x + xx as u32, yy as u32, *px);
                }
            }
        }
        x += p.width();
    }
    out
}

fn panel(title: &str, img: RgbImage) -> RgbImage {
    let hist = histogram(&img);
    stack_vertical(&[label_bar(title, img.width()), img, hist])
}

fn zoom_crop(img: &RgbImage, cx: u32, cy: u32, size: u32, zoom: u32) -> RgbImage {
    let mut out = RgbImage::new(size * zoom, size * zoom);
    let x0 = cx.saturating_sub(size / 2);
    let y0 = cy.saturating_sub(size / 2);
    for y in 0..size {
        for x in 0..size {
            let sx = (x0 + x).min(img.width() - 1);
            let sy = (y0 + y).min(img.height() - 1);
            let p = *img.get_pixel(sx, sy);
            for dy in 0..zoom {
                for dx in 0..zoom {
                    out.put_pixel(x * zoom + dx, y * zoom + dy, p);
                }
            }
        }
    }
    out
}

fn hard_horizon(x: u32, y: u32) -> ScenePixel {
    if y < H / 2 {
        let u = x as f32 / (W - 1) as f32;
        ScenePixel {
            rgb: [1.6 + u * 0.6, 1.4 + u * 0.3, 2.0],
        }
    } else {
        ScenePixel {
            rgb: [0.04, 0.055, 0.03],
        }
    }
}

fn sheet(
    name: &str,
    scene: impl Fn(u32, u32) -> ScenePixel + Copy,
    sliders: ToneSliders,
    out_dir: &Path,
    mode: &str,
) {
    let before = render_scene(scene, sliders, PathKind::Legacy);
    let after = render_scene(scene, sliders, PathKind::New);
    let reference = render_scene(scene, sliders, PathKind::Lightcraft);
    let clip_b = clipping_map(scene, sliders, PathKind::Legacy);
    let clip_a = clipping_map(scene, sliders, PathKind::New);
    let (hi_b, lo_b) = clip_stats(&before);
    let (hi_a, lo_a) = clip_stats(&after);
    let settings = sliders.ui_label(mode);
    let row = stack_horizontal(&[
        panel("AVANT (legacy)", before),
        panel("APRES (nouveau)", after),
        panel("LIGHTCRAFT-LIKE", reference),
        panel("CLIP AVANT", clip_b),
        panel("CLIP APRES", clip_a),
    ]);
    let framed = stack_vertical(&[label_bar(&settings, row.width()), row]);
    let path = out_dir.join(format!("{name}.png"));
    framed.save(&path).expect("write sheet");
    eprintln!(
        "wrote {}  {}  clip_hi {:.1}%->{:.1}%  clip_lo {:.1}%->{:.1}%",
        path.display(),
        settings,
        hi_b * 100.0,
        hi_a * 100.0,
        lo_b * 100.0,
        lo_a * 100.0
    );
}

fn halo_sheet(name: &str, sliders: ToneSliders, out_dir: &Path) {
    let before = render_scene(hard_horizon, sliders, PathKind::Legacy);
    let after = render_scene(hard_horizon, sliders, PathKind::New);
    let cx = W / 2;
    let cy = H / 2;
    let crop_b = zoom_crop(&before, cx, cy, 48, 8);
    let crop_a = zoom_crop(&after, cx, cy, 48, 8);
    let settings = sliders.ui_label("quality");
    let row = stack_horizontal(&[
        panel("CROP AVANT", crop_b),
        panel("CROP APRES", crop_a),
        panel("AVANT", before),
        panel("APRES", after),
    ]);
    let framed = stack_vertical(&[label_bar(&settings, row.width()), row]);
    let path = out_dir.join(format!("{name}.png"));
    framed.save(&path).expect("write halo");
    eprintln!("wrote {}  {}", path.display(), settings);
}

struct SceneBuffer {
    width: u32,
    height: u32,
    pixels: Vec<[f32; 3]>,
}

impl SceneBuffer {
    fn get(&self, x: u32, y: u32) -> [f32; 3] {
        self.pixels[(y * self.width + x) as usize]
    }
}

fn load_raw_scene(path: &Path) -> Option<SceneBuffer> {
    let bytes = std::fs::read(path).ok()?;
    eprintln!("developing {} ({} bytes)", path.display(), bytes.len());
    let img = rapidraw_lib::develop_raw_image(&bytes, true, 4.0, "default".to_string(), None)
        .map_err(|e| {
            eprintln!("develop failed for {}: {e}", path.display());
            e
        })
        .ok()?;
    let rgb = img.to_rgb32f();
    let (w, h) = rgb.dimensions();
    let scale = (W as f32 / w as f32).min(H as f32 / h as f32);
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
    Some(SceneBuffer {
        width: dw,
        height: dh,
        pixels,
    })
}

fn render_raw(scene: &SceneBuffer, sliders: ToneSliders, kind: PathKind) -> RgbImage {
    let out = develop_buffer(&scene.pixels, scene.width, scene.height, sliders, kind, false);
    pixels_to_image(&out, scene.width, scene.height)
}

fn raw_clip_map(scene: &SceneBuffer, sliders: ToneSliders, kind: PathKind) -> RgbImage {
    let out = develop_buffer(&scene.pixels, scene.width, scene.height, sliders, kind, false);
    let mut img = RgbImage::new(scene.width, scene.height);
    for y in 0..scene.height {
        for x in 0..scene.width {
            let p = out[(y * scene.width + x) as usize];
            let hi = p.iter().any(|c| *c >= 0.998);
            let lo = p.iter().any(|c| *c <= 0.002);
            let px = if hi {
                [255, 0, 0]
            } else if lo {
                [0, 0, 255]
            } else {
                [to_u8(p[0]), to_u8(p[1]), to_u8(p[2])]
            };
            img.put_pixel(x, y, Rgb(px));
        }
    }
    img
}

fn raw_sheet(name: &str, scene: &SceneBuffer, sliders: ToneSliders, out_dir: &Path, mode: &str) {
    let before = render_raw(scene, sliders, PathKind::Legacy);
    let after = render_raw(scene, sliders, PathKind::New);
    let reference = render_raw(scene, sliders, PathKind::Lightcraft);
    let clip_b = raw_clip_map(scene, sliders, PathKind::Legacy);
    let clip_a = raw_clip_map(scene, sliders, PathKind::New);
    let (hi_b, lo_b) = clip_stats(&before);
    let (hi_a, lo_a) = clip_stats(&after);
    let settings = sliders.ui_label(mode);
    let row = stack_horizontal(&[
        panel("AVANT RAW", before),
        panel("APRES RAW", after),
        panel("LIGHTCRAFT-LIKE", reference),
        panel("CLIP AVANT", clip_b),
        panel("CLIP APRES", clip_a),
    ]);
    let framed = stack_vertical(&[label_bar(&settings, row.width()), row]);
    let path = out_dir.join(format!("{name}.png"));
    framed.save(&path).expect("write raw sheet");
    eprintln!(
        "wrote {}  {}  clip_hi {:.1}%->{:.1}%  clip_lo {:.1}%->{:.1}%",
        path.display(),
        settings,
        hi_b * 100.0,
        hi_a * 100.0,
        lo_b * 100.0,
        lo_a * 100.0
    );
}

fn main() {
    let mut args = env::args().skip(1);
    let out = PathBuf::from(args.next().unwrap_or_else(|| "docs/tone-recovery".into()));
    std::fs::create_dir_all(&out).expect("mkdir");
    let raws: Vec<PathBuf> = args.map(PathBuf::from).collect();

    let grid: &[(&str, ToneSliders)] = &[
        ("00_default", ToneSliders::from_ui_full(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)),
        ("h_m25", ToneSliders::from_ui_full(0.0, -25.0, 0.0, 0.0, 0.0, 0.0)),
        ("h_m50", ToneSliders::from_ui_full(0.0, -50.0, 0.0, 0.0, 0.0, 0.0)),
        ("h_m100", ToneSliders::from_ui_full(0.0, -100.0, 0.0, 0.0, 0.0, 0.0)),
        ("s_p25", ToneSliders::from_ui_full(0.0, 0.0, 25.0, 0.0, 0.0, 0.0)),
        ("s_p50", ToneSliders::from_ui_full(0.0, 0.0, 50.0, 0.0, 0.0, 0.0)),
        ("s_p100", ToneSliders::from_ui_full(0.0, 0.0, 100.0, 0.0, 0.0, 0.0)),
        ("e_m1", ToneSliders::from_ui_full(-1.0, 0.0, 0.0, 0.0, 0.0, 0.0)),
        ("e_p1", ToneSliders::from_ui_full(1.0, 0.0, 0.0, 0.0, 0.0, 0.0)),
        ("e_p2", ToneSliders::from_ui_full(2.0, 0.0, 0.0, 0.0, 0.0, 0.0)),
        ("e_p1_h_m50", ToneSliders::from_ui_full(1.0, -50.0, 0.0, 0.0, 0.0, 0.0)),
        ("e_p2_h_m100", ToneSliders::from_ui_full(2.0, -100.0, 20.0, 0.0, 0.0, 0.0)),
        ("e_m1_h_m50", ToneSliders::from_ui_full(-1.0, -50.0, 0.0, 0.0, 0.0, 0.0)),
        ("w_m40", ToneSliders::from_ui_full(0.0, 0.0, 0.0, -40.0, 0.0, 0.0)),
        ("w_p40", ToneSliders::from_ui_full(0.0, 0.0, 0.0, 40.0, 0.0, 0.0)),
        ("b_m40", ToneSliders::from_ui_full(0.0, 0.0, 0.0, 0.0, -40.0, 0.0)),
        ("b_p40", ToneSliders::from_ui_full(0.0, 0.0, 0.0, 0.0, 40.0, 0.0)),
        ("c_p30_h_m50", ToneSliders::from_ui_full(0.0, -50.0, 0.0, 0.0, 0.0, 30.0)),
        (
            "preset_ciel",
            ToneSliders::from_ui_full(0.35, -70.0, 35.0, -25.0, 10.0, 10.0),
        ),
        (
            "preset_contrejour",
            ToneSliders::from_ui_full(1.2, -100.0, 55.0, -30.0, 15.0, 15.0),
        ),
        (
            "preset_neige",
            ToneSliders::from_ui_full(0.15, -55.0, 20.0, -40.0, -10.0, 5.0),
        ),
    ];

    for (name, sliders) in grid {
        sheet(&format!("sky_{name}"), synthetic_sky, *sliders, &out, "quality");
        if *name == "00_default" || name.starts_with("h_") || name.starts_with("preset_") {
            sheet(&format!("ramp_{name}"), hdr_ramp, *sliders, &out, "quality");
        }
        if *name == "h_m100" || *name == "preset_contrejour" {
            sheet(&format!("magenta_{name}"), magenta_sky, *sliders, &out, "quality");
        }
    }
    halo_sheet("halo_h_m50", ToneSliders::from_ui(0.0, -50.0, 0.0, 0.0, 0.0), &out);
    halo_sheet("halo_h_m100", ToneSliders::from_ui(0.0, -100.0, 0.0, 0.0, 0.0), &out);
    halo_sheet("halo_s_p100", ToneSliders::from_ui(0.0, 0.0, 100.0, 0.0, 0.0), &out);

    let raw_keys = [
        "00_default",
        "h_m50",
        "h_m100",
        "s_p50",
        "e_p1_h_m50",
        "preset_ciel",
        "preset_contrejour",
        "preset_neige",
    ];

    for raw_path in &raws {
        let Some(scene) = load_raw_scene(raw_path) else {
            continue;
        };
        let stem = raw_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("raw")
            .replace(' ', "_");
        let mode = "quality";
        for (name, sliders) in grid {
            if raw_keys.contains(name) {
                raw_sheet(&format!("{stem}_{name}"), &scene, *sliders, &out, mode);
            }
        }
    }
}
