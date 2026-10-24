//! Adobe DNG / Camera Raw colour path for Lightroom matching.
//!
//! Camera-native linear RGB → CameraCalibration → WB (AsShotNeutral or
//! Temperature/Tint via ColorMatrix interpolation) → ForwardMatrix → XYZ D50 →
//! ProPhoto linear → HueSatMap → BaselineExposure + Exposure → LookTable →
//! ProfileToneCurve → PV2012 curves / HSL → Highlights/Shadows → sRGB.
//!
//! HSV tables follow DNG spec ch. 6 / LightCraft's public algorithm (MIT/Apache-2.0
//! approach, original Rayfine code): value-major, hue-middle, sat-minor; encoding 1
//! indexes value through the sRGB transfer; HueSatMap is interpolated with the
//! same illuminant weight as the matrices. Sidecar `.dcp` from Adobe DNG Converter
//! is merged when present (not shipped; see `bench/lr-compare/fetch_adobe_dcp.py`).

use anyhow::{Result, anyhow};
use flate2::read::ZlibDecoder;
use rayon::prelude::*;
use std::io::Read;
use std::path::{Path, PathBuf};

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
    /// ColorMatrix / ForwardMatrix only (no HueSatMap / Look / tone / BE).
    Matrix,
    /// + interpolated ProfileHueSatMap.
    HueSat,
    /// + BaselineExposure (no user Exposure).
    Baseline,
    /// + ProfileLookTable after BaselineExposure (DNG ch. 6 order).
    Look,
    /// + ProfileToneCurve (linear 0..1, Fritsch–Carlson).
    Tone,
    /// Legacy alias: matrix + HueSatMap + Look + ProfileToneCurve (BE skipped).
    Profile,
    Exposure,
    Curve,
    Color,
    Hs,
    /// Full user sliders after the profile stack (same as [`Self::Hs`]).
    Sliders,
}

impl AdobeStage {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "wb" => Ok(Self::Wb),
            "matrix" => Ok(Self::Matrix),
            "huesat" | "huesatmap" => Ok(Self::HueSat),
            "baseline" => Ok(Self::Baseline),
            "look" => Ok(Self::Look),
            "tone" => Ok(Self::Tone),
            "profile" => Ok(Self::Profile),
            "exposure" => Ok(Self::Exposure),
            "curve" => Ok(Self::Curve),
            "color" => Ok(Self::Color),
            "hs" => Ok(Self::Hs),
            "sliders" => Ok(Self::Sliders),
            other => Err(anyhow!("unknown stage {other}")),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Wb => "wb",
            Self::Matrix => "matrix",
            Self::HueSat => "huesat",
            Self::Baseline => "baseline",
            Self::Look => "look",
            Self::Tone => "tone",
            Self::Profile => "profile",
            Self::Exposure => "exposure",
            Self::Curve => "curve",
            Self::Color => "color",
            Self::Hs => "hs",
            Self::Sliders => "sliders",
        }
    }

    pub fn all() -> [Self; 6] {
        [
            Self::Wb,
            Self::Profile,
            Self::Exposure,
            Self::Curve,
            Self::Color,
            Self::Hs,
        ]
    }

    /// Profile-layer ablation: matrix, +HueSatMap, +BaselineExposure, +LookTable,
    /// +ProfileToneCurve, +curseurs. Look follows BaselineExposure (DNG / LightCraft).
    pub fn profile_layers() -> [Self; 6] {
        [
            Self::Matrix,
            Self::HueSat,
            Self::Baseline,
            Self::Look,
            Self::Tone,
            Self::Sliders,
        ]
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
    pub baseline_exposure_offset: f32,
    pub illuminant1_k: f32,
    pub illuminant2_k: f32,
    pub look_dims: [u32; 3],
    pub look_data: Vec<f32>,
    pub look_encoding: u32,
    pub hue_sat_dims: [u32; 3],
    pub hue_sat_data1: Vec<f32>,
    pub hue_sat_data2: Vec<f32>,
    pub hue_sat_encoding: u32,
    pub tone_curve: Vec<[f32; 2]>,
    pub profile_name: String,
    pub unique_camera_model: String,
    pub dcp_source: String,
    pub look_name: String,
    pub look_uuid: String,
    pub look_source: String,
    pub look_amount: f32,
    pub rgb_lut_div: u32,
    pub rgb_lut: Vec<f32>,
    pub rgb_primaries: u32,
    pub rgb_gamma: u32,
    pub has_rgb_lut: bool,
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
            baseline_exposure_offset: 0.0,
            illuminant1_k: ILLUMINANT_A_K,
            illuminant2_k: ILLUMINANT_D65_K,
            look_dims: [0, 0, 0],
            look_data: Vec::new(),
            look_encoding: 0,
            hue_sat_dims: [0, 0, 0],
            hue_sat_data1: Vec::new(),
            hue_sat_data2: Vec::new(),
            hue_sat_encoding: 0,
            tone_curve: Vec::new(),
            profile_name: String::new(),
            unique_camera_model: String::new(),
            dcp_source: String::new(),
            look_name: String::new(),
            look_uuid: String::new(),
            look_source: String::new(),
            look_amount: 1.0,
            rgb_lut_div: 0,
            rgb_lut: Vec::new(),
            rgb_primaries: 2,
            rgb_gamma: 0,
            has_rgb_lut: false,
            has_forward: false,
            has_look: false,
            has_hue_sat_map: false,
            notes: Vec::new(),
        }
    }
}

impl DngProfile {
    pub fn total_baseline_ev(&self) -> f32 {
        self.baseline_exposure + self.baseline_exposure_offset
    }
}

#[derive(Clone, Copy, Debug)]
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
    pub vibrance: f32,
    pub saturation: f32,
    pub dehaze: f32,
    pub clarity: f32,
    pub texture: f32,
    pub parametric_shadows: f32,
    pub parametric_darks: f32,
    pub parametric_lights: f32,
    pub parametric_highlights: f32,
    pub parametric_shadow_split: f32,
    pub parametric_mid_split: f32,
    pub parametric_highlight_split: f32,
    pub hsl: [f32; 24],
    pub red_hue: f32,
    pub red_sat: f32,
    pub green_hue: f32,
    pub green_sat: f32,
    pub blue_hue: f32,
    pub blue_sat: f32,
    pub tone_curve: NamedCurve,
    pub tone_curve_pv2012: [(f32, f32); 8],
    pub tone_curve_len: usize,
    /// False when XMP `CameraProfile` is ACR 4.x (ColorMatrix + CAT, no LookTable).
    pub use_forward_matrix: bool,
    pub apply_look: bool,
}

