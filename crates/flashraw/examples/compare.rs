//! FlashRaw against LightCraft's own raw path.
//!
//! ```text
//! cargo run --release -p lightcraft-flashraw --example compare -- decode FILE...
//! cargo run --release -p lightcraft-flashraw --example compare -- demosaic OUT_DIR [FILE...]
//! ```
//!
//! `decode`: both decoders on each file: time, then every field the develop path reads, and the sample-by-sample
//! difference of the sensor data. `demosaic`: a ground truth RGB image (each Bayer raw's 2×2 superpixels, which
//! involve no interpolation, plus a synthetic zone plate) is turned back into a mosaic (Bayer RGGB, and X-Trans),
//! demosaiced by every method, and scored against the truth; a 4× zoom of the most detailed 96 px window of each
//! image goes to `OUT_DIR` as PNGs. Prints Markdown.

use lightcraft_codecs::encode::{EncodeImage, EncodeMeta, encode_png};
use lightcraft_raw::backend::{RawBackend, set_backend};
use lightcraft_raw::demosaic::mosaic_from_rgb;
use lightcraft_raw::{Cfa, Method, Normalized, RawImage, Rgb32f, decode, demosaic};
use std::time::Instant;

fn main() {
    lightcraft_flashraw::install();
    let a: Vec<String> = std::env::args().skip(1).collect();
    match a.first().map(String::as_str) {
        Some("decode") => decode_table(&a[1..]),
        Some("demosaic") if a.len() > 1 => demosaic_tables(&a[1], &a[2..]),
        Some("diff") if a.len() > 1 => diff(&a[1]),
        Some("color") => color_table(&a[1..]),
        _ => eprintln!("usage: compare decode FILE... | compare demosaic OUT_DIR [FILE...]"),
    }
}

fn best_ms<T>(runs: usize, mut f: impl FnMut() -> T) -> (f64, T) {
    let mut best = f64::MAX;
    let mut last = None;
    for _ in 0..runs {
        let t = Instant::now();
        last = Some(f());
        best = best.min(t.elapsed().as_secs_f64() * 1e3);
    }
    (best, last.expect("at least one run"))
}

// ---- decode ---------------------------------------------------------------------------------------------------

fn decode_with(b: RawBackend, bytes: &[u8]) -> (f64, Result<RawImage, String>) {
    set_backend(b).expect("backend installed");
    best_ms(2, || decode(bytes).map_err(|e| e.to_string()))
}

fn decode_table(files: &[String]) {
    println!("| file | native ms | flashraw ms | native | flashraw | geometry | levels | wb | samples differing |");
    println!("|---|---:|---:|---|---|---|---|---|---|");
    for f in files {
        let Ok(bytes) = std::fs::read(f) else { continue };
        let name = std::path::Path::new(f).file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let (tn, n) = decode_with(RawBackend::Native, &bytes);
        let (tf, x) = decode_with(RawBackend::Flashraw, &bytes);
        let status = |r: &Result<RawImage, String>| match r {
            Ok(i) => format!(
                "{:?} {}x{} {}",
                i.format,
                i.width,
                i.height,
                i.cfa.as_ref().map_or("-".into(), |c| if c.width == 2 { c.name() } else { "X-Trans".into() })
            ),
            Err(e) => format!("**{}**", e.chars().take(60).collect::<String>()),
        };
        let detail = match (&n, &x) {
            (Ok(n), Ok(x)) => same(n, x),
            _ => ["-".into(), "-".into(), "-".into(), "-".into()],
        };
        println!("| {name} | {tn:.0} | {tf:.0} | {} | {} | {} | {} | {} | {} |", status(&n), status(&x), detail[0], detail[1], detail[2], detail[3]);
    }
}

fn same(n: &RawImage, x: &RawImage) -> [String; 4] {
    let geometry = if (n.width, n.height, n.cpp, n.cfa.as_ref(), n.active_area, n.crop, n.orientation)
        == (x.width, x.height, x.cpp, x.cfa.as_ref(), x.active_area, x.crop, x.orientation)
    {
        "same".to_string()
    } else {
        format!("area {:?}/{:?} crop {:?}/{:?} orient {:?}/{:?}", n.active_area, x.active_area, n.crop, x.crop, n.orientation, x.orientation)
    };
    let levels = format!("black {:.1}/{:.1} white {:.0}/{:.0}", n.black.mean(), x.black.mean(), n.white_at(0), x.white_at(0));
    let wb = format!(
        "{:?}/{:?}",
        n.wb_multipliers.map(|w| w.map(|v| (v * 100.0).round() / 100.0)),
        x.wb_multipliers.map(|w| w.map(|v| (v * 100.0).round() / 100.0))
    );
    let samples = if n.data.len() == x.data.len() {
        let diff = (0..n.data.len()).filter(|&i| n.data.get(i) != x.data.get(i)).count();
        if diff == 0 { "0 (identical)".to_string() } else { format!("{diff} of {}", n.data.len()) }
    } else {
        "size differs".to_string()
    };
    [geometry, levels, wb, samples]
}

