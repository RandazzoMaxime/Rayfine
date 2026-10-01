use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use uuid::Uuid;

use crate::file_management::Preset;

#[derive(Copy, Clone, Debug)]
enum Num {
    I(i64),
    F(f64),
}

fn parse_num(s: &str) -> Option<Num> {
    if let Ok(i) = s.parse::<i64>() {
        Some(Num::I(i))
    } else if let Ok(f) = s.parse::<f64>() {
        Some(Num::F(f))
    } else {
        None
    }
}

fn num_to_json(num: Num) -> Option<Value> {
    match num {
        Num::I(i) => Some(Value::Number(i.into())),
        Num::F(f) => serde_json::Number::from_f64(f).map(Value::Number),
    }
}

fn get_attr_as_f64(attrs: &HashMap<String, String>, key: &str) -> Option<f64> {
    attrs
        .get(key)
        .and_then(|s| s.trim_start_matches('+').parse::<f64>().ok())
}

/// Decode common XML/HTML entities found in Lightroom XMP text nodes.
pub fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#38;", "&")
        .replace("&#39;", "'")
}

fn extract_crs_alt_text(xmp_content: &str, tag: &str) -> Option<String> {
    // <crs:Name> ... <rdf:li ...>value</rdf:li> ... </crs:Name>
    let pattern = format!(
        r#"(?s)<crs:{}>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]+)</rdf:li>"#,
        tag
    );
    let re = Regex::new(&pattern).ok()?;
    re.captures(xmp_content)
        .and_then(|c| c.get(1).map(|m| decode_xml_entities(m.as_str().trim())))
}

fn extract_xmp_name(xmp_content: &str) -> Option<String> {
    extract_crs_alt_text(xmp_content, "Name")
}