impl Default for AdobeSettings {
    fn default() -> Self {
        Self {
            temperature_k: None,
            tint: None,
            use_as_shot: false,
            exposure: 0.0,
            brightness: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            vibrance: 0.0,
            saturation: 0.0,
            dehaze: 0.0,
            clarity: 0.0,
            texture: 0.0,
            parametric_shadows: 0.0,
            parametric_darks: 0.0,
            parametric_lights: 0.0,
            parametric_highlights: 0.0,
            parametric_shadow_split: 25.0,
            parametric_mid_split: 50.0,
            parametric_highlight_split: 75.0,
            hsl: [0.0; 24],
            red_hue: 0.0,
            red_sat: 0.0,
            green_hue: 0.0,
            green_sat: 0.0,
            blue_hue: 0.0,
            blue_sat: 0.0,
            tone_curve: NamedCurve::Linear,
            tone_curve_pv2012: [(0.0, 0.0); 8],
            tone_curve_len: 0,
            use_forward_matrix: true,
            apply_look: true,
        }
    }
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

fn mul9(a: [f32; 9], b: [f32; 9]) -> [f32; 9] {
    [
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
        a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
        a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
        a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
        a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
        a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
        a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ]
}

/// Bradford CAT from `src_white` XYZ to D50.
pub fn bradford_to_d50(src_white: [f32; 3]) -> [f32; 9] {
    const BRADFORD: [f32; 9] = [
        0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296,
    ];
    const D50: [f32; 3] = [0.964_22, 1.0, 0.825_21];
    let b_inv = invert3(BRADFORD).unwrap_or(identity3());
    let src = mul3(BRADFORD, src_white);
    let dst = mul3(BRADFORD, D50);
    let scale = [
        dst[0] / src[0].max(1e-8),
        0.0,
        0.0,
        0.0,
        dst[1] / src[1].max(1e-8),
        0.0,
        0.0,
        0.0,
        dst[2] / src[2].max(1e-8),
    ];
    mul9(b_inv, mul9(scale, BRADFORD))
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
) -> ([f32; 3], f32) {
    let temp = settings.temperature_k.unwrap_or(5500.0);
    let tint = settings.tint.unwrap_or(0.0);
    let neutral = if settings.use_as_shot {
        profile.as_shot_neutral
    } else {
        neutral_from_temp_tint(profile, temp, tint)
    };
    let cal = interpolated_cal(profile, temp);
    let prepared = prepared_camera(cam, neutral, cal, profile.analog_balance);
    (prepared, temp)
}

#[allow(dead_code)]
pub fn camera_to_prophoto(wb_cam: [f32; 3], forward: [f32; 9]) -> [f32; 3] {
    let xyz_d50 = mul3(forward, wb_cam);
    let inv = invert3(PROPHOTO_TO_XYZ_D50).unwrap_or(identity3());
    mul3(inv, xyz_d50)
}

fn vendor_single_illuminant(profile: &DngProfile) -> bool {
    !profile.has_forward
        && (0..9).all(|i| (profile.color_matrix1[i] - profile.color_matrix2[i]).abs() < 1e-6)
}

fn color_matrix_for_xyz(profile: &DngProfile, temp: f32) -> [f32; 9] {
    let cm = interpolated_color_matrix(profile, temp);
    if vendor_single_illuminant(profile) {
        normalize_xyz2cam(cm, xy_to_xyz(cct_to_xy(ILLUMINANT_D65_K)))
    } else {
        cm
    }
}

fn camera_to_prophoto_settings(
    prepared: [f32; 3],
    profile: &DngProfile,
    settings: AdobeSettings,
    temp: f32,
) -> [f32; 3] {
    let xyz_d50 = if settings.use_forward_matrix && profile.has_forward {
        mul3(interpolated_forward(profile, temp), prepared)
    } else if let Some(inv) = invert3(color_matrix_for_xyz(profile, temp)) {
        let xyz_illum = mul3(inv, prepared);
        // A single rawler D65 ColorMatrix already yields XYZ D65. CAT from the
        // user's CCT would double-adapt and destroy chroma (measured IR ΔE +10–20).
        let src_white = if vendor_single_illuminant(profile) {
            xy_to_xyz(cct_to_xy(ILLUMINANT_D65_K))
        } else {
            xy_to_xyz(cct_to_xy(temp))
        };
        let cat = bradford_to_d50(src_white);
        mul3(cat, xyz_illum)
    } else {
        prepared
    };
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

/// DNG ch. 6: value-major, hue-middle, saturation-minor.
fn hsv_entry(dims: [u32; 3], data: &[f32], h: usize, s: usize, v: usize) -> [f32; 3] {
    let hd = dims[0] as usize;
    let sd = dims[1] as usize;
    let idx = ((v * hd + h) * sd + s) * 3;
    if idx + 2 >= data.len() {
        return [0.0, 1.0, 1.0];
    }
    [data[idx], data[idx + 1], data[idx + 2]]
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn sample_hsv_table(dims: [u32; 3], data: &[f32], h: f32, s: f32, v: f32) -> [f32; 3] {
    let hd = dims[0].max(1) as usize;
    let sd = dims[1].max(2) as usize;
    let vd = dims[2].max(1) as usize;
    if data.len() < hd * sd * vd * 3 {
        return [0.0, 1.0, 1.0];
    }
    let hf = (h.rem_euclid(360.0) / 360.0 * hd as f32).clamp(0.0, hd as f32);
    let h0 = (hf as usize).min(hd - 1);
    let h1 = (h0 + 1) % hd;
    let th = (hf - h0 as f32).clamp(0.0, 1.0);
    let axis = |x: f32, n: usize| {
        let f = x.clamp(0.0, 1.0) * (n.saturating_sub(1)) as f32;
        let i0 = (f as usize).min(n.saturating_sub(2));
        let i1 = (i0 + 1).min(n - 1);
        (i0, i1, (f - i0 as f32).clamp(0.0, 1.0))
    };
    let (s0, s1, ts) = axis(s, sd);
    let (v0, v1, tv) = if vd > 1 {
        axis(v, vd)
    } else {
        (0, 0, 0.0)
    };
    let plane = |vi: usize| {
        let lo = lerp3(hsv_entry(dims, data, h0, s0, vi), hsv_entry(dims, data, h0, s1, vi), ts);
        let hi = lerp3(hsv_entry(dims, data, h1, s0, vi), hsv_entry(dims, data, h1, s1, vi), ts);
        lerp3(lo, hi, th)
    };
    if v0 == v1 {
        plane(v0)
    } else {
        lerp3(plane(v0), plane(v1), tv)
    }
}

/// Scale that never raises a value already above 1 (highlight headroom).
fn limited_scale(x: f32, scale: f32) -> f32 {
    if x <= 1.0 {
        (x * scale).min(1.0)
    } else {
        x * scale.min(1.0)
    }
}

/// Apply a DNG HSV table in linear ProPhoto. Encoding 1 indexes value via sRGB.
pub fn apply_hsv_table(dims: [u32; 3], data: &[f32], encoding: u32, rgb: [f32; 3]) -> [f32; 3] {
    let max = rgb[0].max(rgb[1]).max(rgb[2]);
    if !max.is_finite() || max <= 0.0 {
        return rgb;
    }
    let min = rgb[0].min(rgb[1]).min(rgb[2]);
    let d = max - min;
    let hsv = rgb_to_hsv(rgb);
    let srgb_value = encoding == 1 && dims[2] > 1;
    let v_index = if srgb_value {
        linear_to_srgb(max.min(1.0))
    } else {
        max
    };
    let lut = sample_hsv_table(dims, data, hsv[0], if max > 1e-8 { d / max } else { 0.0 }, v_index);
    let s2 = limited_scale(if max > 1e-8 { d / max } else { 0.0 }, lut[1].max(0.0));
    let v2 = if srgb_value && max <= 1.0 {
        if (lut[2] - 1.0).abs() < 1e-6 {
            max
        } else {
            srgb_to_linear((v_index * lut[2]).min(1.0))
        }
    } else if srgb_value {
        max * srgb_to_linear(lut[2].min(1.0)).min(1.0)
    } else {
        limited_scale(max, lut[2].max(0.0))
    };
    hsv_to_rgb([hsv[0] + lut[0], s2, v2])
}

fn srgb_to_linear(x: f32) -> f32 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    }
}

pub fn apply_look_table(profile: &DngProfile, rgb: [f32; 3]) -> [f32; 3] {
    if !profile.has_look {
        return rgb;
    }
    apply_hsv_table(profile.look_dims, &profile.look_data, profile.look_encoding, rgb)
}

/// Adobe DNG SDK `kDecodeTable` (dng_big_table::DecodeFromString). Indexed by `ch - 32`.
const ADOBE_B85_DECODE: [u8; 96] = [
    0xFF, 0x44, 0xFF, 0x54, 0x53, 0x52, 0xFF, 0x49, 0x4B, 0x4C, 0x46, 0x41, 0xFF, 0x3F, 0x3E, 0x45,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x40, 0xFF, 0xFF, 0x42, 0xFF, 0x47,
    0x51, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32,
    0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x4D, 0xFF, 0x4E, 0x43, 0xFF,
    0x48, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x4F, 0x4A, 0x50, 0xFF, 0xFF,
];

/// Decode Adobe XMP base85 (DNG `dng_big_table`) into the compressed block.
pub fn adobe_base85_decode(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut phase = 0u32;
    let mut value = 0u32;
    for ch in text.chars() {
        let e = ch as u32;
        if !(32..=127).contains(&e) {
            continue;
        }
        let d = ADOBE_B85_DECODE[(e - 32) as usize];
        if d > 85 {
            continue;
        }
        phase += 1;
        match phase {
            1 => value = d as u32,
            2 => value += d as u32 * 85,
            3 => value += d as u32 * 85 * 85,
            4 => value += d as u32 * 85 * 85 * 85,
            _ => {
                value += d as u32 * 85 * 85 * 85 * 85;
                out.extend_from_slice(&value.to_le_bytes());
                phase = 0;
            }
        }
    }
    if phase > 1 {
        out.extend_from_slice(&value.to_le_bytes()[..(phase as usize - 1)]);
    }
    out
}

fn inflate_big_table(compressed: &[u8]) -> Result<Vec<u8>> {
    if compressed.len() < 5 {
        return Err(anyhow!("look table payload too short"));
    }
    let expected = u32::from_le_bytes(compressed[0..4].try_into().unwrap()) as usize;
    let mut decoder = ZlibDecoder::new(&compressed[4..]);
    let mut decoded = Vec::with_capacity(expected);
    decoder.read_to_end(&mut decoded)?;
    if decoded.len() != expected {
        return Err(anyhow!(
            "look zlib length mismatch: expected {expected}, got {}",
            decoded.len()
        ));
    }
    Ok(decoded)
}

fn read_u32_at(data: &[u8], off: usize) -> Option<u32> {
    data.get(off..off + 4)
        .and_then(|b| b.try_into().ok())
        .map(u32::from_le_bytes)
}

fn read_u16_at(data: &[u8], off: usize) -> Option<u16> {
    data.get(off..off + 2)
        .and_then(|b| b.try_into().ok())
        .map(u16::from_le_bytes)
}

fn read_f32_at(data: &[u8], off: usize) -> Option<f32> {
    data.get(off..off + 4)
        .and_then(|b| b.try_into().ok())
        .map(f32::from_le_bytes)
}

fn read_f64_at(data: &[u8], off: usize) -> Option<f64> {
    data.get(off..off + 8)
        .and_then(|b| b.try_into().ok())
        .map(f64::from_le_bytes)
}

/// Parse a decompressed `dng_big_table` blob: HSV LookTable (type 0) or RGB 3D LUT (type 1).
pub fn parse_look_blob(raw: &[u8], profile: &mut DngProfile) -> Result<()> {
    if raw.len() < 16 {
        return Err(anyhow!("look blob shorter than header"));
    }
    let field0 = read_u32_at(raw, 0).unwrap_or(0);
    let field1 = read_u32_at(raw, 4).unwrap_or(0);
    let field2 = read_u32_at(raw, 8).unwrap_or(0);
    let field3 = read_u32_at(raw, 12).unwrap_or(0);
    // type-1 RGB table (mini_film / xmp2cube / DNG SDK dng_rgb_table).
    if field0 == 1 && field1 == 1 && (field2 == 1 || field2 == 3) && field3 >= 2 {
        return parse_rgb_table_blob(raw, profile);
    }
    // DNG Converter 16.3 Landscape/Color: [0, version=1, hue, sat, val, encoding]
    // then hue*sat*val float32 HSV cells (H degrees, S scale, V scale).
    if field1 == 1 && field2 >= 2 && field3 >= 2 && raw.len() >= 24 {
        let hue = field2;
        let sat = field3;
        let val = read_u32_at(raw, 16).unwrap_or(0);
        let enc = read_u32_at(raw, 20).unwrap_or(0);
        let n = (hue as usize)
            .saturating_mul(sat as usize)
            .saturating_mul(val as usize);
        let need = 24 + n * 12;
        if val >= 1 && raw.len() >= need {
            let mut data = Vec::with_capacity(n * 3);
            let mut off = 24;
            for _ in 0..n {
                data.push(read_f32_at(raw, off).unwrap_or(0.0));
                data.push(read_f32_at(raw, off + 4).unwrap_or(1.0));
                data.push(read_f32_at(raw, off + 8).unwrap_or(1.0));
                off += 12;
            }
            profile.look_dims = [hue, sat, val];
            profile.look_data = data;
            profile.look_encoding = enc;
            profile.has_look = true;
            return Ok(());
        }
    }
    Err(anyhow!(
        "unrecognised look blob header {field0},{field1},{field2},{field3} len={}",
        raw.len()
    ))
}

fn parse_rgb_table_blob(raw: &[u8], profile: &mut DngProfile) -> Result<()> {
    let dimensions = read_u32_at(raw, 8).unwrap_or(0);
    let divisions = read_u32_at(raw, 12).unwrap_or(0);
    if dimensions != 3 || divisions < 2 {
        return Err(anyhow!("RGB table must be 3D with ≥2 divisions"));
    }
    let n = divisions as usize;
    let nop: Vec<u16> = (0..n)
        .map(|i| ((i as u32 * 0xFFFF + (divisions >> 1)) / (divisions - 1)) as u16)
        .collect();
    let sample_count = n * n * n;
    let mut off = 16;
    let mut samples = Vec::with_capacity(sample_count * 3);
    for &ri in &nop {
        for &gi in &nop {
            for &bi in &nop {
                let rr = read_u16_at(raw, off).unwrap_or(0).wrapping_add(ri);
                let gg = read_u16_at(raw, off + 2).unwrap_or(0).wrapping_add(gi);
                let bb = read_u16_at(raw, off + 4).unwrap_or(0).wrapping_add(bi);
                off += 6;
                samples.push(rr as f32 / 65535.0);
                samples.push(gg as f32 / 65535.0);
                samples.push(bb as f32 / 65535.0);
            }
        }
    }
    let primaries = read_u32_at(raw, off).unwrap_or(2);
    let gamma = read_u32_at(raw, off + 4).unwrap_or(0);
    let min_amount = read_f64_at(raw, off + 12).unwrap_or(0.0);
    let max_amount = read_f64_at(raw, off + 20).unwrap_or(1.0);
    profile.rgb_lut_div = divisions;
    profile.rgb_lut = samples;
    profile.rgb_primaries = primaries;
    profile.rgb_gamma = gamma;
    profile.has_rgb_lut = true;
    if profile.look_amount <= 0.0 {
        profile.look_amount = max_amount.clamp(min_amount, 1.0) as f32;
    }
    Ok(())
}

fn encode_lut_gamma(x: f32, gamma: u32) -> f32 {
    let x = x.max(0.0);
    match gamma {
        1 => linear_to_srgb(x),
        2 => x.powf(1.0 / 1.8),
        3 => x.powf(1.0 / 2.2),
        4 => {
            const A: f32 = 1.099_296_8;
            const B: f32 = 0.018_053_97;
            if x < B {
                4.5 * x
            } else {
                A * x.powf(0.45) - (A - 1.0)
            }
        }
        _ => x,
    }
}

fn decode_lut_gamma(x: f32, gamma: u32) -> f32 {
    let x = x.max(0.0);
    match gamma {
        1 => srgb_to_linear(x),
        2 => x.powf(1.8),
        3 => x.powf(2.2),
        4 => {
            const A: f32 = 1.099_296_8;
            const B: f32 = 0.018_053_97;
            if x < 4.5 * B {
                x / 4.5
            } else {
                ((x + (A - 1.0)) / A).powf(1.0 / 0.45)
            }
        }
        _ => x,
    }
}

fn sample_rgb_lut(div: u32, data: &[f32], rgb: [f32; 3]) -> [f32; 3] {
    let n = div as usize;
    if n < 2 || data.len() < n * n * n * 3 {
        return rgb;
    }
    let m = (n - 1) as f32;
    let axis = |c: f32| -> (usize, usize, f32) {
        let x = c.clamp(0.0, 1.0) * m;
        let lo = (x as usize).min(n - 2);
        let hi = lo + 1;
        (lo, hi, (x - lo as f32).clamp(0.0, 1.0))
    };
    let (r0, r1, fr) = axis(rgb[0]);
    let (g0, g1, fg) = axis(rgb[1]);
    let (b0, b1, fb) = axis(rgb[2]);
    let at = |ri: usize, gi: usize, bi: usize| -> [f32; 3] {
        let idx = ((ri * n + gi) * n + bi) * 3;
        [data[idx], data[idx + 1], data[idx + 2]]
    };
    let mut out = [0.0f32; 3];
    for (ri, wr) in [(r0, 1.0 - fr), (r1, fr)] {
        if wr == 0.0 {
            continue;
        }
        for (gi, wg) in [(g0, 1.0 - fg), (g1, fg)] {
            if wg == 0.0 {
                continue;
            }
            for (bi, wb) in [(b0, 1.0 - fb), (b1, fb)] {
                if wb == 0.0 {
                    continue;
                }
                let w = wr * wg * wb;
                let s = at(ri, gi, bi);
                out[0] += w * s[0];
                out[1] += w * s[1];
                out[2] += w * s[2];
            }
        }
    }
    out
}

/// Apply a type-1 RGBTable in the table's declared transfer (working space = linear ProPhoto).
pub fn apply_rgb_lut(profile: &DngProfile, rgb: [f32; 3]) -> [f32; 3] {
    if !profile.has_rgb_lut {
        return rgb;
    }
    let amount = profile.look_amount.clamp(0.0, 1.0);
    if amount <= 1e-6 {
        return rgb;
    }
    let encoded = [
        encode_lut_gamma(rgb[0], profile.rgb_gamma),
        encode_lut_gamma(rgb[1], profile.rgb_gamma),
        encode_lut_gamma(rgb[2], profile.rgb_gamma),
    ];
    let sampled = sample_rgb_lut(profile.rgb_lut_div, &profile.rgb_lut, encoded);
    let decoded = [
        decode_lut_gamma(sampled[0], profile.rgb_gamma),
        decode_lut_gamma(sampled[1], profile.rgb_gamma),
        decode_lut_gamma(sampled[2], profile.rgb_gamma),
    ];
    if amount >= 1.0 - 1e-6 {
        return decoded;
    }
    [
        rgb[0] + (decoded[0] - rgb[0]) * amount,
        rgb[1] + (decoded[1] - rgb[1]) * amount,
        rgb[2] + (decoded[2] - rgb[2]) * amount,
    ]
}

fn xmp_attr(xmp: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=\"");
    let start = xmp.find(&pat)? + pat.len();
    let end = xmp[start..].find('"')? + start;
    Some(xmp[start..end].to_string())
}

