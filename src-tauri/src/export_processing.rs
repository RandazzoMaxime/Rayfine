use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, GrayImage, ImageBuffer, ImageFormat, Luma, imageops};
use jxl_encoder::{
    LosslessConfig, LossyConfig, PixelLayout,
    api::{calibrated_jxl_quality, quality_to_distance},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Emitter;
use tauri::Manager;

use crate::AppState;
use crate::exif_processing;
use crate::file_management::{
    generate_filename_from_template, parse_virtual_path, read_file_mapped,
};
use crate::formats::is_raw_file;
use crate::image_loader::{
    composite_patches_on_image, load_and_composite, load_base_image_from_bytes,
};
use crate::image_processing::{
    AllAdjustments, Crop, GpuContext, RenderRequest, downscale_f32_image,
    get_all_adjustments_from_json, get_or_init_gpu_context, process_and_get_dynamic_image,
    resolve_tonemapper_override_from_handle,
};
use crate::lut_processing::{
    convert_image_to_cube_lut, generate_identity_lut_image, get_or_load_lut,
};
use crate::mask_generation::{MaskDefinition, generate_mask_bitmap};

use crate::cache_utils::{calculate_full_job_hash, calculate_transform_hash};
use crate::{
    apply_all_transformations, generate_transformed_preview, get_cached_or_generate_mask,
    hydrate_adjustments, load_settings, resolve_warped_image_for_masks,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum ResizeMode {
    LongEdge,
    ShortEdge,
    Width,
    Height,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResizeOptions {
    pub mode: ResizeMode,
    pub value: u32,
    pub dont_enlarge: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub jpeg_quality: u8,
    pub resize: Option<ResizeOptions>,
    pub keep_metadata: bool,
    #[serde(default)]
    pub preserve_timestamps: bool,
    pub strip_gps: bool,
    pub filename_template: Option<String>,
    pub watermark: Option<WatermarkSettings>,
    #[serde(default)]
    pub export_masks: bool,
    #[serde(default)]
    pub preserve_folders: bool,
    /// Output color space tag: "srgb" | "adobe-rgb" | "display-p3" | "prophoto"
    #[serde(default)]
    pub color_space: Option<String>,
    /// Output sharpening: "none" | "screen" | "matte" | "glossy"
    #[serde(default)]
    pub output_sharpening: Option<String>,
    /// Output resolution DPI for EXIF X/YResolution (e.g. 72, 240, 300)
    #[serde(default)]
    pub resolution_dpi: Option<u32>,
    /// Soft limit in kilobytes for lossy formats (JPEG/WebP/JXL). Quality is lowered to fit.
    #[serde(default)]
    pub limit_file_size_kb: Option<u32>,
    /// 8 or 16. 16-bit only applies to PNG/TIFF; other formats stay 8-bit.
    #[serde(default)]
    pub bit_depth: Option<u8>,
}

#[derive(Clone)]
pub(crate) enum ExportAdjustmentsMode {
    UseSidecars {
        active_path: Option<String>,
        active_adjustments: Option<Value>,
    },
    GlobalOverride(Value),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkAnchor {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSettings {
    /// Image watermark path (optional if text is set)
    #[serde(default)]
    pub path: Option<String>,
    pub anchor: WatermarkAnchor,
    pub scale: f32,
    pub spacing: f32,
    pub opacity: f32,
    /// Text watermark (LR-style). Drawn when Some and non-empty.
    #[serde(default)]
    pub text: Option<String>,
    /// Text color as #RRGGBB or #RRGGBBAA (default white)
    #[serde(default)]
    pub text_color: Option<String>,
    /// "unique" (one stamp) or "multiple" (tiled grid). Default unique.
    #[serde(default)]
    pub mode: Option<String>,
}

fn apply_watermark(
    base_image: &mut DynamicImage,
    watermark_settings: &WatermarkSettings,
) -> Result<(), String> {
    let (base_w, base_h) = base_image.dimensions();
    let base_min_dim = base_w.min(base_h) as f32;
    let spacing_pixels = (base_min_dim * (watermark_settings.spacing / 100.0)) as i64;
    let opacity_factor = (watermark_settings.opacity / 100.0).clamp(0.0, 1.0);

    // Text watermark (optional)
    if let Some(text) = watermark_settings
        .text
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        apply_text_watermark(
            base_image,
            text,
            watermark_settings.anchor.clone(),
            watermark_settings.scale,
            spacing_pixels,
            opacity_factor,
            watermark_settings.text_color.as_deref(),
        )?;
    }

    // Image watermark (optional)
    let path = watermark_settings
        .path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if let Some(path) = path {
        let watermark_img =
            image::open(path).map_err(|e| format!("Failed to open watermark image: {}", e))?;

        let watermark_scale_factor =
            (base_min_dim * (watermark_settings.scale / 100.0)) / watermark_img.width().max(1) as f32;
        let new_wm_w = (watermark_img.width() as f32 * watermark_scale_factor).round() as u32;
        let new_wm_h = (watermark_img.height() as f32 * watermark_scale_factor).round() as u32;

        if new_wm_w > 0 && new_wm_h > 0 {
            let scaled_watermark =
                watermark_img.resize_exact(new_wm_w, new_wm_h, image::imageops::FilterType::Lanczos3);
            let mut scaled_watermark_rgba = scaled_watermark.to_rgba8();
            for pixel in scaled_watermark_rgba.pixels_mut() {
                pixel[3] = (pixel[3] as f32 * opacity_factor) as u8;
            }
            let final_watermark = DynamicImage::ImageRgba8(scaled_watermark_rgba);
            let (wm_w, wm_h) = final_watermark.dimensions();
            let tiled = watermark_settings
                .mode
                .as_deref()
                .map(|m| m.eq_ignore_ascii_case("multiple"))
                .unwrap_or(false);
            if tiled {
                let gap = spacing_pixels.max(0);
                let mut y = gap;
                while y + wm_h as i64 <= base_h as i64 {
                    let mut x = gap;
                    while x + wm_w as i64 <= base_w as i64 {
                        image::imageops::overlay(base_image, &final_watermark, x, y);
                        x += wm_w as i64 + gap;
                    }
                    y += wm_h as i64 + gap;
                }
            } else {
                let (x, y) = watermark_position(
                    base_w,
                    base_h,
                    wm_w,
                    wm_h,
                    spacing_pixels,
                    &watermark_settings.anchor,
                );
                image::imageops::overlay(base_image, &final_watermark, x, y);
            }
        }
    }

    Ok(())
}

fn watermark_position(
    base_w: u32,
    base_h: u32,
    wm_w: u32,
    wm_h: u32,
    spacing_pixels: i64,
    anchor: &WatermarkAnchor,
) -> (i64, i64) {
    let x = match anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::CenterLeft | WatermarkAnchor::BottomLeft => {
            spacing_pixels
        }
        WatermarkAnchor::TopCenter | WatermarkAnchor::Center | WatermarkAnchor::BottomCenter => {
            (base_w as i64 - wm_w as i64) / 2
        }
        WatermarkAnchor::TopRight | WatermarkAnchor::CenterRight | WatermarkAnchor::BottomRight => {
            base_w as i64 - wm_w as i64 - spacing_pixels
        }
    };
    let y = match anchor {
        WatermarkAnchor::TopLeft | WatermarkAnchor::TopCenter | WatermarkAnchor::TopRight => {
            spacing_pixels
        }
        WatermarkAnchor::CenterLeft | WatermarkAnchor::Center | WatermarkAnchor::CenterRight => {
            (base_h as i64 - wm_h as i64) / 2
        }
        WatermarkAnchor::BottomLeft
        | WatermarkAnchor::BottomCenter
        | WatermarkAnchor::BottomRight => base_h as i64 - wm_h as i64 - spacing_pixels,
    };
    (x, y)
}

fn parse_hex_color(s: &str) -> [u8; 4] {
    let h = s.trim().trim_start_matches('#');
    let parse2 = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    if h.len() >= 8 {
        [parse2(0), parse2(2), parse2(4), parse2(6)]
    } else if h.len() >= 6 {
        [parse2(0), parse2(2), parse2(4), 255]
    } else {
        [255, 255, 255, 255]
    }
}

fn load_system_font() -> Result<ab_glyph::FontVec, String> {
    use ab_glyph::FontVec;
    let candidates = [
        // macOS
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        // Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        // Windows
        "C:\\\\Windows\\\\Fonts\\\\arial.ttf",
        "C:\\\\Windows\\\\Fonts\\\\segoeui.ttf",
    ];
    for path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(font) = FontVec::try_from_vec(bytes) {
                return Ok(font);
            }
        }
    }
    Err("No system font found for text watermark (install Arial/DejaVu)".to_string())
}

fn apply_text_watermark(
    base_image: &mut DynamicImage,
    text: &str,
    anchor: WatermarkAnchor,
    scale_pct: f32,
    spacing_pixels: i64,
    opacity_factor: f32,
    color_hex: Option<&str>,
) -> Result<(), String> {
    use ab_glyph::PxScale;
    use image::{Rgba, RgbaImage};
    use imageproc::drawing::{draw_text_mut, text_size};

    let font = load_system_font()?;
    let (base_w, base_h) = base_image.dimensions();
    let base_min = base_w.min(base_h) as f32;
    // scale_pct 1–50 maps to roughly 1.5%–12% of min dimension as font height
    let font_px = (base_min * (scale_pct.clamp(1.0, 50.0) / 100.0) * 0.45)
        .clamp(10.0, base_min * 0.25);
    let scale = PxScale::from(font_px);

    let (tw, th) = text_size(scale, &font, text);
    if tw == 0 || th == 0 {
        return Ok(());
    }

    // Draw onto a transparent RGBA buffer with padding for shadow-ish clarity
    let pad = (font_px * 0.15).ceil() as u32;
    let canvas_w = tw + pad * 2;
    let canvas_h = th + pad * 2;
    let mut canvas = RgbaImage::from_pixel(canvas_w, canvas_h, Rgba([0, 0, 0, 0]));

    let mut rgba = parse_hex_color(color_hex.unwrap_or("#FFFFFF"));
    rgba[3] = (rgba[3] as f32 * opacity_factor).round().clamp(0.0, 255.0) as u8;

    // Soft dark outline for readability on light areas
    let outline = Rgba([0, 0, 0, (120.0 * opacity_factor) as u8]);
    for (dx, dy) in [(-1i32, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)] {
        draw_text_mut(
            &mut canvas,
            outline,
            pad as i32 + dx,
            pad as i32 + dy,
            scale,
            &font,
            text,
        );
    }
    draw_text_mut(
        &mut canvas,
        Rgba(rgba),
        pad as i32,
        pad as i32,
        scale,
        &font,
        text,
    );

    let wm = DynamicImage::ImageRgba8(canvas);
    let (wm_w, wm_h) = wm.dimensions();
    let (x, y) = watermark_position(base_w, base_h, wm_w, wm_h, spacing_pixels, &anchor);
    image::imageops::overlay(base_image, &wm, x, y);
    let _ = font; // keep font alive through draws
    Ok(())
}

fn calculate_resize_target(
    current_w: u32,
    current_h: u32,
    resize_opts: &ResizeOptions,
) -> (u32, u32) {
    if resize_opts.dont_enlarge {
        let exceeds = match resize_opts.mode {
            ResizeMode::LongEdge => current_w.max(current_h) > resize_opts.value,
            ResizeMode::ShortEdge => current_w.min(current_h) > resize_opts.value,
            ResizeMode::Width => current_w > resize_opts.value,
            ResizeMode::Height => current_h > resize_opts.value,
        };
        if !exceeds {
            return (current_w, current_h);
        }
    }

    let fix_width = match resize_opts.mode {
        ResizeMode::LongEdge => current_w >= current_h,
        ResizeMode::ShortEdge => current_w <= current_h,
        ResizeMode::Width => true,
        ResizeMode::Height => false,
    };

    let value = resize_opts.value;
    if fix_width {
        let h = (value as f32 * (current_h as f32 / current_w as f32)).round() as u32;
        (value, h)
    } else {
        let w = (value as f32 * (current_w as f32 / current_h as f32)).round() as u32;
        (w, value)
    }
}

fn relative_dir_is_safe(rel_dir: &Path) -> bool {
    rel_dir.components().all(|component| {
        matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    })
}

#[cfg(windows)]
fn component_matches(left: std::path::Component<'_>, right: std::path::Component<'_>) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(windows))]
fn component_matches(left: std::path::Component<'_>, right: std::path::Component<'_>) -> bool {
    left == right
}

