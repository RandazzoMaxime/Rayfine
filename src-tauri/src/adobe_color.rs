//! Adobe DNG / Camera Raw colour path for Lightroom matching.
//!
//! Camera-native linear RGB → CameraCalibration → WB (AsShotNeutral or
//! Temperature/Tint via ColorMatrix interpolation) → ForwardMatrix → XYZ D50 →
//! ProPhoto linear → optional LookTable → BaselineExposure + Exposure →
//! PV2010 Brightness/Contrast / named curve → sRGB display.
//!
//! Algorithms follow the DNG spec (illuminant interpolation, ForwardMatrix) and
//! the public DNG SDK temperature/tint model (Planckian + CIE 1960 tint).
//! HueSatMap is not present as a numeric table in the FiveK DNGs (tag 50932 is
//! a string); the 36×8×16 LookTable is applied when parsed.

use anyhow::{Result, anyhow};
use rayon::prelude::*;

use crate::scene_tone::{
    ToneSliders, apply_contrast, apply_local_tone, log_grey, luma, multi_scale_guided_luma,
};

/// ProPhoto RGB → XYZ D50 (IEC 61966-2-2 primaries, D50 white).
pub const PROPHOTO_TO_XYZ_D50: [f32; 9] = [
    0.797_674_9, 0.135_191_7, 0.031_353_4, 0.288_040_2, 0.711_874_1, 0.000_085_7, 0.0, 0.0,
    0.825_210_0,
];
/// XYZ D65 → linear sRGB (IEC 61966-2-1).
pub const XYZ_D65_TO_SRGB: [f32; 9] = [
    3.240_454_2, -1.537_138_5, -0.498_531_4, -0.969_266_0, 1.876_010_8, 0.041_556_0, 0.055_643_4,
    -0.204_025_9, 1.057_225_2,
];
/// Bradford D50 → D65.
pub const BRADFORD_D50_TO_D65: [f32; 9] = [
    0.955_576_6, -0.023_039_3, 0.063_163_6, -0.028_289_5, 1.009_941_6, 0.021_007_7, 0.012_298_2,
    -0.020_483_0, 1.329_909_8,
];

const ILLUMINANT_A_K: f32 = 2856.0;
const ILLUMINANT_D65_K: f32 = 6504.0;
/// DNG SDK `kTintScale` (dng_temperature.cpp): tint units along CIE 1960 v.
const TINT_SCALE: f32 = -3000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdobeStage {
    Wb,
    Profile,
    Exposure,
    Curve,
    Hs,
}

impl AdobeStage {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "wb" => Ok(Self::Wb),
            "profile" => Ok(Self::Profile),
            "exposure" => Ok(Self::Exposure),
            "curve" => Ok(Self::Curve),
            "hs" => Ok(Self::Hs),
            other => Err(anyhow!("unknown stage {other}")),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Wb => "wb",
            Self::Profile => "profile",
            Self::Exposure => "exposure",
            Self::Curve => "curve",
            Self::Hs => "hs",
        }
    }

    pub fn all() -> [Self; 5] {
        [Self::Wb, Self::Profile, Self::Exposure, Self::Curve, Self::Hs]
    }
}

#[derive(Clone, Debug)]
pub struct DngProfile {
    pub color_matrix1: [f32; 9],
    pub color_matrix2: [f32; 9],
    pub forward_matrix1: [f32; 9],
    pub forward_matrix2: [f32; 9],
    pub camera_cal1: [f32; 9],
    pub camera_cal2: [f32; 9],
    pub as_shot_neutral: [f32; 3],
    pub analog_balance: [f32; 3],
    pub baseline_exposure: f32,
    pub illuminant1_k: f32,
    pub illuminant2_k: f32,
    pub look_dims: [u32; 3],
    pub look_data: Vec<f32>,
    pub has_forward: bool,
    pub has_look: bool,
    pub has_hue_sat_map: bool,
    pub notes: Vec<String>,
}