fn xmp_elem(xmp: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xmp.find(&open)? + open.len();
    let end = xmp[start..].find(&close)? + start;
    Some(xmp[start..end].trim().to_string())
}

/// Load `crs:Table_<UUID>` from an Adobe Look XMP and merge onto `profile` (replaces DCP LookTable).
pub fn apply_look_xmp(profile: &mut DngProfile, path: &Path) -> Result<()> {
    let xmp = std::fs::read_to_string(path)?;
    let uuid = xmp_attr(&xmp, "crs:LookTable")
        .or_else(|| {
            xmp.find("crs:Table_").and_then(|i| {
                let rest = &xmp[i + 10..];
                let end = rest.find('=')?;
                Some(rest[..end].to_string())
            })
        })
        .unwrap_or_default();
    let key = format!("crs:Table_{uuid}");
    let encoded = xmp_attr(&xmp, &key).ok_or_else(|| anyhow!("no {key} in {}", path.display()))?;
    let raw = inflate_big_table(&adobe_base85_decode(&encoded))?;
    parse_look_blob(&raw, profile)?;
    profile.look_uuid = uuid;
    profile.look_name = xmp_elem(&xmp, "crs:Name")
        .or_else(|| xmp_attr(&xmp, "crs:Name"))
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("look")
                .replace('_', " ")
        });
    if let Some(amt) = xmp_attr(&xmp, "crs:Amount").and_then(|s| s.parse().ok()) {
        profile.look_amount = amt;
    }
    profile.look_source = path.display().to_string();
    profile.notes.push(format!(
        "Look '{}' uuid={} dims={:?} rgb_lut={} from {}",
        profile.look_name,
        profile.look_uuid,
        profile.look_dims,
        profile.has_rgb_lut,
        path.display()
    ));
    Ok(())
}