fn strip_prefix_preserving_source_case(source_path: &Path, base_path: &Path) -> Option<PathBuf> {
    let source_components: Vec<_> = source_path.components().collect();
    let base_components: Vec<_> = base_path.components().collect();

    if base_components.len() > source_components.len() {
        return None;
    }

    if !source_components
        .iter()
        .zip(base_components.iter())
        .all(|(source, base)| component_matches(*source, *base))
    {
        return None;
    }

    Some(source_components[base_components.len()..].iter().collect())
}

fn relative_export_dir_for_preserved_folders(
    source_path: &Path,
    base_origin_folders: &[String],
) -> Option<PathBuf> {
    base_origin_folders
        .iter()
        .filter_map(|base| {
            let base_path = Path::new(base);
            strip_prefix_preserving_source_case(source_path, base_path)
                .map(|rel_path| (base_path.components().count(), rel_path))
        })
        .max_by_key(|(component_count, _)| *component_count)
        .and_then(|(_, rel_path)| {
            let rel_dir = rel_path.parent().unwrap_or_else(|| Path::new(""));
            if relative_dir_is_safe(rel_dir) {
                Some(rel_dir.to_path_buf())
            } else {
                None
            }
        })
}

fn apply_export_resize_and_watermark(
    mut image: DynamicImage,
    export_settings: &ExportSettings,
) -> Result<DynamicImage, String> {
    if let Some(resize_opts) = &export_settings.resize {
        let (current_w, current_h) = image.dimensions();
        let (target_w, target_h) = calculate_resize_target(current_w, current_h, resize_opts);

        if target_w != current_w || target_h != current_h {
            image = image.resize(target_w, target_h, imageops::FilterType::Lanczos3);
        }
    }

    if let Some(watermark_settings) = &export_settings.watermark {
        apply_watermark(&mut image, watermark_settings)?;
    }

    // LR-style output sharpening after resize (simple unsharp-ish detail boost)
    if let Some(mode) = export_settings.output_sharpening.as_deref() {
        let amount = match mode.to_ascii_lowercase().as_str() {
            "screen" => 0.35,
            "matte" => 0.55,
            "glossy" => 0.75,
            _ => 0.0,
        };
        if amount > 0.0 {
            apply_export_output_sharpen(&mut image, amount);
        }
    }

    // Approximate gamut conversion (working space assumed ~sRGB display). Full ICC deferred.
    if let Some(cs) = export_settings.color_space.as_deref() {
        apply_export_color_space(&mut image, cs);
    }
    Ok(image)
}

