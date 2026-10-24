// Port of LightCraft's global develop (storytold/lightcraft, MIT / Apache-2.0).
//
// Copyright (c) 2026 ArtCraft Team and the LightCraft contributors
// Copyright (c) 2026 Rayfine contributors (integration)
//
// Licensed under MIT or Apache-2.0 (see THIRD_PARTY/lightcraft/).
// Keep in step with `lightcraft_develop.rs` and LightCraft 0.13.0
// (`finish.wgsl`, `tone.rs`, `colorops.rs`, `cct.rs`).
// Preview and export both include this file (same shader, no divergent copy).

const LC_GREY: f32 = 0.18;
const LC_SKIN: f32 = 0.7826612;
const LC_PI: f32 = 3.141592653589793;
const LC_TAU: f32 = 6.283185307179586;

const LC_SRGB_TO_REC: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(0.6274039, 0.06909729, 0.016391439),
    vec3<f32>(0.32928304, 0.9195404, 0.08801331),
    vec3<f32>(0.043313066, 0.011362316, 0.89559525)
);
const LC_REC_TO_SRGB: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(1.6604910, -0.12455047, -0.018150763),
    vec3<f32>(-0.58764114, 1.1328999, -0.10057890),
    vec3<f32>(-0.07284986, -0.008349423, 1.1187297)
);
const LC_OK_TO_LMS: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(0.61668844, 0.26514020, 0.100150645),
    vec3<f32>(0.36015907, 0.6358565, 0.20400432),
    vec3<f32>(0.023043294, 0.09903023, 0.6963247)
);
const LC_OK_FROM_LMS: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(2.1401404, -0.88483245, -0.04857906),
    vec3<f32>(-1.2463560, 2.1631727, -0.4544909),
    vec3<f32>(0.10643173, -0.2783616, 1.5023563)
);
const LC_OK_TO_LAB: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(0.21045426, 1.9779985, 0.025904037),
    vec3<f32>(0.7936178, -2.4285922, 0.78277177),
    vec3<f32>(-0.004072047, 0.4505937, -0.80867577)
);
const LC_OK_FROM_LAB: mat3x3<f32> = mat3x3<f32>(
    vec3<f32>(1.0, 1.0, 1.0),
    vec3<f32>(0.3963378, -0.10556134, -0.08948418),
    vec3<f32>(0.21580376, -0.063854175, -1.2914855)
);

// Sony DRO-off knots (CC0 pixls.us pool). Packed as (scene, display) pairs.
// Uploaded per photo when `camera == 2` (JPEG-fitted CameraTone). Default is Sony.
const SONY_DRO_OFF: array<vec2<f32>, 32> = array<vec2<f32>, 32>(
    vec2<f32>(0.01655, 0.01799), vec2<f32>(0.01970, 0.02376),
    vec2<f32>(0.02212, 0.03008), vec2<f32>(0.02469, 0.03634),
    vec2<f32>(0.02737, 0.04320), vec2<f32>(0.03049, 0.05044),
    vec2<f32>(0.03425, 0.05812), vec2<f32>(0.03824, 0.06667),
    vec2<f32>(0.04232, 0.07817), vec2<f32>(0.04658, 0.09059),
    vec2<f32>(0.05095, 0.10268), vec2<f32>(0.05550, 0.11731),
    vec2<f32>(0.05962, 0.13173), vec2<f32>(0.06409, 0.14529),
    vec2<f32>(0.06843, 0.15939), vec2<f32>(0.07314, 0.17363),
    vec2<f32>(0.07800, 0.18897), vec2<f32>(0.08298, 0.20502),
    vec2<f32>(0.08909, 0.22159), vec2<f32>(0.09693, 0.23964),
    vec2<f32>(0.10540, 0.26082), vec2<f32>(0.11579, 0.28882),
    vec2<f32>(0.12763, 0.31986), vec2<f32>(0.14079, 0.35198),
    vec2<f32>(0.15786, 0.39293), vec2<f32>(0.17949, 0.44101),
    vec2<f32>(0.20330, 0.49407), vec2<f32>(0.23466, 0.54244),
    vec2<f32>(0.27207, 0.60078), vec2<f32>(0.31673, 0.66533),
    vec2<f32>(0.38682, 0.74143), vec2<f32>(0.52622, 0.80307)
);

// Per-invocation CameraTone knots. Preview/export copies the uniform here
// before `lc_develop_linear` so this file (concatenated first) can stay
// independent of `GlobalAdjustments`.
var<private> LC_KNOTS: array<vec2<f32>, 32> = SONY_DRO_OFF;

fn lc_sstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn lc_lum2020(c: vec3<f32>) -> f32 {
    return c.x * 0.2627 + c.y * 0.6780 + c.z * 0.0593;
}