pub fn find_look_xmp(look_dir: &Path, name: Option<&str>, uuid: Option<&str>) -> Option<PathBuf> {
    if !look_dir.is_dir() {
        return None;
    }
    let mut files: Vec<PathBuf> = std::fs::read_dir(look_dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("xmp"))
        .collect();
    files.sort();
    let name_l = name.unwrap_or("").to_ascii_lowercase();
    let uuid_l = uuid.unwrap_or("").to_ascii_uppercase();
    if !name_l.is_empty() {
        let slug = name_l.replace(' ', "_");
        for p in &files {
            let stem = p.file_stem()?.to_string_lossy().to_ascii_lowercase();
            if stem == slug || stem.contains(&slug) || name_l.contains(&stem.replace('_', " ")) {
                return Some(p.clone());
            }
        }
    }
    if !uuid_l.is_empty() {
        for p in &files {
            if let Ok(text) = std::fs::read_to_string(p) {
                if text.to_ascii_uppercase().contains(&uuid_l) {
                    return Some(p.clone());
                }
            }
        }
    }
    None
}

fn blend_hsv_data(a: &[f32], b: &[f32], g: f32) -> Vec<f32> {
    let n = a.len().min(b.len());
    let mut out = vec![0.0f32; n];
    for i in 0..n {
        out[i] = g * a[i] + (1.0 - g) * b[i];
    }
    out
}

fn interpolated_hue_sat(profile: &DngProfile, temp: f32) -> Option<( [u32; 3], Vec<f32>, u32 )> {
    if !profile.has_hue_sat_map {
        return None;
    }
    let dims = profile.hue_sat_dims;
    let g = illuminant_mix(temp, profile.illuminant1_k, profile.illuminant2_k);
    let data = if !profile.hue_sat_data1.is_empty() && !profile.hue_sat_data2.is_empty() {
        blend_hsv_data(&profile.hue_sat_data1, &profile.hue_sat_data2, g)
    } else if !profile.hue_sat_data1.is_empty() {
        profile.hue_sat_data1.clone()
    } else if !profile.hue_sat_data2.is_empty() {
        profile.hue_sat_data2.clone()
    } else {
        return None;
    };
    Some((dims, data, profile.hue_sat_encoding))
}

pub fn apply_hue_sat_map(profile: &DngProfile, rgb: [f32; 3], temp: f32) -> [f32; 3] {
    match interpolated_hue_sat(profile, temp) {
        Some((dims, data, enc)) => apply_hsv_table(dims, &data, enc, rgb),
        None => rgb,
    }
}

/// Monotone cubic (Fritsch–Carlson) through linear 0..1 ProfileToneCurve knots.
pub fn eval_profile_tone(points: &[[f32; 2]], x: f32) -> f32 {
    let n = points.len();
    if n < 2 {
        return x;
    }
    let x = x.clamp(points[0][0], points[n - 1][0]);
    let mut i = 0;
    for k in 0..n - 1 {
        if points[k + 1][0] >= x {
            i = k;
            break;
        }
        i = k;
    }
    let slope = |k: usize| (points[k + 1][1] - points[k][1]) / (points[k + 1][0] - points[k][0]).max(1e-8);
    let tangent = |k: usize| -> f32 {
        if k == 0 {
            return slope(0);
        }
        if k == n - 1 {
            return slope(n - 2);
        }
        let (a, b) = (slope(k - 1), slope(k));
        if a * b <= 0.0 {
            0.0
        } else {
            2.0 / (1.0 / a + 1.0 / b)
        }
    };
    let (x0, x1) = (points[i][0], points[i + 1][0]);
    let h = (x1 - x0).max(1e-8);
    let t = (x - x0) / h;
    let (t2, t3) = (t * t, t * t * t);
    let y = (2.0 * t3 - 3.0 * t2 + 1.0) * points[i][1]
        + (t3 - 2.0 * t2 + t) * h * tangent(i)
        + (-2.0 * t3 + 3.0 * t2) * points[i + 1][1]
        + (t3 - t2) * h * tangent(i + 1);
    y.clamp(0.0, 1.0)
}

/// Adobe Standard DCP has no ProfileToneCurve. Lightroom still applies a
/// process-version midtone (LightCraft measured ~0.8 EV too dark vs a
/// preview-fitted tone). Vendor RAW has no Adobe preview to fit, so we use a
/// midtone-weighted lift that fades in the highlights.
const DEFAULT_PROCESS_EV: f32 = 0.28;