/// Approximate export color-space transform from sRGB-like working RGB.
/// Not a full ICC pipeline — matrix/tone approximations for Adobe RGB / P3 / ProPhoto / Gray.
fn apply_export_color_space(image: &mut DynamicImage, color_space: &str) {
    let cs = color_space.to_ascii_lowercase();
    if cs == "srgb" || cs.is_empty() {
        return;
    }
    let rgba = image.to_rgba8();
    let (w, h) = rgba.dimensions();
    let src = rgba.as_raw();
    let mut out = src.clone();

    // Linearize approx (gamma 2.2), apply 3x3, re-encode gamma 2.2, clamp.
    // Matrices map sRGB → target (approximate primaries; relative colorimetric intent shell).
    let matrix: [[f32; 3]; 3] = if cs.contains("adobe") {
        // sRGB → Adobe RGB (approx)
        [
            [0.715_117, 0.284_883, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.041_169, 0.958_831],
        ]
    } else if cs.contains("p3") || cs.contains("display") {
        // sRGB → Display P3 (approx)
        [
            [0.822_462, 0.177_538, 0.0],
            [0.033_194, 0.966_806, 0.0],
            [0.017_083, 0.072_397, 0.910_520],
        ]
    } else if cs.contains("prophoto") {
        // sRGB → ProPhoto-ish (very wide; soft matrix)
        [
            [0.529_317, 0.330_022, 0.140_661],
            [0.098_368, 0.873_465, 0.028_167],
            [0.016_875, 0.117_659, 0.865_466],
        ]
    } else if cs.contains("gray") || cs.contains("grey") {
        // handled below as luminance
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    } else {
        return;
    };

    let to_linear = |c: f32| -> f32 {
        let c = (c / 255.0).clamp(0.0, 1.0);
        c.powf(2.2)
    };
    let to_gamma = |c: f32| -> u8 {
        let c = c.clamp(0.0, 1.0).powf(1.0 / 2.2);
        (c * 255.0).round().clamp(0.0, 255.0) as u8
    };

    let gray = cs.contains("gray") || cs.contains("grey");
    for i in (0..src.len()).step_by(4) {
        let r = to_linear(src[i] as f32);
        let g = to_linear(src[i + 1] as f32);
        let b = to_linear(src[i + 2] as f32);
        if gray {
            // Rec.709 luminance
            let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            let y8 = to_gamma(y);
            out[i] = y8;
            out[i + 1] = y8;
            out[i + 2] = y8;
        } else {
            let nr = matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b;
            let ng = matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b;
            let nb = matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b;
            out[i] = to_gamma(nr);
            out[i + 1] = to_gamma(ng);
            out[i + 2] = to_gamma(nb);
        }
        // alpha unchanged
    }
    if let Some(buf) = image::RgbaImage::from_raw(w, h, out) {
        *image = DynamicImage::ImageRgba8(buf);
    }
}

/// Lightweight output sharpening for export (not full LR Print sharpening).
fn apply_export_output_sharpen(image: &mut DynamicImage, amount: f32) {
    let rgba = image.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w < 3 || h < 3 {
        return;
    }
    let src = rgba.as_raw();
    let mut out = src.clone();
    let amount = amount.clamp(0.0, 1.5);
    // 3x3 unsharp: center - average of neighbors
    for y in 1..(h as usize - 1) {
        for x in 1..(w as usize - 1) {
            for c in 0..3 {
                let idx = |xx: usize, yy: usize| (yy * w as usize + xx) * 4 + c;
                let center = src[idx(x, y)] as f32;
                let mut sum = 0.0f32;
                for dy in 0..3u8 {
                    for dx in 0..3u8 {
                        if dx == 1 && dy == 1 {
                            continue;
                        }
                        sum += src[idx(x + dx as usize - 1, y + dy as usize - 1)] as f32;
                    }
                }
                let blur = sum / 8.0;
                let v = (center + (center - blur) * amount).clamp(0.0, 255.0);
                out[idx(x, y)] = v as u8;
            }
        }
    }
    if let Some(buf) = image::RgbaImage::from_raw(w, h, out) {
        *image = DynamicImage::ImageRgba8(buf);
    }
}