fn lc_log_lum(c: vec3<f32>) -> f32 {
    return log2(max(lc_lum2020(c), 1e-7) / LC_GREY);
}

fn lc_wrap(a: f32) -> f32 {
    return ((a + LC_PI) % LC_TAU + LC_TAU) % LC_TAU - LC_PI;
}

fn lc_srgb_to_rec(c: vec3<f32>) -> vec3<f32> {
    return LC_SRGB_TO_REC * c;
}

fn lc_rec_to_srgb(c: vec3<f32>) -> vec3<f32> {
    return LC_REC_TO_SRGB * c;
}

fn lc_oklab(c: vec3<f32>) -> vec3<f32> {
    let lms = LC_OK_TO_LMS * c;
    let cr = vec3<f32>(
        sign(lms.x) * pow(abs(lms.x), 1.0 / 3.0),
        sign(lms.y) * pow(abs(lms.y), 1.0 / 3.0),
        sign(lms.z) * pow(abs(lms.z), 1.0 / 3.0)
    );
    return LC_OK_TO_LAB * cr;
}

fn lc_oklab_inv(lab: vec3<f32>) -> vec3<f32> {
    let l = LC_OK_FROM_LAB * lab;
    return LC_OK_FROM_LMS * (l * l * l);
}

fn lc_apply_wb(c: vec3<f32>, m: mat3x3<f32>) -> vec3<f32> {
    return max(m * c, vec3<f32>(0.0));
}

// Process V2 Highlights / Shadows. `hh`/`ss` are −1..1; `base` is log-luma + EV.
fn lc_v2_hs_delta(base: f32, hh: f32, ss: f32) -> f32 {
    if (hh == 0.0 && ss == 0.0) {
        return 0.0;
    }
    let ws = 1.0 - lc_sstep(-4.8, 0.3, base);
    let wh = lc_sstep(-1.0, 2.8, base);
    return ss * 1.7 * ws * sqrt(ws) + hh * 1.7 * wh;
}

fn lc_tone_hdr(y: f32, contrast: f32, whites: f32, blacks: f32) -> f32 {
    if (y <= 0.0) {
        return 0.0;
    }
    let c = contrast / 100.0;
    let slope = select(1.0 + 0.4 * c, 1.0 + 0.55 * c, c >= 0.0);
    let white_ev = 2.9 - 1.6 * (whites / 100.0);
    let wl = LC_GREY * exp2(white_ev);
    let pre = 1.0 + LC_GREY / wl;
    let ev = log2(max(y, 1e-20) / LC_GREY);
    let yy = LC_GREY * exp2(ev * slope) * pre;
    var o = yy * (1.0 + yy / (wl * wl)) / (1.0 + yy);
    o = min(o, 1.0);
    let b = blacks / 100.0;
    if (b < 0.0) {
        let k = -b * 0.035;
        let e = 0.004;
        let soft = (o - k) + sqrt((o - k) * (o - k) + e * e);
        let soft0 = (0.0 - k) + sqrt((0.0 - k) * (0.0 - k) + e * e);
        let soft1 = (1.0 - k) + sqrt((1.0 - k) * (1.0 - k) + e * e);
        o = (soft * 0.5 - soft0 * 0.5) / max(soft1 * 0.5 - soft0 * 0.5, 1e-8);
    } else if (b > 0.0) {
        let k = b * 0.03;
        o = k + (1.0 - k) * o;
    }
    return clamp(o, 0.0, 1.0);
}

fn lc_tone_display(y: f32, contrast: f32, whites: f32, blacks: f32) -> f32 {
    if (y <= 0.0) {
        return 0.0;
    }
    let c = contrast / 100.0;
    let w = whites / 100.0;
    let b = blacks / 100.0;
    let m = pow(LC_GREY, 1.0 / 2.2);
    let neutral = (c == 0.0 && w == 0.0 && b == 0.0);
    var p = pow(y, 1.0 / 2.2);
    if (p <= 1.0) {
        p += c * 0.35 * (p - m) * (1.0 - pow(2.0 * p - 1.0, 2.0));
        let up = lc_sstep(0.45, 1.0, p);
        p += w * 0.12 * up * (1.0 - p * 0.5);
        let lo = 1.0 - lc_sstep(0.0, 0.45, p);
        p += b * 0.07 * lo * min(p * 2.0, 1.0);
    } else {
        p += w * 0.12 * 0.5;
    }
    var o = pow(max(p, 0.0), 2.2);
    if (o > 0.95 && !neutral) {
        let d = min(o - 0.95, 0.1);
        o = 0.95 + d - d * d / 0.2;
    }
    return clamp(o, 0.0, 1.0);
}