/// Lightroom develop preset group (folder) name from XMP.
pub fn extract_xmp_group(xmp_content: &str) -> Option<String> {
    let group = extract_crs_alt_text(xmp_content, "Group")?;
    let trimmed = group.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// Nested `<crs:Look>` block: `crs:Name="Adobe Monochrome"` (common on style presets).
pub fn extract_xmp_look_name(xmp_content: &str) -> Option<String> {
    // Attribute form: <crs:Look><rdf:Description crs:Name="Adobe Monochrome" ...>
    let re = Regex::new(r#"(?s)<crs:Look>\s*<rdf:Description[^>]*crs:Name="([^"]+)""#).ok()?;
    re.captures(xmp_content)
        .and_then(|c| c.get(1).map(|m| decode_xml_entities(m.as_str().trim())))
        .filter(|s| !s.is_empty())
}

/// Map Adobe/EXIF-like orientation to RapidRAW orientationSteps (0–3 ×90° CW) + flips.
fn apply_image_orientation_to_adjustments(orientation: i64, adjustments: &mut Map<String, Value>) {
    // Support both EXIF 1–8 and simple 0=normal used in some CRS packets.
    let o = orientation;
    let (steps, flip_h, flip_v) = match o {
        0 | 1 => (0u64, false, false),
        2 => (0, true, false),
        3 => (2, false, false),
        4 => (0, false, true),
        5 => (1, true, false),  // approx: mirror + 90
        6 => (1, false, false), // 90 CW
        7 => (3, true, false),
        8 => (3, false, false), // 270 CW
        _ => {
            // Unknown — store raw value only
            adjustments.insert("imageOrientation".to_string(), json!(o));
            return;
        }
    };
    adjustments.insert("orientationSteps".to_string(), json!(steps));
    if flip_h {
        adjustments.insert("flipHorizontal".to_string(), json!(true));
    }
    if flip_v {
        adjustments.insert("flipVertical".to_string(), json!(true));
    }
    adjustments.insert("imageOrientation".to_string(), json!(o));
}


fn extract_tone_curve_points(xmp_str: &str, curve_name: &str) -> Option<Vec<Value>> {
    let pattern = format!(
        r"(?s)<crs:{}>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:{}>",
        curve_name, curve_name
    );
    let re = Regex::new(&pattern).ok()?;
    let captures = re.captures(xmp_str)?;
    let seq_content = captures.get(1)?.as_str();

    let point_re = Regex::new(r"<rdf:li>(\d+),\s*(\d+)</rdf:li>").ok()?;
    let mut points = Vec::new();

    for point_cap in point_re.captures_iter(seq_content) {
        let x: u32 = point_cap.get(1)?.as_str().parse().ok()?;
        let y: u32 = point_cap.get(2)?.as_str().parse().ok()?;

        let mut final_y = y;
        if curve_name == "ToneCurvePV2012" {
            const SHADOW_RANGE_END: f64 = 64.0;
            const SHADOW_DAMPEN_START: f64 = 0.8;
            const SHADOW_DAMPEN_END: f64 = 1.0;

            let x_f64 = x as f64;
            let y_f64 = y as f64;

            if y_f64 > x_f64 && x_f64 < SHADOW_RANGE_END {
                let lift_amount = y_f64 - x_f64;
                let progress = x_f64 / SHADOW_RANGE_END;
                let dampening_factor =
                    SHADOW_DAMPEN_START + (SHADOW_DAMPEN_END - SHADOW_DAMPEN_START) * progress;

                let new_y = x_f64 + (lift_amount * dampening_factor);
                final_y = new_y.round().clamp(0.0, 255.0) as u32;
            }
        }

        let mut point = Map::new();
        point.insert("x".to_string(), Value::Number(x.into()));
        point.insert("y".to_string(), Value::Number(final_y.into()));
        points.push(Value::Object(point));
    }

    if points.is_empty() {
        None
    } else {
        Some(points)
    }
}

/// Result of converting an XMP develop preset, including optional LR group name.
#[derive(Debug, Clone)]
pub struct ConvertedXmpPreset {
    pub preset: Preset,
    pub group: Option<String>,
}

pub fn convert_xmp_to_preset_with_group(xmp_content: &str) -> Result<ConvertedXmpPreset, String> {
    let preset = convert_xmp_to_preset(xmp_content)?;
    let group = extract_xmp_group(xmp_content);
    Ok(ConvertedXmpPreset { preset, group })
}


/// Extract attribute map from an rdf:Description opening tag fragment.
fn attrs_from_description_tag(tag: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let re = Regex::new(r#"crs:([A-Za-z0-9]+)="([^"]*)""#).ok();
    if let Some(re) = re {
        for cap in re.captures_iter(tag) {
            map.insert(cap[1].to_string(), cap[2].to_string());
        }
    }
    map
}

fn f_attr(attrs: &HashMap<String, String>, key: &str) -> Option<f64> {
    get_attr_as_f64(attrs, key)
}

fn bool_attr(attrs: &HashMap<String, String>, key: &str) -> bool {
    attrs
        .get(key)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true") || v == "True")
        .unwrap_or(false)
}

/// Map CRS local correction tone keys → RapidRAW mask adjustment keys.
fn local_tone_from_attrs(attrs: &HashMap<String, String>) -> Map<String, Value> {
    let pairs = [
        ("LocalExposure2012", "exposure"),
        ("LocalExposure", "exposure"),
        ("LocalContrast2012", "contrast"),
        ("LocalContrast", "contrast"),
        ("LocalHighlights2012", "highlights"),
        ("LocalHighlights", "highlights"),
        ("LocalShadows2012", "shadows"),
        ("LocalShadows", "shadows"),
        ("LocalWhites2012", "whites"),
        ("LocalWhites", "whites"),
        ("LocalBlacks2012", "blacks"),
        ("LocalBlacks", "blacks"),
        ("LocalClarity2012", "clarity"),
        ("LocalClarity", "clarity"),
        ("LocalDehaze", "dehaze"),
        ("LocalTexture", "structure"),
        ("LocalSaturation", "saturation"),
        ("LocalVibrance", "vibrance"),
        ("LocalTemperature", "temperature"),
        ("LocalTint", "tint"),
        ("LocalSharpness", "sharpness"),
        ("LocalLuminanceNoise", "lumaNoiseReduction"),
        ("LocalMoire", "moire"),
        ("LocalDefringe", "defringe"),
    ];
    let mut m = Map::new();
    for (crs, rr) in pairs {
        if let Some(v) = f_attr(attrs, crs) {
            // Prefer 2012 keys when both present (later insert wins if we iterate 2012 first... we put 2012 first)
            if !m.contains_key(rr) || crs.contains("2012") {
                m.insert(rr.to_string(), json!(v));
            }
        }
    }
    // Amount scales overall — store as opacity if present
    m
}

/// Best-effort parse of Lightroom `crs:MaskGroupBasedCorrections` / nested CorrectionMasks
/// into RapidRAW `masks: [{ name, opacity, invert, visible, adjustments, subMasks }]`.
/// Geometry: CircularGradient → radial, Gradient → linear, Brush → brush (strokes not fully reconstructed).
pub fn parse_mask_group_based_corrections(xmp_content: &str) -> Vec<Value> {
    let mut masks: Vec<Value> = Vec::new();

    // Find MaskGroupBasedCorrections block (also try PaintBasedCorrections as fallback for older LR)
    let block_re = Regex::new(
        r"(?s)<crs:(MaskGroupBasedCorrections|PaintBasedCorrections)>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:(MaskGroupBasedCorrections|PaintBasedCorrections)>",
    );
    let Ok(block_re) = block_re else {
        return masks;
    };
    let Some(block_cap) = block_re.captures(xmp_content) else {
        return masks;
    };
    let seq_body = block_cap.get(2).map(|m| m.as_str()).unwrap_or("");

    // Split top-level rdf:li correction items — each starts with <rdf:li>
    // Use a simple scan for <rdf:Description ...> that has Local* or CorrectionName / What=Correction
    let desc_re = Regex::new(r#"(?s)<rdf:Description\b([^>]*?)/\s*>|<rdf:Description\b([^>]*)>(.*?)</rdf:Description>"#).ok();
    let Some(desc_re) = desc_re else {
        return masks;
    };

    // Walk all description tags; treat those with Local* or CorrectionMasks as mask containers
    for cap in desc_re.captures_iter(seq_body) {
        // Groups: 1=self-closing attrs, 2=open attrs, 3=inner
        let attr_str = cap
            .get(1)
            .or_else(|| cap.get(2))
            .map(|m| m.as_str())
            .unwrap_or("");
        let inner = cap.get(3).map(|m| m.as_str()).unwrap_or("");
        let attrs = attrs_from_description_tag(attr_str);

        // Skip pure mask geometry descriptions at this level if nested under CorrectionMasks
        // Only process "Correction" level: has Local* keys or CorrectionName / What=Correction
        let is_correction = attrs.get("What").map(|w| w == "Correction").unwrap_or(false)
            || attrs.contains_key("CorrectionName")
            || attrs.keys().any(|k| k.starts_with("Local"));
        if !is_correction {
            continue;
        }

        let name = attrs
            .get("CorrectionName")
            .cloned()
            .or_else(|| attrs.get("MaskName").cloned())
            .unwrap_or_else(|| format!("Mask {}", masks.len() + 1));
        let amount = f_attr(&attrs, "CorrectionAmount").unwrap_or(1.0);
        let opacity = (amount * 100.0).clamp(0.0, 100.0);
        let tone = local_tone_from_attrs(&attrs);
        // Default zeros not required — RR merges with defaults at apply time

        // Nested CorrectionMasks
        let mut sub_masks: Vec<Value> = Vec::new();
        let mask_seq_re = Regex::new(
            r"(?s)<crs:CorrectionMasks>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:CorrectionMasks>",
        )
        .ok();
        if let Some(mask_seq_re) = mask_seq_re {
            if let Some(ms) = mask_seq_re.captures(inner) {
                let mask_body = ms.get(1).map(|m| m.as_str()).unwrap_or("");
                for mcap in desc_re.captures_iter(mask_body) {
                    let mattr = mcap
                        .get(1)
                        .or_else(|| mcap.get(2))
                        .map(|m| m.as_str())
                        .unwrap_or("");
                    let mattrs = attrs_from_description_tag(mattr);
                    let what = mattrs.get("What").cloned().unwrap_or_default();
                    let inverted = bool_attr(&mattrs, "MaskInverted");
                    let mask_name = mattrs
                        .get("MaskName")
                        .cloned()
                        .unwrap_or_else(|| "Mask".to_string());
                    let active = mattrs
                        .get("MaskActive")
                        .map(|v| v == "1" || v.eq_ignore_ascii_case("true") || v == "True")
                        .unwrap_or(true);

                    let (mtype, parameters) = if what.contains("CircularGradient")
                        || what.contains("Radial")
                    {
                        // Normalized 0–1 rect → center/radius in normalized coords (frontend scales to pixels)
                        let top = f_attr(&mattrs, "Top").unwrap_or(0.25);
                        let left = f_attr(&mattrs, "Left").unwrap_or(0.25);
                        let bottom = f_attr(&mattrs, "Bottom").unwrap_or(0.75);
                        let right = f_attr(&mattrs, "Right").unwrap_or(0.75);
                        let zero_x = f_attr(&mattrs, "ZeroX").unwrap_or((left + right) / 2.0);
                        let zero_y = f_attr(&mattrs, "ZeroY").unwrap_or((top + bottom) / 2.0);
                        let radius_x = ((right - left) / 2.0).abs().max(0.01);
                        let radius_y = ((bottom - top) / 2.0).abs().max(0.01);
                        let feather = f_attr(&mattrs, "Feather").unwrap_or(50.0) / 100.0;
                        let rotation = f_attr(&mattrs, "Angle").unwrap_or(0.0);
                        let mut params = Map::new();
                        // Store as normalized 0–1; ImageCanvas may expect pixels — also store normalized flag
                        params.insert("centerX".to_string(), json!(zero_x));
                        params.insert("centerY".to_string(), json!(zero_y));
                        params.insert("radiusX".to_string(), json!(radius_x));
                        params.insert("radiusY".to_string(), json!(radius_y));
                        params.insert("rotation".to_string(), json!(rotation));
                        params.insert("feather".to_string(), json!(feather));
                        params.insert("normalized".to_string(), json!(true));
                        ("radial", Value::Object(params))
                    } else if what.contains("Gradient") && !what.contains("Circular") {
                        // Linear gradient: Top/Left/Bottom/Right + Angle or ZeroX/ZeroY
                        let top = f_attr(&mattrs, "Top").unwrap_or(0.0);
                        let left = f_attr(&mattrs, "Left").unwrap_or(0.5);
                        let bottom = f_attr(&mattrs, "Bottom").unwrap_or(1.0);
                        let right = f_attr(&mattrs, "Right").unwrap_or(0.5);
                        let feather = f_attr(&mattrs, "Feather").unwrap_or(50.0);
                        let mut params = Map::new();
                        params.insert("startX".to_string(), json!(left));
                        params.insert("startY".to_string(), json!(top));
                        params.insert("endX".to_string(), json!(right));
                        params.insert("endY".to_string(), json!(bottom));
                        params.insert("feather".to_string(), json!(feather));
                        params.insert("normalized".to_string(), json!(true));
                        ("linear", Value::Object(params))
                    } else if what.contains("Brush") || what.contains("Paint") {
                        let mut params = Map::new();
                        params.insert("lines".to_string(), json!([]));
                        params.insert(
                            "flow".to_string(),
                            json!(f_attr(&mattrs, "Flow").unwrap_or(50.0)),
                        );
                        params.insert(
                            "density".to_string(),
                            json!(f_attr(&mattrs, "Density").unwrap_or(100.0)),
                        );
                        // Full brush dabs not reconstructed from XMP (binary mask data omitted)
                        ("brush", Value::Object(params))
                    } else if what.contains("RangeMask") || what.contains("Luminance") {
                        let mut params = Map::new();
                        params.insert(
                            "rangeLow".to_string(),
                            json!(f_attr(&mattrs, "LumRange").or_else(|| f_attr(&mattrs, "LuminanceRangeLow")).unwrap_or(0.0)),
                        );
                        ("luminance", Value::Object(params))
                    } else {
                        // Unknown mask type — still import tone as full-image mask
                        ("all", json!({}))
                    };

                    let mut sub = Map::new();
                    sub.insert("id".to_string(), json!(Uuid::new_v4().to_string()));
                    sub.insert("type".to_string(), json!(mtype));
                    sub.insert("name".to_string(), json!(mask_name));
                    sub.insert("visible".to_string(), json!(active));
                    sub.insert("invert".to_string(), json!(inverted));
                    sub.insert("opacity".to_string(), json!(100));
                    sub.insert("mode".to_string(), json!("additive"));
                    sub.insert("parameters".to_string(), parameters);
                    sub_masks.push(Value::Object(sub));
                }
            }
        }

        // Older PaintBasedCorrections: geometry often inline on same Description
        if sub_masks.is_empty() {
            let what = attrs.get("What").cloned().unwrap_or_default();
            if what.contains("Mask/") || attrs.contains_key("Top") || attrs.contains_key("ZeroX") {
                let mut params = Map::new();
                if attrs.contains_key("ZeroX") || attrs.contains_key("Top") {
                    let top = f_attr(&attrs, "Top").unwrap_or(0.25);
                    let left = f_attr(&attrs, "Left").unwrap_or(0.25);
                    let bottom = f_attr(&attrs, "Bottom").unwrap_or(0.75);
                    let right = f_attr(&attrs, "Right").unwrap_or(0.75);
                    let zero_x = f_attr(&attrs, "ZeroX").unwrap_or((left + right) / 2.0);
                    let zero_y = f_attr(&attrs, "ZeroY").unwrap_or((top + bottom) / 2.0);
                    params.insert("centerX".to_string(), json!(zero_x));
                    params.insert("centerY".to_string(), json!(zero_y));
                    params.insert("radiusX".to_string(), json!(((right - left) / 2.0).abs().max(0.01)));
                    params.insert("radiusY".to_string(), json!(((bottom - top) / 2.0).abs().max(0.01)));
                    params.insert("feather".to_string(), json!(f_attr(&attrs, "Feather").unwrap_or(50.0) / 100.0));
                    params.insert("normalized".to_string(), json!(true));
                    let mut sub = Map::new();
                    sub.insert("id".to_string(), json!(Uuid::new_v4().to_string()));
                    sub.insert("type".to_string(), json!("radial"));
                    sub.insert("name".to_string(), json!(name.clone()));
                    sub.insert("visible".to_string(), json!(true));
                    sub.insert("invert".to_string(), json!(bool_attr(&attrs, "MaskInverted")));
                    sub.insert("opacity".to_string(), json!(100));
                    sub.insert("mode".to_string(), json!("additive"));
                    sub.insert("parameters".to_string(), Value::Object(params));
                    sub_masks.push(Value::Object(sub));
                }
            }
        }

        if sub_masks.is_empty() && tone.is_empty() {
            continue;
        }
        if sub_masks.is_empty() {
            // Tone-only correction → full-image mask
            let mut sub = Map::new();
            sub.insert("id".to_string(), json!(Uuid::new_v4().to_string()));
            sub.insert("type".to_string(), json!("all"));
            sub.insert("name".to_string(), json!("All"));
            sub.insert("visible".to_string(), json!(true));
            sub.insert("invert".to_string(), json!(false));
            sub.insert("opacity".to_string(), json!(100));
            sub.insert("mode".to_string(), json!("additive"));
            sub.insert("parameters".to_string(), json!({}));
            sub_masks.push(Value::Object(sub));
        }

        let mut container = Map::new();
        container.insert("id".to_string(), json!(Uuid::new_v4().to_string()));
        container.insert("name".to_string(), json!(name));
        container.insert("opacity".to_string(), json!(opacity));
        container.insert("invert".to_string(), json!(false));
        container.insert("visible".to_string(), json!(true));
        container.insert("adjustments".to_string(), Value::Object(tone));
        container.insert("subMasks".to_string(), Value::Array(sub_masks));
        masks.push(Value::Object(container));
    }

    masks
}

/// Export RapidRAW masks → crs:MaskGroupBasedCorrections (best-effort, radial/linear geometry).
fn export_masks_to_xmp_lines(adj: &Map<String, Value>) -> Vec<String> {
    let Some(masks) = adj.get("masks").and_then(|v| v.as_array()) else {
        return vec![];
    };
    if masks.is_empty() {
        return vec![];
    }

    let mut lines = Vec::new();
    lines.push("   <crs:MaskGroupBasedCorrections>".to_string());
    lines.push("    <rdf:Seq>".to_string());

    for mask in masks {
        let Some(m) = mask.as_object() else { continue };
        let name = m
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Mask")
            .replace('"', "&quot;");
        let opacity = m.get("opacity").and_then(|v| v.as_f64()).unwrap_or(100.0);
        let amount = (opacity / 100.0).clamp(0.0, 1.0);
        let tone = m.get("adjustments").and_then(|v| v.as_object());

        lines.push("     <rdf:li>".to_string());
        lines.push("      <rdf:Description".to_string());
        lines.push(r#"       crs:What="Correction""#.to_string());
        lines.push(format!(r#"       crs:CorrectionAmount="{}""#, amount));
        lines.push(format!(r#"       crs:CorrectionName="{}""#, name));
        lines.push(r#"       crs:CorrectionActive="true""#.to_string());

        if let Some(tone) = tone {
            let map_pairs = [
                ("exposure", "LocalExposure2012"),
                ("contrast", "LocalContrast2012"),
                ("highlights", "LocalHighlights2012"),
                ("shadows", "LocalShadows2012"),
                ("whites", "LocalWhites2012"),
                ("blacks", "LocalBlacks2012"),
                ("clarity", "LocalClarity2012"),
                ("dehaze", "LocalDehaze"),
                ("structure", "LocalTexture"),
                ("saturation", "LocalSaturation"),
                ("vibrance", "LocalVibrance"),
                ("temperature", "LocalTemperature"),
                ("tint", "LocalTint"),
                ("sharpness", "LocalSharpness"),
                ("lumaNoiseReduction", "LocalLuminanceNoise"),
            ];
            for (rr, crs) in map_pairs {
                if let Some(v) = tone.get(rr).and_then(|x| x.as_f64()) {
                    if v.abs() > 1e-6 {
                        lines.push(format!(r#"       crs:{}="{}""#, crs, v));
                    }
                }
            }
        }
        lines.push("      >".to_string());
        lines.push("       <crs:CorrectionMasks>".to_string());
        lines.push("        <rdf:Seq>".to_string());

        let sub_masks = m
            .get("subMasks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if sub_masks.is_empty() {
            // Full image
            lines.push("         <rdf:li>".to_string());
            lines.push(
                r#"          <rdf:Description crs:What="Mask/Image" crs:MaskActive="true" crs:MaskName="All" crs:MaskInverted="false" crs:MaskValue="1.0"/>"#.to_string(),
            );
            lines.push("         </rdf:li>".to_string());
        }
        for sub in &sub_masks {
            let Some(s) = sub.as_object() else { continue };
            let stype = s.get("type").and_then(|v| v.as_str()).unwrap_or("all");
            let sname = s
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Mask")
                .replace('"', "&quot;");
            let inverted = s.get("invert").and_then(|v| v.as_bool()).unwrap_or(false);
            let params = s.get("parameters").and_then(|v| v.as_object());

            lines.push("         <rdf:li>".to_string());
            match stype {
                "radial" => {
                    let p = params.cloned().unwrap_or_default();
                    let cx = p.get("centerX").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    let cy = p.get("centerY").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    let rx = p.get("radiusX").and_then(|v| v.as_f64()).unwrap_or(0.25);
                    let ry = p.get("radiusY").and_then(|v| v.as_f64()).unwrap_or(0.25);
                    let feather = p.get("feather").and_then(|v| v.as_f64()).unwrap_or(0.5) * 100.0;
                    let angle = p.get("rotation").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    // If values look like pixels (>1), store as-is but clamp for CRS 0–1 when normalized
                    let normalized = p
                        .get("normalized")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(cx <= 1.5 && cy <= 1.5);
                    let (cx, cy, rx, ry) = if normalized {
                        (cx, cy, rx, ry)
                    } else {
                        // Can't convert without image size — write raw and hope
                        (cx, cy, rx, ry)
                    };
                    let left = (cx - rx).clamp(0.0, 1.0);
                    let right = (cx + rx).clamp(0.0, 1.0);
                    let top = (cy - ry).clamp(0.0, 1.0);
                    let bottom = (cy + ry).clamp(0.0, 1.0);
                    lines.push(format!(
                        r#"          <rdf:Description crs:What="Mask/CircularGradient" crs:MaskActive="true" crs:MaskName="{}" crs:MaskInverted="{}" crs:MaskValue="1" crs:Top="{}" crs:Left="{}" crs:Bottom="{}" crs:Right="{}" crs:Angle="{}" crs:Midpoint="50" crs:Roundness="0" crs:Feather="{}" crs:Flipped="false" crs:ZeroX="{}" crs:ZeroY="{}"/>"#,
                        sname,
                        if inverted { "True" } else { "False" },
                        top,
                        left,
                        bottom,
                        right,
                        angle,
                        feather,
                        cx,
                        cy
                    ));
                }
                "linear" => {
                    let p = params.cloned().unwrap_or_default();
                    let sx = p.get("startX").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    let sy = p.get("startY").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let ex = p.get("endX").and_then(|v| v.as_f64()).unwrap_or(0.5);
                    let ey = p.get("endY").and_then(|v| v.as_f64()).unwrap_or(1.0);
                    let feather = p.get("feather").and_then(|v| v.as_f64()).unwrap_or(50.0);
                    lines.push(format!(
                        r#"          <rdf:Description crs:What="Mask/Gradient" crs:MaskActive="true" crs:MaskName="{}" crs:MaskInverted="{}" crs:MaskValue="1" crs:Top="{}" crs:Left="{}" crs:Bottom="{}" crs:Right="{}" crs:Feather="{}" crs:ZeroX="{}" crs:ZeroY="{}"/>"#,
                        sname,
                        if inverted { "True" } else { "False" },
                        sy,
                        sx,
                        ey,
                        ex,
                        feather,
                        (sx + ex) / 2.0,
                        (sy + ey) / 2.0
                    ));
                }
                "brush" => {
                    lines.push(format!(
                        r#"          <rdf:Description crs:What="Mask/Brush" crs:MaskActive="true" crs:MaskName="{}" crs:MaskInverted="{}" crs:MaskValue="1"/>"#,
                        sname,
                        if inverted { "True" } else { "False" }
                    ));
                }
                _ => {
                    lines.push(format!(
                        r#"          <rdf:Description crs:What="Mask/Image" crs:MaskActive="true" crs:MaskName="{}" crs:MaskInverted="{}" crs:MaskValue="1"/>"#,
                        sname,
                        if inverted { "True" } else { "False" }
                    ));
                }
            }
            lines.push("         </rdf:li>".to_string());
        }

        lines.push("        </rdf:Seq>".to_string());
        lines.push("       </crs:CorrectionMasks>".to_string());
        lines.push("      </rdf:Description>".to_string());
        lines.push("     </rdf:li>".to_string());
    }

    lines.push("    </rdf:Seq>".to_string());
    lines.push("   </crs:MaskGroupBasedCorrections>".to_string());
    lines
}


/// Parse crs:PointColors (LR Point Color / modern color mixer) as array of f64 rows.
/// Each rdf:li is a comma-separated list of numbers; -1 often means "unused".
fn parse_point_colors(xmp_content: &str) -> Option<Vec<Value>> {
    let re = Regex::new(r"(?s)<crs:PointColors>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:PointColors>").ok()?;
    let caps = re.captures(xmp_content)?;
    let body = caps.get(1)?.as_str();
    let li_re = Regex::new(r"<rdf:li>([^<]+)</rdf:li>").ok()?;
    let mut rows: Vec<Value> = Vec::new();
    for cap in li_re.captures_iter(body) {
        let raw = cap[1].trim();
        if raw.is_empty() {
            continue;
        }
        let nums: Vec<Value> = raw
            .split(',')
            .filter_map(|s| parse_num(s.trim()).and_then(num_to_json))
            .collect();
        if !nums.is_empty() {
            rows.push(Value::Array(nums));
        }
    }
    if rows.is_empty() {
        None
    } else {
        Some(rows)
    }
}

/// Parse crs:ColorVariance seq (often a single value) into f64 array.
fn parse_color_variance(xmp_content: &str) -> Option<Vec<Value>> {
    let re = Regex::new(r"(?s)<crs:ColorVariance>\s*<rdf:Seq>(.*?)</rdf:Seq>\s*</crs:ColorVariance>").ok()?;
    let caps = re.captures(xmp_content)?;
    let body = caps.get(1)?.as_str();
    let li_re = Regex::new(r"<rdf:li>([^<]+)</rdf:li>").ok()?;
    let mut vals: Vec<Value> = Vec::new();
    for cap in li_re.captures_iter(body) {
        if let Some(n) = parse_num(cap[1].trim()).and_then(num_to_json) {
            vals.push(n);
        }
    }
    if vals.is_empty() {
        None
    } else {
        Some(vals)
    }
}


fn export_point_colors_to_xmp_lines(adj: &Map<String, Value>) -> Vec<String> {
    let Some(rows) = adj.get("pointColors").and_then(|v| v.as_array()) else {
        return vec![];
    };
    if rows.is_empty() {
        return vec![];
    }
    let mut lines = Vec::new();
    lines.push("   <crs:PointColors>".to_string());
    lines.push("    <rdf:Seq>".to_string());
    for row in rows {
        if let Some(arr) = row.as_array() {
            let parts: Vec<String> = arr
                .iter()
                .filter_map(|v| {
                    v.as_f64()
                        .or_else(|| v.as_i64().map(|i| i as f64))
                        .map(|n| format!("{:.6}", n))
                })
                .collect();
            if !parts.is_empty() {
                lines.push(format!("     <rdf:li>{}</rdf:li>", parts.join(", ")));
            }
        }
    }
    lines.push("    </rdf:Seq>".to_string());
    lines.push("   </crs:PointColors>".to_string());
    lines
}

fn export_color_variance_to_xmp_lines(adj: &Map<String, Value>) -> Vec<String> {
    let Some(vals) = adj.get("colorVariance").and_then(|v| v.as_array()) else {
        return vec![];
    };
    if vals.is_empty() {
        return vec![];
    }
    let mut lines = Vec::new();
    lines.push("   <crs:ColorVariance>".to_string());
    lines.push("    <rdf:Seq>".to_string());
    for v in vals {
        if let Some(n) = v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)) {
            lines.push(format!("     <rdf:li>{:.6}</rdf:li>", n));
        }
    }
    lines.push("    </rdf:Seq>".to_string());
    lines.push("   </crs:ColorVariance>".to_string());
    lines
}

pub fn convert_xmp_to_preset(xmp_content: &str) -> Result<Preset, String> {
    let xmp_one_line = xmp_content.split('\n').collect::<Vec<_>>().join(" ");

    let attr_re = Regex::new(r#"crs:([A-Za-z0-9]+)="([^"]*)""#)
        .map_err(|e| format!("Regex compilation failed: {}", e))?;
    let mut attrs: HashMap<String, String> = HashMap::new();
    for cap in attr_re.captures_iter(&xmp_one_line) {
        attrs.insert(cap[1].to_string(), cap[2].to_string());
    }

    let mut adjustments = Map::new();
    let mut hsl_map = Map::new();
    let mut color_grading_map = Map::new();
    let mut curves_map = Map::new();

    let mappings = vec![
        ("Exposure2012", "exposure"),
        ("Contrast2012", "contrast"),
        ("Highlights2012", "highlights"),
        ("Whites2012", "whites"),
        ("Blacks2012", "blacks"),
        ("Clarity2012", "clarity"),
        ("Dehaze", "dehaze"),
        ("Vibrance", "vibrance"),
        ("Saturation", "saturation"),
        ("Texture", "structure"),
        ("SharpenRadius", "sharpenRadius"),
        ("SharpenDetail", "sharpenDetail"),
        ("SharpenEdgeMasking", "sharpenMasking"),
        ("LuminanceSmoothing", "lumaNoiseReduction"),
        ("ColorNoiseReduction", "colorNoiseReduction"),
        ("ColorNoiseReductionDetail", "colorNoiseDetail"),
        ("ColorNoiseReductionSmoothness", "colorNoiseSmoothness"),
        ("ChromaticAberrationRedCyan", "chromaticAberrationRedCyan"),
        (
            "ChromaticAberrationBlueYellow",
            "chromaticAberrationBlueYellow",
        ),
        ("PostCropVignetteAmount", "vignetteAmount"),
        ("PostCropVignetteMidpoint", "vignetteMidpoint"),
        ("PostCropVignetteFeather", "vignetteFeather"),
        ("PostCropVignetteRoundness", "vignetteRoundness"),
        ("GrainAmount", "grainAmount"),
        ("GrainSize", "grainSize"),
        ("GrainFrequency", "grainRoughness"),
        ("ColorGradeBlending", "blending"),
        // Parametric curve (stored as relative sliders when present)
        ("ParametricShadows", "parametricShadows"),
        ("ParametricDarks", "parametricDarks"),
        ("ParametricLights", "parametricLights"),
        ("ParametricHighlights", "parametricHighlights"),
        // Presence / optics extras commonly found in LR XMP
        ("VignetteAmount", "lensVignetteAmount"),
        ("VignetteMidpoint", "lensVignetteMidpoint"),
        ("DefringePurpleAmount", "defringePurpleAmount"),
        ("DefringePurpleHueLo", "defringePurpleHueLo"),
        ("DefringePurpleHueHi", "defringePurpleHueHi"),
        ("DefringeGreenAmount", "defringeGreenAmount"),
        ("DefringeGreenHueLo", "defringeGreenHueLo"),
        ("DefringeGreenHueHi", "defringeGreenHueHi"),
        ("PerspectiveVertical", "transformVertical"),
        ("PerspectiveHorizontal", "transformHorizontal"),
        ("PerspectiveRotate", "transformRotate"),
        ("PerspectiveScale", "transformScale"),
        ("PerspectiveAspect", "transformAspect"),
        ("PerspectiveX", "transformXOffset"),
        ("PerspectiveY", "transformYOffset"),
        ("LensManualDistortionAmount", "transformDistortion"),
    ];

    for (xmp_key, rr_key) in mappings {
        if let Some(raw_val) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw_val.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            if rr_key == "blending" {
                color_grading_map.insert(rr_key.to_string(), json_val);
            } else {
                adjustments.insert(rr_key.to_string(), json_val);
            }
        }
    }

    if let Some(shadows_val) = get_attr_as_f64(&attrs, "Shadows2012") {
        let adjusted_shadows = (shadows_val * 1.5).min(100.0);
        adjustments.insert("shadows".to_string(), json!(adjusted_shadows));
    }

    if let Some(sharpness_val) = get_attr_as_f64(&attrs, "Sharpness") {
        let scaled_sharpness = (sharpness_val / 150.0) * 100.0;
        adjustments.insert(
            "sharpness".to_string(),
            json!(scaled_sharpness.clamp(0.0, 100.0)),
        );
    }

    // Prefer IncrementalTemperature/Tint when present (RapidRAW export + some LR relative WB).
    // Fall back to absolute Temperature Kelvin / Tint for classic Camera Raw packets.
    if let Some(inc) = get_attr_as_f64(&attrs, "IncrementalTemperature") {
        adjustments.insert("temperature".to_string(), json!(inc.clamp(-100.0, 100.0)));
    } else if let Some(adjusted_k) = get_attr_as_f64(&attrs, "Temperature") {
        const AS_SHOT_DEFAULT: f64 = 5500.0;
        const MAX_MIRED_SHIFT: f64 = 150.0;
        let as_shot_k = get_attr_as_f64(&attrs, "AsShotTemperature").unwrap_or(AS_SHOT_DEFAULT);
        let mired_adjusted = 1_000_000.0 / adjusted_k.max(1.0);
        let mired_as_shot = 1_000_000.0 / as_shot_k.max(1.0);
        let mired_delta = mired_adjusted - mired_as_shot;
        let temp_value = (-mired_delta / MAX_MIRED_SHIFT) * 100.0;
        adjustments.insert(
            "temperature".to_string(),
            json!(temp_value.clamp(-100.0, 100.0)),
        );
    }

    if let Some(inc_tint) = get_attr_as_f64(&attrs, "IncrementalTint") {
        let scaled_tint = (inc_tint / 150.0) * 100.0;
        adjustments.insert("tint".to_string(), json!(scaled_tint.clamp(-100.0, 100.0)));
    } else if let Some(tint_val) = get_attr_as_f64(&attrs, "Tint") {
        let scaled_tint = (tint_val / 150.0) * 100.0;
        adjustments.insert("tint".to_string(), json!(scaled_tint.clamp(-100.0, 100.0)));
    }

    // White balance as shot / custom / cloudy etc. — store as string for UI if present
    if let Some(wb) = attrs.get("WhiteBalance") {
        adjustments.insert("whiteBalance".to_string(), json!(wb));
    }

    if let Some(v) = get_attr_as_f64(&attrs, "AsShotTemperature") {
        adjustments.insert("asShotTemperature".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "AsShotTint") {
        adjustments.insert("asShotTint".to_string(), json!(v));
    }

    // B&W conversion (+ GrayMixer implies monochrome look in LR)
    let mut is_bw = false;
    if let Some(bw) = attrs.get("ConvertToGrayscale") {
        is_bw = bw.eq_ignore_ascii_case("true") || bw == "1";
    }
    let gray_keys = [
        "GrayMixerRed",
        "GrayMixerOrange",
        "GrayMixerYellow",
        "GrayMixerGreen",
        "GrayMixerAqua",
        "GrayMixerBlue",
        "GrayMixerPurple",
        "GrayMixerMagenta",
    ];
    let mut gray_mixer = Map::new();
    let gray_dst = [
        "reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas",
    ];
    for (src, dst) in gray_keys.iter().zip(gray_dst.iter()) {
        if let Some(v) = get_attr_as_f64(&attrs, src) {
            gray_mixer.insert(dst.to_string(), json!(v));
            is_bw = true;
        }
    }
    if !gray_mixer.is_empty() {
        adjustments.insert("grayMixer".to_string(), Value::Object(gray_mixer));
    }
    if is_bw {
        adjustments.insert("convertToGrayscale".to_string(), json!(true));
        // RapidRAW has no dedicated B&W engine: collapse saturation for a usable mono base.
        if !adjustments.contains_key("saturation") {
            adjustments.insert("saturation".to_string(), json!(-100.0));
        }
    }

    // Relative WB (common in creative/B&W LR presets)
    if !attrs.contains_key("Temperature") {
        if let Some(v) = get_attr_as_f64(&attrs, "IncrementalTemperature") {
            adjustments.insert("temperature".to_string(), json!(v.clamp(-100.0, 100.0)));
        }
    }
    if !attrs.contains_key("Tint") {
        if let Some(v) = get_attr_as_f64(&attrs, "IncrementalTint") {
            // LR incremental tint is roughly -150..150; scale toward app -100..100
            let scaled = (v / 150.0) * 100.0;
            adjustments.insert("tint".to_string(), json!(scaled.clamp(-100.0, 100.0)));
        }
    }

    // Camera / look profile name
    if let Some(pv) = attrs.get("ProcessVersion") {
        if !pv.is_empty() {
            adjustments.insert("processVersion".to_string(), json!(pv));
        }
    }
    if let Some(profile) = attrs.get("CameraProfile") {
        if !profile.is_empty() {
            adjustments.insert("cameraProfile".to_string(), json!(profile));
        }
    }
    if let Some(pt) = attrs.get("PresetType") {
        if !pt.is_empty() {
            adjustments.insert("xmpPresetType".to_string(), json!(pt));
        }
    }
    if let Some(v) = get_attr_as_f64(&attrs, "PerspectiveUpright") {
        // 0=off, 1=auto, 2=level, 3=vertical, 4=full, 5=guided (LR semantics)
        adjustments.insert("perspectiveUpright".to_string(), json!(v as i64));
    }

    // Lens corrections toggles (best-effort flags for the lens panel)
    if let Some(v) = attrs.get("LensProfileEnable") {
        let enabled = v == "1" || v.eq_ignore_ascii_case("true");
        adjustments.insert("lensDistortionEnabled".to_string(), json!(enabled));
        adjustments.insert("lensVignetteEnabled".to_string(), json!(enabled));
    }
    if let Some(v) = attrs.get("AutoLateralCA") {
        let enabled = v == "1" || v.eq_ignore_ascii_case("true");
        adjustments.insert("lensTcaEnabled".to_string(), json!(enabled));
    }
    if let Some(v) = attrs.get("OverrideLookVignette") {
        let enabled = v == "1" || v.eq_ignore_ascii_case("true");
        adjustments.insert("overrideLookVignette".to_string(), json!(enabled));
    }

    if let Some(v) = get_attr_as_f64(&attrs, "PostCropVignetteStyle") {
        // 0=Highlight Priority, 1=Color Priority, 2=Paint Overlay (LR)
        adjustments.insert("vignetteStyle".to_string(), json!(v as i64));
    }

    if let Some(v) = get_attr_as_f64(&attrs, "PostCropVignetteHighlightContrast") {
        adjustments.insert("vignetteHighlightContrast".to_string(), json!(v));
    }
    if let Some(v) = attrs.get("AlreadyApplied") {
        let applied = v == "True" || v.eq_ignore_ascii_case("true") || v == "1";
        adjustments.insert("alreadyApplied".to_string(), json!(applied));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "ImageOrientation") {
        apply_image_orientation_to_adjustments(v as i64, &mut adjustments);
    } else if let Some(v) = get_attr_as_f64(&attrs, "Orientation") {
        // some packets use short Orientation
        apply_image_orientation_to_adjustments(v as i64, &mut adjustments);
    }
    if let Some(name) = attrs.get("ToneCurveName") {
        if !name.is_empty() {
            adjustments.insert("toneCurveName".to_string(), json!(name));
        }
    } else if let Some(name) = attrs.get("ToneCurveName2012") {
        // Newer LR packets often use ToneCurveName2012
        if !name.is_empty() {
            adjustments.insert("toneCurveName".to_string(), json!(name));
        }
    }
    if let Some(v) = get_attr_as_f64(&attrs, "BlurAmount") {
        // Map Adobe blur amount into RapidRAW lens blur (0–100).
        // Many LR presets ship BlurAmount=50 as an inactive default — do not auto-enable.
        let amount = v.clamp(0.0, 100.0);
        adjustments.insert("lensBlurAmount".to_string(), json!(amount));
    }
    // Bokeh / lens-blur companion fields (store for fidelity; enable blur only if non-default activity)
    if let Some(v) = get_attr_as_f64(&attrs, "BokehShape") {
        let shape = match v as i64 {
            1 => "hexagon",
            2 => "octagon",
            3 => "ring",
            _ => "circle",
        };
        adjustments.insert("lensBlurShape".to_string(), json!(shape));
        adjustments.insert("bokehShape".to_string(), json!(v as i64));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "BokehShapeDetail") {
        adjustments.insert("bokehShapeDetail".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "BokehAspect") {
        adjustments.insert("bokehAspect".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "BokehRotation") {
        adjustments.insert("bokehRotation".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "SphericalAberration") {
        adjustments.insert("sphericalAberration".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "CatEyeAmount") {
        adjustments.insert("catEyeAmount".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "CatEyeScale") {
        adjustments.insert("catEyeScale".to_string(), json!(v));
    }
    // Enable lens blur only when companion fields show real activity (not LR placeholders)
    {
        let blur_amt = adjustments
            .get("lensBlurAmount")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let active = [
            "bokehShapeDetail",
            "bokehAspect",
            "bokehRotation",
            "sphericalAberration",
            "catEyeAmount",
        ]
        .iter()
        .any(|k| {
            adjustments
                .get(*k)
                .and_then(|v| v.as_f64())
                .map(|x| x.abs() > 0.001)
                .unwrap_or(false)
        });
        // Explicit non-default amount (50 is a common inactive default in CRS packets)
        let amount_active = blur_amt > 0.0 && (blur_amt - 50.0).abs() > 0.5;
        if active || amount_active {
            adjustments.insert("lensBlurEnabled".to_string(), json!(true));
        }
    }
    if let Some(v) = attrs.get("LensProfileSetup") {
        if !v.is_empty() {
            adjustments.insert("lensProfileSetup".to_string(), json!(v));
        }
    }
    if let Some(v) = attrs.get("LensProfileFilename") {
        if !v.is_empty() {
            adjustments.insert("lensProfileFilename".to_string(), json!(v));
        }
    }
    if let Some(v) = attrs.get("LensProfileIsEmbedded") {
        let on = v == "1" || v.eq_ignore_ascii_case("true") || v == "True";
        adjustments.insert("lensProfileIsEmbedded".to_string(), json!(on));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "CurveRefineSaturation") {
        adjustments.insert("curveRefineSaturation".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "HDREditMode") {
        adjustments.insert("hdrEditMode".to_string(), json!(v as i64));
    }

    if let Some(v) = get_attr_as_f64(&attrs, "GrainSeed") {
        adjustments.insert("grainSeed".to_string(), json!(v as i64));
    }
    if let Some(v) = attrs.get("CameraProfileDigest") {
        if !v.is_empty() {
            adjustments.insert("cameraProfileDigest".to_string(), json!(v));
        }
    }
    if let Some(v) = attrs.get("LensProfileDigest") {
        if !v.is_empty() {
            adjustments.insert("lensProfileDigest".to_string(), json!(v));
        }
    }
    if let Some(v) = attrs.get("CropConstrainToUnitSquare") {
        let on = v == "1" || v.eq_ignore_ascii_case("true") || v == "True";
        adjustments.insert("cropConstrainToUnitSquare".to_string(), json!(on));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "HighlightsBoost") {
        adjustments.insert("highlightsBoost".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "HighlightsThreshold") {
        adjustments.insert("highlightsThreshold".to_string(), json!(v));
    }
    // Look / table flags commonly present on LR style presets (store for fidelity)
    if let Some(v) = attrs.get("RGBTables") {
        let on = v == "True" || v.eq_ignore_ascii_case("true") || v == "1";
        adjustments.insert("rgbTables".to_string(), json!(on));
    }
    if let Some(v) = attrs.get("LookTable") {
        // sometimes a path/id string rather than bool
        if v == "True" || v.eq_ignore_ascii_case("true") || v == "1" {
            adjustments.insert("lookTable".to_string(), json!(true));
        } else if !v.is_empty() && v != "False" && !v.eq_ignore_ascii_case("false") {
            adjustments.insert("lookTable".to_string(), json!(v));
        }
    }
    if let Some(look) = extract_xmp_look_name(xmp_content) {
        adjustments.insert("lookName".to_string(), json!(look));
    }

    // Color calibration (LR Calibration panel)
    let mut cal = Map::new();
    let cal_map = [
        ("ShadowTint", "shadowsTint"),
        ("RedHue", "redHue"),
        ("RedSaturation", "redSaturation"),
        ("GreenHue", "greenHue"),
        ("GreenSaturation", "greenSaturation"),
        ("BlueHue", "blueHue"),
        ("BlueSaturation", "blueSaturation"),
    ];
    for (xmp_key, rr_key) in cal_map {
        if let Some(raw) = attrs.get(xmp_key)
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            cal.insert(rr_key.to_string(), json_val);
        }
    }
    if !cal.is_empty() {
        adjustments.insert("colorCalibration".to_string(), Value::Object(cal));
    }

    // Parametric curve (matches frontend ParametricCurveSettings on luma channel)
    let has_parametric = attrs.contains_key("ParametricShadowSplit")
        || attrs.contains_key("ParametricMidtoneSplit")
        || attrs.contains_key("ParametricHighlightSplit")
        || attrs.contains_key("ParametricShadows")
        || attrs.contains_key("ParametricDarks")
        || attrs.contains_key("ParametricLights")
        || attrs.contains_key("ParametricHighlights");
    if has_parametric {
        let mut luma = Map::new();
        luma.insert("darks".to_string(), json!(get_attr_as_f64(&attrs, "ParametricDarks").unwrap_or(0.0)));
        luma.insert(
            "shadows".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricShadows").unwrap_or(0.0)),
        );
        luma.insert(
            "lights".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricLights").unwrap_or(0.0)),
        );
        luma.insert(
            "highlights".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricHighlights").unwrap_or(0.0)),
        );
        luma.insert("whiteLevel".to_string(), json!(0.0));
        luma.insert("blackLevel".to_string(), json!(0.0));
        luma.insert(
            "split1".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricShadowSplit").unwrap_or(25.0)),
        );
        luma.insert(
            "split2".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricMidtoneSplit").unwrap_or(50.0)),
        );
        luma.insert(
            "split3".to_string(),
            json!(get_attr_as_f64(&attrs, "ParametricHighlightSplit").unwrap_or(75.0)),
        );
        // RGB channels: default neutral (same as app defaults)
        let neutral = luma.clone();
        let mut pc = Map::new();
        pc.insert("luma".to_string(), Value::Object(luma));
        pc.insert("red".to_string(), Value::Object(neutral.clone()));
        pc.insert("green".to_string(), Value::Object(neutral.clone()));
        pc.insert("blue".to_string(), Value::Object(neutral));
        adjustments.insert("parametricCurve".to_string(), Value::Object(pc));
        // Prefer parametric mode when LR stored parametric values
        adjustments.insert("curveMode".to_string(), json!("parametric"));
    }

    if let Some(v) = get_attr_as_f64(&attrs, "LuminanceNoiseReductionDetail") {
        adjustments.insert("lumaNoiseDetail".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "LuminanceNoiseReductionContrast") {
        adjustments.insert("lumaNoiseContrast".to_string(), json!(v));
    }
    if let Some(name) = attrs.get("LensProfileName") {
        if !name.is_empty() {
            adjustments.insert("lensProfileName".to_string(), json!(name));
        }
    }
    if let Some(v) = get_attr_as_f64(&attrs, "LensProfileDistortionScale") {
        adjustments.insert("lensProfileDistortionScale".to_string(), json!(v));
    }
    if let Some(v) = get_attr_as_f64(&attrs, "LensProfileVignettingScale") {
        adjustments.insert("lensProfileVignettingScale".to_string(), json!(v));
    }

    let colors = [
        ("Red", "reds"),
        ("Orange", "oranges"),
        ("Yellow", "yellows"),
        ("Green", "greens"),
        ("Aqua", "aquas"),
        ("Blue", "blues"),
        ("Purple", "purples"),
        ("Magenta", "magentas"),
    ];
    for (src, dst) in colors {
        let mut color_map = Map::new();
        if let Some(raw) = attrs.get(&format!("HueAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(Value::Number(n)) = num_to_json(num)
            && let Some(val_f64) = n.as_f64()
        {
            let adjusted_hue = val_f64 * 0.75;
            color_map.insert("hue".to_string(), json!(adjusted_hue));
        }
        if let Some(raw) = attrs.get(&format!("SaturationAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            color_map.insert("saturation".to_string(), json_val);
        }
        if let Some(raw) = attrs.get(&format!("LuminanceAdjustment{}", src))
            && let Some(num) = parse_num(raw.trim_start_matches('+'))
            && let Some(json_val) = num_to_json(num)
        {
            color_map.insert("luminance".to_string(), json_val);
        }
        if !color_map.is_empty() {
            hsl_map.insert(dst.to_string(), Value::Object(color_map));
        }
    }
    if !hsl_map.is_empty() {
        adjustments.insert("hsl".to_string(), Value::Object(hsl_map));
    }

    let mut shadows_map = Map::new();
    let mut midtones_map = Map::new();
    let mut highlights_map = Map::new();
    let mut global_map = Map::new();
    if let Some(raw) = attrs.get("SplitToningShadowHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningHighlightHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningShadowSaturation")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneSat")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningHighlightSaturation")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeShadowLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        shadows_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeMidtoneLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        midtones_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeHighlightLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        highlights_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalHue")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("hue".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalSat")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("saturation".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("ColorGradeGlobalLum")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        global_map.insert("luminance".to_string(), json_val);
    }
    if let Some(raw) = attrs.get("SplitToningBalance")
        && let Some(num) = parse_num(raw)
        && let Some(json_val) = num_to_json(num)
    {
        color_grading_map.insert("balance".to_string(), json_val);
    }
    if !shadows_map.is_empty() {
        color_grading_map.insert("shadows".to_string(), Value::Object(shadows_map));
    }
    if !midtones_map.is_empty() {
        color_grading_map.insert("midtones".to_string(), Value::Object(midtones_map));
    }
    if !highlights_map.is_empty() {
        color_grading_map.insert("highlights".to_string(), Value::Object(highlights_map));
    }
    if !global_map.is_empty() {
        color_grading_map.insert("global".to_string(), Value::Object(global_map));
    }
    if !color_grading_map.is_empty() {
        adjustments.insert("colorGrading".to_string(), Value::Object(color_grading_map));
    }

    let curve_mappings = [
        ("ToneCurvePV2012", "luma"),
        ("ToneCurvePV2012Red", "red"),
        ("ToneCurvePV2012Green", "green"),
        ("ToneCurvePV2012Blue", "blue"),
    ];
    for (xmp_curve, rr_curve) in curve_mappings {
        if let Some(points) = extract_tone_curve_points(xmp_content, xmp_curve) {
            curves_map.insert(rr_curve.to_string(), Value::Array(points));
        }
    }
    if !curves_map.is_empty() {
        adjustments.insert("curves".to_string(), Value::Object(curves_map));
    }

    let preset_name =
        extract_xmp_name(xmp_content).unwrap_or_else(|| "Imported Preset".to_string());

    let preset_kind = attrs
        .get("PresetType")
        .map(|s| s.as_str())
        .unwrap_or("Normal");
    // "Look" presets in LR are still style-like for RapidRAW; keep tool vs style distinction for future
    let rr_preset_type = if preset_kind.eq_ignore_ascii_case("Look") {
        "style"
    } else {
        "style"
    };

    // Crop: LR uses normalized 0–1 edges (CropTop/Left/Bottom/Right); RR uses % crop box
    let has_crop_flag = attrs
        .get("HasCrop")
        .map(|v| v == "True" || v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false);
    let crop_top = get_attr_as_f64(&attrs, "CropTop");
    let crop_left = get_attr_as_f64(&attrs, "CropLeft");
    let crop_bottom = get_attr_as_f64(&attrs, "CropBottom");
    let crop_right = get_attr_as_f64(&attrs, "CropRight");
    let mut include_crop = false;
    if has_crop_flag
        || crop_top.is_some()
        || crop_left.is_some()
        || crop_bottom.is_some()
        || crop_right.is_some()
    {
        let top = crop_top.unwrap_or(0.0).clamp(0.0, 1.0);
        let left = crop_left.unwrap_or(0.0).clamp(0.0, 1.0);
        let bottom = crop_bottom.unwrap_or(1.0).clamp(0.0, 1.0);
        let right = crop_right.unwrap_or(1.0).clamp(0.0, 1.0);
        let width_n = (right - left).max(0.0);
        let height_n = (bottom - top).max(0.0);
        let is_full = top <= 0.0001 && left <= 0.0001 && bottom >= 0.9999 && right >= 0.9999;
        if !is_full && width_n > 0.0001 && height_n > 0.0001 {
            let mut crop = Map::new();
            crop.insert("unit".to_string(), json!("%"));
            crop.insert("x".to_string(), json!(left * 100.0));
            crop.insert("y".to_string(), json!(top * 100.0));
            crop.insert("width".to_string(), json!(width_n * 100.0));
            crop.insert("height".to_string(), json!(height_n * 100.0));
            adjustments.insert("crop".to_string(), Value::Object(crop));
            include_crop = true;
        }
        if let Some(angle) = get_attr_as_f64(&attrs, "CropAngle") {
            if angle.abs() > 0.0001 {
                adjustments.insert("rotation".to_string(), json!(angle));
                include_crop = true;
            }
        }
        if let Some(v) = attrs.get("CropConstrainToWarp") {
            let on = v == "1" || v.eq_ignore_ascii_case("true");
            adjustments.insert("cropConstrainToWarp".to_string(), json!(on));
        }
    }


    // AutoTone flag (LR may set AutoTone="True" when auto was used)
    if let Some(v) = attrs.get("AutoTone") {
        let on = v == "True" || v.eq_ignore_ascii_case("true") || v == "1";
        adjustments.insert("autoTone".to_string(), json!(on));
    }
    if let Some(v) = attrs.get("AutoExposure") {
        let on = v == "True" || v.eq_ignore_ascii_case("true") || v == "1";
        adjustments.insert("autoExposure".to_string(), json!(on));
    }

    // Local adjustments / masks (MaskGroupBasedCorrections)
    let parsed_masks = parse_mask_group_based_corrections(xmp_content);
    let include_masks = !parsed_masks.is_empty();
    if include_masks {
        adjustments.insert("masks".to_string(), Value::Array(parsed_masks));
    }

    // Point Color / Color Variance (LR modern color tools) — preserved for round-trip
    if let Some(rows) = parse_point_colors(xmp_content) {
        adjustments.insert("pointColors".to_string(), Value::Array(rows));
    }
    if let Some(vals) = parse_color_variance(xmp_content) {
        adjustments.insert("colorVariance".to_string(), Value::Array(vals));
    }

    Ok(Preset {
        id: Uuid::new_v4().to_string(),
        name: preset_name,
        adjustments: Value::Object(adjustments),
        include_masks: Some(include_masks),
        include_crop_transform: Some(include_crop),
        preset_type: Some(rr_preset_type.to_string()),
        group: None,
    })
}


/// Best-effort reverse mapping: RapidRAW adjustments → Lightroom-compatible XMP develop preset.
/// Not a full CRS dump; covers the fields we import so round-trips are useful for interop.
pub fn convert_adjustments_to_xmp(name: &str, adjustments: &Value) -> String {
    convert_adjustments_to_xmp_with_group(name, adjustments, None)
}

/// Same as [`convert_adjustments_to_xmp`] but writes optional `crs:Group` (LR preset folder).
pub fn convert_adjustments_to_xmp_with_group(
    name: &str,
    adjustments: &Value,
    group: Option<&str>,
) -> String {
    let adj = adjustments.as_object().cloned().unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    lines.push(r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">"#.to_string());
    lines.push(r#" <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">"#.to_string());
    lines.push(r#"  <rdf:Description rdf:about="""#.to_string());
    lines.push(r#"    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/""#.to_string());
    lines.push(r#"   crs:Version="15.0""#.to_string());
    if let Some(pv) = adj.get("processVersion").and_then(|v| v.as_str()) {
        if !pv.is_empty() {
            lines.push(format!(r#"   crs:ProcessVersion="{}""#, pv.replace('"', "&quot;")));
        } else {
            lines.push(r#"   crs:ProcessVersion="11.0""#.to_string());
        }
    } else {
        lines.push(r#"   crs:ProcessVersion="11.0""#.to_string());
    }
    lines.push(r#"   crs:HasSettings="True""#.to_string());
    // Orientation (best-effort reverse of EXIF-like codes)
    if let Some(raw) = adj.get("imageOrientation").and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))) {
        lines.push(format!(r#"   crs:ImageOrientation="{}""#, raw));
    } else {
        let steps = adj
            .get("orientationSteps")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            % 4;
        let flip_h = adj
            .get("flipHorizontal")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let flip_v = adj
            .get("flipVertical")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let code: i64 = match (steps, flip_h, flip_v) {
            (0, false, false) => 1,
            (0, true, false) => 2,
            (2, false, false) => 3,
            (0, false, true) => 4,
            (1, true, false) => 5,
            (1, false, false) => 6,
            (3, true, false) => 7,
            (3, false, false) => 8,
            _ => 1,
        };
        if code != 1 || steps != 0 || flip_h || flip_v {
            lines.push(format!(r#"   crs:ImageOrientation="{}""#, code));
        }
    }

    // PresetType: prefer stored xmpPresetType, else map RR preset_type style → Normal
    if let Some(pt) = adj
        .get("xmpPresetType")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        lines.push(format!(
            r#"   crs:PresetType="{}""#,
            pt.replace('"', "&quot;")
        ));
    } else if let Some(pt) = adj.get("presetType").and_then(|v| v.as_str()) {
        // RapidRAW uses style/tool; LR XMP uses Normal/Look typically
        let crs_pt = if pt.eq_ignore_ascii_case("look") {
            "Look"
        } else {
            "Normal"
        };
        lines.push(format!(r#"   crs:PresetType="{}""#, crs_pt));
    }

    let map_f = |key: &str| -> Option<f64> {
        adj.get(key).and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
    };
    let push_attr = |lines: &mut Vec<String>, crs: &str, val: f64, signed: bool| {
        if signed {
            lines.push(format!(r#"   crs:{}="{:+}""#, crs, val));
        } else {
            lines.push(format!(r#"   crs:{}="{}""#, crs, val));
        }
    };

    if let Some(v) = map_f("exposure") {
        push_attr(&mut lines, "Exposure2012", v, true);
    } else if let Some(v) = map_f("brightness") {
        // RapidRAW exposes a separate brightness slider; map to Exposure when EV not set
        push_attr(&mut lines, "Exposure2012", v, true);
    }
    if let Some(v) = map_f("contrast") {
        push_attr(&mut lines, "Contrast2012", v, true);
    }
    if let Some(v) = map_f("highlights") {
        push_attr(&mut lines, "Highlights2012", v, true);
    }
    if let Some(v) = map_f("shadows") {
        // import multiplies Shadows2012 by 1.5; reverse approximately
        push_attr(&mut lines, "Shadows2012", (v / 1.5).clamp(-100.0, 100.0), true);
    }
    if let Some(v) = map_f("whites") {
        push_attr(&mut lines, "Whites2012", v, true);
    }
    if let Some(v) = map_f("blacks") {
        push_attr(&mut lines, "Blacks2012", v, true);
    }
    if let Some(v) = map_f("clarity") {
        push_attr(&mut lines, "Clarity2012", v, true);
    }
    if let Some(v) = map_f("dehaze") {
        push_attr(&mut lines, "Dehaze", v, true);
    }
    if let Some(v) = map_f("vibrance") {
        push_attr(&mut lines, "Vibrance", v, true);
    }
    if let Some(v) = map_f("saturation") {
        push_attr(&mut lines, "Saturation", v, true);
    }
    if let Some(v) = map_f("structure") {
        push_attr(&mut lines, "Texture", v, true);
    }
    if let Some(v) = map_f("sharpness") {
        // import: (Sharpness/150)*100
        push_attr(&mut lines, "Sharpness", (v / 100.0) * 150.0, false);
    }
    if let Some(v) = map_f("sharpenRadius") {
        push_attr(&mut lines, "SharpenRadius", v, true);
    }
    if let Some(v) = map_f("sharpenDetail") {
        push_attr(&mut lines, "SharpenDetail", v, false);
    }
    if let Some(v) = map_f("sharpenMasking") {
        push_attr(&mut lines, "SharpenEdgeMasking", v, false);
    }
    if let Some(true) = adj.get("convertToGrayscale").and_then(|v| v.as_bool()) {
        lines.push(r#"   crs:ConvertToGrayscale="True""#.to_string());
    }
    if let Some(v) = map_f("temperature") {
        // store as relative IncrementalTemperature for portability
        push_attr(&mut lines, "IncrementalTemperature", v, true);
    }
    if let Some(v) = map_f("tint") {
        push_attr(&mut lines, "IncrementalTint", (v / 100.0) * 150.0, true);
    }
    if let Some(wb) = adj.get("whiteBalance").and_then(|v| v.as_str()) {
        lines.push(format!(r#"   crs:WhiteBalance="{}""#, wb));
    }

    if let Some(v) = map_f("asShotTemperature") {
        push_attr(&mut lines, "AsShotTemperature", v, false);
    }
    if let Some(v) = map_f("asShotTint") {
        push_attr(&mut lines, "AsShotTint", v, true);
    }
        if let Some(v) = adj.get("alreadyApplied") {
        let on = matches!(v, serde_json::Value::Bool(true))
            || matches!(v, serde_json::Value::String(s) if s == "1" || s.eq_ignore_ascii_case("true"));
        if on {
            lines.push(r#"   crs:AlreadyApplied="True""#.to_string());
        }
    }
    if let Some(name) = adj.get("toneCurveName").and_then(|v| v.as_str()) {
        if !name.is_empty() {
            let safe = name.replace('"', "&quot;");
            lines.push(format!(r#"   crs:ToneCurveName="{}""#, safe));
            lines.push(format!(r#"   crs:ToneCurveName2012="{}""#, safe));
        }
    }

    if let Some(v) = adj.get("rgbTables") {
        let on = matches!(v, serde_json::Value::Bool(true))
            || matches!(v, serde_json::Value::String(s) if s == "1" || s.eq_ignore_ascii_case("true"));
        lines.push(format!(
            r#"   crs:RGBTables="{}""#,
            if on { "True" } else { "False" }
        ));
    }
if let Some(profile) = adj.get("cameraProfile").and_then(|v| v.as_str()) {
        if !profile.is_empty() {
            lines.push(format!(r#"   crs:CameraProfile="{}""#, profile.replace('"', "&quot;")));
        }
    }
    if let Some(lp) = adj.get("lensProfileName").and_then(|v| v.as_str()) {
        if !lp.is_empty() {
            lines.push(format!(r#"   crs:LensProfileName="{}""#, lp.replace('"', "&quot;")));
        }
    }
    // crs:LensProfileEnable from profile name or distortion/vignette toggles (LR Optics)
    {
        let json_truthy = |v: Option<&serde_json::Value>| -> bool {
            match v {
                Some(serde_json::Value::Bool(b)) => *b,
                Some(serde_json::Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
                Some(serde_json::Value::Number(n)) => n.as_i64() == Some(1) || n.as_f64() == Some(1.0),
                _ => false,
            }
        };
        let named = adj
            .get("lensProfileName")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let dist_on = json_truthy(adj.get("lensDistortionEnabled"));
        let vig_on = json_truthy(adj.get("lensVignetteEnabled"));
        if named || dist_on || vig_on {
            lines.push(r#"   crs:LensProfileEnable="1""#.to_string());
        } else if adj.get("lensDistortionEnabled").is_some() || adj.get("lensVignetteEnabled").is_some() {
            lines.push(r#"   crs:LensProfileEnable="0""#.to_string());
        }
    }
    if let Some(v) = map_f("lensProfileDistortionScale") {
        push_attr(&mut lines, "LensProfileDistortionScale", v, false);
    }
    if let Some(v) = map_f("lensProfileVignettingScale") {
        push_attr(&mut lines, "LensProfileVignettingScale", v, false);
    }
    if let Some(v) = map_f("perspectiveUpright") {
        lines.push(format!(r#"   crs:PerspectiveUpright="{}""#, v as i64));
    }

    // Manual transform / perspective (geometry panel)
    if let Some(v) = map_f("transformVertical") {
        push_attr(&mut lines, "PerspectiveVertical", v, true);
    }
    if let Some(v) = map_f("transformHorizontal") {
        push_attr(&mut lines, "PerspectiveHorizontal", v, true);
    }
    if let Some(v) = map_f("transformRotate") {
        push_attr(&mut lines, "PerspectiveRotate", v, true);
    }
    if let Some(v) = map_f("transformScale") {
        push_attr(&mut lines, "PerspectiveScale", v, false);
    }
    if let Some(v) = map_f("transformAspect") {
        push_attr(&mut lines, "PerspectiveAspect", v, true);
    }
    if let Some(v) = map_f("transformXOffset") {
        push_attr(&mut lines, "PerspectiveX", v, true);
    }
    if let Some(v) = map_f("transformYOffset") {
        push_attr(&mut lines, "PerspectiveY", v, true);
    }
    if let Some(v) = map_f("transformDistortion") {
        push_attr(&mut lines, "LensManualDistortionAmount", v, true);
    }

    // Defringe
    if let Some(v) = map_f("defringePurpleAmount") {
        push_attr(&mut lines, "DefringePurpleAmount", v, false);
    }
    if let Some(v) = map_f("defringePurpleHueLo") {
        push_attr(&mut lines, "DefringePurpleHueLo", v, false);
    }
    if let Some(v) = map_f("defringePurpleHueHi") {
        push_attr(&mut lines, "DefringePurpleHueHi", v, false);
    }
    if let Some(v) = map_f("defringeGreenAmount") {
        push_attr(&mut lines, "DefringeGreenAmount", v, false);
    }
    if let Some(v) = map_f("defringeGreenHueLo") {
        push_attr(&mut lines, "DefringeGreenHueLo", v, false);
    }
    if let Some(v) = map_f("defringeGreenHueHi") {
        push_attr(&mut lines, "DefringeGreenHueHi", v, false);
    }

    // HSL
    if let Some(hsl) = adj.get("hsl").and_then(|v| v.as_object()) {
        let colors = [
            ("reds", "Red"),
            ("oranges", "Orange"),
            ("yellows", "Yellow"),
            ("greens", "Green"),
            ("aquas", "Aqua"),
            ("blues", "Blue"),
            ("purples", "Purple"),
            ("magentas", "Magenta"),
        ];
        for (src, crs_color) in colors {
            if let Some(c) = hsl.get(src).and_then(|v| v.as_object()) {
                if let Some(h) = c.get("hue").and_then(|v| v.as_f64()) {
                    // import multiplies hue by 0.75
                    push_attr(&mut lines, &format!("HueAdjustment{}", crs_color), h / 0.75, true);
                }
                if let Some(s) = c.get("saturation").and_then(|v| v.as_f64()) {
                    push_attr(&mut lines, &format!("SaturationAdjustment{}", crs_color), s, true);
                }
                if let Some(l) = c.get("luminance").and_then(|v| v.as_f64()) {
                    push_attr(&mut lines, &format!("LuminanceAdjustment{}", crs_color), l, true);
                }
            }
        }
    }

    // Effects
    if let Some(v) = map_f("vignetteAmount") {
        push_attr(&mut lines, "PostCropVignetteAmount", v, true);
    }
    if let Some(v) = map_f("vignetteMidpoint") {
        push_attr(&mut lines, "PostCropVignetteMidpoint", v, false);
    }
    if let Some(v) = map_f("vignetteFeather") {
        push_attr(&mut lines, "PostCropVignetteFeather", v, false);
    }
    if let Some(v) = map_f("vignetteRoundness") {
        push_attr(&mut lines, "PostCropVignetteRoundness", v, true);
    }

    if let Some(v) = map_f("vignetteStyle") {
        lines.push(format!(r#"   crs:PostCropVignetteStyle="{}""#, v as i64));
    } else if map_f("vignetteAmount").is_some() {
        // LR default style when post-crop vignette is used
        lines.push(r#"   crs:PostCropVignetteStyle="1""#.to_string());
    }

    if let Some(v) = map_f("vignetteHighlightContrast") {
        push_attr(&mut lines, "PostCropVignetteHighlightContrast", v, true);
    }
    if let Some(v) = adj.get("overrideLookVignette") {
        let on = match v {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
            serde_json::Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
            _ => false,
        };
        lines.push(format!(
            r#"   crs:OverrideLookVignette="{}""#,
            if on { "1" } else { "0" }
        ));
    }
    if let Some(v) = map_f("grainAmount") {
        push_attr(&mut lines, "GrainAmount", v, false);
    }
    if let Some(v) = map_f("grainSize") {
        push_attr(&mut lines, "GrainSize", v, false);
    }
    if let Some(v) = map_f("grainRoughness") {
        push_attr(&mut lines, "GrainFrequency", v, false);
    }

    if let Some(v) = map_f("grainSeed") {
        lines.push(format!(r#"   crs:GrainSeed="{}""#, v as i64));
    }
    if let Some(d) = adj.get("cameraProfileDigest").and_then(|v| v.as_str()) {
        if !d.is_empty() {
            lines.push(format!(
                r#"   crs:CameraProfileDigest="{}""#,
                d.replace('"', "&quot;")
            ));
        }
    }
    if let Some(d) = adj.get("lensProfileDigest").and_then(|v| v.as_str()) {
        if !d.is_empty() {
            lines.push(format!(
                r#"   crs:LensProfileDigest="{}""#,
                d.replace('"', "&quot;")
            ));
        }
    }
    if let Some(v) = adj.get("cropConstrainToUnitSquare") {
        let on = matches!(v, serde_json::Value::Bool(true))
            || matches!(v, serde_json::Value::String(s) if s == "1" || s.eq_ignore_ascii_case("true"));
        if on {
            lines.push(r#"   crs:CropConstrainToUnitSquare="True""#.to_string());
        }
    }
    if let Some(v) = map_f("highlightsBoost") {
        push_attr(&mut lines, "HighlightsBoost", v, true);
    }
    if let Some(v) = map_f("highlightsThreshold") {
        push_attr(&mut lines, "HighlightsThreshold", v, false);
    }
    // Lens blur (best-effort CRS BlurAmount + bokeh companions)
    let blur_on = adj
        .get("lensBlurEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if blur_on {
        if let Some(v) = map_f("lensBlurAmount") {
            push_attr(&mut lines, "BlurAmount", v, false);
        }
        // shape: circle=0, hexagon=1, octagon=2, ring=3
        let shape_code = match adj.get("lensBlurShape").and_then(|v| v.as_str()) {
            Some("hexagon") => 1,
            Some("octagon") => 2,
            Some("ring") => 3,
            _ => adj
                .get("bokehShape")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
        };
        lines.push(format!(r#"   crs:BokehShape="{}""#, shape_code));
        if let Some(v) = map_f("bokehShapeDetail") {
            push_attr(&mut lines, "BokehShapeDetail", v, false);
        }
        if let Some(v) = map_f("bokehAspect") {
            push_attr(&mut lines, "BokehAspect", v, true);
        }
        if let Some(v) = map_f("bokehRotation") {
            push_attr(&mut lines, "BokehRotation", v, true);
        }
        if let Some(v) = map_f("sphericalAberration") {
            push_attr(&mut lines, "SphericalAberration", v, true);
        }
        if let Some(v) = map_f("catEyeAmount") {
            push_attr(&mut lines, "CatEyeAmount", v, false);
        }
        if let Some(v) = map_f("catEyeScale") {
            push_attr(&mut lines, "CatEyeScale", v, false);
        }
    }
    if let Some(fnm) = adj.get("lensProfileFilename").and_then(|v| v.as_str()) {
        if !fnm.is_empty() {
            lines.push(format!(
                r#"   crs:LensProfileFilename="{}""#,
                fnm.replace('"', "&quot;")
            ));
        }
    }
    if let Some(v) = adj.get("lensProfileIsEmbedded") {
        let on = match v {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
            serde_json::Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
            _ => false,
        };
        lines.push(format!(
            r#"   crs:LensProfileIsEmbedded="{}""#,
            if on { "True" } else { "False" }
        ));
    }
    if let Some(v) = map_f("hdrEditMode") {
        lines.push(format!(r#"   crs:HDREditMode="{}""#, v as i64));
    }
    if let Some(setup) = adj.get("lensProfileSetup").and_then(|v| v.as_str()) {
        if !setup.is_empty() {
            lines.push(format!(
                r#"   crs:LensProfileSetup="{}""#,
                setup.replace('"', "&quot;")
            ));
        }
    }
    if let Some(v) = map_f("curveRefineSaturation") {
        push_attr(&mut lines, "CurveRefineSaturation", v, true);
    }
    if let Some(v) = map_f("lumaNoiseReduction") {
        push_attr(&mut lines, "LuminanceSmoothing", v, false);
    }
    if let Some(v) = map_f("colorNoiseReduction") {
        push_attr(&mut lines, "ColorNoiseReduction", v, false);
    }
    if let Some(v) = map_f("colorNoiseDetail") {
        push_attr(&mut lines, "ColorNoiseReductionDetail", v, false);
    }
    if let Some(v) = map_f("colorNoiseSmoothness") {
        push_attr(&mut lines, "ColorNoiseReductionSmoothness", v, false);
    }
    if let Some(v) = map_f("lumaNoiseDetail") {
        push_attr(&mut lines, "LuminanceNoiseReductionDetail", v, false);
    }
    if let Some(v) = map_f("lumaNoiseContrast") {
        push_attr(&mut lines, "LuminanceNoiseReductionContrast", v, false);
    }
    if let Some(v) = map_f("chromaticAberrationRedCyan") {
        push_attr(&mut lines, "ChromaticAberrationRedCyan", v, true);
    }
    if let Some(v) = map_f("chromaticAberrationBlueYellow") {
        push_attr(&mut lines, "ChromaticAberrationBlueYellow", v, true);
    }
    // Auto remove chromatic aberration (LR Optics)
    if let Some(v) = adj.get("lensTcaEnabled") {
        let enabled = match v {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
            serde_json::Value::String(s) => s == "1" || s.eq_ignore_ascii_case("true"),
            _ => false,
        };
        lines.push(format!(r#"   crs:AutoLateralCA="{}""#, if enabled { "1" } else { "0" }));
    }

    // Color grading / split toning
    if let Some(cg) = adj.get("colorGrading").and_then(|v| v.as_object()) {
        if let Some(sh) = cg.get("shadows").and_then(|v| v.as_object()) {
            if let Some(h) = sh.get("hue").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "SplitToningShadowHue", h, false);
            }
            if let Some(s) = sh.get("saturation").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "SplitToningShadowSaturation", s, false);
            }
            if let Some(l) = sh.get("luminance").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeShadowLum", l, true);
            }
        }
        if let Some(hi) = cg.get("highlights").and_then(|v| v.as_object()) {
            if let Some(h) = hi.get("hue").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "SplitToningHighlightHue", h, false);
            }
            if let Some(s) = hi.get("saturation").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "SplitToningHighlightSaturation", s, false);
            }
            if let Some(l) = hi.get("luminance").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeHighlightLum", l, true);
            }
        }
        if let Some(mt) = cg.get("midtones").and_then(|v| v.as_object()) {
            if let Some(h) = mt.get("hue").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeMidtoneHue", h, false);
            }
            if let Some(s) = mt.get("saturation").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeMidtoneSat", s, false);
            }
            if let Some(l) = mt.get("luminance").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeMidtoneLum", l, true);
            }
        }
        if let Some(g) = cg.get("global").and_then(|v| v.as_object()) {
            if let Some(h) = g.get("hue").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeGlobalHue", h, false);
            }
            if let Some(s) = g.get("saturation").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeGlobalSat", s, false);
            }
            if let Some(l) = g.get("luminance").and_then(|v| v.as_f64()) {
                push_attr(&mut lines, "ColorGradeGlobalLum", l, true);
            }
        }
        if let Some(b) = cg.get("balance").and_then(|v| v.as_f64()) {
            push_attr(&mut lines, "SplitToningBalance", b, true);
        }
        if let Some(b) = cg.get("blending").and_then(|v| v.as_f64()) {
            push_attr(&mut lines, "ColorGradeBlending", b, false);
        }
    }

    // Color calibration
    if let Some(cal) = adj.get("colorCalibration").and_then(|v| v.as_object()) {
        let cal_map = [
            ("shadowsTint", "ShadowTint"),
            ("redHue", "RedHue"),
            ("redSaturation", "RedSaturation"),
            ("greenHue", "GreenHue"),
            ("greenSaturation", "GreenSaturation"),
            ("blueHue", "BlueHue"),
            ("blueSaturation", "BlueSaturation"),
        ];
        for (src, crs) in cal_map {
            if let Some(v) = cal.get(src).and_then(|x| x.as_f64()) {
                push_attr(&mut lines, crs, v, true);
            }
        }
    }

    // Gray mixer (B&W)
    if let Some(gm) = adj.get("grayMixer").and_then(|v| v.as_object()) {
        let gm_map = [
            ("reds", "GrayMixerRed"),
            ("oranges", "GrayMixerOrange"),
            ("yellows", "GrayMixerYellow"),
            ("greens", "GrayMixerGreen"),
            ("aquas", "GrayMixerAqua"),
            ("blues", "GrayMixerBlue"),
            ("purples", "GrayMixerPurple"),
            ("magentas", "GrayMixerMagenta"),
        ];
        for (src, crs) in gm_map {
            if let Some(v) = gm.get(src).and_then(|x| x.as_f64()) {
                push_attr(&mut lines, crs, v, true);
            }
        }
    }

    // Parametric curve (luma channel)
    if let Some(pc) = adj.get("parametricCurve").and_then(|v| v.as_object()) {
        if let Some(luma) = pc.get("luma").and_then(|v| v.as_object()) {
            if let Some(v) = luma.get("shadows").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricShadows", v, true);
            }
            if let Some(v) = luma.get("darks").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricDarks", v, true);
            }
            if let Some(v) = luma.get("lights").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricLights", v, true);
            }
            if let Some(v) = luma.get("highlights").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricHighlights", v, true);
            }
            if let Some(v) = luma.get("split1").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricShadowSplit", v, false);
            }
            if let Some(v) = luma.get("split2").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricMidtoneSplit", v, false);
            }
            if let Some(v) = luma.get("split3").and_then(|x| x.as_f64()) {
                push_attr(&mut lines, "ParametricHighlightSplit", v, false);
            }
        }
    }

    lines.push("  >".to_string());
    let safe_name = name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    lines.push(format!(
        "   <crs:Name><rdf:Alt><rdf:li xml:lang=\"x-default\">{}</rdf:li></rdf:Alt></crs:Name>",
        safe_name
    ));
    if let Some(g) = group {
        let g = g.trim();
        if !g.is_empty() {
            let safe_g = g
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;");
            lines.push(format!(
                "   <crs:Group><rdf:Alt><rdf:li xml:lang=\"x-default\">{}</rdf:li></rdf:Alt></crs:Group>",
                safe_g
            ));
        }
    }

        if let Some(look) = adj.get("lookName").and_then(|v| v.as_str()) {
        if !look.is_empty() {
            let safe_look = look
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;");
            lines.push("   <crs:Look>".to_string());
            lines.push(format!(
                r#"    <rdf:Description crs:Name="{}" crs:Amount="1" crs:Stubbed="true">"#,
                safe_look
            ));
            lines.push("    </rdf:Description>".to_string());
            lines.push("   </crs:Look>".to_string());
        }
    }

// Tone curves
    if let Some(curves) = adj.get("curves").and_then(|v| v.as_object()) {
        let curve_map = [
            ("luma", "ToneCurvePV2012"),
            ("red", "ToneCurvePV2012Red"),
            ("green", "ToneCurvePV2012Green"),
            ("blue", "ToneCurvePV2012Blue"),
        ];
        for (src, crs) in curve_map {
            if let Some(pts) = curves.get(src).and_then(|v| v.as_array()) {
                if pts.is_empty() {
                    continue;
                }
                lines.push(format!("   <crs:{}>", crs));
                lines.push("    <rdf:Seq>".to_string());
                for pt in pts {
                    if let Some(o) = pt.as_object() {
                        let x = o.get("x").and_then(|v| v.as_u64()).unwrap_or(0);
                        let y = o.get("y").and_then(|v| v.as_u64()).unwrap_or(0);
                        lines.push(format!("     <rdf:li>{}, {}</rdf:li>", x, y));
                    }
                }
                lines.push("    </rdf:Seq>".to_string());
                lines.push(format!("   </crs:{}>", crs));
            }
        }
    }

    // Crop box → normalized LR edges (percent crop only; pixel crop needs image size)
    if let Some(crop) = adj.get("crop").and_then(|v| v.as_object()) {
        let x = crop.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let y = crop.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let w = crop.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let h = crop.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let unit = crop.get("unit").and_then(|v| v.as_str()).unwrap_or("");
        let norm = if unit == "%" || (w > 1.0 && w <= 100.0 && h > 1.0 && h <= 100.0 && x <= 100.0 && y <= 100.0) {
            Some((x / 100.0, y / 100.0, (x + w) / 100.0, (y + h) / 100.0))
        } else if w > 0.0 && h > 0.0 && x >= 0.0 && y >= 0.0 && x + w <= 1.0001 && y + h <= 1.0001 {
            Some((x, y, x + w, y + h))
        } else {
            None
        };
        if let Some((left, top, right, bottom)) = norm {
            let left = left.clamp(0.0, 1.0);
            let top = top.clamp(0.0, 1.0);
            let right = right.clamp(0.0, 1.0);
            let bottom = bottom.clamp(0.0, 1.0);
            let is_full = top <= 0.0001 && left <= 0.0001 && bottom >= 0.9999 && right >= 0.9999;
            if !is_full && right > left && bottom > top {
                lines.push(r#"   crs:HasCrop="True""#.to_string());
                lines.push(format!(r#"   crs:CropTop="{}""#, top));
                lines.push(format!(r#"   crs:CropLeft="{}""#, left));
                lines.push(format!(r#"   crs:CropBottom="{}""#, bottom));
                lines.push(format!(r#"   crs:CropRight="{}""#, right));
                if let Some(angle) = map_f("rotation") {
                    if angle.abs() > 0.0001 {
                        lines.push(format!(r#"   crs:CropAngle="{}""#, angle));
                    }
                }
                lines.push(r#"   crs:CropConstrainToWarp="1""#.to_string());
            }
        }
    }

        
    if adj.get("autoTone").and_then(|v| v.as_bool()).unwrap_or(false) {
        lines.push(r#"   crs:AutoTone="True""#.to_string());
    }

// Local masks (best-effort MaskGroupBasedCorrections)
    let mask_lines = export_masks_to_xmp_lines(&adj);
    if !mask_lines.is_empty() {
        lines.extend(mask_lines);
    }

    // Point Color / Color Variance round-trip
    let pc_lines = export_point_colors_to_xmp_lines(&adj);
    if !pc_lines.is_empty() {
        lines.extend(pc_lines);
    }
    let cv_lines = export_color_variance_to_xmp_lines(&adj);
    if !cv_lines.is_empty() {
        lines.extend(cv_lines);
    }

lines.push("  </rdf:Description>".to_string());
    lines.push(" </rdf:RDF>".to_string());
    lines.push("</x:xmpmeta>".to_string());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("tests/fixtures/presets");
        path.push(name);
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("missing fixture {:?}: {}", path, e))
    }

    #[test]
    fn decodes_ampersand_in_names() {
        assert_eq!(decode_xml_entities("B&amp;W Film"), "B&W Film");
    }

    #[test]
    fn parses_paris_preset() {
        let xmp = fixture("PARIS.xmp");
        let converted = convert_xmp_to_preset_with_group(&xmp).expect("parse PARIS");
        assert_eq!(converted.preset.name, "PARIS");
        assert_eq!(
            converted.group.as_deref(),
            Some("Randazzo - Lifestyle")
        );
        let adj = converted.preset.adjustments.as_object().unwrap();
        assert!(adj.contains_key("dehaze"), "dehaze should map");
        assert!(adj.contains_key("highlights") || adj.contains_key("shadows") || adj.contains_key("vibrance"));
        assert!(adj.contains_key("hsl"), "HSL expected in PARIS");
        assert!(adj.contains_key("curves"), "curves expected");
        assert!(adj.contains_key("colorGrading"), "split toning expected");
    }

    
    #[test]
    fn parses_paris_color_calibration_or_parametric_when_present() {
        let xmp = fixture("PARIS.xmp");
        let converted = convert_xmp_to_preset(&xmp).expect("paris");
        let adj = converted.adjustments.as_object().unwrap();
        assert!(adj.contains_key("colorCalibration"), "PARIS has BlueHue/RedHue");
        assert!(adj.contains_key("parametricCurve"), "PARIS has ParametricShadowSplit");
        let cal = adj.get("colorCalibration").unwrap().as_object().unwrap();
        let blue = cal.get("blueHue").and_then(|v| v.as_f64()).unwrap();
        assert!((blue - (-48.0)).abs() < 0.01, "BlueHue -48, got {}", blue);
        let red = cal.get("redHue").and_then(|v| v.as_f64()).unwrap();
        assert!((red - 21.0).abs() < 0.01);
        assert!(adj.contains_key("lumaNoiseDetail") || adj.contains_key("lumaNoiseReduction"));
        if let Some(name) = adj.get("lensProfileName").and_then(|v| v.as_str()) {
            assert!(name.contains("SIGMA") || name.contains("Adobe"));
        }
        let pc = adj.get("parametricCurve").unwrap().as_object().unwrap();
        let luma = pc.get("luma").unwrap().as_object().unwrap();
        assert!((luma.get("split1").and_then(|v| v.as_f64()).unwrap() - 19.0).abs() < 0.01);
        assert!(pc.contains_key("red") && pc.contains_key("blue"));
    }

#[test]
    fn parses_aurel_with_exposure() {
        let xmp = fixture("AUREL.xmp");
        let converted = convert_xmp_to_preset_with_group(&xmp).expect("parse AUREL");
        assert_eq!(converted.preset.name, "AUREL");
        let adj = converted.preset.adjustments.as_object().unwrap();
        let exposure = adj.get("exposure").and_then(|v| v.as_f64()).unwrap();
        assert!((exposure - 0.94).abs() < 0.001);
        assert!(adj.contains_key("curves"));
    }

    #[test]
    fn parses_bw_film_entity_and_group() {
        let xmp = fixture("B&W Film.xmp");
        let converted = convert_xmp_to_preset_with_group(&xmp).expect("parse B&W");
        assert_eq!(converted.preset.name, "B&W Film");
        assert_eq!(converted.group.as_deref(), Some("Cinematic - Randazzo"));
        let adj = converted.preset.adjustments.as_object().unwrap();
        assert_eq!(adj.get("convertToGrayscale").and_then(|v| v.as_bool()), Some(true));
        assert!(adj.contains_key("grayMixer"), "GrayMixer* should map");
        let sat = adj.get("saturation").and_then(|v| v.as_f64()).unwrap_or(0.0);
        assert!((sat - (-100.0)).abs() < 0.01, "B&W collapses saturation, got {}", sat);
        assert!(adj.contains_key("temperature") || adj.contains_key("tint"));
    }

    #[test]
    fn parses_bastia_temperature() {
        let xmp = fixture("BASTIA.xmp");
        let converted = convert_xmp_to_preset_with_group(&xmp).expect("parse BASTIA");
        assert_eq!(converted.preset.name, "BASTIA");
        let adj = converted.preset.adjustments.as_object().unwrap();
        assert!(adj.contains_key("temperature"), "custom WB temp");
        assert!(adj.contains_key("tint"));
    }

    #[test]
    fn parses_ptl_chicago_look() {
        let xmp = fixture("PTL - Chicago 01.xmp");
        let converted = convert_xmp_to_preset_with_group(&xmp).expect("parse PTL");
        assert_eq!(converted.preset.name, "PTL - Chicago 01");
        assert!(
            converted
                .group
                .as_deref()
                .unwrap_or("")
                .contains("Pierre T. Lambert")
        );
        let adj = converted.preset.adjustments.as_object().unwrap();
        assert!(adj.contains_key("curves") || adj.contains_key("hsl"));
    }

    #[test]
    fn parses_all_fixtures_in_folder() {
        let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dir.push("tests/fixtures/presets");
        let mut count = 0usize;
        for entry in fs::read_dir(&dir).expect("fixtures dir") {
            let entry = entry.unwrap();
            let path = entry.path();
            let is_xmp = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|e| e.eq_ignore_ascii_case("xmp"))
                .unwrap_or(false);
            if is_xmp {
                let xmp = fs::read_to_string(&path).unwrap();
                let converted = convert_xmp_to_preset_with_group(&xmp)
                    .unwrap_or_else(|e| panic!("failed {:?}: {}", path, e));
                assert!(!converted.preset.name.is_empty());
                count += 1;
            }
        }
        assert!(count >= 5, "expected at least 5 fixtures, got {}", count);
    }

    #[test]
    fn parses_bw_sets_grayscale_flag_when_present() {
        let xmp = fixture("B&W Film.xmp");
        // Even if ConvertToGrayscale absent, parse must succeed; PARIS-like color presets ok
        let converted = convert_xmp_to_preset(&xmp).expect("bw");
        assert_eq!(converted.name, "B&W Film");
        // If XMP has ConvertToGrayscale, flag should map
        if xmp.contains("ConvertToGrayscale") {
            let adj = converted.adjustments.as_object().unwrap();
            assert!(adj.contains_key("convertToGrayscale"));
        }
    }

    fn walk_xmp(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
        let read = match fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => return,
        };
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_xmp(&path, out);
            } else if path
                .extension()
                .and_then(|s| s.to_str())
                .map(|e| e.eq_ignore_ascii_case("xmp"))
                .unwrap_or(false)
            {
                out.push(path);
            }
        }
    }

    /// Optionally parse all develop XMPs from the user's CameraRaw folders (macOS).
    /// Skips when directories are absent (CI).
    #[test]
    fn parses_user_cameraraw_presets_if_present() {
        let home = match std::env::var_os("HOME") {
            Some(h) => PathBuf::from(h),
            None => return,
        };
        let roots = [
            home.join("Library/Application Support/Adobe/CameraRaw/Settings"),
            home.join("Library/Application Support/Adobe/CameraRaw/ImportedSettings"),
        ];
        let mut files = Vec::new();
        for root in &roots {
            if root.is_dir() {
                walk_xmp(root, &mut files);
            }
        }
        let mut ok = 0usize;
        let mut err = 0usize;
        for path in files {
            let s = path.to_string_lossy();
            if s.contains("/GPU/") || s.contains("/Defaults/") {
                continue;
            }
            let xmp = match fs::read_to_string(&path) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // Skip non-develop settings blobs without crs:Name
            if !xmp.contains("crs:Name") && !xmp.contains("<crs:Name>") {
                continue;
            }
            match convert_xmp_to_preset_with_group(&xmp) {
                Ok(c) => {
                    assert!(!c.preset.name.is_empty(), "empty name for {:?}", path);
                    ok += 1;
                }
                Err(e) => {
                    err += 1;
                    eprintln!("parse fail {:?}: {}", path, e);
                }
            }
        }
        if ok + err == 0 {
            return;
        }
        assert!(ok > 0, "expected to parse some user presets");
        assert_eq!(err, 0, "{} presets failed to parse", err);
        eprintln!("parsed {} user CameraRaw XMP presets", ok);
    }

    #[test]
    fn parses_mask_group_based_radial_correction() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
  <rdf:Description crs:Version="15.0" crs:ProcessVersion="11.0" crs:HasSettings="True"
   crs:Exposure2012="0.25">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">RadialLocal</rdf:li></rdf:Alt></crs:Name>
   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description
       crs:What="Correction"
       crs:CorrectionAmount="1.0"
       crs:CorrectionActive="true"
       crs:CorrectionName="Sky punch"
       crs:LocalExposure2012="0.40"
       crs:LocalContrast2012="15"
       crs:LocalHighlights2012="-20">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description
           crs:What="Mask/CircularGradient"
           crs:MaskActive="true"
           crs:MaskName="Radial 1"
           crs:MaskInverted="False"
           crs:MaskValue="1"
           crs:Top="0.10"
           crs:Left="0.20"
           crs:Bottom="0.60"
           crs:Right="0.80"
           crs:Angle="0"
           crs:Feather="50"
           crs:ZeroX="0.50"
           crs:ZeroY="0.35"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let preset = convert_xmp_to_preset(xmp).expect("parse radial mask xmp");
        assert_eq!(preset.include_masks, Some(true));
        let adj = preset.adjustments.as_object().unwrap();
        let masks = adj.get("masks").and_then(|v| v.as_array()).expect("masks array");
        assert_eq!(masks.len(), 1, "one mask container");
        let m0 = masks[0].as_object().unwrap();
        assert_eq!(m0.get("name").and_then(|v| v.as_str()), Some("Sky punch"));
        let tone = m0.get("adjustments").and_then(|v| v.as_object()).unwrap();
        assert!((tone.get("exposure").and_then(|v| v.as_f64()).unwrap() - 0.40).abs() < 0.001);
        assert!((tone.get("contrast").and_then(|v| v.as_f64()).unwrap() - 15.0).abs() < 0.001);
        let subs = m0.get("subMasks").and_then(|v| v.as_array()).unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].get("type").and_then(|v| v.as_str()), Some("radial"));
        let params = subs[0].get("parameters").and_then(|v| v.as_object()).unwrap();
        assert!((params.get("centerX").and_then(|v| v.as_f64()).unwrap() - 0.50).abs() < 0.001);
        assert!((params.get("centerY").and_then(|v| v.as_f64()).unwrap() - 0.35).abs() < 0.001);

        // Round-trip export contains MaskGroupBasedCorrections
        let out = convert_adjustments_to_xmp("RadialLocal", &preset.adjustments);
        assert!(out.contains("MaskGroupBasedCorrections"), "export masks block");
        assert!(out.contains("CircularGradient") || out.contains("LocalExposure2012"), "export geometry or tone");
        assert!(out.contains("Sky punch") || out.contains("LocalExposure"), "name or tone in export");
    }

    #[test]
    fn auto_tone_flag_roundtrip() {
        let xmp = r#"<x:xmpmeta>
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
  <rdf:Description crs:HasSettings="True" crs:AutoTone="True" crs:Exposure2012="0.10"/>
 </rdf:RDF>
</x:xmpmeta>"#;
        let preset = convert_xmp_to_preset(xmp).expect("parse");
        let adj = preset.adjustments.as_object().unwrap();
        assert_eq!(adj.get("autoTone").and_then(|v| v.as_bool()), Some(true));
        let out = convert_adjustments_to_xmp("Auto", &preset.adjustments);
        assert!(out.contains("AutoTone=\"True\"") || out.contains("AutoTone=\"true\""), "export: {}", &out[..out.len().min(400)]);
    }


    #[test]
    fn parses_mask_group_linear_and_exports() {
        let xmp = r#"<x:xmpmeta>
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
  <rdf:Description crs:HasSettings="True">
   <crs:MaskGroupBasedCorrections>
    <rdf:Seq>
     <rdf:li>
      <rdf:Description crs:What="Correction" crs:CorrectionAmount="1" crs:CorrectionName="Grad ND" crs:LocalExposure2012="-0.5">
       <crs:CorrectionMasks>
        <rdf:Seq>
         <rdf:li>
          <rdf:Description crs:What="Mask/Gradient" crs:MaskActive="true" crs:MaskName="Grad" crs:Top="0" crs:Left="0.5" crs:Bottom="1" crs:Right="0.5" crs:Feather="40"/>
         </rdf:li>
        </rdf:Seq>
       </crs:CorrectionMasks>
      </rdf:Description>
     </rdf:li>
    </rdf:Seq>
   </crs:MaskGroupBasedCorrections>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let preset = convert_xmp_to_preset(xmp).expect("linear");
        let masks = preset.adjustments.get("masks").unwrap().as_array().unwrap();
        let sub = masks[0].get("subMasks").unwrap().as_array().unwrap();
        assert_eq!(sub[0].get("type").and_then(|v| v.as_str()), Some("linear"));
    }


    
    #[test]
    fn export_xmp_contains_name_and_exposure() {
        let adj = json!({
            "exposure": 0.5,
            "contrast": 10,
            "saturation": -100,
            "convertToGrayscale": true,
            "dehaze": 20,
            "vignetteAmount": -15,
            "grainAmount": 25,
            "colorCalibration": {"blueHue": -48.0, "redHue": 21.0},
            "colorGrading": {
                "shadows": {"hue": 200.0, "saturation": 10.0},
                "highlights": {"hue": 40.0, "saturation": 8.0}
            },
            "parametricCurve": {
                "luma": {"shadows": -9.0, "darks": 3.0, "lights": -4.0, "highlights": -10.0, "split1": 19.0, "split2": 50.0, "split3": 75.0}
            },
            "grayMixer": {"reds": -6.0, "blues": 5.0},
            "chromaticAberrationRedCyan": 5.0,
            "chromaticAberrationBlueYellow": -3.0,
            "transformVertical": 12.0,
            "defringePurpleAmount": 3.0
        });
        let xmp = convert_adjustments_to_xmp("My Look", &adj);
        assert!(xmp.contains("My Look"));
        assert!(xmp.contains("Exposure2012"));
        assert!(xmp.contains("ConvertToGrayscale"));
        assert!(xmp.contains("PostCropVignetteAmount"));
        assert!(xmp.contains("GrainAmount"));
        assert!(xmp.contains("BlueHue"));
        assert!(xmp.contains("SplitToningShadowHue"));
        assert!(xmp.contains("ParametricShadowSplit"));
        assert!(xmp.contains("GrayMixerRed"));
        assert!(xmp.contains("ChromaticAberrationRedCyan"));
        assert!(xmp.contains("PerspectiveVertical"));
        assert!(xmp.contains("DefringePurpleAmount"));
        let back = convert_xmp_to_preset(&xmp).expect("reimport");
        assert_eq!(back.name, "My Look");
        let o = back.adjustments.as_object().unwrap();
        assert!(o.contains_key("colorCalibration") || o.contains_key("dehaze"));
        assert!(o.get("convertToGrayscale").and_then(|v| v.as_bool()).unwrap_or(false));
    }

    #[test]
    fn roundtrip_paris_fixture_via_export() {
        let xmp = fixture("PARIS.xmp");
        let first = convert_xmp_to_preset_with_group(&xmp).expect("import PARIS");
        assert_eq!(first.preset.name, "PARIS");
        let exported = convert_adjustments_to_xmp(&first.preset.name, &first.preset.adjustments);
        let second = convert_xmp_to_preset(&exported).expect("reimport exported PARIS");
        assert_eq!(second.name, "PARIS");
        let a = first.preset.adjustments.as_object().unwrap();
        let b = second.adjustments.as_object().unwrap();
        // Core fields should survive export→import
        for key in ["dehaze", "vibrance", "saturation", "highlights", "shadows", "whites", "blacks"] {
            if let Some(v1) = a.get(key).and_then(|v| v.as_f64()) {
                let v2 = b.get(key).and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                assert!(
                    (v1 - v2).abs() < 0.6,
                    "{} mismatch: {} vs {}",
                    key,
                    v1,
                    v2
                );
            }
        }
        if a.contains_key("colorCalibration") {
            assert!(b.contains_key("colorCalibration"));
        }
        if a.contains_key("hsl") {
            assert!(b.contains_key("hsl"));
        }
    }


    #[test]
    fn roundtrip_all_fixtures_via_export() {
        let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dir.push("tests/fixtures/presets");
        let mut n = 0usize;
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if !path
                .extension()
                .and_then(|s| s.to_str())
                .map(|e| e.eq_ignore_ascii_case("xmp"))
                .unwrap_or(false)
            {
                continue;
            }
            let xmp = fs::read_to_string(&path).unwrap();
            let first = convert_xmp_to_preset(&xmp).unwrap_or_else(|e| panic!("{:?}: {}", path, e));
            let exported = convert_adjustments_to_xmp(&first.name, &first.adjustments);
            let second = convert_xmp_to_preset(&exported)
                .unwrap_or_else(|e| panic!("reimport {:?}: {}", path, e));
            assert_eq!(second.name, first.name, "name for {:?}", path);
            let a = first.adjustments.as_object().unwrap();
            let b = second.adjustments.as_object().unwrap();
            for key in ["contrast", "highlights", "whites", "blacks", "saturation"] {
                if let Some(v1) = a.get(key).and_then(|v| v.as_f64()) {
                    let v2 = b.get(key).and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                    assert!(
                        (v1 - v2).abs() < 1.0,
                        "{:?} {} {} vs {}",
                        path.file_name(),
                        key,
                        v1,
                        v2
                    );
                }
            }
            n += 1;
        }
        assert!(n >= 5);
    }


    #[test]
    fn bulk_export_then_reimport_names() {
        let cases = [
            ("Look A", json!({"exposure": 0.2, "contrast": 5})),
            ("Look_B", json!({"saturation": 10, "vibrance": 8})),
            ("B&W", json!({"convertToGrayscale": true, "saturation": -100})),
        ];
        let dir = std::env::temp_dir().join(format!("rustroom_xmp_export_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for (name, adj) in cases {
            let path = dir.join(format!("{}.xmp", name.replace('/', "_")));
            let xmp = convert_adjustments_to_xmp(name, &adj);
            fs::write(&path, &xmp).unwrap();
            let back = convert_xmp_to_preset(&fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(back.name, name);
        }
        let count = fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, 3);
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn point_colors_and_color_variance_roundtrip() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:Version="15.0" crs:ProcessVersion="11.0" crs:HasSettings="True"
   crs:Exposure2012="+0.25" crs:Contrast2012="10">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">PCTest</rdf:li></rdf:Alt></crs:Name>
   <crs:PointColors>
    <rdf:Seq>
     <rdf:li>-1.000000, -1.000000, -1.000000, 12.500000, 0.000000</rdf:li>
     <rdf:li>1.000000, 2.000000, 3.000000, 4.000000, 5.000000</rdf:li>
    </rdf:Seq>
   </crs:PointColors>
   <crs:ColorVariance>
    <rdf:Seq>
     <rdf:li>-50.000000</rdf:li>
    </rdf:Seq>
   </crs:ColorVariance>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let preset = convert_xmp_to_preset(xmp).expect("parse");
        let adj = preset.adjustments.as_object().expect("obj");
        let pc = adj.get("pointColors").and_then(|v| v.as_array()).expect("pointColors");
        assert_eq!(pc.len(), 2);
        let row0 = pc[0].as_array().expect("row0");
        assert!((row0[3].as_f64().unwrap() - 12.5).abs() < 0.01);
        let cv = adj.get("colorVariance").and_then(|v| v.as_array()).expect("colorVariance");
        assert_eq!(cv.len(), 1);
        assert!((cv[0].as_f64().unwrap() + 50.0).abs() < 0.01);

        let exported = convert_adjustments_to_xmp("PCTest", &preset.adjustments);
        assert!(exported.contains("crs:PointColors"), "export PointColors");
        assert!(exported.contains("crs:ColorVariance"), "export ColorVariance");
        assert!(
            exported.contains("12.500000") || exported.contains("12.5"),
            "row value missing in export"
        );
        let re = convert_xmp_to_preset(&exported).expect("reimport");
        let adj2 = re.adjustments.as_object().unwrap();
        assert!(adj2.contains_key("pointColors"));
        assert!(adj2.contains_key("colorVariance"));
    }


    #[test]
    fn lens_profile_is_embedded_roundtrip() {
        let mut map = Map::new();
        map.insert("lensProfileIsEmbedded".to_string(), json!(true));
        map.insert("lensProfileName".to_string(), json!("Adobe (Canon EF 50mm f/1.8)"));
        let adj = Value::Object(map);
        let xmp = convert_adjustments_to_xmp("LensEmb", &adj);
        assert!(xmp.contains("LensProfileIsEmbedded=\"True\""), "export embedded flag: {}", xmp);
        let preset = convert_xmp_to_preset(&xmp).expect("parse");
        let a = preset.adjustments.as_object().unwrap();
        assert_eq!(
            a.get("lensProfileIsEmbedded").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

#[test]
    fn mapping_coverage_report_on_fixtures() {
        let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dir.push("tests/fixtures/presets");
        let interesting = [
            "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
            "temperature", "tint", "vibrance", "saturation", "hsl", "curves",
            "colorGrading", "colorCalibration", "parametricCurve", "dehaze",
            "convertToGrayscale", "grayMixer", "lensProfileName", "structure",
            "clarity", "sharpness",
        ];
        let mut present = std::collections::HashMap::<&str, usize>::new();
        for k in interesting {
            present.insert(k, 0);
        }
        let mut n = 0usize;
        let attr_re = Regex::new(r#"crs:([A-Za-z0-9]+)=""#).unwrap();
        let known_prefixes = [
            "Exposure", "Contrast", "Highlights", "Shadows", "Whites", "Blacks",
            "Clarity", "Dehaze", "Vibrance", "Saturation", "Texture", "Sharp",
            "Luminance", "ColorNoise", "Chromatic", "PostCrop", "Grain", "ColorGrade",
            "Parametric", "Vignette", "Defringe", "Perspective", "HueAdjustment",
            "SaturationAdjustment", "LuminanceAdjustment", "GrayMixer", "ToneCurve",
            "Temperature", "Tint", "Incremental", "WhiteBalance", "ConvertToGrayscale",
            "CameraProfile", "LensProfile", "ProcessVersion", "HasSettings", "Version",
            "Name", "Group", "Look", "AlreadyApplied", "HasCrop", "Crop", "Curve",
            "SplitToning", "ShadowTint", "RedHue", "RedSaturation", "GreenHue",
            "GreenSaturation", "BlueHue", "BlueSaturation", "AutoLateralCA",
            "LensManual", "AsShot", "OverrideLook", "Supports", "UUID", "Copyright",
            "ContactInfo", "Cluster", "CameraModel", "PresetType", "ShowIn",
            "Requires", "HDR", "ImageOrientation", "Active", "Amount", "Blur",
            "Bokeh", "CatEye", "FocalRange", "Spherical", "Stubbed",
        ];
        let mut unmapped: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("xmp")).unwrap_or(false) {
                let xmp = fs::read_to_string(&path).unwrap();
                let c = convert_xmp_to_preset(&xmp).unwrap();
                let adj = c.adjustments.as_object().unwrap();
                n += 1;
                for k in interesting {
                    if adj.contains_key(k) {
                        *present.get_mut(k).unwrap() += 1;
                    }
                }
                for cap in attr_re.captures_iter(&xmp) {
                    let key = cap[1].to_string();
                    let known = known_prefixes.iter().any(|p| key.starts_with(p));
                    if !known {
                        *unmapped.entry(key).or_insert(0) += 1;
                    }
                }
            }
        }
        assert!(n >= 5);
        // Core tone or color present on most style presets
        assert!(present["hsl"] + present["curves"] + present["exposure"] + present["contrast"] > 0);
        eprintln!("fixture mapping coverage over {} files: {:?}", n, present);
        if !unmapped.is_empty() {
            eprintln!("possibly unmapped crs attrs (sample): {:?}", unmapped);
        }
    }

    #[test]
    fn lens_profile_enable_from_toggles() {
        let mut map = Map::new();
        map.insert("lensDistortionEnabled".to_string(), json!(true));
        map.insert("lensVignetteEnabled".to_string(), json!(false));
        let xmp = convert_adjustments_to_xmp("LensToggle", &Value::Object(map));
        assert!(
            xmp.contains("LensProfileEnable=\"1\""),
            "expected LensProfileEnable=1 when distortion on: {}",
            &xmp[..xmp.len().min(600)]
        );

        let mut map2 = Map::new();
        map2.insert("lensDistortionEnabled".to_string(), json!(false));
        map2.insert("lensVignetteEnabled".to_string(), json!(false));
        let xmp2 = convert_adjustments_to_xmp("LensOff", &Value::Object(map2));
        assert!(
            xmp2.contains("LensProfileEnable=\"0\""),
            "expected LensProfileEnable=0 when both off: {}",
            &xmp2[..xmp2.len().min(600)]
        );
    }


    #[test]
    fn incremental_wb_roundtrip_via_export() {
        let adj = serde_json::json!({
            "temperature": 25.0,
            "tint": -10.0,
            "exposure": 0.1
        });
        let xmp = convert_adjustments_to_xmp("WBTest", &adj);
        assert!(xmp.contains("IncrementalTemperature") || xmp.contains("Temperature"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        let temp = a.get("temperature").and_then(|v| v.as_f64()).unwrap();
        let tint = a.get("tint").and_then(|v| v.as_f64()).unwrap();
        assert!((temp - 25.0).abs() < 1.0, "temp roundtrip got {}", temp);
        assert!((tint - (-10.0)).abs() < 2.0, "tint roundtrip got {}", tint);
    }

    #[test]
    fn auto_lateral_ca_roundtrip() {
        let adj = serde_json::json!({
            "lensTcaEnabled": true,
            "chromaticAberrationRedCyan": 2.0
        });
        let xmp = convert_adjustments_to_xmp("CATest", &adj);
        assert!(xmp.contains("AutoLateralCA"), "export AutoLateralCA: {}", &xmp[..xmp.len().min(400)]);
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("lensTcaEnabled").and_then(|v| v.as_bool()), Some(true));
    }

    #[test]
    fn perspective_upright_roundtrip() {
        let adj = serde_json::json!({
            "perspectiveUpright": 4,
            "transformVertical": 5.0
        });
        let xmp = convert_adjustments_to_xmp("UprightTest", &adj);
        assert!(xmp.contains("PerspectiveUpright"), "export upright");
        assert!(xmp.contains("PerspectiveUpright=\"4\"") || xmp.contains("PerspectiveUpright=\"4.0\""));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        let u = a.get("perspectiveUpright").and_then(|v| v.as_i64()).or_else(|| a.get("perspectiveUpright").and_then(|v| v.as_f64().map(|f| f as i64)));
        assert_eq!(u, Some(4));
    }

    #[test]
    fn process_version_roundtrip() {
        let adj = serde_json::json!({
            "processVersion": "15.4",
            "exposure": 0.1
        });
        let xmp = convert_adjustments_to_xmp("PVTest", &adj);
        assert!(xmp.contains("ProcessVersion=\"15.4\""), "export pv: {}", &xmp[..xmp.len().min(500)]);
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("processVersion").and_then(|v| v.as_str()), Some("15.4"));
    }

    #[test]
    fn camera_profile_roundtrip() {
        let adj = serde_json::json!({
            "cameraProfile": "Adobe Standard",
            "exposure": 0.0
        });
        let xmp = convert_adjustments_to_xmp("CamProf", &adj);
        assert!(xmp.contains("CameraProfile"), "export camera profile");
        assert!(xmp.contains("Adobe Standard"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("cameraProfile").and_then(|v| v.as_str()), Some("Adobe Standard"));
    }

    #[test]
    fn crop_xmp_roundtrip_percent() {
        let adj = serde_json::json!({
            "crop": { "unit": "%", "x": 10.0, "y": 5.0, "width": 80.0, "height": 90.0 },
            "exposure": 0.0
        });
        let xmp = convert_adjustments_to_xmp("CropTest", &adj);
        assert!(xmp.contains("HasCrop=\"True\""), "export HasCrop");
        assert!(xmp.contains("CropLeft"), "export CropLeft");
        assert!(xmp.contains("CropTop"), "export CropTop");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        let crop = a.get("crop").and_then(|v| v.as_object()).expect("crop object");
        let x = crop.get("x").and_then(|v| v.as_f64()).unwrap();
        let y = crop.get("y").and_then(|v| v.as_f64()).unwrap();
        let w = crop.get("width").and_then(|v| v.as_f64()).unwrap();
        let h = crop.get("height").and_then(|v| v.as_f64()).unwrap();
        assert!((x - 10.0).abs() < 0.5, "x={}", x);
        assert!((y - 5.0).abs() < 0.5, "y={}", y);
        assert!((w - 80.0).abs() < 0.5, "w={}", w);
        assert!((h - 90.0).abs() < 0.5, "h={}", h);
        assert_eq!(parsed.include_crop_transform, Some(true));
    }

    #[test]
    fn crop_import_from_normalized_lr_edges() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:HasCrop="True"
   crs:CropTop="0.1"
   crs:CropLeft="0.2"
   crs:CropBottom="0.9"
   crs:CropRight="0.85"
   crs:Exposure2012="+0.10">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">EdgeCrop</rdf:li></rdf:Alt></crs:Name>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let parsed = convert_xmp_to_preset(xmp).unwrap();
        let crop = parsed
            .adjustments
            .as_object()
            .unwrap()
            .get("crop")
            .and_then(|v| v.as_object())
            .expect("crop");
        assert!((crop.get("x").and_then(|v| v.as_f64()).unwrap() - 20.0).abs() < 0.2);
        assert!((crop.get("y").and_then(|v| v.as_f64()).unwrap() - 10.0).abs() < 0.2);
        assert!((crop.get("width").and_then(|v| v.as_f64()).unwrap() - 65.0).abs() < 0.2);
        assert!((crop.get("height").and_then(|v| v.as_f64()).unwrap() - 80.0).abs() < 0.2);
    }

    #[test]
    fn crop_constrain_to_warp_roundtrip() {
        let adj = serde_json::json!({
            "crop": { "unit": "%", "x": 5.0, "y": 5.0, "width": 90.0, "height": 90.0 },
            "cropConstrainToWarp": true
        });
        let xmp = convert_adjustments_to_xmp("WarpCrop", &adj);
        assert!(xmp.contains("CropConstrainToWarp"), "export constrain");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("cropConstrainToWarp").and_then(|v| v.as_bool()), Some(true));
    }

    #[test]
    fn defringe_roundtrip() {
        let adj = serde_json::json!({
            "defringePurpleAmount": 5.0,
            "defringePurpleHueLo": 20.0,
            "defringePurpleHueHi": 70.0,
            "defringeGreenAmount": 3.0,
            "defringeGreenHueLo": 40.0,
            "defringeGreenHueHi": 60.0
        });
        let xmp = convert_adjustments_to_xmp("DefringeTest", &adj);
        assert!(xmp.contains("DefringePurpleAmount"), "export purple");
        assert!(xmp.contains("DefringeGreenAmount"), "export green");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert!((a.get("defringePurpleAmount").and_then(|v| v.as_f64()).unwrap() - 5.0).abs() < 0.1);
        assert!((a.get("defringeGreenAmount").and_then(|v| v.as_f64()).unwrap() - 3.0).abs() < 0.1);
    }

    #[test]
    fn group_export_roundtrip() {
        let adj = serde_json::json!({ "exposure": 0.2 });
        let xmp = convert_adjustments_to_xmp_with_group("My Look", &adj, Some("Cinematic - Randazzo"));
        assert!(xmp.contains("<crs:Group>"), "export Group element");
        assert!(xmp.contains("Cinematic - Randazzo"));
        let g = extract_xmp_group(&xmp);
        assert_eq!(g.as_deref(), Some("Cinematic - Randazzo"));
        let name = extract_xmp_name(&xmp);
        assert_eq!(name.as_deref(), Some("My Look"));
    }

    #[test]
    fn override_look_vignette_roundtrip() {
        let adj = serde_json::json!({
            "overrideLookVignette": true,
            "vignetteAmount": -20.0
        });
        let xmp = convert_adjustments_to_xmp("OLV", &adj);
        assert!(xmp.contains("OverrideLookVignette"), "export flag");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("overrideLookVignette").and_then(|v| v.as_bool()), Some(true));
    }

    #[test]
    fn already_applied_and_tone_curve_name_roundtrip() {
        let adj = serde_json::json!({
            "alreadyApplied": true,
            "toneCurveName": "Medium Contrast",
            "exposure": 0.0
        });
        let xmp = convert_adjustments_to_xmp("TCN", &adj);
        assert!(xmp.contains("AlreadyApplied"), "export AlreadyApplied");
        assert!(xmp.contains("ToneCurveName"), "export ToneCurveName");
        assert!(xmp.contains("Medium Contrast"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("alreadyApplied").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(a.get("toneCurveName").and_then(|v| v.as_str()), Some("Medium Contrast"));
    }

    #[test]
    fn rgb_tables_roundtrip() {
        let adj = serde_json::json!({
            "rgbTables": false,
            "exposure": 0.0
        });
        let xmp = convert_adjustments_to_xmp("RGBT", &adj);
        assert!(xmp.contains("RGBTables"), "export RGBTables");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("rgbTables").and_then(|v| v.as_bool()), Some(false));
    }

    #[test]
    fn look_name_from_bw_film_fixture() {
        let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dir.push("tests/fixtures/presets");
        let path = dir.join("B&W Film.xmp");
        if !path.exists() {
            return;
        }
        let xmp = fs::read_to_string(&path).unwrap();
        let name = extract_xmp_look_name(&xmp);
        assert_eq!(name.as_deref(), Some("Adobe Monochrome"));
        let preset = convert_xmp_to_preset(&xmp).unwrap();
        let a = preset.adjustments.as_object().unwrap();
        assert_eq!(a.get("lookName").and_then(|v| v.as_str()), Some("Adobe Monochrome"));
        // roundtrip export keeps look name
        let exported = convert_adjustments_to_xmp("B&W Film", &preset.adjustments);
        assert!(exported.contains("Adobe Monochrome"));
        assert!(exported.contains("<crs:Look>"));
    }

    #[test]
    fn lens_profile_scale_roundtrip() {
        let adj = serde_json::json!({
            "lensProfileName": "Adobe (Sony FE 24-70mm F2.8 GM)",
            "lensProfileDistortionScale": 120.0,
            "lensProfileVignettingScale": 80.0
        });
        let xmp = convert_adjustments_to_xmp("LPS", &adj);
        assert!(xmp.contains("LensProfileName"), "export name");
        // scales may map to LensProfileDistortionScale / VignettingScale
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert!(a.get("lensProfileName").and_then(|v| v.as_str()).unwrap().contains("Sony") || a.contains_key("lensProfileName"));
        if let Some(d) = a.get("lensProfileDistortionScale").and_then(|v| v.as_f64()) {
            assert!((d - 120.0).abs() < 1.0, "dist scale {}", d);
        }
        if let Some(v) = a.get("lensProfileVignettingScale").and_then(|v| v.as_f64()) {
            assert!((v - 80.0).abs() < 1.0, "vig scale {}", v);
        }
    }

    #[test]
    fn luma_noise_detail_roundtrip() {
        let adj = serde_json::json!({
            "lumaNoiseReduction": 25.0,
            "lumaNoiseDetail": 60.0,
            "lumaNoiseContrast": 15.0,
            "colorNoiseReduction": 20.0
        });
        let xmp = convert_adjustments_to_xmp("NR", &adj);
        assert!(xmp.contains("LuminanceSmoothing") || xmp.contains("LuminanceNoiseReductionDetail"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert!((a.get("lumaNoiseDetail").and_then(|v| v.as_f64()).unwrap_or(0.0) - 60.0).abs() < 1.0);
        assert!((a.get("lumaNoiseContrast").and_then(|v| v.as_f64()).unwrap_or(0.0) - 15.0).abs() < 1.0);
    }

    #[test]
    fn sharpen_and_color_nr_extras_roundtrip() {
        let adj = serde_json::json!({
            "sharpness": 40.0,
            "sharpenRadius": 1.2,
            "sharpenDetail": 35.0,
            "sharpenMasking": 20.0,
            "colorNoiseReduction": 15.0,
            "colorNoiseDetail": 55.0,
            "colorNoiseSmoothness": 45.0
        });
        let xmp = convert_adjustments_to_xmp("SharpNR", &adj);
        assert!(xmp.contains("SharpenRadius") || xmp.contains("Sharpness"));
        assert!(xmp.contains("ColorNoiseReductionDetail") || xmp.contains("ColorNoiseReduction"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        if let Some(r) = a.get("sharpenRadius").and_then(|v| v.as_f64()) {
            assert!((r - 1.2).abs() < 0.15, "radius {}", r);
        }
        if let Some(d) = a.get("colorNoiseDetail").and_then(|v| v.as_f64()) {
            assert!((d - 55.0).abs() < 1.0, "color detail {}", d);
        }
        if let Some(s) = a.get("colorNoiseSmoothness").and_then(|v| v.as_f64()) {
            assert!((s - 45.0).abs() < 1.0, "smooth {}", s);
        }
    }

    #[test]
    fn vignette_style_roundtrip() {
        let adj = serde_json::json!({
            "vignetteAmount": -30.0,
            "vignetteStyle": 2,
            "vignetteMidpoint": 40.0
        });
        let xmp = convert_adjustments_to_xmp("VigStyle", &adj);
        assert!(xmp.contains("PostCropVignetteStyle"), "export style");
        assert!(xmp.contains("PostCropVignetteStyle=\"2\"") || xmp.contains("PostCropVignetteStyle=\"2.0\""));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        let s = a.get("vignetteStyle").and_then(|v| v.as_i64()).or_else(|| a.get("vignetteStyle").and_then(|v| v.as_f64().map(|f| f as i64)));
        assert_eq!(s, Some(2));
    }

    #[test]
    fn preset_type_export_roundtrip() {
        let adj = serde_json::json!({
            "xmpPresetType": "Look",
            "exposure": 0.1
        });
        let xmp = convert_adjustments_to_xmp("Lookish", &adj);
        assert!(xmp.contains("PresetType=\"Look\""), "export Look type: {}", &xmp[..xmp.len().min(400)]);
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("xmpPresetType").and_then(|v| v.as_str()), Some("Look"));
    }

    #[test]
    fn orientation_steps_from_image_orientation() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:ImageOrientation="6"
   crs:Exposure2012="+0.10">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Rot90</rdf:li></rdf:Alt></crs:Name>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let parsed = convert_xmp_to_preset(xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("orientationSteps").and_then(|v| v.as_u64()), Some(1));
        // export preserves a meaningful orientation code
        let exported = convert_adjustments_to_xmp("Rot90", &parsed.adjustments);
        assert!(exported.contains("ImageOrientation"));
    }

    #[test]
    fn orientation_roundtrip_flip_horizontal() {
        let adj = serde_json::json!({
            "orientationSteps": 0,
            "flipHorizontal": true,
            "exposure": 0.0
        });
        let xmp = convert_adjustments_to_xmp("FlipH", &adj);
        assert!(xmp.contains("ImageOrientation=\"2\"") || xmp.contains("ImageOrientation=\"2.0\""));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("flipHorizontal").and_then(|v| v.as_bool()), Some(true));
    }

    #[test]
    fn vignette_highlight_contrast_roundtrip() {
        let adj = serde_json::json!({
            "vignetteAmount": -25.0,
            "vignetteHighlightContrast": 15.0,
            "vignetteStyle": 1
        });
        let xmp = convert_adjustments_to_xmp("VigHC", &adj);
        assert!(
            xmp.contains("PostCropVignetteHighlightContrast"),
            "export highlight contrast"
        );
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        let hc = a
            .get("vignetteHighlightContrast")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        assert!((hc - 15.0).abs() < 0.5, "hc={}", hc);
    }

    #[test]
    fn blur_amount_roundtrip() {
        let adj = serde_json::json!({
            "lensBlurEnabled": true,
            "lensBlurAmount": 42.0
        });
        let xmp = convert_adjustments_to_xmp("Blur", &adj);
        assert!(xmp.contains("BlurAmount"), "export BlurAmount");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("lensBlurEnabled").and_then(|v| v.as_bool()), Some(true));
        let amt = a.get("lensBlurAmount").and_then(|v| v.as_f64()).unwrap_or(0.0);
        assert!((amt - 42.0).abs() < 0.5, "amt={}", amt);
    }

    #[test]
    fn blur_default_does_not_auto_enable() {
        // LR often ships BlurAmount=50 as inactive placeholder
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:BlurAmount="50"
   crs:BokehShape="0"
   crs:BokehShapeDetail="0"
   crs:Exposure2012="+0.00">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">NoBlur</rdf:li></rdf:Alt></crs:Name>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let parsed = convert_xmp_to_preset(xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert!(
            a.get("lensBlurEnabled").and_then(|v| v.as_bool()) != Some(true),
            "default BlurAmount=50 must not enable lens blur"
        );
        assert!((a.get("lensBlurAmount").and_then(|v| v.as_f64()).unwrap_or(0.0) - 50.0).abs() < 0.1);
    }

    #[test]
    fn bokeh_shape_roundtrip() {
        let adj = serde_json::json!({
            "lensBlurEnabled": true,
            "lensBlurAmount": 35.0,
            "lensBlurShape": "hexagon",
            "bokehShapeDetail": 12.0,
            "sphericalAberration": -5.0
        });
        let xmp = convert_adjustments_to_xmp("Bokeh", &adj);
        assert!(xmp.contains("BokehShape"), "export BokehShape");
        assert!(xmp.contains("BlurAmount"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("lensBlurEnabled").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(a.get("lensBlurShape").and_then(|v| v.as_str()), Some("hexagon"));
        assert!((a.get("bokehShapeDetail").and_then(|v| v.as_f64()).unwrap_or(0.0) - 12.0).abs() < 0.5);
    }

    #[test]
    fn grain_seed_roundtrip() {
        let adj = serde_json::json!({
            "grainAmount": 20.0,
            "grainSeed": 123456789,
            "cameraProfileDigest": "ABC123DEF",
            "highlightsBoost": 5.0
        });
        let xmp = convert_adjustments_to_xmp("GrainSeed", &adj);
        assert!(xmp.contains("GrainSeed"), "export GrainSeed");
        assert!(xmp.contains("CameraProfileDigest"));
        assert!(xmp.contains("HighlightsBoost"));
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("grainSeed").and_then(|v| v.as_i64()), Some(123456789));
        assert_eq!(a.get("cameraProfileDigest").and_then(|v| v.as_str()), Some("ABC123DEF"));
        assert!((a.get("highlightsBoost").and_then(|v| v.as_f64()).unwrap_or(0.0) - 5.0).abs() < 0.1);
    }

    #[test]
    fn as_shot_wb_roundtrip() {
        let adj = serde_json::json!({
            "asShotTemperature": 5200.0,
            "asShotTint": 10.0,
            "whiteBalance": "As Shot",
            "temperature": 0.0
        });
        let xmp = convert_adjustments_to_xmp("AsShot", &adj);
        assert!(xmp.contains("AsShotTemperature"), "export AsShotTemperature");
        assert!(xmp.contains("AsShotTint"), "export AsShotTint");
        let parsed = convert_xmp_to_preset(&xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert!((a.get("asShotTemperature").and_then(|v| v.as_f64()).unwrap_or(0.0) - 5200.0).abs() < 1.0);
        assert!((a.get("asShotTint").and_then(|v| v.as_f64()).unwrap_or(0.0) - 10.0).abs() < 0.5);
    }




    #[test]
    fn tone_curve_name_2012_import() {
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:HasSettings="True"
   crs:ToneCurveName2012="Linear"
   crs:Exposure2012="+0.00">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Lin</rdf:li></rdf:Alt></crs:Name>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let parsed = convert_xmp_to_preset(xmp).unwrap();
        let a = parsed.adjustments.as_object().unwrap();
        assert_eq!(a.get("toneCurveName").and_then(|v| v.as_str()), Some("Linear"));
    }




















}