pub fn apply_profile_tone_curve(profile: &DngProfile, rgb: [f32; 3]) -> [f32; 3] {
    if profile.tone_curve.len() >= 2 {
        let y = luma(rgb).max(1e-8);
        let mapped = eval_profile_tone(&profile.tone_curve, y.clamp(0.0, 1.0));
        let gain = mapped.max(1e-8) / y.clamp(0.0, 1.0).max(1e-8);
        return [rgb[0] * gain, rgb[1] * gain, rgb[2] * gain];
    }
    let y = luma(rgb).max(1e-8);
    let w = (0.45 / (y + 0.45)).clamp(0.0, 1.0);
    let g = 2f32.powf(DEFAULT_PROCESS_EV * w);
    [rgb[0] * g, rgb[1] * g, rgb[2] * g]
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

fn eval_curve(points: &[(f32, f32)], len: usize, x: f32) -> f32 {
    if len < 2 {
        return x;
    }
    let x = x.clamp(0.0, 1.0);
    let pts = &points[..len];
    if x <= pts[0].0 {
        return pts[0].1;
    }
    for i in 1..len {
        if x <= pts[i].0 {
            let t = (x - pts[i - 1].0) / (pts[i].0 - pts[i - 1].0).max(1e-6);
            return pts[i - 1].1 + t * (pts[i].1 - pts[i - 1].1);
        }
    }
    pts[len - 1].1
}

fn apply_point_curve(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    if settings.tone_curve_len < 2 {
        return rgb;
    }
    let y = luma(rgb).max(1e-8);
    let x = y.clamp(0.0, 1.0);
    let mapped = eval_curve(&settings.tone_curve_pv2012, settings.tone_curve_len, x);
    let gain = mapped.max(1e-8) / x.max(1e-8);
    [rgb[0] * gain, rgb[1] * gain, rgb[2] * gain]
}

fn apply_parametric(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    let amount = settings.parametric_shadows.abs()
        + settings.parametric_darks.abs()
        + settings.parametric_lights.abs()
        + settings.parametric_highlights.abs();
    if amount < 1e-6 {
        return rgb;
    }
    let y = luma(rgb).clamp(0.0, 1.0);
    let s0 = (settings.parametric_shadow_split / 100.0).clamp(0.05, 0.45);
    let s1 = (settings.parametric_mid_split / 100.0).clamp(s0 + 0.05, 0.7);
    let s2 = (settings.parametric_highlight_split / 100.0).clamp(s1 + 0.05, 0.95);
    let w_sh = (1.0 - (y / s0).clamp(0.0, 1.0)).powf(1.4);
    let w_hi = ((y - s2) / (1.0 - s2).max(1e-4)).clamp(0.0, 1.0).powf(1.4);
    let w_dk = if y < s1 {
        1.0 - ((y - s0) / (s1 - s0).max(1e-4)).clamp(0.0, 1.0)
    } else {
        0.0
    } * (1.0 - w_sh);
    let w_li = if y > s1 {
        ((y - s1) / (s2 - s1).max(1e-4)).clamp(0.0, 1.0)
    } else {
        0.0
    } * (1.0 - w_hi);
    let ev = (settings.parametric_shadows * w_sh
        + settings.parametric_darks * w_dk
        + settings.parametric_lights * w_li
        + settings.parametric_highlights * w_hi)
        / 100.0
        * 0.6;
    let g = 2f32.powf(ev);
    [rgb[0] * g, rgb[1] * g, rgb[2] * g]
}

fn apply_vibrance_sat(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    if settings.vibrance.abs() < 1e-6 && settings.saturation.abs() < 1e-6 {
        return rgb;
    }
    let mut hsv = rgb_to_hsv(rgb);
    if settings.saturation.abs() > 1e-6 {
        hsv[1] = (hsv[1] * (1.0 + settings.saturation / 100.0)).clamp(0.0, 1.5);
    }
    if settings.vibrance.abs() > 1e-6 {
        let protect = (1.0 - hsv[1]).powf(1.2);
        hsv[1] = (hsv[1] * (1.0 + settings.vibrance / 100.0 * protect * 0.85)).max(0.0);
    }
    hsv_to_rgb(hsv)
}

fn hsl_weight(hue: f32, center: f32) -> f32 {
    let mut d = (hue - center).abs();
    if d > 180.0 {
        d = 360.0 - d;
    }
    (1.0 - (d / 35.0).clamp(0.0, 1.0)).powf(1.4)
}

fn apply_hsl(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    if settings.hsl.iter().all(|v| v.abs() < 1e-6) {
        return rgb;
    }
    let centers = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0];
    let mut hsv = rgb_to_hsv(rgb);
    let mut dh = 0.0;
    let mut ds = 0.0;
    let mut dv = 0.0;
    let mut wsum = 0.0;
    for i in 0..8 {
        let w = hsl_weight(hsv[0], centers[i]);
        if w <= 0.0 {
            continue;
        }
        dh += settings.hsl[i] * w;
        ds += settings.hsl[8 + i] * w;
        dv += settings.hsl[16 + i] * w;
        wsum += w;
    }
    if wsum > 1e-6 {
        hsv[0] = (hsv[0] + dh / wsum).rem_euclid(360.0);
        hsv[1] = (hsv[1] * (1.0 + ds / wsum / 100.0)).max(0.0);
        hsv[2] = (hsv[2] * (1.0 + dv / wsum / 100.0)).max(0.0);
    }
    hsv_to_rgb(hsv)
}

fn apply_calibration(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    if settings.red_hue.abs()
        + settings.red_sat.abs()
        + settings.green_hue.abs()
        + settings.green_sat.abs()
        + settings.blue_hue.abs()
        + settings.blue_sat.abs()
        < 1e-6
    {
        return rgb;
    }
    let r = rgb[0]
        * (1.0 + settings.red_sat / 200.0)
        + rgb[1] * (settings.red_hue / 400.0)
        - rgb[2] * (settings.red_hue / 400.0);
    let g = rgb[1] * (1.0 + settings.green_sat / 200.0)
        + rgb[2] * (settings.green_hue / 400.0)
        - rgb[0] * (settings.green_hue / 400.0);
    let b = rgb[2] * (1.0 + settings.blue_sat / 200.0)
        + rgb[0] * (settings.blue_hue / 400.0)
        - rgb[1] * (settings.blue_hue / 400.0);
    [r.max(0.0), g.max(0.0), b.max(0.0)]
}

fn apply_dehaze_pixel(rgb: [f32; 3], amount: f32) -> [f32; 3] {
    if amount.abs() < 1e-6 {
        return rgb;
    }
    let t = (amount / 100.0).clamp(-1.0, 1.0);
    let air = [0.82, 0.88, 0.96];
    [
        (rgb[0] - air[0] * t * 0.35) / (1.0 - t.abs() * 0.25).max(0.4),
        (rgb[1] - air[1] * t * 0.35) / (1.0 - t.abs() * 0.25).max(0.4),
        (rgb[2] - air[2] * t * 0.35) / (1.0 - t.abs() * 0.25).max(0.4),
    ]
}

fn apply_color_ops(rgb: [f32; 3], settings: AdobeSettings) -> [f32; 3] {
    let mut p = apply_calibration(rgb, settings);
    p = apply_hsl(p, settings);
    apply_vibrance_sat(p, settings)
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

#[derive(Clone, Copy)]
struct PipeFlags {
    hsm: bool,
    baseline: bool,
    user_expo: bool,
    look: bool,
    tone: bool,
    curve: bool,
    color: bool,
}

fn flags_for(stage: AdobeStage, settings: AdobeSettings) -> PipeFlags {
    let look = settings.apply_look;
    match stage {
        AdobeStage::Wb => PipeFlags {
            hsm: false,
            baseline: false,
            user_expo: false,
            look: false,
            tone: false,
            curve: false,
            color: false,
        },
        AdobeStage::Matrix => PipeFlags {
            hsm: false,
            baseline: false,
            user_expo: false,
            look: false,
            tone: false,
            curve: false,
            color: false,
        },
        AdobeStage::HueSat => PipeFlags {
            hsm: true,
            baseline: false,
            user_expo: false,
            look: false,
            tone: false,
            curve: false,
            color: false,
        },
        AdobeStage::Baseline => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: false,
            look: false,
            tone: false,
            curve: false,
            color: false,
        },
        AdobeStage::Look => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: false,
            look,
            tone: false,
            curve: false,
            color: false,
        },
        AdobeStage::Tone => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: false,
            look,
            tone: true,
            curve: false,
            color: false,
        },
        // Legacy “profile”: colour science without exposure (Look at BE = 0).
        AdobeStage::Profile => PipeFlags {
            hsm: true,
            baseline: false,
            user_expo: false,
            look,
            tone: true,
            curve: false,
            color: false,
        },
        AdobeStage::Exposure => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: true,
            look,
            tone: true,
            curve: false,
            color: false,
        },
        AdobeStage::Curve => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: true,
            look,
            tone: true,
            curve: true,
            color: false,
        },
        AdobeStage::Color => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: true,
            look,
            tone: true,
            curve: true,
            color: true,
        },
        AdobeStage::Hs | AdobeStage::Sliders => PipeFlags {
            hsm: true,
            baseline: true,
            user_expo: true,
            look,
            tone: true,
            curve: true,
            color: true,
        },
    }
}

fn apply_profile_stack(
    mut ppr: [f32; 3],
    profile: &DngProfile,
    settings: AdobeSettings,
    temp: f32,
    flags: PipeFlags,
) -> [f32; 3] {
    if flags.hsm {
        ppr = apply_hue_sat_map(profile, ppr, temp);
    }
    let mut ev = 0.0;
    if flags.baseline {
        ev += profile.total_baseline_ev();
    }
    if flags.user_expo {
        ev += settings.exposure;
    }
    if ev.abs() > 1e-8 {
        let g = 2f32.powf(ev);
        ppr = [ppr[0] * g, ppr[1] * g, ppr[2] * g];
    }
    if flags.look {
        ppr = apply_look_table(profile, ppr);
        ppr = apply_rgb_lut(profile, ppr);
    }
    if flags.tone {
        ppr = apply_profile_tone_curve(profile, ppr);
    }
    ppr
}