fn lc_camera_tone(y: f32) -> f32 {
    if (y <= 0.0) {
        return 0.0;
    }
    var previous = vec2<f32>(0.0, 0.0);
    for (var i = 0u; i < 32u; i = i + 1u) {
        let p = LC_KNOTS[i];
        if (y <= p.x) {
            let t = (y - previous.x) / max(p.x - previous.x, 1e-8);
            return previous.y + t * (p.y - previous.y);
        }
        previous = p;
    }
    let a = LC_KNOTS[30];
    let b = LC_KNOTS[31];
    let slope = clamp((b.y - a.y) / max(b.x - a.x, 1e-8), 0.1, 16.0);
    return 1.0 - (1.0 - b.y) * exp(-(y - b.x) * slope / max(1.0 - b.y, 0.01));
}

fn lc_tone_apply(y: f32, contrast: f32, whites: f32, blacks: f32, camera: u32) -> f32 {
    if (camera == 1u || camera == 2u) {
        let mapped = lc_camera_tone(y);
        if (contrast == 0.0 && whites == 0.0 && blacks == 0.0) {
            return mapped;
        }
        return lc_tone_display(mapped, contrast, whites, blacks);
    }
    return lc_tone_hdr(y, contrast, whites, blacks);
}

fn lc_highlight_desat(d: vec3<f32>, o: f32) -> vec3<f32> {
    let mx = max(d.x, max(d.y, d.z));
    if (mx > 1.0) {
        let t = clamp((mx - 1.0) / max(mx - o, 1e-6), 0.0, 1.0);
        return d + (vec3<f32>(o) - d) * t;
    }
    return d;
}

fn lc_vibrance_sat(rgb: vec3<f32>, vibrance: f32, saturation: f32) -> vec3<f32> {
    if (vibrance == 0.0 && saturation == 0.0) {
        return rgb;
    }
    let vib = vibrance / 100.0;
    let sat = saturation / 100.0;
    var lab = lc_oklab(rgb);
    let c0 = sqrt(lab.y * lab.y + lab.z * lab.z);
    var c = c0;
    if (vib != 0.0) {
        let low = 1.0 - clamp(c / 0.22, 0.0, 1.0);
        var skin = 1.0;
        if (vib > 0.0) {
            let q = lc_wrap(atan2(lab.z, lab.y) - LC_SKIN) / 0.35;
            skin = 1.0 - 0.6 * exp(-(q * q));
        }
        c *= max(1.0 + vib * low * low * skin * 1.2, 0.0);
    }
    if (sat != 0.0) {
        c *= max(1.0 + sat, 0.0);
    }
    if (c0 > 0.0) {
        let k = c / c0;
        lab = vec3<f32>(lab.x, lab.y * k, lab.z * k);
    }
    return lc_oklab_inv(lab);
}

fn lc_encode_srgb(v: f32) -> f32 {
    if (v <= 0.0) {
        return 0.0;
    }
    if (v <= 0.0031308) {
        return v * 12.92;
    }
    return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn lc_encode_srgb3(c: vec3<f32>) -> vec3<f32> {
    return clamp(vec3<f32>(lc_encode_srgb(c.x), lc_encode_srgb(c.y), lc_encode_srgb(c.z)), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Linear sRGB in → display-linear sRGB out (no encode). Slider units are
// Lightroom −100..100 (exposure in EV). `wb` is the CPU-built Bradford matrix.
fn lc_develop_linear(
    rgb_srgb: vec3<f32>,
    mask_luma: f32,
    exposure: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    contrast: f32,
    vibrance: f32,
    saturation: f32,
    wb: mat3x3<f32>,
    camera: u32
) -> vec3<f32> {
    var c = lc_srgb_to_rec(rgb_srgb);
    c = lc_apply_wb(c, wb);
    c = c * exp2(exposure);
    let base = log2(max(mask_luma, 1e-7) / LC_GREY) + exposure;
    let delta = lc_v2_hs_delta(base, highlights / 100.0, shadows / 100.0);
    if (delta != 0.0) {
        c = c * exp2(delta);
    }
    let yl = lc_lum2020(c);
    let o = lc_tone_apply(yl, contrast, whites, blacks, camera);
    var d = vec3<f32>(0.0);
    if (yl > 1e-9) {
        d = c * (o / yl);
    }
    d = lc_highlight_desat(d, o);
    d = lc_vibrance_sat(d, vibrance, saturation);
    return lc_rec_to_srgb(d);
}

fn lc_develop(
    rgb_srgb: vec3<f32>,
    mask_luma: f32,
    exposure: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    contrast: f32,
    vibrance: f32,
    saturation: f32,
    wb: mat3x3<f32>,
    camera: u32
) -> vec3<f32> {
    return lc_encode_srgb3(lc_develop_linear(
        rgb_srgb, mask_luma, exposure, highlights, shadows, whites, blacks,
        contrast, vibrance, saturation, wb, camera
    ));
}