impl Default for DngProfile {
    fn default() -> Self {
        Self {
            color_matrix1: identity3(),
            color_matrix2: identity3(),
            forward_matrix1: identity3(),
            forward_matrix2: identity3(),
            camera_cal1: identity3(),
            camera_cal2: identity3(),
            as_shot_neutral: [1.0, 1.0, 1.0],
            analog_balance: [1.0, 1.0, 1.0],
            baseline_exposure: 0.0,
            illuminant1_k: ILLUMINANT_A_K,
            illuminant2_k: ILLUMINANT_D65_K,
            look_dims: [0, 0, 0],
            look_data: Vec::new(),
            has_forward: false,
            has_look: false,
            has_hue_sat_map: false,
            notes: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct AdobeSettings {
    pub temperature_k: Option<f32>,
    pub tint: Option<f32>,
    pub use_as_shot: bool,
    pub exposure: f32,
    pub brightness: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub tone_curve: NamedCurve,
}

/// Adobe named tone curve. FiveK Expert C stores `Linear`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NamedCurve {
    #[default]
    Linear,
    MediumContrast,
}

impl NamedCurve {
    pub fn parse(s: &str) -> Self {
        match s {
            "Medium Contrast" | "MediumContrast" => Self::MediumContrast,
            _ => Self::Linear,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Linear => "Linear",
            Self::MediumContrast => "Medium Contrast",
        }
    }
}

pub fn identity3() -> [f32; 9] {
    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
}

#[inline]
pub fn mul3(m: [f32; 9], v: [f32; 3]) -> [f32; 3] {
    [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ]
}

pub fn invert3(m: [f32; 9]) -> Option<[f32; 9]> {
    let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if det.abs() < 1e-12 {
        return None;
    }
    let i = 1.0 / det;
    Some([
        (m[4] * m[8] - m[5] * m[7]) * i,
        (m[2] * m[7] - m[1] * m[8]) * i,
        (m[1] * m[5] - m[2] * m[4]) * i,
        (m[5] * m[6] - m[3] * m[8]) * i,
        (m[0] * m[8] - m[2] * m[6]) * i,
        (m[2] * m[3] - m[0] * m[5]) * i,
        (m[3] * m[7] - m[4] * m[6]) * i,
        (m[1] * m[6] - m[0] * m[7]) * i,
        (m[0] * m[4] - m[1] * m[3]) * i,
    ])
}

fn lerp9(a: [f32; 9], b: [f32; 9], t: f32) -> [f32; 9] {
    let mut o = [0.0; 9];
    for i in 0..9 {
        o[i] = a[i] + (b[i] - a[i]) * t;
    }
    o
}

fn illuminant_k(code: u16) -> f32 {
    match code {
        17 => ILLUMINANT_A_K,   // Standard A
        21 => ILLUMINANT_D65_K, // D65
        20 => 5503.0,           // D55
        23 => 7504.0,           // D75
        _ => ILLUMINANT_D65_K,
    }
}

/// Kang / CIE daylight-or-Planckian xy from CCT (public colour-science formulas).
pub fn cct_to_xy(cct: f32) -> [f32; 2] {
    let t = cct.clamp(2000.0, 25000.0);
    let t2 = t * t;
    let t3 = t2 * t;
    let x = if t <= 4000.0 {
        -0.266_123_9e9 / t3 - 0.234_358_0e6 / t2 + 0.877_695_6e3 / t + 0.179_910
    } else if t <= 7000.0 {
        -4.6070e9 / t3 + 2.9678e6 / t2 + 0.09911e3 / t + 0.244_063
    } else {
        -2.0064e9 / t3 + 1.9018e6 / t2 + 0.24748e3 / t + 0.237_040
    };
    let y = if t <= 2222.0 {
        -1.106_381_4 * x * x * x - 1.348_110_20 * x * x + 2.185_558_32 * x - 0.202_196_83
    } else if t <= 4000.0 {
        -0.954_947_6 * x * x * x - 1.374_185_93 * x * x + 2.091_370_15 * x - 0.167_488_67
    } else {
        3.081_758_0 * x * x * x - 5.873_386_70 * x * x + 3.751_129_97 * x - 0.370_201_68
    };
    [x as f32, y as f32]
}

fn xy_to_uv(xy: [f32; 2]) -> [f32; 2] {
    let d = -2.0 * xy[0] + 12.0 * xy[1] + 3.0;
    [4.0 * xy[0] / d, 6.0 * xy[1] / d]
}

fn uv_to_xy(uv: [f32; 2]) -> [f32; 2] {
    let d = 2.0 * uv[0] - 8.0 * uv[1] + 4.0;
    [3.0 * uv[0] / d, 2.0 * uv[1] / d]
}

/// DNG SDK temperature + tint → xy (Planckian locus + CIE 1960 v offset).
pub fn temp_tint_to_xy(temp_k: f32, tint: f32) -> [f32; 2] {
    let xy = cct_to_xy(temp_k);
    let uv = xy_to_uv(xy);
    uv_to_xy([uv[0], uv[1] + tint / TINT_SCALE])
}

pub fn xy_to_xyz(xy: [f32; 2]) -> [f32; 3] {
    let y = 1.0;
    let x = xy[0] * y / xy[1].max(1e-8);
    let z = (1.0 - xy[0] - xy[1]) * y / xy[1].max(1e-8);
    [x, y, z]
}

/// Inverse-CCT mix: 0 at illuminant2 (D65), 1 at illuminant1 (A). DNG spec 6.2.3.
pub fn illuminant_mix(temp_k: f32, k1: f32, k2: f32) -> f32 {
    let inv_t = 1.0 / temp_k.max(1.0);
    let inv_1 = 1.0 / k1.max(1.0);
    let inv_2 = 1.0 / k2.max(1.0);
    ((inv_t - inv_2) / (inv_1 - inv_2)).clamp(0.0, 1.0)
}

pub fn interpolated_color_matrix(profile: &DngProfile, temp_k: f32) -> [f32; 9] {
    let g = illuminant_mix(temp_k, profile.illuminant1_k, profile.illuminant2_k);
    lerp9(profile.color_matrix2, profile.color_matrix1, g)
}

pub fn interpolated_cal(profile: &DngProfile, temp_k: f32) -> [f32; 9] {
    let g = illuminant_mix(temp_k, profile.illuminant1_k, profile.illuminant2_k);
    lerp9(profile.camera_cal2, profile.camera_cal1, g)
}

pub fn interpolated_forward(profile: &DngProfile, temp_k: f32) -> [f32; 9] {
    let g = illuminant_mix(temp_k, profile.illuminant1_k, profile.illuminant2_k);
    lerp9(profile.forward_matrix2, profile.forward_matrix1, g)
}

/// Camera-space neutral (G-normalized) for a Temperature/Tint pair.
/// DNG SDK `NeutralToCamera`: CameraCalibration × ColorMatrix × XYZ(temp, tint).
pub fn neutral_from_temp_tint(profile: &DngProfile, temp_k: f32, tint: f32) -> [f32; 3] {
    let xyz = xy_to_xyz(temp_tint_to_xy(temp_k, tint));
    let cm = interpolated_color_matrix(profile, temp_k);
    let cal = interpolated_cal(profile, temp_k);
    let cam = mul3(cm, xyz);
    let cal_cam = mul3(cal, cam);
    let g = cal_cam[1].abs().max(1e-8);
    [cal_cam[0] / g, 1.0, cal_cam[2] / g]
}

/// White-balanced camera RGB ready for ForwardMatrix.
/// DNG: Inverse(AnalogBalance) × (camera / neutral), then Inverse(CameraCalibration).
fn prepared_camera(cam: [f32; 3], neutral: [f32; 3], cal: [f32; 9], analog: [f32; 3]) -> [f32; 3] {
    let cam_ab = [
        cam[0] / analog[0].max(1e-8),
        cam[1] / analog[1].max(1e-8),
        cam[2] / analog[2].max(1e-8),
    ];
    let wb = [
        cam_ab[0] / neutral[0].max(1e-8),
        cam_ab[1] / neutral[1].max(1e-8),
        cam_ab[2] / neutral[2].max(1e-8),
    ];
    let cal_inv = invert3(cal).unwrap_or(identity3());
    mul3(cal_inv, wb)
}

fn wb_and_forward(
    cam: [f32; 3],
    profile: &DngProfile,
    settings: AdobeSettings,
) -> ([f32; 3], [f32; 9]) {
    let temp = settings.temperature_k.unwrap_or(5500.0);
    let tint = settings.tint.unwrap_or(0.0);
    let neutral = if settings.use_as_shot {
        profile.as_shot_neutral
    } else {
        neutral_from_temp_tint(profile, temp, tint)
    };
    let cal = interpolated_cal(profile, temp);
    let prepared = prepared_camera(cam, neutral, cal, profile.analog_balance);
    let fm = if profile.has_forward {
        interpolated_forward(profile, temp)
    } else if let Some(inv) = invert3(interpolated_color_matrix(profile, temp)) {
        inv
    } else {
        identity3()
    };
    (prepared, fm)
}

pub fn camera_to_prophoto(wb_cam: [f32; 3], forward: [f32; 9]) -> [f32; 3] {
    let xyz_d50 = mul3(forward, wb_cam);
    let inv = invert3(PROPHOTO_TO_XYZ_D50).unwrap_or(identity3());
    mul3(inv, xyz_d50)
}

pub fn prophoto_to_srgb_linear(ppr: [f32; 3]) -> [f32; 3] {
    let xyz_d50 = mul3(PROPHOTO_TO_XYZ_D50, ppr);
    let xyz_d65 = mul3(BRADFORD_D50_TO_D65, xyz_d50);
    mul3(XYZ_D65_TO_SRGB, xyz_d65)
}

pub fn linear_to_srgb(x: f32) -> f32 {
    if x <= 0.0 {
        0.0
    } else if x <= 0.0031308 {
        12.92 * x
    } else {
        1.055 * x.powf(1.0 / 2.4) - 0.055
    }
}

pub fn encode_srgb(rgb: [f32; 3]) -> [f32; 3] {
    [
        linear_to_srgb(rgb[0]).clamp(0.0, 1.0),
        linear_to_srgb(rgb[1]).clamp(0.0, 1.0),
        linear_to_srgb(rgb[2]).clamp(0.0, 1.0),
    ]
}

/// ProPhoto encoding used by FiveK 16-bit TIFFs (gamma 1.8).
#[allow(dead_code)]
pub fn encode_prophoto_g18(x: f32) -> f32 {
    if x <= 0.0 {
        0.0
    } else {
        x.powf(1.0 / 1.8)
    }
}

fn rgb_to_hsv(rgb: [f32; 3]) -> [f32; 3] {
    let r = rgb[0].max(0.0);
    let g = rgb[1].max(0.0);
    let b = rgb[2].max(0.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let v = max;
    let d = max - min;
    let s = if max > 1e-8 { d / max } else { 0.0 };
    let h = if d < 1e-8 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / d) % 6.0)
    } else if max == g {
        60.0 * (((b - r) / d) + 2.0)
    } else {
        60.0 * (((r - g) / d) + 4.0)
    };
    let h = if h < 0.0 { h + 360.0 } else { h };
    [h, s, v]
}