/// The colour transform each backend gives a file: white balance, whether the matrix is a fallback, and the matrix.
fn color_table(files: &[String]) {
    println!("| file | backend | wb (R, G, B) | fallback matrix | camera → Rec.2020 matrix |\n|---|---|---|---|---|");
    for f in files {
        let Ok(bytes) = std::fs::read(f) else { continue };
        let name = std::path::Path::new(f).file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        for b in [RawBackend::Native, RawBackend::Flashraw] {
            let Ok(raw) = decode_with(b, &bytes).1 else { continue };
            let t = lightcraft_raw::color::camera_transform(&raw, lightcraft_raw::color::as_shot_white_xy(&raw));
            let m = t.matrix.0.iter().map(|r| r.iter().map(|v| format!("{v:.3}")).collect::<Vec<_>>().join(" ")).collect::<Vec<_>>().join(" / ");
            println!("| {name} | {} | {:.2} {:.2} {:.2} | {} | {m} |", b.name(), t.wb[0], t.wb[1], t.wb[2], t.matrix_is_fallback);
        }
    }
}

/// Where and by how much the two decoders' sensor samples differ.
fn diff(file: &str) {
    let bytes = std::fs::read(file).expect("read");
    let (n, x) = (decode_with(RawBackend::Native, &bytes).1.expect("native"), decode_with(RawBackend::Flashraw, &bytes).1.expect("flashraw"));
    let (w, h) = (n.width, n.height);
    let (mut count, mut cols, mut rows) =
        (0usize, std::collections::BTreeMap::<usize, usize>::new(), std::collections::BTreeMap::<usize, usize>::new());
    let mut deltas = std::collections::BTreeMap::<i64, usize>::new();
    for i in 0..n.data.len() {
        let (a, b) = (n.data.get(i), x.data.get(i));
        if a != b {
            count += 1;
            *cols.entry((i % w) / 64 * 64).or_default() += 1;
            *rows.entry((i / w) / 64 * 64).or_default() += 1;
            *deltas.entry((b - a) as i64).or_default() += 1;
        }
    }
    // which value fits its same-colour neighbours (±2 px) better?
    let (mut fit_native, mut fit_flash, mut n_checked) = (0f64, 0f64, 0usize);
    for i in 0..n.data.len() {
        let (a, b) = (n.data.get(i), x.data.get(i));
        let (px, py) = (i % w, i / w);
        if a != b && px >= 2 && py >= 2 && px + 2 < w && py + 2 < h {
            let nb = [i - 2, i + 2, i - 2 * w, i + 2 * w].map(|j| n.data.get(j));
            let m = nb.iter().sum::<f32>() / 4.0;
            fit_native += f64::from((a - m).abs());
            fit_flash += f64::from((b - m).abs());
            n_checked += 1;
        }
    }
    println!(
        "mean |sample - same-colour neighbours| over the {n_checked} differing samples: native {:.1}, flashraw {:.1}",
        fit_native / n_checked.max(1) as f64,
        fit_flash / n_checked.max(1) as f64
    );
    println!("{count} differing of {} ({w}x{h})", n.data.len());
    let top = |m: &std::collections::BTreeMap<usize, usize>| {
        let mut v: Vec<_> = m.iter().collect();
        v.sort_by_key(|(_, c)| std::cmp::Reverse(**c));
        v.into_iter().take(8).map(|(k, c)| format!("{k}:{c}")).collect::<Vec<_>>().join(" ")
    };
    println!("columns (64-wide bins): {}", top(&cols));
    println!("rows (64-tall bins): {}", top(&rows));
    let mut d: Vec<_> = deltas.iter().collect();
    d.sort_by_key(|(_, c)| std::cmp::Reverse(**c));
    println!("flashraw - native, most common: {}", d.iter().take(10).map(|(k, c)| format!("{k:+}:{c}")).collect::<Vec<_>>().join(" "));
    println!("largest |delta|: {}", deltas.keys().map(|k| k.abs()).max().unwrap_or(0));
}

// ---- demosaic -------------------------------------------------------------------------------------------------

/// Largest square of truth pixels kept per source.
const SIDE: usize = 1536;