fn ensure_export_not_cancelled(cancellation_token: &AtomicBool) -> Result<(), String> {
    if cancellation_token.load(Ordering::SeqCst) {
        Err("Export cancelled".to_string())
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportCancellationRequest {
    Requested,
    AlreadyRequested,
    NoActiveTask,
}

struct ExportTaskGuard {
    task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    cancellation_token: Arc<AtomicBool>,
    app_handle: Option<tauri::AppHandle>,
}

impl ExportTaskGuard {
    fn new(
        task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
        cancellation_token: Arc<AtomicBool>,
    ) -> Self {
        Self {
            task_token,
            cancellation_token,
            app_handle: None,
        }
    }

    fn with_app_handle(
        task_token: Arc<Mutex<Option<Arc<AtomicBool>>>>,
        cancellation_token: Arc<AtomicBool>,
        app_handle: tauri::AppHandle,
    ) -> Self {
        let mut guard = Self::new(task_token, cancellation_token);
        guard.app_handle = Some(app_handle);
        guard
    }
}

fn register_export_task(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
) -> Result<Arc<AtomicBool>, String> {
    let mut active_token = task_token.lock().unwrap();
    if active_token.is_some() {
        return Err("An export is already in progress.".to_string());
    }

    let cancellation_token = Arc::new(AtomicBool::new(false));
    *active_token = Some(Arc::clone(&cancellation_token));
    Ok(cancellation_token)
}

fn request_export_cancellation<F>(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
    on_requested: F,
) -> ExportCancellationRequest
where
    F: FnOnce(),
{
    let active_token = task_token.lock().unwrap();
    let Some(cancellation_token) = active_token.as_ref() else {
        return ExportCancellationRequest::NoActiveTask;
    };

    if cancellation_token.swap(true, Ordering::SeqCst) {
        ExportCancellationRequest::AlreadyRequested
    } else {
        on_requested();
        ExportCancellationRequest::Requested
    }
}

fn finish_export_task<F>(
    task_token: &Mutex<Option<Arc<AtomicBool>>>,
    cancellation_token: &Arc<AtomicBool>,
    on_finish: F,
) -> bool
where
    F: FnOnce(bool),
{
    let mut active_token = task_token.lock().unwrap();
    let Some(current_token) = active_token.as_ref() else {
        return false;
    };
    if !Arc::ptr_eq(current_token, cancellation_token) {
        return false;
    }

    let cancelled = cancellation_token.load(Ordering::SeqCst);
    *active_token = None;

    on_finish(cancelled);
    true
}

impl Drop for ExportTaskGuard {
    fn drop(&mut self) {
        let app_handle = self.app_handle.clone();
        let _ = finish_export_task(
            &self.task_token,
            &self.cancellation_token,
            |cancelled| match (cancelled, app_handle) {
                (true, Some(app_handle)) => {
                    let _ = app_handle.emit("export-cancelled", ());
                }
                (false, Some(app_handle)) => {
                    let _ = app_handle.emit("export-error", "Export task terminated unexpectedly");
                }
                _ => {}
            },
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn process_image_for_export_pipeline(
    path: &str,
    base_image: &DynamicImage,
    js_adjustments: &Value,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    debug_tag: &str,
    app_handle: &tauri::AppHandle,
) -> Result<DynamicImage, String> {
    let (transformed_image, unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(base_image), js_adjustments);
    let (img_w, img_h) = transformed_image.dimensions();

    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let warped_image = resolve_warped_image_for_masks(state, js_adjustments, &mask_definitions);
    let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
        .iter()
        .filter_map(|def| {
            generate_mask_bitmap(
                def,
                img_w,
                img_h,
                1.0,
                unscaled_crop_offset,
                warped_image.as_deref(),
            )
        })
        .collect();

    let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
    all_adjustments.global.show_clipping = 0;

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());

    let unique_hash = calculate_full_job_hash(path, js_adjustments);

    process_and_get_dynamic_image(
        context,
        state,
        transformed_image.as_ref(),
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &mask_bitmaps,
            lut,
            roi: None,
        },
        debug_tag,
    )
}

fn set_timestamps_from_exif(src: &Path, dst: &Path) {
    let capture_dt = exif_processing::get_creation_date_from_path(src);
    let ft = filetime::FileTime::from_unix_time(
        capture_dt.timestamp(),
        capture_dt.timestamp_subsec_nanos(),
    );
    if let Err(e) = filetime::set_file_times(dst, ft, ft) {
        log::warn!("Could not set timestamps on '{}': {}", dst.display(), e);
    }
}

fn save_image_with_metadata(
    image: &DynamicImage,
    output_path: &std::path::Path,
    source_path_str: &str,
    export_settings: &ExportSettings,
) -> Result<(), String> {
    let extension = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut image_bytes = encode_with_optional_size_limit(image, &extension, export_settings)?;

    exif_processing::write_image_with_metadata(
        &mut image_bytes,
        source_path_str,
        &extension,
        export_settings.keep_metadata,
        export_settings.strip_gps,
        export_settings.color_space.as_deref(),
        export_settings.resolution_dpi,
    )?;

    // If metadata push exceeded the limit, re-encode at lower quality once more for lossy formats.
    if let Some(limit_kb) = export_settings.limit_file_size_kb {
        let limit = (limit_kb as usize).saturating_mul(1024).max(1024);
        if image_bytes.len() > limit {
            let lossy = matches!(
                extension.as_str(),
                "jpg" | "jpeg" | "webp" | "jxl"
            );
            if lossy {
                // Binary search again targeting final size with a metadata headroom (~8–32KB)
                let headroom = 24 * 1024;
                let target = limit.saturating_sub(headroom).max(512);
                image_bytes = encode_to_size_budget(image, &extension, export_settings.jpeg_quality, target)?;
                exif_processing::write_image_with_metadata(
                    &mut image_bytes,
                    source_path_str,
                    &extension,
                    export_settings.keep_metadata,
                    export_settings.strip_gps,
                    export_settings.color_space.as_deref(),
                    export_settings.resolution_dpi,
                )?;
            }
        }
    }

    #[cfg(target_os = "android")]
    {
        let file_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Missing Android export file name".to_string())?;
        crate::android_integration::save_image_bytes_to_android_gallery(
            file_name,
            mime_type_for_extension(&extension),
            &image_bytes,
        )?;
    }

    #[cfg(not(target_os = "android"))]
    fs::write(output_path, image_bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "android")]
pub fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "tif" | "tiff" => "image/tiff",
        "jxl" => "image/jxl",
        _ => "application/octet-stream",
    }
}

#[allow(clippy::too_many_arguments)]
fn process_image_for_export(
    path: &str,
    base_image: &DynamicImage,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    context: &GpuContext,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
) -> Result<DynamicImage, String> {
    let processed_image = process_image_for_export_pipeline(
        path,
        base_image,
        js_adjustments,
        context,
        state,
        is_raw,
        "process_image_for_export",
        app_handle,
    )?;

    apply_export_resize_and_watermark(processed_image, export_settings)
}

fn build_single_mask_adjustments(all: &AllAdjustments, mask_index: usize) -> AllAdjustments {
    let mut single = AllAdjustments {
        global: all.global,
        mask_adjustments: all.mask_adjustments,
        mask_count: 1,
        tile_offset_x: all.tile_offset_x,
        tile_offset_y: all.tile_offset_y,
        mask_atlas_cols: all.mask_atlas_cols,
    };
    single.mask_adjustments[0] = all.mask_adjustments[mask_index];
    for i in 1..single.mask_adjustments.len() {
        single.mask_adjustments[i] = Default::default();
    }
    single
}

fn encode_grayscale_to_png(bitmap: &GrayImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    bitmap
        .write_to(&mut cursor, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Encode image, optionally binary-searching quality to stay under `limit_file_size_kb`.
fn encode_with_optional_size_limit(
    image: &DynamicImage,
    extension: &str,
    export_settings: &ExportSettings,
) -> Result<Vec<u8>, String> {
    let q = export_settings.jpeg_quality;
    let lossy = matches!(extension, "jpg" | "jpeg" | "webp" | "jxl");
    if let (true, Some(limit_kb)) = (lossy, export_settings.limit_file_size_kb) {
        // Leave headroom for EXIF/XMP rewrite
        let target = (limit_kb as usize)
            .saturating_mul(1024)
            .saturating_sub(24 * 1024)
            .max(512);
        encode_to_size_budget(image, extension, q, target)
    } else {
        encode_image_to_bytes(image, extension, q, export_settings.bit_depth.unwrap_or(8))
    }
}

/// Binary-search quality so encoded bytes length <= `target_bytes` (best effort).
fn encode_to_size_budget(
    image: &DynamicImage,
    extension: &str,
    preferred_quality: u8,
    target_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut lo: u8 = 1;
    let mut hi: u8 = preferred_quality.max(1).min(100);
    let mut best = encode_image_to_bytes(image, extension, hi, 8)?;
    if best.len() <= target_bytes {
        return Ok(best);
    }
    // Prefer the highest quality that still fits
    let mut best_fit: Option<Vec<u8>> = None;
    for _ in 0..8 {
        if lo > hi {
            break;
        }
        let mid = lo + (hi - lo) / 2;
        let bytes = encode_image_to_bytes(image, extension, mid, 8)?;
        if bytes.len() <= target_bytes {
            best_fit = Some(bytes);
            lo = mid.saturating_add(1);
        } else {
            best = bytes;
            if mid == 0 {
                break;
            }
            hi = mid.saturating_sub(1);
        }
    }
    if let Some(fit) = best_fit {
        Ok(fit)
    } else {
        // Could not fit; return lowest quality attempt
        encode_image_to_bytes(image, extension, 1, 8).or(Ok(best))
    }
}

fn encode_image_to_bytes(
    image: &DynamicImage,
    output_format: &str,
    jpeg_quality: u8,
    bit_depth: u8,
) -> Result<Vec<u8>, String> {
    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);

    match output_format.to_lowercase().as_str() {
        "jxl" => {
            let (width, height) = image.dimensions();
            let has_alpha = image.color().has_alpha();

            let jxl_data = if jpeg_quality == 100 {
                if has_alpha {
                    let rgba = image.to_rgba8();
                    LosslessConfig::new()
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LosslessConfig::new()
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                }
            } else {
                let jxl_quality = calibrated_jxl_quality(jpeg_quality as f32);
                let distance = quality_to_distance(jxl_quality);

                if has_alpha {
                    let rgba = image.to_rgba8();
                    LossyConfig::new(distance)
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LossyConfig::new(distance)
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                }
            };

            return Ok(jxl_data);
        }
        "webp" => {
            let encoder = webp::Encoder::from_image(image)
                .map_err(|_| "Failed to create WebP encoder".to_string())?;
            let webp_mem = encoder.encode(jpeg_quality as f32);
            return Ok(webp_mem.to_vec());
        }
        "jpg" | "jpeg" => {
            let rgb_image = image.to_rgb8();
            let encoder = JpegEncoder::new_with_quality(&mut cursor, jpeg_quality);
            rgb_image
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }
        "png" => {
            let has_alpha = image.color().has_alpha();
            let image_to_encode = if bit_depth >= 16 {
                if has_alpha {
                    DynamicImage::ImageRgba16(image.to_rgba16())
                } else {
                    DynamicImage::ImageRgb16(image.to_rgb16())
                }
            } else if has_alpha {
                DynamicImage::ImageRgba8(image.to_rgba8())
            } else {
                DynamicImage::ImageRgb8(image.to_rgb8())
            };

            image_to_encode
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        "tiff" => {
            let has_alpha = image.color().has_alpha();
            let image_to_encode = if bit_depth >= 16 {
                if has_alpha {
                    DynamicImage::ImageRgba16(image.to_rgba16())
                } else {
                    DynamicImage::ImageRgb16(image.to_rgb16())
                }
            } else if has_alpha {
                DynamicImage::ImageRgba8(image.to_rgba8())
            } else {
                DynamicImage::ImageRgb8(image.to_rgb8())
            };
            image_to_encode
                .write_to(&mut cursor, image::ImageFormat::Tiff)
                .map_err(|e| e.to_string())?;
        }
        "avif" => {
            image
                .write_to(&mut cursor, image::ImageFormat::Avif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported file format: {}", output_format)),
    };
    Ok(image_bytes)
}

#[allow(clippy::too_many_arguments)]
fn export_masks_for_image(
    base_image: &DynamicImage,
    js_adjustments: &Value,
    export_settings: &ExportSettings,
    output_path_obj: &std::path::Path,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    is_raw: bool,
    app_handle: &tauri::AppHandle,
    cancellation_token: &AtomicBool,
) -> Result<(), String> {
    ensure_export_not_cancelled(cancellation_token)?;
    let (transformed_image, unscaled_crop_offset) =
        apply_all_transformations(Cow::Borrowed(base_image), js_adjustments);
    ensure_export_not_cancelled(cancellation_token)?;
    let (img_w, img_h) = transformed_image.dimensions();
    let mask_definitions: Vec<MaskDefinition> = js_adjustments
        .get("masks")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
        .unwrap_or_default();

    let warped_image = resolve_warped_image_for_masks(state, js_adjustments, &mask_definitions);
    let mut mask_bitmaps = Vec::with_capacity(mask_definitions.len());
    for definition in &mask_definitions {
        ensure_export_not_cancelled(cancellation_token)?;
        if let Some(bitmap) = generate_mask_bitmap(
            definition,
            img_w,
            img_h,
            1.0,
            unscaled_crop_offset,
            warped_image.as_deref(),
        ) {
            mask_bitmaps.push(bitmap);
        }
        ensure_export_not_cancelled(cancellation_token)?;
    }

    if !mask_bitmaps.is_empty() {
        let tm_override = resolve_tonemapper_override_from_handle(app_handle, is_raw);
        let all_adjustments = get_all_adjustments_from_json(js_adjustments, is_raw, tm_override);
        let lut_path = js_adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
        let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);
        let output_dir = output_path_obj.parent().unwrap_or(output_path_obj);
        let stem = output_path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("export");
        let extension = output_path_obj
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("jpg");

        for (i, _) in mask_bitmaps.iter().enumerate() {
            ensure_export_not_cancelled(cancellation_token)?;
            let single_adjustments = build_single_mask_adjustments(&all_adjustments, i);
            let full_white_mask = ImageBuffer::from_fn(img_w, img_h, |_, _| Luma([255u8]));
            let single_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = vec![full_white_mask];

            let processed = process_and_get_dynamic_image(
                context,
                state,
                transformed_image.as_ref(),
                unique_hash,
                RenderRequest {
                    adjustments: single_adjustments,
                    mask_bitmaps: &single_bitmaps,
                    lut: lut.clone(),
                    roi: None,
                },
                "export_mask_image",
            )?;
            ensure_export_not_cancelled(cancellation_token)?;

            let with_options = apply_export_resize_and_watermark(processed, export_settings)?;
            let (out_w, out_h) = with_options.dimensions();

            let alpha_resized = imageops::resize(
                &mask_bitmaps[i],
                out_w,
                out_h,
                imageops::FilterType::Lanczos3,
            );
            ensure_export_not_cancelled(cancellation_token)?;

            let mask_image_path =
                output_dir.join(format!("{}_mask_{}_image.{}", stem, i, extension));
            let mask_alpha_path = output_dir.join(format!("{}_mask_{}_alpha.png", stem, i));

            save_image_with_metadata(
                &with_options,
                &mask_image_path,
                source_path_str,
                export_settings,
            )?;
            ensure_export_not_cancelled(cancellation_token)?;

            if export_settings.preserve_timestamps {
                set_timestamps_from_exif(Path::new(source_path_str), &mask_image_path);
            }

            let alpha_bytes = encode_grayscale_to_png(&alpha_resized)?;
            ensure_export_not_cancelled(cancellation_token)?;
            #[cfg(target_os = "android")]
            {
                let file_name = mask_alpha_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| "Missing Android mask export file name".to_string())?;
                crate::android_integration::save_image_bytes_to_android_gallery(
                    file_name,
                    "image/png",
                    &alpha_bytes,
                )?;
            }

            #[cfg(not(target_os = "android"))]
            fs::write(&mask_alpha_path, alpha_bytes).map_err(|e| e.to_string())?;
            ensure_export_not_cancelled(cancellation_token)?;
        }
    }
    Ok(())
}

fn export_adjustments_as_lut(
    js_adjustments: &Value,
    source_path_str: &str,
    context: &Arc<GpuContext>,
    state: &tauri::State<AppState>,
    app_handle: &tauri::AppHandle,
    cancellation_token: &AtomicBool,
) -> Result<Vec<u8>, String> {
    ensure_export_not_cancelled(cancellation_token)?;
    let lut_size = 33;
    let identity_image = generate_identity_lut_image(lut_size);

    let tm_override = resolve_tonemapper_override_from_handle(app_handle, false);
    let mut all_adjustments = get_all_adjustments_from_json(js_adjustments, false, tm_override);

    all_adjustments.global.show_clipping = 0;
    all_adjustments.global.vignette_amount = 0.0;
    all_adjustments.global.grain_amount = 0.0;
    all_adjustments.global.sharpness = 0.0;
    all_adjustments.global.clarity = 0.0;
    all_adjustments.global.dehaze = 0.0;
    all_adjustments.global.structure = 0.0;
    all_adjustments.global.centré = 0.0;
    all_adjustments.global.glow_amount = 0.0;
    all_adjustments.global.halation_amount = 0.0;
    all_adjustments.global.flare_amount = 0.0;
    all_adjustments.global.luma_noise_reduction = 0.0;
    all_adjustments.global.color_noise_reduction = 0.0;
    all_adjustments.global.chromatic_aberration_red_cyan = 0.0;
    all_adjustments.global.chromatic_aberration_blue_yellow = 0.0;

    let lut_path = js_adjustments["lutPath"].as_str();
    let lut = lut_path.and_then(|p| get_or_load_lut(state, p).ok());
    let unique_hash = calculate_full_job_hash(source_path_str, js_adjustments);

    let processed_lut = process_and_get_dynamic_image(
        context,
        state,
        &identity_image,
        unique_hash,
        RenderRequest {
            adjustments: all_adjustments,
            mask_bitmaps: &[],
            lut,
            roi: None,
        },
        "export_lut",
    )?;
    ensure_export_not_cancelled(cancellation_token)?;

    let cube_lut = convert_image_to_cube_lut(&processed_lut, lut_size)?;
    ensure_export_not_cancelled(cancellation_token)?;
    Ok(cube_lut)
}

fn export_original_copy(
    source_path: &Path,
    sidecar_path: &Path,
    output_folder_path: &Path,
    image_path_str: &str,
    global_index: usize,
    total_paths: usize,
    appearance_count: usize,
    explicit_vc: Option<u32>,
    export_settings: &ExportSettings,
    base_origin_folders: &[String],
    is_explicit_file_path: bool,
    adjustments_mode: &ExportAdjustmentsMode,
) -> Result<(), String> {
    let source_path_str = source_path.to_string_lossy().to_string();
    let js_adjustments = match adjustments_mode {
        ExportAdjustmentsMode::UseSidecars {
            active_path,
            active_adjustments,
        } => {
            if active_path.as_ref() == Some(&source_path_str) {
                active_adjustments
                    .clone()
                    .unwrap_or_else(|| crate::exif_processing::load_sidecar(sidecar_path).adjustments)
            } else {
                crate::exif_processing::load_sidecar(sidecar_path).adjustments
            }
        }
        ExportAdjustmentsMode::GlobalOverride(adj) => adj.clone(),
    };
    let _ = image_path_str;

    let file_date = exif_processing::get_creation_date_from_path(source_path);
    let filename_template = export_settings
        .filename_template
        .as_deref()
        .unwrap_or("{original_filename}");
    let mut new_stem = generate_filename_from_template(
        filename_template,
        source_path,
        global_index + 1,
        total_paths,
        &file_date,
    );
    if let Some(vc_id) = explicit_vc {
        new_stem = format!("{}_VC{:02}", new_stem, vc_id);
    } else if appearance_count > 1 {
        new_stem = format!("{}_VC{:02}", new_stem, appearance_count - 1);
    }
    let ext = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let new_filename = if ext.is_empty() {
        new_stem.clone()
    } else {
        format!("{}.{}", new_stem, ext)
    };
    let output_path = if is_explicit_file_path && total_paths == 1 {
        let mut p = output_folder_path.to_path_buf();
        if !ext.is_empty() {
            p.set_extension(ext);
        }
        p
    } else if export_settings.preserve_folders {
        if let Some(rel_dir) =
            relative_export_dir_for_preserved_folders(source_path, base_origin_folders)
        {
            let full_dir = output_folder_path.join(rel_dir);
            let _ = fs::create_dir_all(&full_dir);
            full_dir.join(&new_filename)
        } else {
            output_folder_path.join(&new_filename)
        }
    } else {
        output_folder_path.join(&new_filename)
    };
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source_path, &output_path).map_err(|e| e.to_string())?;
    let mut metadata = crate::exif_processing::load_sidecar(sidecar_path);
    metadata.adjustments = js_adjustments;
    crate::file_management::sync_metadata_to_xmp(&output_path, &metadata, true);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn export_images_impl(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    adjustments_mode: ExportAdjustmentsMode,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    completion_tx: Option<tokio::sync::oneshot::Sender<Result<(), usize>>>,
) -> Result<(), String> {
    let cancellation_token = register_export_task(&state.export_task_token)?;
    let task_guard = ExportTaskGuard::with_app_handle(
        Arc::clone(&state.export_task_token),
        Arc::clone(&cancellation_token),
        app_handle.clone(),
    );
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(());
    }

    let is_original = output_format.eq_ignore_ascii_case("original");
    let context = if is_original {
        None
    } else {
        match get_or_init_gpu_context(&state, &app_handle) {
            Ok(ctx) => Some(Arc::new(ctx)),
            Err(_) if cancellation_token.load(Ordering::SeqCst) => return Ok(()),
            Err(error) => return Err(error),
        }
    };

    if cancellation_token.load(Ordering::SeqCst) {
        return Ok(());
    }
    let progress_counter = Arc::new(AtomicUsize::new(0));

    let available_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let mut sys = sysinfo::System::new();
    sys.refresh_memory();

    let available_ram_gb = sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let ram_based_limit = (available_ram_gb / 4.0).floor() as usize;

    let num_threads = if paths.len() == 1 {
        1
    } else {
        available_cores.min(ram_based_limit).clamp(1, 4)
    };

    log::info!(
        "Batch Export: {} cores, {:.1} GB free RAM -> {} threads",
        available_cores,
        available_ram_gb,
        num_threads
    );

    let _export_task = tokio::spawn(async move {
        let _task_guard = task_guard;
        let output_folder_path = std::path::Path::new(&output_folder_or_file);
        let total_paths = paths.len();
        let settings = load_settings(app_handle.clone()).unwrap_or_default();

        let mut base_path_counts: HashMap<String, usize> = HashMap::new();
        let mut export_items = Vec::with_capacity(total_paths);

        for (i, path_str) in paths.into_iter().enumerate() {
            let (source_path, _) = parse_virtual_path(&path_str);
            let source_str = source_path.to_string_lossy().to_string();
            let count = base_path_counts.entry(source_str.clone()).or_insert(0);
            *count += 1;

            let mut explicit_vc = None;
            if let Some(idx) = path_str.rfind("vc=") {
                let id_str = path_str[idx + 3..].split('&').next().unwrap_or("");
                if let Ok(id) = id_str.parse::<u32>() {
                    explicit_vc = Some(id);
                }
            }
            if explicit_vc.is_none() {
                let lower = path_str.to_lowercase();
                if let Some(idx) = lower.rfind("_vc") {
                    let id_str: String = lower[idx + 3..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    if let Ok(id) = id_str.parse::<u32>() {
                        explicit_vc = Some(id);
                    }
                }
            }
            export_items.push((i, path_str, *count, explicit_vc));
        }

        let semaphore = Arc::new(tokio::sync::Semaphore::new(num_threads));
        let mut join_handles = Vec::new();

        for (global_index, image_path_str, appearance_count, explicit_vc) in export_items {
            if cancellation_token.load(Ordering::SeqCst) {
                break;
            }
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            if cancellation_token.load(Ordering::SeqCst) {
                drop(permit);
                break;
            }

            let app_handle_clone = app_handle.clone();
            let context_clone = context.clone();
            let progress_counter_clone = Arc::clone(&progress_counter);
            let output_folder_path = output_folder_path.to_path_buf();
            let base_origin_folders = base_origin_folders.clone();
            let export_settings = export_settings.clone();
            let output_format = output_format.clone();
            let settings = settings.clone();
            let cancellation_token_clone = Arc::clone(&cancellation_token);
            let adjustments_mode = adjustments_mode.clone();

            let handle = tokio::task::spawn_blocking(move || {
                ensure_export_not_cancelled(&cancellation_token_clone)?;

                let state = app_handle_clone.state::<AppState>();
                let (source_path, sidecar_path) = parse_virtual_path(&image_path_str);
                let source_path_str = source_path.to_string_lossy().to_string();

                if output_format.eq_ignore_ascii_case("original") {
                    let result = export_original_copy(
                        &source_path,
                        &sidecar_path,
                        &output_folder_path,
                        &image_path_str,
                        global_index,
                        total_paths,
                        appearance_count,
                        explicit_vc,
                        &export_settings,
                        &base_origin_folders,
                        is_explicit_file_path,
                        &adjustments_mode,
                    );
                    if !cancellation_token_clone.load(Ordering::SeqCst) {
                        let current_progress =
                            progress_counter_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = app_handle_clone.emit(
                            "batch-export-progress",
                            serde_json::json!({
                                "current": current_progress,
                                "total": total_paths,
                                "path": &image_path_str
                            }),
                        );
                    }
                    drop(permit);
                    return if cancellation_token_clone.load(Ordering::SeqCst) {
                        Err("Export cancelled".to_string())
                    } else {
                        result
                    };
                }

                let context_clone = context_clone
                    .as_ref()
                    .cloned()
                    .ok_or_else(|| "GPU context missing".to_string())?;

                let is_current_edit = match &adjustments_mode {
                    ExportAdjustmentsMode::UseSidecars { active_path, .. } => {
                        Some(&source_path_str) == active_path.as_ref()
                    }
                    ExportAdjustmentsMode::GlobalOverride(_) => false,
                };

                let mut js_adjustments = match &adjustments_mode {
                    ExportAdjustmentsMode::UseSidecars {
                        active_adjustments, ..
                    } => {
                        if is_current_edit {
                            if let Some(adj) = active_adjustments {
                                adj.clone()
                            } else {
                                crate::exif_processing::load_sidecar(&sidecar_path).adjustments
                            }
                        } else {
                            crate::exif_processing::load_sidecar(&sidecar_path).adjustments
                        }
                    }
                    ExportAdjustmentsMode::GlobalOverride(adj) => adj.clone(),
                };

                hydrate_adjustments(&state, &mut js_adjustments);
                let is_raw = is_raw_file(&source_path_str);
                let original_path = std::path::Path::new(&source_path_str);
                let file_date = exif_processing::get_creation_date_from_path(original_path);

                let filename_template = export_settings
                    .filename_template
                    .as_deref()
                    .unwrap_or("{original_filename}_edited");

                let mut new_stem = generate_filename_from_template(
                    filename_template,
                    original_path,
                    global_index + 1,
                    total_paths,
                    &file_date,
                );

                if let Some(vc_id) = explicit_vc {
                    new_stem = format!("{}_VC{:02}", new_stem, vc_id);
                } else if appearance_count > 1 {
                    new_stem = format!("{}_VC{:02}", new_stem, appearance_count - 1);
                }

                let new_filename = format!("{}.{}", new_stem, output_format);
                let output_path = if is_explicit_file_path && total_paths == 1 {
                    output_folder_path
                } else if export_settings.preserve_folders {
                    if let Some(rel_dir) = relative_export_dir_for_preserved_folders(
                        source_path.as_path(),
                        &base_origin_folders,
                    ) {
                        let full_dir = output_folder_path.join(rel_dir);
                        if let Err(e) = std::fs::create_dir_all(&full_dir) {
                            log::warn!("Failed to create export subdirectory: {}", e);
                        }
                        full_dir.join(&new_filename)
                    } else {
                        output_folder_path.join(&new_filename)
                    }
                } else {
                    output_folder_path.join(&new_filename)
                };

                let extension = output_format.to_lowercase();

                let result: Result<(), String> = (|| {
                    if extension == "cube" {
                        let cube_bytes = export_adjustments_as_lut(
                            &js_adjustments,
                            &source_path_str,
                            &context_clone,
                            &state,
                            &app_handle_clone,
                            &cancellation_token_clone,
                        )?;
                        ensure_export_not_cancelled(&cancellation_token_clone)?;
                        #[cfg(target_os = "android")]
                        {
                            let file_name = output_path
                                .file_name()
                                .and_then(|name| name.to_str())
                                .ok_or_else(|| "Missing Android LUT file name".to_string())?;
                            crate::android_integration::save_file_bytes_to_android_downloads(
                                file_name,
                                "application/octet-stream",
                                &cube_bytes,
                            )?;
                        }
                        #[cfg(not(target_os = "android"))]
                        fs::write(&output_path, cube_bytes).map_err(|e| e.to_string())?;
                        ensure_export_not_cancelled(&cancellation_token_clone)?;
                        return Ok(());
                    }

                    let base_image = if is_current_edit {
                        match crate::get_original_image(&state) {
                            Ok((orig_data_arc, _)) => {
                                composite_patches_on_image(&orig_data_arc, &js_adjustments)
                                    .map_err(|e| format!("Failed to composite AI patches: {}", e))?
                            }
                            Err(_) => {
                                let bytes =
                                    fs::read(&source_path_str).map_err(|e| e.to_string())?;
                                load_and_composite(
                                    &bytes,
                                    &source_path_str,
                                    &js_adjustments,
                                    false,
                                    &settings,
                                    None,
                                )
                                .map_err(|e| format!("Failed to load fallback image: {}", e))?
                            }
                        }
                    } else {
                        match read_file_mapped(Path::new(&source_path_str)) {
                            Ok(mmap) => load_and_composite(
                                &mmap,
                                &source_path_str,
                                &js_adjustments,
                                false,
                                &settings,
                                None,
                            )
                            .map_err(|e| format!("Failed to load from mmap: {}", e))?,
                            Err(_) => {
                                let bytes =
                                    fs::read(&source_path_str).map_err(|e| e.to_string())?;
                                load_and_composite(
                                    &bytes,
                                    &source_path_str,
                                    &js_adjustments,
                                    false,
                                    &settings,
                                    None,
                                )
                                .map_err(|e| format!("Failed to load from bytes: {}", e))?
                            }
                        }
                    };
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    let mut main_export_adjustments = js_adjustments.clone();
                    if export_settings.export_masks
                        && let Some(obj) = main_export_adjustments.as_object_mut()
                    {
                        obj.insert("masks".to_string(), serde_json::json!([]));
                    }

                    let final_image = process_image_for_export(
                        &source_path_str,
                        &base_image,
                        &main_export_adjustments,
                        &export_settings,
                        &context_clone,
                        &state,
                        is_raw,
                        &app_handle_clone,
                    )?;
                    ensure_export_not_cancelled(&cancellation_token_clone)?;
                    save_image_with_metadata(
                        &final_image,
                        &output_path,
                        &source_path_str,
                        &export_settings,
                    )?;
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    if export_settings.preserve_timestamps {
                        set_timestamps_from_exif(Path::new(&source_path_str), &output_path);
                    }
                    ensure_export_not_cancelled(&cancellation_token_clone)?;

                    if export_settings.export_masks {
                        export_masks_for_image(
                            &base_image,
                            &js_adjustments,
                            &export_settings,
                            &output_path,
                            &source_path_str,
                            &context_clone,
                            &state,
                            is_raw,
                            &app_handle_clone,
                            &cancellation_token_clone,
                        )?;
                    }

                    Ok(())
                })();

                if !cancellation_token_clone.load(Ordering::SeqCst) {
                    let current_progress =
                        progress_counter_clone.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = app_handle_clone.emit(
                        "batch-export-progress",
                        serde_json::json!({
                            "current": current_progress,
                            "total": total_paths,
                            "path": &image_path_str
                        }),
                    );
                }

                drop(permit);
                if cancellation_token_clone.load(Ordering::SeqCst) {
                    Err("Export cancelled".to_string())
                } else {
                    result
                }
            });

            join_handles.push(handle);
        }

        let mut results = Vec::new();
        for handle in join_handles {
            match handle.await {
                Ok(res) => results.push(res),
                Err(e) => results.push(Err(format!("Thread crashed: {}", e))),
            }
        }

        let errors: Vec<String> = results.into_iter().filter_map(Result::err).collect();
        let error_count = errors.len();
        let export_state = app_handle.state::<AppState>();
        let finalized = finish_export_task(
            &export_state.export_task_token,
            &cancellation_token,
            |cancelled| {
                if cancelled {
                    log::info!("Batch export cancelled and worker cleanup completed");
                    let _ = app_handle.emit("export-cancelled", ());
                    return;
                }

                for error in &errors {
                    log::error!("Export error: {}", error);
                    if total_paths == 1 {
                        let _ = app_handle.emit("export-error", error.clone());
                    }
                }

                if error_count > 0 && total_paths > 1 {
                    let _ = app_handle.emit(
                        "export-error",
                        format!("{error_count} of {total_paths} exports failed"),
                    );
                } else if error_count == 0 {
                    let _ = app_handle.emit(
                        "batch-export-progress",
                        serde_json::json!({ "current": total_paths, "total": total_paths, "path": "" }),
                    );
                    let _ = app_handle.emit("export-complete", ());
                }
            },
        );

        if !finalized {
            log::warn!("Ignoring terminal events from a stale export task");
        }

        if let Some(tx) = completion_tx {
            if error_count > 0 {
                let _ = tx.send(Err(error_count));
            } else {
                let _ = tx.send(Ok(()));
            }
        }
    });

    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn export_images(
    paths: Vec<String>,
    output_folder_or_file: String,
    is_explicit_file_path: bool,
    base_origin_folders: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    export_images_impl(
        paths,
        output_folder_or_file,
        is_explicit_file_path,
        base_origin_folders,
        export_settings,
        output_format,
        ExportAdjustmentsMode::UseSidecars {
            active_path: current_edit_path,
            active_adjustments: current_edit_adjustments,
        },
        state,
        app_handle,
        None,
    )
    .await
}

pub async fn run_headless_export(
    session: crate::launch_request::HeadlessExportSession,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    println!("Starting headless export...");
    let state = app_handle.state::<crate::AppState>();

    let source_path = std::path::Path::new(&session.source);
    if !source_path.exists() {
        return Err(format!("Source path does not exist: {}", session.source));
    }

    let mut paths = Vec::new();
    if source_path.is_dir() {
        let images = crate::file_management::list_images_recursive(
            session.source.clone(),
            app_handle.clone(),
        )?;
        paths = images.into_iter().map(|img| img.path).collect();
    } else {
        paths.push(session.source.clone());
    }

    if paths.is_empty() {
        return Err("No supported images found at the source path.".to_string());
    }

    let output_path = std::path::Path::new(&session.output);
    let is_explicit_file_path =
        paths.len() == 1 && output_path.extension().is_some() && !output_path.is_dir();

    if is_explicit_file_path {
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output parent directory: {}", e))?;
        }
    } else {
        std::fs::create_dir_all(&session.output)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    println!("Found {} images to export. Processing...", paths.len());

    let export_settings = ExportSettings {
        jpeg_quality: session.quality,
        resize: None,
        keep_metadata: session.keep_metadata,
        preserve_timestamps: true,
        strip_gps: false,
        filename_template: None,
        watermark: None,
        export_masks: false,
        preserve_folders: true,
        color_space: Some("srgb".to_string()),
        output_sharpening: Some("none".to_string()),
        resolution_dpi: Some(240),
        limit_file_size_kb: None,
        bit_depth: None,
    };

    let mut custom_adjustments = None;
    if let Some(adj_path) = &session.adjustments_override {
        let content = std::fs::read_to_string(adj_path)
            .map_err(|e| format!("Failed to read adjustments file: {}", e))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse adjustments JSON: {}", e))?;
        custom_adjustments = Some(json);
        println!(
            "Loaded custom adjustments to override sidecars from: {}",
            adj_path
        );
    }

    let (tx, rx) = tokio::sync::oneshot::channel();

    let mode = if let Some(adj) = custom_adjustments {
        ExportAdjustmentsMode::GlobalOverride(adj)
    } else {
        ExportAdjustmentsMode::UseSidecars {
            active_path: None,
            active_adjustments: None,
        }
    };

    export_images_impl(
        paths,
        session.output,
        is_explicit_file_path,
        vec![session.source],
        export_settings,
        session.format,
        mode,
        state.clone(),
        app_handle.clone(),
        Some(tx),
    )
    .await?;

    match rx.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(errors)) => Err(format!("Export completed with {} errors.", errors)),
        Err(_) => Err("Export task panicked or was cancelled.".to_string()),
    }
}

#[tauri::command]
pub fn cancel_export(
    state: tauri::State<AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    match request_export_cancellation(&state.export_task_token, || {
        let _ = app_handle.emit("export-cancelling", ());
    }) {
        ExportCancellationRequest::Requested => {
            log::info!("Export cancellation requested; workers will stop at the next checkpoint");
        }
        ExportCancellationRequest::AlreadyRequested => {
            log::info!("Export cancellation was already requested");
        }
        ExportCancellationRequest::NoActiveTask => {
            return Err("No export task is currently running.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn estimate_export_sizes(
    paths: Vec<String>,
    export_settings: ExportSettings,
    output_format: String,
    current_edit_path: Option<String>,
    current_edit_adjustments: Option<Value>,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    if output_format.to_lowercase() == "cube" {
        return Ok(1_050_000 * paths.len());
    }

    if paths.is_empty() {
        return Ok(0);
    }

    let first_path = &paths[0];
    let (source_path, sidecar_path) = parse_virtual_path(first_path);
    let source_path_str = source_path.to_string_lossy().to_string();

    let context = get_or_init_gpu_context(&state, &app_handle)?;
    let is_current_edit = Some(&source_path_str) == current_edit_path.as_ref();
    let is_raw = is_raw_file(&source_path_str);
    let settings = load_settings(app_handle.clone()).unwrap_or_default();

    let single_image_extrapolated_size: usize = if is_current_edit
        && current_edit_adjustments.is_some()
    {
        let loaded_image = state
            .original_image
            .lock()
            .unwrap()
            .clone()
            .ok_or("No original image loaded")?;
        let mut adjustments_clone = current_edit_adjustments.clone().unwrap();
        hydrate_adjustments(&state, &mut adjustments_clone);

        let new_transform_hash = calculate_transform_hash(&adjustments_clone);
        let cached_preview_lock = state.cached_preview.lock().unwrap();
        let preview_dim = settings.editor_preview_resolution.unwrap_or(1920);

        let (preview_image, scale, unscaled_crop_offset) = if let Some(cached) =
            &*cached_preview_lock
        {
            if cached.transform_hash == new_transform_hash && cached.preview_dim == preview_dim {
                let img = Arc::clone(&cached.image);
                let s = cached.scale;
                let offset = cached.unscaled_crop_offset;
                drop(cached_preview_lock);
                let owned_img = Arc::try_unwrap(img).unwrap_or_else(|arc| (*arc).clone());
                (owned_img, s, offset)
            } else {
                drop(cached_preview_lock);
                generate_transformed_preview(
                    &state,
                    &loaded_image,
                    &adjustments_clone,
                    preview_dim,
                )?
            }
        } else {
            drop(cached_preview_lock);
            generate_transformed_preview(&state, &loaded_image, &adjustments_clone, preview_dim)?
        };

        let (img_w, img_h) = preview_image.dimensions();
        let mask_definitions: Vec<MaskDefinition> = adjustments_clone
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();

        let scaled_crop_offset = (
            unscaled_crop_offset.0 * scale,
            unscaled_crop_offset.1 * scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    img_w,
                    img_h,
                    scale,
                    scaled_crop_offset,
                    &adjustments_clone,
                )
            })
            .collect();

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&adjustments_clone, is_raw, tm_override);
        all_adjustments.global.show_clipping = 0;

        let lut = adjustments_clone["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&loaded_image.path, &adjustments_clone).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_image,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
            },
            "estimate_export_size",
        )?;

        let preview_bytes = encode_image_to_bytes(
            &processed_preview,
            &output_format,
            export_settings.jpeg_quality,
            export_settings.bit_depth.unwrap_or(8),
        )?;
        let preview_byte_size = preview_bytes.len();

        let (transformed_full_res, _) =
            apply_all_transformations(&loaded_image.image, &adjustments_clone);
        let (full_w, full_h) = transformed_full_res.dimensions();

        let (final_full_w, final_full_h) = if let Some(resize_opts) = &export_settings.resize {
            calculate_resize_target(full_w, full_h, resize_opts)
        } else {
            (full_w, full_h)
        };

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (preview_byte_size as f64 * pixel_ratio) as usize
    } else {
        let metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        let mut js_adjustments = metadata.adjustments;

        const ESTIMATE_DIM: u32 = 1280;

        let file_slice: Vec<u8>;
        let mmap_guard;
        let file_data: &[u8] = match read_file_mapped(Path::new(&source_path_str)) {
            Ok(mmap) => {
                mmap_guard = Some(mmap);
                mmap_guard.as_ref().unwrap()
            }
            Err(_) => {
                file_slice = fs::read(&source_path_str).map_err(|io_err| io_err.to_string())?;
                &file_slice
            }
        };

        let original_image =
            load_base_image_from_bytes(file_data, &source_path_str, true, &settings, None)
                .map_err(|e| e.to_string())?;

        let raw_scale_factor = if is_raw {
            crate::raw_processing::get_fast_demosaic_scale_factor(
                file_data,
                original_image.width(),
                original_image.height(),
            )
        } else {
            1.0
        };

        if let Some(crop_val) = js_adjustments.get_mut("crop")
            && let Ok(c) = serde_json::from_value::<Crop>(crop_val.clone())
        {
            *crop_val = serde_json::to_value(Crop {
                x: c.x * raw_scale_factor as f64,
                y: c.y * raw_scale_factor as f64,
                width: c.width * raw_scale_factor as f64,
                height: c.height * raw_scale_factor as f64,
            })
            .unwrap_or(serde_json::Value::Null);
        }

        let (transformed_shrunk_res, unscaled_crop_offset) =
            apply_all_transformations(Cow::Borrowed(&original_image), &js_adjustments);
        let (shrunk_w, shrunk_h) = transformed_shrunk_res.dimensions();

        let preview_base = if shrunk_w > ESTIMATE_DIM || shrunk_h > ESTIMATE_DIM {
            downscale_f32_image(transformed_shrunk_res.as_ref(), ESTIMATE_DIM, ESTIMATE_DIM)
        } else {
            transformed_shrunk_res.into_owned()
        };

        let (preview_w, preview_h) = preview_base.dimensions();
        let gpu_scale = if shrunk_w > 0 {
            preview_w as f32 / shrunk_w as f32
        } else {
            1.0
        };
        let total_scale = gpu_scale * raw_scale_factor;

        let mask_definitions: Vec<MaskDefinition> = js_adjustments
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();
        let scaled_crop_offset = (
            unscaled_crop_offset.0 * gpu_scale,
            unscaled_crop_offset.1 * gpu_scale,
        );

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    scaled_crop_offset,
                    &js_adjustments,
                )
            })
            .collect();

        let tm_override = resolve_tonemapper_override_from_handle(&app_handle, is_raw);
        let mut all_adjustments =
            get_all_adjustments_from_json(&js_adjustments, is_raw, tm_override);
        all_adjustments.global.show_clipping = 0;

        let lut = js_adjustments["lutPath"]
            .as_str()
            .and_then(|p| get_or_load_lut(&state, p).ok());
        let unique_hash =
            calculate_full_job_hash(&source_path_str, &js_adjustments).wrapping_add(1);

        let processed_preview = process_and_get_dynamic_image(
            &context,
            &state,
            &preview_base,
            unique_hash,
            RenderRequest {
                adjustments: all_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
            },
            "estimate_batch_export_size",
        )?;

        let preview_bytes = encode_image_to_bytes(
            &processed_preview,
            &output_format,
            export_settings.jpeg_quality,
            export_settings.bit_depth.unwrap_or(8),
        )?;
        let single_image_estimated_size = preview_bytes.len();

        let full_w = (shrunk_w as f32 / raw_scale_factor).round() as u32;
        let full_h = (shrunk_h as f32 / raw_scale_factor).round() as u32;

        let (final_full_w, final_full_h) = if let Some(resize_opts) = &export_settings.resize {
            calculate_resize_target(full_w, full_h, resize_opts)
        } else {
            (full_w, full_h)
        };

        let (processed_preview_w, processed_preview_h) = processed_preview.dimensions();
        let pixel_ratio = if processed_preview_w > 0 && processed_preview_h > 0 {
            (final_full_w as f64 * final_full_h as f64)
                / (processed_preview_w as f64 * processed_preview_h as f64)
        } else {
            1.0
        };

        (single_image_estimated_size as f64 * pixel_ratio) as usize
    };

    Ok(single_image_extrapolated_size * paths.len())
}