fn hsv_to_rgb(hsv: [f32; 3]) -> [f32; 3] {
    let h = ((hsv[0] % 360.0) + 360.0) % 360.0;
    let s = hsv[1].clamp(0.0, 1.0);
    let v = hsv[2].max(0.0);
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    [r + m, g + m, b + m]
}

fn sample_look(profile: &DngProfile, hsv: [f32; 3]) -> [f32; 3] {
    let hd = profile.look_dims[0].max(1) as i32;
    let sd = profile.look_dims[1].max(1) as i32;
    let vd = profile.look_dims[2].max(1) as i32;
    if profile.look_data.len() < (hd * sd * vd * 3) as usize {
        return [0.0, 1.0, 1.0];
    }
    let hf = (hsv[0] / 360.0) * hd as f32;
    let sf = hsv[1].clamp(0.0, 1.0) * (sd - 1) as f32;
    let vf = hsv[2].clamp(0.0, 1.0) * (vd - 1) as f32;
    let h0 = hf.floor() as i32;
    let s0 = sf.floor() as i32;
    let v0 = vf.floor() as i32;
    let th = hf - h0 as f32;
    let ts = sf - s0 as f32;
    let tv = vf - v0 as f32;
    let mut acc = [0.0f32; 3];
    for (ih, wh) in [(0, 1.0 - th), (1, th)] {
        for (is, ws) in [(0, 1.0 - ts), (1, ts)] {
            for (iv, wv) in [(0, 1.0 - tv), (1, tv)] {
                let w = wh * ws * wv;
                if w <= 0.0 {
                    continue;
                }
                let hi = (h0 + ih).rem_euclid(hd);
                let si = (s0 + is).clamp(0, sd - 1);
                let vi = (v0 + iv).clamp(0, vd - 1);
                let idx = (((hi * sd + si) * vd + vi) * 3) as usize;
                acc[0] += profile.look_data[idx] * w;
                acc[1] += profile.look_data[idx + 1] * w;
                acc[2] += profile.look_data[idx + 2] * w;
            }
        }
    }
    acc
}