pub fn apply_adobe_pixel(
    cam: [f32; 3],
    profile: &DngProfile,
    settings: AdobeSettings,
    stage: AdobeStage,
) -> [f32; 3] {
    let (prepared, temp) = wb_and_forward(cam, profile, settings);
    if matches!(stage, AdobeStage::Wb) {
        return encode_srgb(prepared);
    }
    let flags = flags_for(stage, settings);
    let mut ppr = camera_to_prophoto_settings(prepared, profile, settings, temp);
    if matches!(stage, AdobeStage::Matrix) {
        return to_display(ppr);
    }
    ppr = apply_profile_stack(ppr, profile, settings, temp, flags);
    if matches!(
        stage,
        AdobeStage::HueSat
            | AdobeStage::Baseline
            | AdobeStage::Look
            | AdobeStage::Tone
            | AdobeStage::Profile
            | AdobeStage::Exposure
    ) {
        return to_display(ppr);
    }
    if flags.curve {
        ppr = apply_pv2010_brightness(ppr, settings.brightness);
        ppr = apply_named_curve(ppr, settings.tone_curve);
        ppr = apply_contrast(ppr, settings.contrast / 100.0);
        ppr = apply_parametric(ppr, settings);
        ppr = apply_point_curve(ppr, settings);
    }
    if matches!(stage, AdobeStage::Curve) {
        return to_display(ppr);
    }
    if flags.color {
        ppr = apply_color_ops(ppr, settings);
    }
    if matches!(stage, AdobeStage::Color) {
        return to_display(ppr);
    }
    ppr = apply_dehaze_pixel(ppr, settings.dehaze);
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
    let flags = flags_for(stage, settings);
    let mut ppr: Vec<[f32; 3]> = camera[..n]
        .par_iter()
        .map(|cam| {
            let (prepared, temp) = wb_and_forward(*cam, profile, settings);
            let rgb = camera_to_prophoto_settings(prepared, profile, settings, temp);
            apply_profile_stack(rgb, profile, settings, temp, flags)
        })
        .collect();
    if matches!(
        stage,
        AdobeStage::Matrix
            | AdobeStage::HueSat
            | AdobeStage::Baseline
            | AdobeStage::Look
            | AdobeStage::Tone
            | AdobeStage::Profile
            | AdobeStage::Exposure
    ) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    if flags.curve {
        ppr.par_iter_mut().for_each(|p| {
            *p = apply_pv2010_brightness(*p, settings.brightness);
            *p = apply_named_curve(*p, settings.tone_curve);
            *p = apply_contrast(*p, settings.contrast / 100.0);
            *p = apply_parametric(*p, settings);
            *p = apply_point_curve(*p, settings);
        });
    }
    if matches!(stage, AdobeStage::Curve) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    if flags.color {
        ppr.par_iter_mut().for_each(|p| *p = apply_color_ops(*p, settings));
    }
    if matches!(stage, AdobeStage::Color) {
        return ppr.par_iter().map(|p| to_display(*p)).collect();
    }
    ppr.par_iter_mut()
        .for_each(|p| *p = apply_dehaze_pixel(*p, settings.dehaze));
    if settings.clarity.abs() + settings.texture.abs() > 1e-6 {
        apply_local_contrast(&mut ppr, width, height, settings.clarity, settings.texture);
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

fn apply_local_contrast(ppr: &mut [[f32; 3]], width: usize, height: usize, clarity: f32, texture: f32) {
    let n = width * height;
    let lumas: Vec<f32> = ppr.iter().map(|p| luma(*p)).collect();
    let blur = multi_scale_guided_luma(&lumas.iter().map(|y| y.max(1e-8)).collect::<Vec<_>>(), width, height, false);
    let c = clarity / 100.0 * 0.35;
    let t = texture / 100.0 * 0.22;
    for i in 0..n {
        let y = lumas[i].max(1e-8);
        let mid = 1.0 - ((y - 0.18).abs() * 2.2).clamp(0.0, 1.0);
        let fine = y - blur[i];
        let gain = 1.0 + (c * mid + t) * (fine / y.max(0.05)).clamp(-1.5, 1.5);
        ppr[i] = [ppr[i][0] * gain, ppr[i][1] * gain, ppr[i][2] * gain];
    }
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
            50721 => out.color_matrix1 = read_matrix9(raw, le, typ),
            50722 => out.color_matrix2 = read_matrix9(raw, le, typ),
            50723 => out.camera_cal1 = read_matrix9(raw, le, typ),
            50724 => out.camera_cal2 = read_matrix9(raw, le, typ),
            50727 => {
                let n = read_rational_n(raw, le, 3);
                out.analog_balance = [n[0], n[1], n[2]];
            }
            50728 => {
                let n = read_rational_n(raw, le, 3);
                out.as_shot_neutral = [n[0], n[1], n[2]];
            }
            50706 => {
                out.notes.push("DNGVersion present".into());
            }
            50708 => {
                out.unique_camera_model = read_ascii(raw);
            }
            50730 => out.baseline_exposure = read_srat1(raw, le),
            50778 => out.illuminant1_k = illuminant_k(val as u16),
            50779 => out.illuminant2_k = illuminant_k(val as u16),
            50936 => {
                out.profile_name = read_ascii(raw);
            }
            50964 => {
                out.forward_matrix1 = read_matrix9(raw, le, typ);
                out.has_forward = matrix_looks_valid(out.forward_matrix1);
            }
            50965 => {
                out.forward_matrix2 = read_matrix9(raw, le, typ);
                out.has_forward = out.has_forward || matrix_looks_valid(out.forward_matrix2);
            }
            50937 if (typ == 3 || typ == 4) && cnt >= 3 => {
                let d = if typ == 3 {
                    read_u16_list(raw, le).into_iter().map(u32::from).collect()
                } else {
                    read_u32_list(raw, le)
                };
                if d.len() >= 3 {
                    out.hue_sat_dims = [d[0], d[1], d[2]];
                }
            }
            50938 if typ == 11 || typ == 12 => {
                out.hue_sat_data1 = read_float_list(raw, le, typ);
            }
            50939 if typ == 11 || typ == 12 => {
                out.hue_sat_data2 = read_float_list(raw, le, typ);
            }
            50940 if typ == 11 || typ == 12 => {
                let flats = read_float_list(raw, le, typ);
                out.tone_curve = flats
                    .chunks(2)
                    .filter(|c| c.len() == 2 && c[0].is_finite() && c[1].is_finite())
                    .map(|c| [c[0], c[1]])
                    .collect();
            }
            50981 if (typ == 3 || typ == 4) && cnt >= 3 => {
                let d = if typ == 3 {
                    read_u16_list(raw, le).into_iter().map(u32::from).collect()
                } else {
                    read_u32_list(raw, le)
                };
                if d.len() >= 3 {
                    out.look_dims = [d[0], d[1], d[2]];
                }
            }
            50982 if typ == 11 || typ == 12 => {
                out.look_data = read_float_list(raw, le, typ);
                out.has_look = out.look_data.len() >= 6;
            }
            51107 => out.hue_sat_encoding = val,
            51108 => out.look_encoding = val,
            51109 => out.baseline_exposure_offset = read_srat1(raw, le),
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

fn read_u16_list(raw: &[u8], le: bool) -> Vec<u16> {
    (0..raw.len() / 2).map(|i| read_u16(raw, i * 2, le)).collect()
}

fn read_float_list(raw: &[u8], le: bool, typ: u16) -> Vec<f32> {
    if typ == 12 {
        (0..raw.len() / 8)
            .map(|i| {
                let mut b = [0u8; 8];
                b.copy_from_slice(&raw[i * 8..i * 8 + 8]);
                let v = if le {
                    f64::from_le_bytes(b)
                } else {
                    f64::from_be_bytes(b)
                };
                v as f32
            })
            .collect()
    } else {
        read_f32_list(raw, le)
    }
}

fn read_ascii(raw: &[u8]) -> String {
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..end]).trim().to_string()
}

fn read_srat1(raw: &[u8], le: bool) -> f32 {
    if raw.len() < 8 {
        return 0.0;
    }
    let a = read_i32(raw, 0, le) as f64;
    let b = read_i32(raw, 4, le) as f64;
    if b.abs() < 1e-12 { 0.0 } else { (a / b) as f32 }
}

fn read_matrix9(raw: &[u8], le: bool, typ: u16) -> [f32; 9] {
    if typ == 11 || typ == 12 {
        let f = read_float_list(raw, le, typ);
        let mut m = identity3();
        for i in 0..9.min(f.len()) {
            m[i] = f[i];
        }
        m
    } else {
        read_srat9(raw, le)
    }
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

fn normalize_xyz2cam(cm: [f32; 9], white_xyz: [f32; 3]) -> [f32; 9] {
    let cam = mul3(cm, white_xyz);
    let mut out = cm;
    for row in 0..3 {
        let s = cam[row].abs().max(1e-8);
        out[row * 3] = cm[row * 3] / s;
        out[row * 3 + 1] = cm[row * 3 + 1] / s;
        out[row * 3 + 2] = cm[row * 3 + 2] / s;
    }
    out
}

fn matrix_looks_valid(m: [f32; 9]) -> bool {
    let s0 = (m[0] + m[1] + m[2]).abs();
    let s1 = (m[3] + m[4] + m[5]).abs();
    s0 > 0.2 && s0 < 6.0 && s1 > 0.2 && s1 < 6.0
}

/// DNG ColorMatrix/ForwardMatrix when present; otherwise rawler's vendor matrix.
pub fn parse_color_profile(data: &[u8]) -> Result<DngProfile> {
    if let Ok(p) = parse_dng_profile(data)
        && (p.has_forward || (matrix_looks_valid(p.color_matrix1) && p.notes.iter().any(|n| n.contains("DNGVersion"))))
    {
        return Ok(p);
    }
    profile_from_vendor_raw(data)
}

fn profile_from_vendor_raw(data: &[u8]) -> Result<DngProfile> {
    let source = rawler::rawsource::RawSource::new_from_slice(data);
    let decoder = rawler::get_decoder(&source)?;
    let raw = decoder.raw_image(&source, &rawler::decoders::RawDecodeParams::default(), false)?;
    let mut out = DngProfile::default();
    let mat = raw
        .color_matrix
        .iter()
        .find(|(illuminant, _)| **illuminant == rawler::imgop::xyz::Illuminant::D65)
        .or_else(|| raw.color_matrix.iter().next());
    if let Some((_, color_matrix)) = mat {
        let mut m = identity3();
        for i in 0..9.min(color_matrix.len()) {
            m[i] = color_matrix[i] as f32;
        }
        // Keep the rawler matrix for NeutralToCamera (Temperature/Tint).
        // XYZ invert uses a D65-normalized copy — see color_matrix_for_xyz.
        out.color_matrix1 = m;
        out.color_matrix2 = m;
    }
    let wb = raw.wb_coeffs;
    if wb[0].is_finite() && wb[1].abs() > 1e-6 && wb[2].is_finite() {
        let n = [
            1.0 / wb[0].max(1e-8),
            1.0 / wb[1].max(1e-8),
            1.0 / wb[2].max(1e-8),
        ];
        let g = n[1];
        out.as_shot_neutral = [n[0] / g, 1.0, n[2] / g];
    }
    out.has_forward = false;
    out.has_look = false;
    out.notes.push(
        "Vendor RAW: ColorMatrix from rawler (not Adobe Standard DCP). \
         LookTable / HueSatMap / BaselineExposure from DNG are absent."
            .into(),
    );
    Ok(out)
}

fn finalize_profile(out: &mut DngProfile) {
    out.has_hue_sat_map = !out.hue_sat_data1.is_empty() || !out.hue_sat_data2.is_empty();
    out.has_look = out.look_data.len() >= 6;
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
            "No numeric ProfileHueSatMap (DNG 50937/50938). FiveK Adobe Standard DNGs omit it."
                .into(),
        );
    }
    if out.tone_curve.len() >= 2 {
        out.notes.push(format!(
            "ProfileToneCurve {} knots.",
            out.tone_curve.len()
        ));
    }
    if out.total_baseline_ev().abs() > 1e-6 {
        out.notes.push(format!(
            "BaselineExposure {:.3} + offset {:.3}.",
            out.baseline_exposure, out.baseline_exposure_offset
        ));
    }
}