/// The ground truth of a Bayer raw: its 2×2 superpixels (R, mean of both greens, B), white-balanced and exposed so
/// the image is neutral and its 99.5th percentile sits at 0.92, centre-cropped to `SIDE`.
fn truth_from_raw(bytes: &[u8]) -> Option<Rgb32f> {
    set_backend(RawBackend::Native).ok()?;
    let raw = decode(bytes).ok()?;
    let n = raw.normalized().ok()?;
    let cfa = n.cfa.as_ref().filter(|c| c.is_bayer())?;
    let (w, h) = (n.width / 2, n.height / 2);
    let mut img = Rgb32f::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let (mut p, mut g) = ([0f32; 3], 0f32);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let c = cfa.color_at(2 * x + dx, 2 * y + dy) as usize;
                let v = n.data[(2 * y + dy) * n.width + 2 * x + dx].clamp(0.0, 1.0);
                if c == 1 { g += v * 0.5 } else { p[c] = v }
            }
            p[1] = g;
            img.data[y * w + x] = p;
        }
    }
    let gain = raw.wb_multipliers.unwrap_or([1.0; 3]);
    let top = gain.iter().copied().fold(1.0, f32::max);
    let mut lum: Vec<f32> = img.data.iter().map(|p| (0..3).map(|c| p[c] * gain[c] / top).sum::<f32>() / 3.0).collect();
    lum.sort_by(f32::total_cmp);
    let exposure = 0.92 / lum[(lum.len() as f32 * 0.995) as usize].max(1e-3);
    img.data.iter_mut().for_each(|p| (0..3).for_each(|c| p[c] = (p[c] * gain[c] / top * exposure).clamp(0.0, 1.0)));
    Some(center(&img, SIDE))
}

fn center(img: &Rgb32f, side: usize) -> Rgb32f {
    let (w, h) = (img.width.min(side) & !1, img.height.min(side) & !1);
    let (x0, y0) = (((img.width - w) / 2) & !1, ((img.height - h) / 2) & !1);
    img.clone().into_crop(x0, y0, w, h)
}

/// A zone plate (radial chirp, a different phase per channel): the standard stress test for false colour.
fn zone_plate(side: usize) -> Rgb32f {
    let mut img = Rgb32f::new(side, side);
    let k = std::f32::consts::PI / (side as f32 * 0.9);
    for y in 0..side {
        for x in 0..side {
            let r2 = ((x as f32 - side as f32 / 2.0).powi(2) + (y as f32 - side as f32 / 2.0).powi(2)) * k / 2.0;
            img.data[y * side + x] = [0.5 + 0.45 * r2.cos(), 0.5 + 0.45 * (r2 + 0.6).cos(), 0.5 + 0.45 * (r2 + 1.2).cos()];
        }
    }
    img
}

fn srgb(v: f32) -> f32 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.003_130_8 { 12.92 * v } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

struct Score {
    psnr: f64,
    edge_psnr: f64,
    chroma: f64,
}

/// PSNR on sRGB-encoded values (all pixels / the 10 % with the steepest truth gradient) and the mean error of the
/// colour differences R−G and B−G (false colour), ignoring an 8 px border.
fn score(truth: &Rgb32f, got: &Rgb32f) -> Score {
    const B: usize = 8;
    let (w, h) = (truth.width, truth.height);
    let grad = |x: usize, y: usize| {
        let l = |x: usize, y: usize| truth.data[y * w + x].iter().map(|&v| srgb(v)).sum::<f32>();
        (l(x + 1, y) - l(x - 1, y)).abs() + (l(x, y + 1) - l(x, y - 1)).abs()
    };
    let mut gs: Vec<f32> = (B..h - B).flat_map(|y| (B..w - B).map(move |x| (x, y))).map(|(x, y)| grad(x, y)).collect();
    gs.sort_by(f32::total_cmp);
    let edge_min = gs[gs.len() * 9 / 10];
    let (mut all, mut edge, mut chroma, mut n_all, mut n_edge) = (0f64, 0f64, 0f64, 0f64, 0f64);
    for y in B..h - B {
        for x in B..w - B {
            let (t, g) = (truth.data[y * w + x].map(srgb), got.data[y * w + x].map(srgb));
            let e: f64 = (0..3).map(|c| f64::from(t[c] - g[c]).powi(2)).sum::<f64>() / 3.0;
            all += e;
            n_all += 1.0;
            if grad(x, y) >= edge_min {
                edge += e;
                n_edge += 1.0;
            }
            chroma += f64::from(((t[0] - t[1]) - (g[0] - g[1])).abs() + ((t[2] - t[1]) - (g[2] - g[1])).abs()) / 2.0;
        }
    }
    let db = |mse: f64| 10.0 * (1.0 / mse.max(1e-12)).log10();
    Score { psnr: db(all / n_all), edge_psnr: db(edge / n_edge.max(1.0)), chroma: chroma / n_all }
}