pub fn apply_look_table(profile: &DngProfile, rgb: [f32; 3]) -> [f32; 3] {
    if !profile.has_look {
        return rgb;
    }
    let hsv = rgb_to_hsv(rgb);
    let lut = sample_look(profile, hsv);
    hsv_to_rgb([hsv[0] + lut[0], hsv[1] * lut[1], hsv[2] * lut[2]])
}

/// Named Adobe curve. Medium Contrast is a mild S around 0.18 (PV2010 default).
pub fn apply_named_curve(rgb: [f32; 3], curve: NamedCurve) -> [f32; 3] {
    match curve {
        NamedCurve::Linear => rgb,
        NamedCurve::MediumContrast => apply_contrast(rgb, 0.22),
    }
}

/// PV2010 Brightness around mid-grey in ProPhoto linear (FiveK stores 0 as identity).
pub fn apply_pv2010_brightness(rgb: [f32; 3], brightness: f32) -> [f32; 3] {
    if brightness.abs() < 1e-6 {
        return rgb;
    }
    let y = luma(rgb).max(1e-8);
    // Midtone-weighted lift: 0 at 0/1, peak near 0.18–0.3.
    let w = 4.0 * (y / (y + 0.18)).min(1.0) * (1.0 - y).max(0.0);
    let gain = 2f32.powf((brightness / 100.0) * 0.8 * w);
    [rgb[0] * gain, rgb[1] * gain, rgb[2] * gain]
}