pub fn parse_dng_profile(data: &[u8]) -> Result<DngProfile> {
    if data.len() < 8 {
        return Err(anyhow!("DNG too small"));
    }
    let le = data[0] == b'I' || data[0] == b'i';
    if data[0] != b'I' && data[0] != b'M' {
        return Err(anyhow!("not a TIFF/DNG/DCP"));
    }
    let off = read_u32(data, 4, le) as usize;
    let mut out = DngProfile::default();
    parse_ifd(data, off, le, &mut Vec::new(), &mut out);
    finalize_profile(&mut out);
    Ok(out)
}

/// Overlay a sidecar DCP onto a vendor-RAW profile, keeping AsShotNeutral.
pub fn merge_dcp_onto_raw(raw: &DngProfile, dcp: &DngProfile) -> DngProfile {
    let as_shot = raw.as_shot_neutral;
    let analog = raw.analog_balance;
    let mut out = dcp.clone();
    out.as_shot_neutral = as_shot;
    if analog[0] > 0.0 {
        out.analog_balance = analog;
    }
    if out.dcp_source.is_empty() {
        out.dcp_source = dcp.profile_name.clone();
    }
    out.notes.push(format!(
        "Merged DCP '{}' ({}) onto vendor AsShotNeutral.",
        if dcp.profile_name.is_empty() {
            "unnamed"
        } else {
            dcp.profile_name.as_str()
        },
        dcp.dcp_source
    ));
    out
}

pub fn load_dcp_file(path: &Path) -> Result<DngProfile> {
    let bytes = std::fs::read(path)?;
    let mut p = parse_dng_profile(&bytes)?;
    p.dcp_source = path.display().to_string();
    if p.profile_name.is_empty() {
        p.profile_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("dcp")
            .to_string();
    }
    p.notes.push(format!("Loaded sidecar DCP {}", path.display()));
    Ok(p)
}

/// IR / EXIF model → `slug` used by `fetch_adobe_dcp.py` (`{slug}-adobe_standard.dcp`).
pub fn dcp_slug_for(hint: &str) -> Option<&'static str> {
    let t = hint.to_ascii_lowercase();
    if t.contains("g95")
        || t.contains("g99")
        || t.contains("g90")
        || t.contains("dc-g95")
        || t.contains("dc-g99")
        || t.contains("dmc-g95")
    {
        Some("g95")
    } else if t.contains("a6600") || t.contains("ilce-6600") || t.contains("ilce_6600") {
        Some("a6600")
    } else if t.contains("z6ii")
        || t.contains("z 6_2")
        || t.contains("z_6_2")
        || t.contains("z 6ii")
        || t.contains("nikon z 6_2")
    {
        Some("z6ii")
    } else if t.contains("a7riv")
        || t.contains("a7r iv")
        || t.contains("ilce-7rm4")
        || t.contains("ilce_7rm4")
        || t.contains("a7r4")
    {
        Some("a7riv")
    } else {
        None
    }
}

pub fn find_dcp_file(dcp_dir: &Path, hint: &str, style: &str) -> Option<PathBuf> {
    let slug = dcp_slug_for(hint)?;
    let style_slug = style.replace(' ', "_").to_ascii_lowercase();
    let named = dcp_dir.join(format!("{slug}-{style_slug}.dcp"));
    if named.is_file() {
        return Some(named);
    }
    for cand in std::fs::read_dir(dcp_dir).ok()?.flatten() {
        let p = cand.path();
        if p.extension().and_then(|e| e.to_str()) != Some("dcp") {
            continue;
        }
        let stem = p.file_stem()?.to_string_lossy().to_ascii_lowercase();
        if stem.contains(slug) && stem.contains(&style_slug) {
            return Some(p);
        }
    }
    None
}

/// Vendor RAW + optional Adobe Standard DCP from `dcp_dir` / `RAYFINE_DCP_DIR`.
pub fn parse_color_profile_with_dcp(
    data: &[u8],
    hint: Option<&str>,
    dcp_path: Option<&Path>,
    dcp_dir: Option<&Path>,
) -> Result<DngProfile> {
    parse_color_profile_with_sidecars(data, hint, dcp_path, dcp_dir, None, None, None)
}