type Variant = (&'static str, Box<dyn Fn(&Normalized) -> Rgb32f>);

fn variants(bayer: bool) -> Vec<Variant> {
    let ours = |m: Method| -> Box<dyn Fn(&Normalized) -> Rgb32f> {
        Box::new(move |n| {
            set_backend(RawBackend::Native).expect("native");
            demosaic(n, m)
        })
    };
    let flash: Box<dyn Fn(&Normalized) -> Rgb32f> = Box::new(|n| lightcraft_flashraw::demosaic(n).expect("flashraw takes this mosaic"));
    if bayer {
        vec![
            ("FlashRaw (bilinear)", flash),
            ("LightCraft bilinear", ours(Method::Bilinear)),
            ("LightCraft PPG", ours(Method::Ppg)),
            ("LightCraft AHD (default)", ours(Method::Ahd)),
        ]
    } else {
        vec![
            ("FlashRaw (X-Trans)", flash),
            ("LightCraft bilinear", ours(Method::Bilinear)),
            ("LightCraft X-Trans directional (default)", ours(Method::Ahd)),
        ]
    }
}

fn demosaic_tables(out: &str, files: &[String]) {
    std::fs::create_dir_all(out).expect("create out dir");
    let mut sources: Vec<(String, Rgb32f)> = vec![("synthetic zone plate".into(), zone_plate(1024))];
    for f in files {
        let name = std::path::Path::new(f).file_stem().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        match std::fs::read(f).ok().and_then(|b| truth_from_raw(&b)) {
            Some(t) => sources.push((name, t)),
            None => eprintln!("skipped {f}: not a Bayer raw ours decodes"),
        }
    }
    for (name, truth) in &sources {
        let window = detail_window(truth);
        save(out, name, "truth", truth, window);
        for (label, cfa) in [("Bayer RGGB", Cfa::bayer("RGGB").expect("literal pattern")), ("X-Trans 6×6", Cfa::xtrans())] {
            let mosaic = mosaic_from_rgb(truth, &cfa);
            println!("\n### {name} — {label} ({}×{}, {:.1} MP)\n", truth.width, truth.height, (truth.width * truth.height) as f64 / 1e6);
            println!("| method | PSNR dB | edge PSNR dB | false colour | ms |\n|---|---:|---:|---:|---:|");
            for (v, f) in variants(cfa.is_bayer()) {
                let (ms, img) = best_ms(3, || f(&mosaic));
                let s = score(truth, &img);
                println!("| {v} | {:.2} | {:.2} | {:.4} | {ms:.0} |", s.psnr, s.edge_psnr, s.chroma);
                let tag = format!(
                    "{}_{}",
                    if cfa.is_bayer() { "bayer" } else { "xtrans" },
                    v.split_whitespace().take(2).collect::<Vec<_>>().join("-").to_lowercase().replace(['(', ')'], "")
                );
                save(out, name, &tag, &img, window);
            }
        }
    }
}

/// Top-left corner of the 96 px window with the most gradient energy, away from the border.
fn detail_window(img: &Rgb32f) -> (usize, usize) {
    const W: usize = 96;
    let mut best = (0.0f32, (img.width / 2, img.height / 2));
    for y in (16..img.height.saturating_sub(W + 16)).step_by(16) {
        for x in (16..img.width.saturating_sub(W + 16)).step_by(16) {
            let e: f32 = (0..W)
                .step_by(2)
                .flat_map(|j| (0..W).step_by(2).map(move |i| (i, j)))
                .map(|(i, j)| {
                    let p = img.data[(y + j) * img.width + x + i];
                    let q = img.data[(y + j) * img.width + x + i + 1];
                    (p[0] + p[1] + p[2] - q[0] - q[1] - q[2]).abs()
                })
                .sum();
            // a window that is mostly clipped white or black is not a useful comparison
            let mean = img.data[(y + W / 2) * img.width + x + W / 2].iter().sum::<f32>() / 3.0;
            if e > best.0 && (0.08..0.92).contains(&mean) {
                best = (e, (x & !1, y & !1));
            }
        }
    }
    best.1
}

fn save(dir: &str, name: &str, tag: &str, img: &Rgb32f, (x, y): (usize, usize)) {
    const W: usize = 96;
    const Z: usize = 4;
    let crop = img.clone().into_crop(x, y, W, W);
    let big = Rgb32f {
        width: W * Z,
        height: W * Z,
        data: (0..W * Z).flat_map(|j| (0..W * Z).map(move |i| (i, j))).map(|(i, j)| crop.data[(j / Z) * W + i / Z]).collect(),
    };
    let rgba = big.to_srgb8();
    let png = encode_png(&EncodeImage::rgba8(&rgba), &EncodeMeta::default()).expect("png");
    let file = format!("{dir}/{}__{tag}.png", name.replace(' ', "_"));
    std::fs::write(file, png).expect("write png");
}