fn to_display(ppr: [f32; 3]) -> [f32; 3] {
    encode_srgb(prophoto_to_srgb_linear(ppr))
}

fn tone_sliders(settings: AdobeSettings) -> ToneSliders {
    ToneSliders::from_ui_full(
        0.0,
        settings.highlights,
        settings.shadows,
        settings.whites,
        settings.blacks,
        0.0,
    )
}

pub fn apply_adobe_pixel(
    cam: [f32; 3],
    profile: &DngProfile,
    settings: AdobeSettings,
    stage: AdobeStage,
) -> [f32; 3] {
    let (prepared, fm) = wb_and_forward(cam, profile, settings);
    if matches!(stage, AdobeStage::Wb) {
        // Honest “WB only”: white-balanced camera RGB shown as sRGB (no matrix).
        return encode_srgb(prepared);
    }
    let mut ppr = apply_look_table(profile, camera_to_prophoto(prepared, fm));
    if matches!(stage, AdobeStage::Profile) {
        return to_display(ppr);
    }
    let ev = profile.baseline_exposure + settings.exposure;
    ppr = [
        ppr[0] * 2f32.powf(ev),
        ppr[1] * 2f32.powf(ev),
        ppr[2] * 2f32.powf(ev),
    ];
    if matches!(stage, AdobeStage::Exposure) {
        return to_display(ppr);
    }
    ppr = apply_pv2010_brightness(ppr, settings.brightness);
    ppr = apply_named_curve(ppr, settings.tone_curve);
    ppr = apply_contrast(ppr, settings.contrast / 100.0);
    if matches!(stage, AdobeStage::Curve) {
        return to_display(ppr);
    }
    let sliders = tone_sliders(settings);
    if sliders.needs_local_mask() {
        ppr = apply_local_tone(ppr, log_grey(luma(ppr).max(1e-8)), sliders);
    }
    to_display(ppr)
}