/// Same as [`parse_color_profile_with_dcp`] plus an Adobe Look XMP (Landscape / Color).
pub fn parse_color_profile_with_sidecars(
    data: &[u8],
    hint: Option<&str>,
    dcp_path: Option<&Path>,
    dcp_dir: Option<&Path>,
    look_dir: Option<&Path>,
    look_name: Option<&str>,
    look_uuid: Option<&str>,
) -> Result<DngProfile> {
    let mut raw = parse_color_profile(data)?;
    if let Some(path) = dcp_path {
        raw = merge_dcp_onto_raw(&raw, &load_dcp_file(path)?);
    } else {
        let dir = dcp_dir
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("RAYFINE_DCP_DIR").map(PathBuf::from));
        let hint = hint.unwrap_or("");
        if let Some(dir) = dir {
            if let Some(path) = find_dcp_file(&dir, hint, "Adobe Standard") {
                match load_dcp_file(&path) {
                    Ok(dcp) => raw = merge_dcp_onto_raw(&raw, &dcp),
                    Err(e) => raw.notes.push(format!("DCP load failed {}: {e}", path.display())),
                }
            } else {
                raw.notes.push(format!(
                    "No Adobe Standard DCP for '{hint}' under {}.",
                    dir.display()
                ));
            }
        }
    }
    let look_dir = look_dir
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("RAYFINE_LOOK_DIR").map(PathBuf::from));
    if let Some(dir) = look_dir {
        if let Some(path) = find_look_xmp(&dir, look_name, look_uuid) {
            if let Err(e) = apply_look_xmp(&mut raw, &path) {
                raw.notes.push(format!("Look load failed {}: {e}", path.display()));
            }
        } else if look_name.unwrap_or("").is_empty() && look_uuid.unwrap_or("").is_empty() {
            raw.notes.push(format!("No Look XMP under {}.", dir.display()));
        } else {
            raw.notes.push(format!(
                "No Look XMP for name={:?} uuid={:?} under {}.",
                look_name,
                look_uuid,
                dir.display()
            ));
        }
    }
    Ok(raw)
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

    #[test]
    fn default_color_ops_are_identity() {
        let rgb = [0.22, 0.18, 0.14];
        let settings = AdobeSettings::default();
        assert_eq!(apply_color_ops(rgb, settings), rgb);
        assert_eq!(apply_parametric(rgb, settings), rgb);
        assert_eq!(apply_point_curve(rgb, settings), rgb);
        assert_eq!(apply_dehaze_pixel(rgb, 0.0), rgb);
    }

    #[test]
    fn point_curve_identity_pair_is_noop() {
        let mut settings = AdobeSettings::default();
        settings.tone_curve_pv2012[0] = (0.0, 0.0);
        settings.tone_curve_pv2012[1] = (1.0, 1.0);
        settings.tone_curve_len = 2;
        let rgb = [0.31, 0.22, 0.18];
        let out = apply_point_curve(rgb, settings);
        assert!((out[0] - rgb[0]).abs() < 1e-5);
        assert!((out[1] - rgb[1]).abs() < 1e-5);
    }

    #[test]
    fn adobe_stage_parse_includes_color() {
        assert_eq!(AdobeStage::parse("color").unwrap(), AdobeStage::Color);
        assert_eq!(AdobeStage::all().len(), 6);
        assert_eq!(AdobeStage::parse("huesat").unwrap(), AdobeStage::HueSat);
        assert_eq!(AdobeStage::parse("baseline").unwrap(), AdobeStage::Baseline);
        assert_eq!(AdobeStage::parse("sliders").unwrap(), AdobeStage::Sliders);
        assert_eq!(AdobeStage::profile_layers().len(), 6);
        let _ = match AdobeStage::parse("tone").unwrap() {
            AdobeStage::Tone => (),
            other => {
                let _: () = match other {
                    AdobeStage::Wb
                    | AdobeStage::Matrix
                    | AdobeStage::HueSat
                    | AdobeStage::Baseline
                    | AdobeStage::Look
                    | AdobeStage::Tone
                    | AdobeStage::Profile
                    | AdobeStage::Exposure
                    | AdobeStage::Curve
                    | AdobeStage::Color
                    | AdobeStage::Hs
                    | AdobeStage::Sliders => (),
                };
            }
        };
    }

    #[test]
    fn hsv_identity_table_is_noop() {
        let dims = [2, 2, 1];
        let data = vec![0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0];
        let rgb = [0.42, 0.31, 0.18];
        let out = apply_hsv_table(dims, &data, 0, rgb);
        assert!((out[0] - rgb[0]).abs() < 0.02, "{out:?}");
        assert!((out[1] - rgb[1]).abs() < 0.02, "{out:?}");
    }

    #[test]
    fn hsv_value_major_desaturates_only_high_v() {
        // 2×2×2 identity except the high-value plane scales saturation by 0.2.
        let dims = [2, 2, 2];
        let mut data = vec![0.0, 1.0, 1.0];
        data.resize(2 * 2 * 2 * 3, 0.0);
        for v in 0..2 {
            for h in 0..2 {
                for s in 0..2 {
                    let idx = ((v * 2 + h) * 2 + s) * 3;
                    data[idx] = 0.0;
                    data[idx + 1] = if v == 1 { 0.2 } else { 1.0 };
                    data[idx + 2] = 1.0;
                }
            }
        }
        let dark = apply_hsv_table(dims, &data, 0, [0.08, 0.02, 0.02]);
        let bright = apply_hsv_table(dims, &data, 0, [0.9, 0.2, 0.2]);
        let dark_s = rgb_to_hsv(dark)[1];
        let bright_s = rgb_to_hsv(bright)[1];
        assert!(bright_s < dark_s * 0.7, "dark_s={dark_s} bright_s={bright_s}");
    }

    #[test]
    fn profile_tone_identity_is_noop() {
        let mut p = DngProfile::default();
        p.tone_curve = vec![[0.0, 0.0], [1.0, 1.0]];
        let rgb = [0.2, 0.18, 0.16];
        let out = apply_profile_tone_curve(&p, rgb);
        assert!((out[0] - rgb[0]).abs() < 1e-4);
    }

    #[test]
    fn missing_profile_tone_lifts_midgrey() {
        let p = DngProfile::default();
        let rgb = [0.18, 0.18, 0.18];
        let out = apply_profile_tone_curve(&p, rgb);
        assert!(out[1] > rgb[1] * 1.05, "{out:?}");
        assert!(out[1] < rgb[1] * 1.35, "{out:?}");
    }

    #[test]
    fn merge_dcp_keeps_as_shot() {
        let mut raw = DngProfile::default();
        raw.as_shot_neutral = [0.7, 1.0, 1.4];
        let mut dcp = DngProfile::default();
        dcp.baseline_exposure = 0.35;
        dcp.profile_name = "Adobe Standard".into();
        dcp.has_forward = true;
        dcp.forward_matrix1 = [0.7, 0.2, 0.1, 0.2, 0.8, 0.0, 0.0, 0.1, 0.9];
        let merged = merge_dcp_onto_raw(&raw, &dcp);
        assert!((merged.as_shot_neutral[0] - 0.7).abs() < 1e-6);
        assert!((merged.baseline_exposure - 0.35).abs() < 1e-6);
        assert_eq!(dcp_slug_for("z6ii-0086"), Some("z6ii"));
        assert_eq!(dcp_slug_for("Sony ILCE-7RM4"), Some("a7riv"));
        assert_eq!(dcp_slug_for("g95-0192"), Some("g95"));
        assert_eq!(dcp_slug_for("Panasonic DC-G99"), Some("g95"));
    }

    #[test]
    fn parse_local_adobe_standard_dcp_when_fetched() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/datasets/dcp/z6ii-adobe_standard.dcp"
        );
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let p = parse_dng_profile(&bytes).expect("dcp");
        assert!(p.has_forward, "notes={:?}", p.notes);
        assert!(p.has_hue_sat_map);
        assert_eq!(p.hue_sat_dims, [90, 30, 1]);
        assert!(p.has_look);
        assert_eq!(p.look_dims, [36, 8, 16]);
        assert_eq!(p.profile_name, "Adobe Standard");
        assert!(p.tone_curve.is_empty());
    }

    #[test]
    fn vendor_xyz2cam_normalize_maps_d65_to_neutral() {
        let raw = [1.2, 0.1, 0.05, 0.2, 0.9, 0.05, 0.05, 0.15, 0.8];
        let white = xy_to_xyz(cct_to_xy(ILLUMINANT_D65_K));
        let cm = normalize_xyz2cam(raw, white);
        let cam = mul3(cm, white);
        assert!((cam[0] - 1.0).abs() < 1e-5, "{cam:?}");
        assert!((cam[1] - 1.0).abs() < 1e-5, "{cam:?}");
        assert!((cam[2] - 1.0).abs() < 1e-5, "{cam:?}");
        let xyz = mul3(invert3(cm).unwrap(), [1.0, 1.0, 1.0]);
        assert!((xyz[1] - white[1]).abs() < 1e-4, "{xyz:?} white={white:?}");
    }

    #[test]
    fn identity_look_xmp_is_noop() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/fixtures/look_identity.xmp"
        );
        let mut p = DngProfile::default();
        apply_look_xmp(&mut p, Path::new(path)).expect("identity look");
        assert_eq!(p.look_dims, [2, 2, 2]);
        assert!(p.has_look);
        assert_eq!(p.look_name, "Identity Look");
        let rgb = [0.31, 0.22, 0.18];
        let out = apply_look_table(&p, rgb);
        assert!((out[0] - rgb[0]).abs() < 0.02, "{out:?}");
        assert!((out[1] - rgb[1]).abs() < 0.02, "{out:?}");
        assert!((out[2] - rgb[2]).abs() < 0.02, "{out:?}");
    }

    #[test]
    fn adobe_base85_roundtrip_length_prefix() {
        let encoded = "z1000n]m$uBRLy1V-G3JkLuC50m/50:}sZ{";
        let raw = inflate_big_table(&adobe_base85_decode(encoded)).expect("inflate");
        assert_eq!(raw.len(), 120);
        let mut p = DngProfile::default();
        parse_look_blob(&raw, &mut p).expect("blob");
        assert_eq!(p.look_dims, [2, 2, 2]);
    }

    #[test]
    fn parse_local_landscape_look_when_fetched() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../bench/lr-compare/datasets/looks/adobe_landscape.xmp"
        );
        let Ok(_) = std::fs::read_to_string(path) else {
            return;
        };
        let mut p = DngProfile::default();
        apply_look_xmp(&mut p, Path::new(path)).expect("landscape");
        assert_eq!(p.look_uuid.to_ascii_uppercase(), "0B3BFB5CFB7DBF7FF175E98F24D316B0");
        assert_eq!(p.look_dims, [36, 16, 16]);
        assert!(p.has_look);
        let mid = apply_look_table(&p, [0.22, 0.22, 0.22]);
        assert!(mid.iter().all(|c| c.is_finite()), "{mid:?}");
    }
}