/// Camera-native linear RGB → display sRGB through the requested Adobe stage.
/// Highlights/Shadows at `Hs` use the same multi-scale guided luma as `develop_image`.
pub fn develop_adobe_image(
    camera: &[[f32; 3]],
    width: usize,
    height: usize,
    profile: &DngProfile,
    settings: AdobeSettings,
    stage: AdobeStage,
) -> Vec<[f32; 3]> {
    let n = width * height;
    if matches!(stage, AdobeStage::Wb) {
        return camera[..n]
            .par_iter()
            .map(|p| apply_adobe_pixel(*p, profile, settings, AdobeStage::Wb))
            .collect();
    }
    let ev = profile.baseline_exposure + settings.exposure;
    let mut ppr: Vec<[f32; 3]> = camera[..n]
        .par_iter()
        .map(|cam| {
            let (prepared, fm) = wb_and_forward(*cam, profile, settings);
            apply_look_table(profile, camera_to_prophoto(prepared, fm))
        })
        .collect();
    if matches!(stage, AdobeStage::Profile) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    ppr.par_iter_mut().for_each(|p| {
        *p = [p[0] * 2f32.powf(ev), p[1] * 2f32.powf(ev), p[2] * 2f32.powf(ev)];
    });
    if matches!(stage, AdobeStage::Exposure) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    ppr.par_iter_mut().for_each(|p| {
        *p = apply_pv2010_brightness(*p, settings.brightness);
        *p = apply_named_curve(*p, settings.tone_curve);
        *p = apply_contrast(*p, settings.contrast / 100.0);
    });
    if matches!(stage, AdobeStage::Curve) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    let sliders = tone_sliders(settings);
    if sliders.needs_local_mask() {
        let lumas: Vec<f32> = ppr.iter().map(|p| luma(*p).max(1e-8)).collect();
        let mask = multi_scale_guided_luma(&lumas, width, height, true);
        ppr.iter_mut()
            .zip(mask.iter())
            .for_each(|(p, m)| *p = apply_local_tone(*p, log_grey(*m), sliders));
    }
    ppr.par_iter().map(|p| to_display(*p)).collect()
}

// --- DNG IFD parser (Adobe tags only) --------------------------------------

fn parse_ifd(data: &[u8], offset: usize, le: bool, seen: &mut Vec<usize>, out: &mut DngProfile) {
    if seen.contains(&offset) || offset + 2 > data.len() || seen.len() > 32 {
        return;
    }
    seen.push(offset);
    let n = read_u16(data, offset, le) as usize;
    let mut p = offset + 2;
    for _ in 0..n {
        if p + 12 > data.len() {
            break;
        }
        let tag = read_u16(data, p, le);
        let typ = read_u16(data, p + 2, le);
        let cnt = read_u32(data, p + 4, le) as usize;
        let val = read_u32(data, p + 8, le);
        let size = type_size(typ).saturating_mul(cnt);
        let raw = if size <= 4 {
            &data[p + 8..p + 8 + size.min(4)]
        } else if (val as usize).saturating_add(size) <= data.len() {
            &data[val as usize..val as usize + size]
        } else {
            &[]
        };
        match tag {
            330 | 34665 if typ == 4 => {
                let offs = read_u32_list(raw, le);
                for o in offs {
                    parse_ifd(data, o as usize, le, seen, out);
                }
            }
            50721 => out.color_matrix1 = read_srat9(raw, le),
            50722 => out.color_matrix2 = read_srat9(raw, le),
            50723 => out.camera_cal1 = read_srat9(raw, le),
            50724 => out.camera_cal2 = read_srat9(raw, le),
            50727 => {
                let n = read_rational_n(raw, le, 3);
                out.analog_balance = [n[0], n[1], n[2]];
            }
            50728 => {
                let n = read_rational_n(raw, le, 3);
                out.as_shot_neutral = [n[0], n[1], n[2]];
            }
            50730 => out.baseline_exposure = read_srat1(raw, le),
            50778 => out.illuminant1_k = illuminant_k(val as u16),
            50779 => out.illuminant2_k = illuminant_k(val as u16),
            50964 => {
                out.forward_matrix1 = read_srat9(raw, le);
                out.has_forward = true;
            }
            50965 => {
                out.forward_matrix2 = read_srat9(raw, le);
                out.has_forward = true;
            }
            50937 if typ == 4 && cnt >= 3 => {
                out.has_hue_sat_map = true;
            }
            50981 if typ == 4 && cnt >= 3 => {
                let d = read_u32_list(raw, le);
                if d.len() >= 3 {
                    out.look_dims = [d[0], d[1], d[2]];
                }
            }
            50982 if typ == 11 => {
                out.look_data = read_f32_list(raw, le);
                out.has_look = out.look_data.len() >= 6;
            }
            _ => {}
        }
        p += 12;
    }
    if p + 4 <= data.len() {
        let next = read_u32(data, p, le) as usize;
        if next > 0 {
            parse_ifd(data, next, le, seen, out);
        }
    }
}

fn type_size(typ: u16) -> usize {
    match typ {
        1 | 2 => 1,
        3 => 2,
        4 | 11 => 4,
        5 | 10 | 12 => 8,
        _ => 1,
    }
}

fn read_u16(data: &[u8], off: usize, le: bool) -> u16 {
    if off + 2 > data.len() {
        return 0;
    }
    let b = [data[off], data[off + 1]];
    if le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) }
}

fn read_u32(data: &[u8], off: usize, le: bool) -> u32 {
    if off + 4 > data.len() {
        return 0;
    }
    let b = [data[off], data[off + 1], data[off + 2], data[off + 3]];
    if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) }
}

fn read_i32(data: &[u8], off: usize, le: bool) -> i32 {
    if off + 4 > data.len() {
        return 0;
    }
    let b = [data[off], data[off + 1], data[off + 2], data[off + 3]];
    if le { i32::from_le_bytes(b) } else { i32::from_be_bytes(b) }
}

fn read_u32_list(raw: &[u8], le: bool) -> Vec<u32> {
    (0..raw.len() / 4).map(|i| read_u32(raw, i * 4, le)).collect()
}

fn read_f32_list(raw: &[u8], le: bool) -> Vec<f32> {
    (0..raw.len() / 4)
        .map(|i| {
            let b = [raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2], raw[i * 4 + 3]];
            if le {
                f32::from_le_bytes(b)
            } else {
                f32::from_be_bytes(b)
            }
        })
        .collect()
}

fn read_srat1(raw: &[u8], le: bool) -> f32 {
    if raw.len() < 8 {
        return 0.0;
    }
    let a = read_i32(raw, 0, le) as f64;
    let b = read_i32(raw, 4, le) as f64;
    if b.abs() < 1e-12 { 0.0 } else { (a / b) as f32 }
}

fn read_srat9(raw: &[u8], le: bool) -> [f32; 9] {
    let mut m = identity3();
    for i in 0..9 {
        let off = i * 8;
        if off + 8 <= raw.len() {
            let a = read_i32(raw, off, le) as f64;
            let b = read_i32(raw, off + 4, le) as f64;
            m[i] = if b.abs() < 1e-12 { 0.0 } else { (a / b) as f32 };
        }
    }
    m
}

fn read_rational_n(raw: &[u8], le: bool, n: usize) -> [f32; 3] {
    let mut o = [1.0, 1.0, 1.0];
    for i in 0..n.min(3) {
        let off = i * 8;
        if off + 8 <= raw.len() {
            let a = read_u32(raw, off, le) as f64;
            let b = read_u32(raw, off + 4, le) as f64;
            o[i] = if b.abs() < 1e-12 { 1.0 } else { (a / b) as f32 };
        }
    }
    o
}

pub fn parse_dng_profile(data: &[u8]) -> Result<DngProfile> {
    if data.len() < 8 {
        return Err(anyhow!("DNG too small"));
    }
    let le = data[0] == b'I';
    let off = read_u32(data, 4, le) as usize;
    let mut out = DngProfile::default();
    parse_ifd(data, off, le, &mut Vec::new(), &mut out);
    if !out.has_forward {
        out.notes
            .push("No ForwardMatrix; falling back to inverse ColorMatrix.".into());
    }
    if !out.has_look {
        out.notes
            .push("No ProfileLookTable; Adobe Standard look is missing.".into());
    }
    if !out.has_hue_sat_map {
        out.notes.push(
            "No numeric ProfileHueSatMap (DNG 50937/50938). FiveK Adobe Standard DNGs omit it; \
             only the 36×8×16 LookTable is applied. Residual colour error is expected."
                .into(),
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invert_identity() {
        let i = invert3(identity3()).unwrap();
        for k in 0..9 {
            assert!((i[k] - identity3()[k]).abs() < 1e-5);
        }
    }

    #[test]
    fn d65_xy_is_close() {
        let xy = cct_to_xy(6504.0);
        assert!((xy[0] - 0.3127).abs() < 0.02, "{xy:?}");
        assert!((xy[1] - 0.3290).abs() < 0.03, "{xy:?}");
    }

    #[test]
    fn illuminant_mix_endpoints() {
        assert!((illuminant_mix(2856.0, 2856.0, 6504.0) - 1.0).abs() < 1e-5);
        assert!(illuminant_mix(6504.0, 2856.0, 6504.0).abs() < 1e-5);
    }

    #[test]
    fn look_identity_sample_is_noop_scale() {
        let mut p = DngProfile::default();
        p.look_dims = [1, 1, 1];
        p.look_data = vec![0.0, 1.0, 1.0];
        p.has_look = true;
        let rgb = [0.4, 0.3, 0.2];
        let out = apply_look_table(&p, rgb);
        assert!((out[0] - rgb[0]).abs() < 0.02);
    }

    #[test]
    fn parse_fivek_forward_and_look() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/datasets/fivek/a0045-20050320_081337__E6B1177/raw.dng"
        );
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let p = parse_dng_profile(&bytes).expect("profile");
        assert!(p.has_forward);
        assert!(p.has_look);
        assert_eq!(p.look_dims, [36, 8, 16]);
        assert!((p.baseline_exposure - 0.35).abs() < 0.02);
        assert!((p.as_shot_neutral[1] - 1.0).abs() < 1e-4);
        assert!((p.camera_cal1[0] - 1.0454).abs() < 0.001);
        assert!(!p.has_hue_sat_map);
        let custom = neutral_from_temp_tint(&p, 4000.0, -31.0);
        assert!((custom[1] - 1.0).abs() < 1e-5);
        assert!(
            (custom[0] - p.as_shot_neutral[0]).abs() > 0.01,
            "custom={custom:?} as_shot={:?}",
            p.as_shot_neutral
        );
        let mid = apply_adobe_pixel(
            [0.2, 0.2, 0.2],
            &p,
            AdobeSettings {
                temperature_k: Some(4900.0),
                tint: Some(-5.0),
                exposure: 0.51,
                ..AdobeSettings::default()
            },
            AdobeStage::Exposure,
        );
        assert!(mid[0] > 0.0 && mid[0] < 1.0, "{mid:?}");
    }

    #[test]
    fn camera_cal_inverse_is_used() {
        let cal = [2.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.5];
        let out = prepared_camera([0.4, 0.2, 0.1], [1.0, 1.0, 1.0], cal, [1.0, 1.0, 1.0]);
        assert!((out[0] - 0.2).abs() < 1e-5);
        assert!((out[1] - 0.2).abs() < 1e-5);
        assert!((out[2] - 0.2).abs() < 1e-5);
    }

    #[test]
    fn named_curve_linear_is_identity() {
        let rgb = [0.2, 0.3, 0.4];
        assert_eq!(apply_named_curve(rgb, NamedCurve::Linear), rgb);
    }
}
