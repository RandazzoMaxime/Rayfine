// Port of LightCraft's global develop (storytold/lightcraft, MIT / Apache-2.0).
//
// Copyright (c) 2026 ArtCraft Team and the LightCraft contributors
// Copyright (c) 2026 Rayfine contributors (integration)
//
// Licensed under either of:
//   * MIT license (see THIRD_PARTY/lightcraft/LICENSE-MIT)
//   * Apache License, Version 2.0 (see THIRD_PARTY/lightcraft/LICENSE-APACHE)
// at your option. The algorithm, constants, and slider units below follow
// `lightcraft-pipeline` (`local.rs`, `tone.rs`, `finish.rs`, `colorops.rs`) and
// `lightcraft-color` (`cct.rs`, `perceptual.rs`) at LightCraft 0.13.0
// (`38f8d2508`). Keep this file in step with those sources.
//
// White balance: Temperature + Tint, as-shot, and the relative 6500 K / 0 =
// as-shot scale (Bradford, luminance-preserving) used on ARW/NEF/RW2 without
// camera matrices.
// Tone: `ToneMap::hdr` (extended Reinhard around grey 0.18), `ToneMap::camera`
// (Sony DRO-off 32-knot curve, CC0 pixls.us pool) and the V2 Highlights /
// Shadows log masks (`ss*1.7*ws*sqrt(ws) + hh*1.7*wh`).
// Colour: OkLab vibrance / saturation. Highlight rebuild stays in
// `scene_tone` (same block, before this stage).
//
// CPU and the WGSL in `shaders/lightcraft.wgsl` implement the same math.
// Preview and export both run that shader.

use crate::scene_tone::{
    reconstruct_image, reconstruct_pixel, ToneSliders, guided_filter, smoothstep,
};

/// Middle grey (LightCraft `tone::GREY`).
pub const GREY: f32 = 0.18;
/// Rec.2020 luminance (`lightcraft_color::LUMA_2020`).
pub const LUMA_2020: [f32; 3] = [0.2627, 0.6780, 0.0593];
/// Tint units per Duv (LightCraft `cct::TINT_SCALE`).
pub const TINT_SCALE: f64 = 3000.0;
pub const MIN_K: f64 = 1667.0;
pub const MAX_K: f64 = 25000.0;

/// Default develop path: LightCraft treatment.
pub const DEVELOP_PATH_LIGHTCRAFT: u32 = 0;
/// Previous Rayfine scene-linear / Adobe slider path (compare flag).
pub const DEVELOP_PATH_ADOBE: u32 = 1;
/// Oldest Highlights `pow` path.
pub const DEVELOP_PATH_LEGACY: u32 = 2;

/// Camera-tone selector uploaded to the GPU (`camera_tone` uniform).
pub const CAMERA_TONE_HDR: u32 = 0;
pub const CAMERA_TONE_SONY_DRO_OFF: u32 = 1;

/// Bradford cone matrix (XYZ → sharpened cones).
const BRADFORD: [[f64; 3]; 3] = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];
const BRADFORD_INV: [[f64; 3]; 3] = [
    [0.986_992_9, -0.147_054_3, 0.159_962_7],
    [0.432_305_3, 0.518_360_3, 0.049_291_2],
    [-0.008_528_7, 0.040_042_8, 0.968_486_7],
];

/// Linear sRGB → Rec.2020 (LightCraft `SRGB.to_space(&REC2020)`).
const SRGB_TO_REC2020: [[f32; 3]; 3] = [
    [0.627_403_9, 0.329_283_04, 0.043_313_066],
    [0.069_097_29, 0.919_540_4, 0.011_362_316],
    [0.016_391_439, 0.088_013_31, 0.895_595_25],
];
/// Linear Rec.2020 → sRGB.
const REC2020_TO_SRGB: [[f32; 3]; 3] = [
    [1.660_491_0, -0.587_641_14, -0.072_849_86],
    [-0.124_550_47, 1.132_899_9, -0.008_349_423],
    [-0.018_150_763, -0.100_578_90, 1.118_729_7],
];

/// Rec.2020 → LMS (OkLab, LightCraft `oklab_matrices`).
const OK_TO_LMS: [[f32; 3]; 3] = [
    [0.616_688_44, 0.360_159_07, 0.023_043_294],
    [0.265_140_20, 0.635_856_5, 0.099_030_23],
    [0.100_150_645, 0.204_004_32, 0.696_324_7],
];
const OK_FROM_LMS: [[f32; 3]; 3] = [
    [2.140_140_4, -1.246_356_0, 0.106_431_73],
    [-0.884_832_45, 2.163_172_7, -0.278_361_6],
    [-0.048_579_06, -0.454_490_9, 1.502_356_3],
];
const OK_TO_LAB: [[f32; 3]; 3] = [
    [0.210_454_26, 0.793_617_8, -0.004_072_047],
    [1.977_998_5, -2.428_592_2, 0.450_593_7],
    [0.025_904_037, 0.782_771_77, -0.808_675_77],
];
const OK_FROM_LAB: [[f32; 3]; 3] = [
    [1.0, 0.396_337_8, 0.215_803_76],
    [1.0, -0.105_561_34, -0.063_854_175],
    [1.0, -0.089_484_18, -1.291_485_5],
];

/// OkLCh hue (radians) of sRGB HSV hue 25° — LightCraft vibrance skin pivot.
pub const SKIN_HUE: f32 = 0.782_661_2;

/// Sony DRO-off 32-knot camera tone (CC0, pixls.us pool; LightCraft
/// `assets/camera-tone/sony-dro-off.json`).
pub const SONY_DRO_OFF: [[f32; 2]; 32] = [
    [0.01655, 0.01799],
    [0.01970, 0.02376],
    [0.02212, 0.03008],
    [0.02469, 0.03634],
    [0.02737, 0.04320],
    [0.03049, 0.05044],
    [0.03425, 0.05812],
    [0.03824, 0.06667],
    [0.04232, 0.07817],
    [0.04658, 0.09059],
    [0.05095, 0.10268],
    [0.05550, 0.11731],
    [0.05962, 0.13173],
    [0.06409, 0.14529],
    [0.06843, 0.15939],
    [0.07314, 0.17363],
    [0.07800, 0.18897],
    [0.08298, 0.20502],
    [0.08909, 0.22159],
    [0.09693, 0.23964],
    [0.10540, 0.26082],
    [0.11579, 0.28882],
    [0.12763, 0.31986],
    [0.14079, 0.35198],
    [0.15786, 0.39293],
    [0.17949, 0.44101],
    [0.20330, 0.49407],
    [0.23466, 0.54244],
    [0.27207, 0.60078],
    [0.31673, 0.66533],
    [0.38682, 0.74143],
    [0.52622, 0.80307],
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DevelopPath {
    LightCraft,
    Adobe,
    Legacy,
}

impl DevelopPath {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "adobe" | "old" | "previous" => Self::Adobe,
            "legacy" | "before" => Self::Legacy,
            _ => Self::LightCraft,
        }
    }

    pub fn as_u32(self) -> u32 {
        match self {
            Self::LightCraft => DEVELOP_PATH_LIGHTCRAFT,
            Self::Adobe => DEVELOP_PATH_ADOBE,
            Self::Legacy => DEVELOP_PATH_LEGACY,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WbMode {
    AsShot,
    Custom { temp: f64, tint: f64 },
    /// Relative scale: 6500 K / 0 means as-shot (LightCraft `WbScale::Legacy`).
    Relative { temp: f64, tint: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToneModel {
    Hdr,
    CameraSonyDroOff,
    Display,
}

impl ToneModel {
    pub fn for_make(make: Option<&str>) -> Self {
        match make.map(|m| m.to_ascii_lowercase()) {
            Some(m) if m.contains("sony") || m.contains("ilce") || m.contains("ilca") => {
                Self::CameraSonyDroOff
            }
            _ => Self::Hdr,
        }
    }

    pub fn as_u32(self) -> u32 {
        match self {
            Self::CameraSonyDroOff => CAMERA_TONE_SONY_DRO_OFF,
            Self::Hdr | Self::Display => CAMERA_TONE_HDR,
        }
    }
}

/// LightCraft slider units (−100..100 except exposure in EV).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LcSliders {
    pub exposure: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub contrast: f32,
    pub vibrance: f32,
    pub saturation: f32,
}

impl LcSliders {
    pub fn from_ui(
        exposure: f32,
        highlights: f32,
        shadows: f32,
        whites: f32,
        blacks: f32,
        contrast: f32,
        vibrance: f32,
        saturation: f32,
    ) -> Self {
        Self {
            exposure,
            highlights,
            shadows,
            whites,
            blacks,
            contrast,
            vibrance,
            saturation,
        }
    }

    pub fn from_tone(sliders: ToneSliders, vibrance: f32, saturation: f32) -> Self {
        Self {
            exposure: sliders.exposure,
            highlights: sliders.highlights * 120.0,
            shadows: sliders.shadows * 120.0,
            whites: sliders.whites * 30.0,
            blacks: sliders.blacks * 40.0,
            contrast: sliders.contrast * 100.0,
            vibrance,
            saturation,
        }
    }

    pub fn ui_label(&self, tone: ToneModel, wb: &str) -> String {
        format!(
            "LC  Exp {:+.2}  H {:+.0}  S {:+.0}  W {:+.0}  B {:+.0}  C {:+.0}  Vib {:+.0}  Sat {:+.0}  tone={tone:?}  WB {wb}",
            self.exposure,
            self.highlights,
            self.shadows,
            self.whites,
            self.blacks,
            self.contrast,
            self.vibrance,
            self.saturation
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LcDevelop {
    pub sliders: LcSliders,
    pub wb: WbMode,
    pub as_shot: (f64, f64),
    pub tone: ToneModel,
}

impl Default for LcDevelop {
    fn default() -> Self {
        Self {
            sliders: LcSliders::default(),
            wb: WbMode::AsShot,
            as_shot: (6500.0, 0.0),
            tone: ToneModel::Hdr,
        }
    }
}

#[inline]
pub fn lum2020(c: [f32; 3]) -> f32 {
    c[0] * LUMA_2020[0] + c[1] * LUMA_2020[1] + c[2] * LUMA_2020[2]
}

#[inline]
pub fn log_lum(c: [f32; 3]) -> f32 {
    (lum2020(c).max(1e-7) / GREY).log2()
}

#[inline]
fn mul3(m: [[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

#[inline]
fn mul3_d(m: [[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

#[inline]
pub fn srgb_to_rec2020(c: [f32; 3]) -> [f32; 3] {
    mul3(SRGB_TO_REC2020, c)
}

#[inline]
pub fn rec2020_to_srgb(c: [f32; 3]) -> [f32; 3] {
    mul3(REC2020_TO_SRGB, c)
}

#[inline]
fn wrap_angle(a: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    (a + std::f32::consts::PI).rem_euclid(tau) - std::f32::consts::PI
}

/// Kim et al. (2002) Planckian locus, LightCraft `cct::kim_xy`.
fn kim_xy(t: f64) -> (f64, f64) {
    let t = t.clamp(MIN_K, MAX_K);
    let (t2, t3) = (t * t, t * t * t);
    let x = if t <= 4000.0 {
        -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910
    } else {
        -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390
    };
    let (x2, x3) = (x * x, x * x * x);
    let y = if t <= 2222.0 {
        -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
    } else if t <= 4000.0 {
        -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
    } else {
        3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483
    };
    (x, y)
}

fn xy_to_uv(x: f64, y: f64) -> (f64, f64) {
    let d = -2.0 * x + 12.0 * y + 3.0;
    (4.0 * x / d, 6.0 * y / d)
}

fn uv_to_xy(u: f64, v: f64) -> (f64, f64) {
    let d = 2.0 * u - 8.0 * v + 4.0;
    (3.0 * u / d, 2.0 * v / d)
}

fn locus_uv(t: f64) -> (f64, f64) {
    let t = t.max(1000.0);
    if (MIN_K..=MAX_K).contains(&t) {
        let (x, y) = kim_xy(t);
        return xy_to_uv(x, y);
    }
    let (a, b) = if t < MIN_K {
        (MIN_K, MIN_K + 50.0)
    } else {
        (MAX_K - 500.0, MAX_K)
    };
    let (ua, va) = {
        let (x, y) = kim_xy(a);
        xy_to_uv(x, y)
    };
    let (ub, vb) = {
        let (x, y) = kim_xy(b);
        xy_to_uv(x, y)
    };
    let (ma, mb, m) = (1e6 / a, 1e6 / b, 1e6 / t);
    let s = (m - ma) / (mb - ma);
    (ua + (ub - ua) * s, va + (vb - va) * s)
}

fn locus_normal(t: f64) -> (f64, f64) {
    let m = 1e6 / t;
    let (u0, v0) = locus_uv(1e6 / (m + 1.0));
    let (u1, v1) = locus_uv(1e6 / (m - 1.0).max(1.0));
    let (du, dv) = (u1 - u0, v1 - v0);
    let l = du.hypot(dv).max(1e-12);
    let (nx, ny) = (-dv / l, du / l);
    if ny < 0.0 {
        (-nx, -ny)
    } else {
        (nx, ny)
    }
}

/// Source illuminant chromaticity. Positive tint = green source (magenta correction).
pub fn temp_tint_to_xy(t: f64, tint: f64) -> (f64, f64) {
    let (u, v) = locus_uv(t);
    let (nu, nv) = locus_normal(t);
    let duv = tint / TINT_SCALE;
    uv_to_xy(u + nu * duv, v + nv * duv)
}

fn xy_to_xyz(x: f64, y: f64) -> [f64; 3] {
    [x / y, 1.0, (1.0 - x - y) / y]
}

/// Rec.2020 D65 white in XYZ (Y = 1).
const D65_XYZ: [f64; 3] = [0.9504559270516716, 1.0, 1.0890577507598784];

/// Bradford adaptation XYZ → XYZ from `src` white to D65.
fn bradford_to_d65(src: (f64, f64)) -> [[f64; 3]; 3] {
    let s = mul3_d(BRADFORD, xy_to_xyz(src.0, src.1));
    let d = mul3_d(BRADFORD, D65_XYZ);
    let diag = [
        [d[0] / s[0], 0.0, 0.0],
        [0.0, d[1] / s[1], 0.0],
        [0.0, 0.0, d[2] / s[2]],
    ];
    // inv(B) * diag * B
    let mid = [
        [
            BRADFORD_INV[0][0] * diag[0][0],
            BRADFORD_INV[0][1] * diag[1][1],
            BRADFORD_INV[0][2] * diag[2][2],
        ],
        [
            BRADFORD_INV[1][0] * diag[0][0],
            BRADFORD_INV[1][1] * diag[1][1],
            BRADFORD_INV[1][2] * diag[2][2],
        ],
        [
            BRADFORD_INV[2][0] * diag[0][0],
            BRADFORD_INV[2][1] * diag[1][1],
            BRADFORD_INV[2][2] * diag[2][2],
        ],
    ];
    [
        [
            mid[0][0] * BRADFORD[0][0] + mid[0][1] * BRADFORD[1][0] + mid[0][2] * BRADFORD[2][0],
            mid[0][0] * BRADFORD[0][1] + mid[0][1] * BRADFORD[1][1] + mid[0][2] * BRADFORD[2][1],
            mid[0][0] * BRADFORD[0][2] + mid[0][1] * BRADFORD[1][2] + mid[0][2] * BRADFORD[2][2],
        ],
        [
            mid[1][0] * BRADFORD[0][0] + mid[1][1] * BRADFORD[1][0] + mid[1][2] * BRADFORD[2][0],
            mid[1][0] * BRADFORD[0][1] + mid[1][1] * BRADFORD[1][1] + mid[1][2] * BRADFORD[2][1],
            mid[1][0] * BRADFORD[0][2] + mid[1][1] * BRADFORD[1][2] + mid[1][2] * BRADFORD[2][2],
        ],
        [
            mid[2][0] * BRADFORD[0][0] + mid[2][1] * BRADFORD[1][0] + mid[2][2] * BRADFORD[2][0],
            mid[2][0] * BRADFORD[0][1] + mid[2][1] * BRADFORD[1][1] + mid[2][2] * BRADFORD[2][1],
            mid[2][0] * BRADFORD[0][2] + mid[2][1] * BRADFORD[1][2] + mid[2][2] * BRADFORD[2][2],
        ],
    ]
}

/// Rec.2020 → XYZ (LightCraft `REC2020.to_xyz`).
const REC2020_TO_XYZ: [[f64; 3]; 3] = [
    [0.636_958_048_3, 0.144_616_903_6, 0.168_880_975_2],
    [0.262_700_212_0, 0.677_998_071_5, 0.059_301_716_5],
    [0.000_000_000_0, 0.028_072_693_0, 1.060_985_057_7],
];
const XYZ_TO_REC2020: [[f64; 3]; 3] = [
    [1.716_651_188_0, -0.355_670_783_8, -0.253_366_281_4],
    [-0.666_684_351_8, 1.616_481_236_6, 0.015_768_545_8],
    [0.017_639_857_4, -0.042_770_613_3, 0.942_103_121_2],
];

fn mat_mul_d(a: [[f64; 3]; 3], b: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut o = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
    }
    o
}

/// Linear Rec.2020 WB matrix (as-shot → target), luminance-preserving.
/// `None` when the as-shot white is kept.
pub fn wb_matrix_for(as_shot: (f64, f64), target: (f64, f64)) -> Option<[[f32; 3]; 3]> {
    if (target.0 - as_shot.0).abs() < 1e-6 && (target.1 - as_shot.1).abs() < 1e-6 {
        return None;
    }
    let adapt_set = bradford_to_d65(target);
    let adapt_shot = bradford_to_d65(as_shot);
    // space.from_xyz * adapt * space.to_xyz
    let set = mat_mul_d(XYZ_TO_REC2020, mat_mul_d(adapt_set, REC2020_TO_XYZ));
    let shot = mat_mul_d(XYZ_TO_REC2020, mat_mul_d(adapt_shot, REC2020_TO_XYZ));
    // shot inverse
    let det = shot[0][0] * (shot[1][1] * shot[2][2] - shot[1][2] * shot[2][1])
        - shot[0][1] * (shot[1][0] * shot[2][2] - shot[1][2] * shot[2][0])
        + shot[0][2] * (shot[1][0] * shot[2][1] - shot[1][1] * shot[2][0]);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv_shot = [
        [
            (shot[1][1] * shot[2][2] - shot[1][2] * shot[2][1]) / det,
            (shot[0][2] * shot[2][1] - shot[0][1] * shot[2][2]) / det,
            (shot[0][1] * shot[1][2] - shot[0][2] * shot[1][1]) / det,
        ],
        [
            (shot[1][2] * shot[2][0] - shot[1][0] * shot[2][2]) / det,
            (shot[0][0] * shot[2][2] - shot[0][2] * shot[2][0]) / det,
            (shot[0][2] * shot[1][0] - shot[0][0] * shot[1][2]) / det,
        ],
        [
            (shot[1][0] * shot[2][1] - shot[1][1] * shot[2][0]) / det,
            (shot[0][1] * shot[2][0] - shot[0][0] * shot[2][1]) / det,
            (shot[0][0] * shot[1][1] - shot[0][1] * shot[1][0]) / det,
        ],
    ];
    let m = mat_mul_d(set, inv_shot);
    let g = mul3_d(m, [1.0, 1.0, 1.0]);
    let y = g[0] * 0.2627 + g[1] * 0.6780 + g[2] * 0.0593;
    if !y.is_finite() || y.abs() < 1e-12 {
        return None;
    }
    let s = 1.0 / y;
    Some([
        [
            (m[0][0] * s) as f32,
            (m[0][1] * s) as f32,
            (m[0][2] * s) as f32,
        ],
        [
            (m[1][0] * s) as f32,
            (m[1][1] * s) as f32,
            (m[1][2] * s) as f32,
        ],
        [
            (m[2][0] * s) as f32,
            (m[2][1] * s) as f32,
            (m[2][2] * s) as f32,
        ],
    ])
}

/// Compose the relative-scale white (6500/0 = as-shot) onto Kelvin.
pub fn legacy_white(temp: f64, tint: f64, as_shot: (f64, f64)) -> Option<(f64, f64)> {
    if !(temp.is_finite() && tint.is_finite() && as_shot.0.is_finite() && as_shot.1.is_finite()) {
        return None;
    }
    let cones = |t: f64, ti: f64| {
        let (x, y) = temp_tint_to_xy(t, ti);
        mul3_d(BRADFORD, xy_to_xyz(x, y))
    };
    let old = cones(temp, tint);
    let reference = cones(6500.0, 0.0);
    let shot = cones(as_shot.0, as_shot.1);
    let mut new = [0.0; 3];
    for i in 0..3 {
        if reference[i].abs() < 1e-12 {
            return None;
        }
        new[i] = old[i] * shot[i] / reference[i];
    }
    let xyz = mul3_d(BRADFORD_INV, new);
    let s = xyz[0] + xyz[1] + xyz[2];
    if s <= 0.0 || !xyz[1].is_finite() {
        return None;
    }
    Some((xyz[0] / s, xyz[1] / s))
}

pub fn legacy_to_kelvin(temp: f64, tint: f64, as_shot: (f64, f64)) -> (f64, f64) {
    if temp == 6500.0 && tint == 0.0 && as_shot.0.is_finite() && as_shot.1.is_finite() {
        return as_shot;
    }
    // Nearest-locus search in mired space (LightCraft `xy_to_temp_tint`).
    let Some((x, y)) = legacy_white(temp, tint, as_shot) else {
        return (temp, tint);
    };
    xy_to_temp_tint(x, y)
}

pub fn xy_to_temp_tint(x: f64, y: f64) -> (f64, f64) {
    let (u, v) = xy_to_uv(x, y);
    let dist = |m: f64| {
        let (lu, lv) = locus_uv(1e6 / m);
        (u - lu).powi(2) + (v - lv).powi(2)
    };
    let mut best = 20.0;
    let mut bd = f64::MAX;
    let mut m = 20.0;
    while m <= 1000.0 {
        let d = dist(m);
        if d < bd {
            bd = d;
            best = m;
        }
        m += 5.0;
    }
    let (mut a, mut b) = ((best - 5.0).max(20.0), (best + 5.0).min(1000.0));
    let g = 0.618_033_988_75;
    for _ in 0..60 {
        let c = b - g * (b - a);
        let d = a + g * (b - a);
        if dist(c) < dist(d) {
            b = d;
        } else {
            a = c;
        }
    }
    let m = (a + b) / 2.0;
    let t = 1e6 / m;
    let (lu, lv) = locus_uv(t);
    let (nu, nv) = locus_normal(t);
    let duv = (u - lu) * nu + (v - lv) * nv;
    (t, duv * TINT_SCALE)
}

pub fn effective_wb(dev: &LcDevelop) -> (f64, f64) {
    match dev.wb {
        WbMode::AsShot => dev.as_shot,
        WbMode::Custom { temp, tint } => (temp, tint),
        WbMode::Relative { temp, tint } => legacy_to_kelvin(temp, tint, dev.as_shot),
    }
}

pub fn apply_wb(rgb: [f32; 3], dev: &LcDevelop) -> [f32; 3] {
    let target = effective_wb(dev);
    match wb_matrix_for(dev.as_shot, target) {
        None => rgb,
        Some(m) => {
            let c = mul3(m, rgb);
            [c[0].max(0.0), c[1].max(0.0), c[2].max(0.0)]
        }
    }
}

/// Process V2 Highlights / Shadows (`finish.wgsl` / `local.rs`).
/// `hh`/`ss` are −1..1 (UI / 100). `base` is edge-aware log-luminance + EV.
pub fn v2_hs_delta(base: f32, hh: f32, ss: f32) -> f32 {
    if hh == 0.0 && ss == 0.0 {
        return 0.0;
    }
    let ws = 1.0 - smoothstep(-4.8, 0.3, base);
    let wh = smoothstep(-1.0, 2.8, base);
    ss * 1.7 * ws * ws.sqrt() + hh * 1.7 * wh
}

/// Sony / generic camera-tone knots (`CameraTone::apply`).
pub fn camera_tone_apply(y: f32, knots: &[[f32; 2]; 32]) -> f32 {
    if !y.is_finite() || y <= 0.0 {
        return 0.0;
    }
    let mut previous = [0.0, 0.0];
    for p in knots {
        if y <= p[0] {
            let t = (y - previous[0]) / (p[0] - previous[0]);
            return previous[1] + t * (p[1] - previous[1]);
        }
        previous = *p;
    }
    let a = knots[30];
    let b = knots[31];
    let slope = ((b[1] - a[1]) / (b[0] - a[0])).clamp(0.1, 16.0);
    1.0 - (1.0 - b[1]) * (-(y - b[0]) * slope / (1.0 - b[1]).max(0.01)).exp()
}

/// `ToneMap::hdr` closed form (the LUT source, peak = 1).
pub fn tone_hdr(y: f32, contrast: f32, whites: f32, blacks: f32) -> f32 {
    if y <= 0.0 {
        return 0.0;
    }
    let c = contrast / 100.0;
    let slope = if c >= 0.0 { 1.0 + 0.55 * c } else { 1.0 + 0.4 * c };
    let white_ev = 2.9 - 1.6 * (whites / 100.0);
    let wl = GREY * 2f32.powf(white_ev);
    let pre = 1.0 + GREY / wl;
    let ev = (y.max(1e-20) / GREY).log2();
    let yy = GREY * 2f32.powf(ev * slope) * pre;
    let mut o = yy * (1.0 + yy / (wl * wl)) / (1.0 + yy);
    o = o.min(1.0);
    let b = blacks / 100.0;
    if b < 0.0 {
        let k = -b * 0.035;
        let e = 0.004;
        let soft = |v: f32| ((v - k) + ((v - k) * (v - k) + e * e).sqrt()) * 0.5;
        o = (soft(o) - soft(0.0)) / (soft(1.0) - soft(0.0));
    } else if b > 0.0 {
        let k = b * 0.03;
        o = k + (1.0 - k) * o;
    }
    o.clamp(0.0, 1.0)
}

/// `ToneMap::display` closed form (identity at neutral, peak = 1).
pub fn tone_display(y: f32, contrast: f32, whites: f32, blacks: f32) -> f32 {
    if y <= 0.0 {
        return 0.0;
    }
    let c = contrast / 100.0;
    let w = whites / 100.0;
    let b = blacks / 100.0;
    let m = GREY.powf(1.0 / 2.2);
    let neutral = c == 0.0 && w == 0.0 && b == 0.0;
    let mut p = y.powf(1.0 / 2.2);
    if p <= 1.0 {
        p += c * 0.35 * (p - m) * (1.0 - (2.0 * p - 1.0).powi(2));
        let up = smoothstep(0.45, 1.0, p);
        p += w * 0.12 * up * (1.0 - p * 0.5);
        let lo = 1.0 - smoothstep(0.0, 0.45, p);
        p += b * 0.07 * lo * (p * 2.0).min(1.0);
    } else {
        p += w * 0.12 * 0.5;
    }
    let mut o = p.max(0.0).powf(2.2);
    if o > 0.95 && !neutral {
        let d = (o - 0.95).min(0.1);
        o = 0.95 + d - d * d / 0.2;
    }
    o.clamp(0.0, 1.0)
}

/// `ToneMap::camera` (SDR): camera curve, then display contrast/whites/blacks.
pub fn tone_camera(y: f32, knots: &[[f32; 2]; 32], contrast: f32, whites: f32, blacks: f32) -> f32 {
    let mapped = camera_tone_apply(y, knots);
    if contrast == 0.0 && whites == 0.0 && blacks == 0.0 {
        mapped
    } else {
        tone_display(mapped, contrast, whites, blacks)
    }
}

pub fn tone_apply(y: f32, sliders: LcSliders, tone: ToneModel) -> f32 {
    match tone {
        ToneModel::Hdr => tone_hdr(y, sliders.contrast, sliders.whites, sliders.blacks),
        ToneModel::CameraSonyDroOff => {
            tone_camera(y, &SONY_DRO_OFF, sliders.contrast, sliders.whites, sliders.blacks)
        }
        ToneModel::Display => tone_display(y, sliders.contrast, sliders.whites, sliders.blacks),
    }
}

/// Highlight desaturation after the tone map (`finish.wgsl`).
pub fn highlight_desat(d: [f32; 3], o: f32) -> [f32; 3] {
    let mx = d[0].max(d[1]).max(d[2]);
    if mx > 1.0 {
        let t = ((mx - 1.0) / (mx - o).max(1e-6)).clamp(0.0, 1.0);
        [
            d[0] + (o - d[0]) * t,
            d[1] + (o - d[1]) * t,
            d[2] + (o - d[2]) * t,
        ]
    } else {
        d
    }
}

fn oklab_from_2020(rgb: [f32; 3]) -> [f32; 3] {
    let lms = mul3(OK_TO_LMS, rgb);
    let cbrt = [lms[0].cbrt(), lms[1].cbrt(), lms[2].cbrt()];
    mul3(OK_TO_LAB, cbrt)
}

fn oklab_to_2020(lab: [f32; 3]) -> [f32; 3] {
    let l = mul3(OK_FROM_LAB, lab);
    mul3(OK_FROM_LMS, [l[0] * l[0] * l[0], l[1] * l[1] * l[1], l[2] * l[2] * l[2]])
}

/// OkLab vibrance + saturation (`ColorOps::apply`, mixer off).
pub fn apply_vibrance_sat(rgb: [f32; 3], vibrance: f32, saturation: f32) -> [f32; 3] {
    if vibrance == 0.0 && saturation == 0.0 {
        return rgb;
    }
    let vib = vibrance / 100.0;
    let sat = saturation / 100.0;
    let mut lab = oklab_from_2020(rgb);
    let c0 = (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
    let mut c = c0;
    if vib != 0.0 {
        let low = 1.0 - (c / 0.22).clamp(0.0, 1.0);
        let skin = if vib > 0.0 {
            1.0 - 0.6 * (-(wrap_angle(lab[2].atan2(lab[1]) - SKIN_HUE) / 0.35).powi(2)).exp()
        } else {
            1.0
        };
        c *= (1.0 + vib * low * low * skin * 1.2).max(0.0);
    }
    if sat != 0.0 {
        c *= (1.0 + sat).max(0.0);
    }
    if c0 > 0.0 {
        let k = c / c0;
        lab[1] *= k;
        lab[2] *= k;
    }
    oklab_to_2020(lab)
}

pub fn encode_srgb(v: f32) -> f32 {
    if v <= 0.0 {
        0.0
    } else if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// One pixel: linear sRGB in → encoded sRGB out (LightCraft global develop).
pub fn develop_pixel_lc(rgb_srgb: [f32; 3], mask_luma_srgb: f32, dev: &LcDevelop) -> [f32; 3] {
    let reconstructed = reconstruct_pixel(rgb_srgb, None);
    let mut c = srgb_to_rec2020(reconstructed);
    c = apply_wb(c, dev);
    let gain = 2f32.powf(dev.sliders.exposure);
    c = [c[0] * gain, c[1] * gain, c[2] * gain];
    let base = (mask_luma_srgb.max(1e-7) / GREY).log2() + dev.sliders.exposure;
    let delta = v2_hs_delta(
        base,
        dev.sliders.highlights / 100.0,
        dev.sliders.shadows / 100.0,
    );
    if delta != 0.0 {
        let g = 2f32.powf(delta);
        c = [c[0] * g, c[1] * g, c[2] * g];
    }
    let yl = lum2020(c);
    let o = tone_apply(yl, dev.sliders, dev.tone);
    let mut d = if yl > 1e-9 {
        [c[0] * o / yl, c[1] * o / yl, c[2] * o / yl]
    } else {
        [0.0; 3]
    };
    d = highlight_desat(d, o);
    d = apply_vibrance_sat(d, dev.sliders.vibrance, dev.sliders.saturation);
    let s = rec2020_to_srgb(d);
    [
        encode_srgb(s[0]).clamp(0.0, 1.0),
        encode_srgb(s[1]).clamp(0.0, 1.0),
        encode_srgb(s[2]).clamp(0.0, 1.0),
    ]
}

/// Rec.2020-linear in → encoded sRGB out (when the caller already converted).
pub fn develop_pixel_rec2020(rgb: [f32; 3], mask_luma: f32, dev: &LcDevelop) -> [f32; 3] {
    let mut c = apply_wb(rgb, dev);
    let gain = 2f32.powf(dev.sliders.exposure);
    c = [c[0].max(0.0) * gain, c[1].max(0.0) * gain, c[2].max(0.0) * gain];
    let base = (mask_luma.max(1e-7) / GREY).log2() + dev.sliders.exposure;
    let delta = v2_hs_delta(
        base,
        dev.sliders.highlights / 100.0,
        dev.sliders.shadows / 100.0,
    );
    if delta != 0.0 {
        let g = 2f32.powf(delta);
        c = [c[0] * g, c[1] * g, c[2] * g];
    }
    let yl = lum2020(c);
    let o = tone_apply(yl, dev.sliders, dev.tone);
    let mut d = if yl > 1e-9 {
        [c[0] * o / yl, c[1] * o / yl, c[2] * o / yl]
    } else {
        [0.0; 3]
    };
    d = highlight_desat(d, o);
    d = apply_vibrance_sat(d, dev.sliders.vibrance, dev.sliders.saturation);
    let s = rec2020_to_srgb(d);
    [
        encode_srgb(s[0]).clamp(0.0, 1.0),
        encode_srgb(s[1]).clamp(0.0, 1.0),
        encode_srgb(s[2]).clamp(0.0, 1.0),
    ]
}

/// Guided Rec.2020 luma at 0.15 % of the long edge (LightCraft V2 `tone_base`).
pub fn v2_tone_base(lumas: &[f32], width: usize, height: usize) -> Vec<f32> {
    let long = width.max(height) as f32;
    let radius = ((0.0015 * long).round() as usize).max(1);
    guided_filter(lumas, lumas, width, height, radius, 1e-4)
}

/// Whole-image LightCraft develop. `pixels` are linear sRGB (Rayfine working).
pub fn develop_image_lc(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    dev: &LcDevelop,
) -> Vec<[f32; 3]> {
    let n = width * height;
    let mut work = pixels[..n].to_vec();
    reconstruct_image(&mut work, width, height);
    for px in &mut work {
        *px = srgb_to_rec2020(*px);
        *px = apply_wb(*px, dev);
        let g = 2f32.powf(dev.sliders.exposure);
        *px = [px[0] * g, px[1] * g, px[2] * g];
    }
    let lumas: Vec<f32> = work.iter().map(|p| lum2020(*p).max(1e-8)).collect();
    let need_hs = dev.sliders.highlights.abs() > 1e-6 || dev.sliders.shadows.abs() > 1e-6;
    let mask = if need_hs {
        v2_tone_base(&lumas, width, height)
    } else {
        lumas.clone()
    };
    work.iter()
        .zip(mask.iter())
        .map(|(rgb, m)| {
            let mut c = *rgb;
            let base = (*m / GREY).log2();
            let delta = v2_hs_delta(
                base,
                dev.sliders.highlights / 100.0,
                dev.sliders.shadows / 100.0,
            );
            if delta != 0.0 {
                let g = 2f32.powf(delta);
                c = [c[0] * g, c[1] * g, c[2] * g];
            }
            let yl = lum2020(c);
            let o = tone_apply(yl, dev.sliders, dev.tone);
            let mut d = if yl > 1e-9 {
                [c[0] * o / yl, c[1] * o / yl, c[2] * o / yl]
            } else {
                [0.0; 3]
            };
            d = highlight_desat(d, o);
            d = apply_vibrance_sat(d, dev.sliders.vibrance, dev.sliders.saturation);
            let s = rec2020_to_srgb(d);
            [
                encode_srgb(s[0]).clamp(0.0, 1.0),
                encode_srgb(s[1]).clamp(0.0, 1.0),
                encode_srgb(s[2]).clamp(0.0, 1.0),
            ]
        })
        .collect()
}

/// Rec.2020-linear image (e.g. after optional DCP colour-only).
pub fn develop_image_rec2020(
    pixels: &[[f32; 3]],
    width: usize,
    height: usize,
    dev: &LcDevelop,
) -> Vec<[f32; 3]> {
    let n = width * height;
    let mut work = pixels[..n].to_vec();
    for px in &mut work {
        *px = apply_wb(*px, dev);
        let g = 2f32.powf(dev.sliders.exposure);
        *px = [px[0].max(0.0) * g, px[1].max(0.0) * g, px[2].max(0.0) * g];
    }
    let lumas: Vec<f32> = work.iter().map(|p| lum2020(*p).max(1e-8)).collect();
    let need_hs = dev.sliders.highlights.abs() > 1e-6 || dev.sliders.shadows.abs() > 1e-6;
    let mask = if need_hs {
        v2_tone_base(&lumas, width, height)
    } else {
        lumas
    };
    work.iter()
        .zip(mask.iter())
        .map(|(rgb, m)| {
            let mut c = *rgb;
            let base = (*m / GREY).log2();
            let delta = v2_hs_delta(
                base,
                dev.sliders.highlights / 100.0,
                dev.sliders.shadows / 100.0,
            );
            if delta != 0.0 {
                let g = 2f32.powf(delta);
                c = [c[0] * g, c[1] * g, c[2] * g];
            }
            let yl = lum2020(c);
            let o = tone_apply(yl, dev.sliders, dev.tone);
            let mut d = if yl > 1e-9 {
                [c[0] * o / yl, c[1] * o / yl, c[2] * o / yl]
            } else {
                [0.0; 3]
            };
            d = highlight_desat(d, o);
            d = apply_vibrance_sat(d, dev.sliders.vibrance, dev.sliders.saturation);
            let s = rec2020_to_srgb(d);
            [
                encode_srgb(s[0]).clamp(0.0, 1.0),
                encode_srgb(s[1]).clamp(0.0, 1.0),
                encode_srgb(s[2]).clamp(0.0, 1.0),
            ]
        })
        .collect()
}

/// Linear display-referred sRGB of a Rec.2020 pixel after tone (no encode).
pub fn develop_linear_rec2020(rgb: [f32; 3], mask_luma: f32, dev: &LcDevelop) -> [f32; 3] {
    let mut c = apply_wb(rgb, dev);
    let gain = 2f32.powf(dev.sliders.exposure);
    c = [c[0].max(0.0) * gain, c[1].max(0.0) * gain, c[2].max(0.0) * gain];
    let base = (mask_luma.max(1e-7) / GREY).log2() + dev.sliders.exposure;
    let delta = v2_hs_delta(
        base,
        dev.sliders.highlights / 100.0,
        dev.sliders.shadows / 100.0,
    );
    if delta != 0.0 {
        let g = 2f32.powf(delta);
        c = [c[0] * g, c[1] * g, c[2] * g];
    }
    let yl = lum2020(c);
    let o = tone_apply(yl, dev.sliders, dev.tone);
    let mut d = if yl > 1e-9 {
        [c[0] * o / yl, c[1] * o / yl, c[2] * o / yl]
    } else {
        [0.0; 3]
    };
    d = highlight_desat(d, o);
    apply_vibrance_sat(d, dev.sliders.vibrance, dev.sliders.saturation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn almost(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() <= eps
    }

    #[test]
    fn as_shot_wb_is_identity() {
        let dev = LcDevelop::default();
        let rgb = [0.4, 0.3, 0.2];
        let out = apply_wb(rgb, &dev);
        assert!(almost(out[0], 0.4, 1e-6) && almost(out[1], 0.3, 1e-6) && almost(out[2], 0.2, 1e-6));
    }

    #[test]
    fn relative_6500_is_as_shot() {
        let (t, tint) = legacy_to_kelvin(6500.0, 0.0, (5200.0, -8.0));
        assert!((t - 5200.0).abs() < 1e-6);
        assert!((tint + 8.0).abs() < 1e-6);
    }

    #[test]
    fn warmer_is_redder() {
        let warm = temp_tint_to_xy(3000.0, 0.0);
        let cool = temp_tint_to_xy(9000.0, 0.0);
        assert!(warm.0 > cool.0);
    }

    #[test]
    fn hdr_mid_grey_and_shoulder() {
        let o18 = tone_hdr(0.18, 0.0, 0.0, 0.0);
        assert!(almost(o18, 0.188_681_84, 2e-4), "{o18}");
        assert!(tone_hdr(0.01, 0.0, 0.0, 0.0) < tone_hdr(0.18, 0.0, 0.0, 0.0));
        assert!(tone_hdr(1.2, 0.0, 0.0, 0.0) <= 1.0);
        let contrast = tone_hdr(0.4, 40.0, 0.0, 0.0);
        assert!(contrast > tone_hdr(0.4, 0.0, 0.0, 0.0));
    }

    #[test]
    fn v2_highlights_pull_bright_and_leave_shadows() {
        let hh = -1.0;
        let bright = v2_hs_delta(2.0, hh, 0.0);
        let mid = v2_hs_delta(0.0, hh, 0.0);
        let dark = v2_hs_delta(-4.0, hh, 0.0);
        assert!(bright < mid && mid <= 0.0);
        assert!(dark.abs() < 0.05, "{dark}");
        let lift = v2_hs_delta(-3.0, 0.0, 1.0);
        assert!(lift > 0.5);
    }

    #[test]
    fn sony_camera_tone_is_monotone() {
        let mut prev = 0.0;
        for i in 0..200 {
            let y = 0.01 * 1.03f32.powi(i);
            let v = camera_tone_apply(y, &SONY_DRO_OFF);
            assert!(v + 1e-5 >= prev, "non-monotone at {y}: {v} < {prev}");
            prev = v;
        }
    }

    #[test]
    fn vibrance_boosts_low_chroma() {
        let muted = apply_vibrance_sat([0.20, 0.18, 0.16], 40.0, 0.0);
        let vivid = apply_vibrance_sat([0.40, 0.10, 0.08], 40.0, 0.0);
        let muted0 = apply_vibrance_sat([0.20, 0.18, 0.16], 0.0, 0.0);
        let c = |p: [f32; 3]| {
            let m = p[0].max(p[1]).max(p[2]);
            let n = p[0].min(p[1]).min(p[2]);
            m - n
        };
        assert!(c(muted) > c(muted0));
        // already-saturated colours move less than muted ones
        let vivid0 = apply_vibrance_sat([0.40, 0.10, 0.08], 0.0, 0.0);
        assert!((c(vivid) - c(vivid0)) < (c(muted) - c(muted0)) * 2.0 + 0.05);
    }

    #[test]
    fn default_path_is_lightcraft() {
        assert_eq!(DevelopPath::parse("").as_u32(), DEVELOP_PATH_LIGHTCRAFT);
        assert_eq!(DevelopPath::parse("lightcraft").as_u32(), DEVELOP_PATH_LIGHTCRAFT);
        assert_eq!(DevelopPath::parse("adobe").as_u32(), DEVELOP_PATH_ADOBE);
        assert_eq!(DevelopPath::parse("legacy").as_u32(), DEVELOP_PATH_LEGACY);
    }

    #[test]
    fn cpu_gpu_math_twins_on_hdr_and_hs() {
        // The WGSL twins use the same closed form; this locks the numbers the
        // shader must reproduce (mean |Δ| < 0.5 LSB once encoded).
        let y = 0.18f32;
        let o = tone_hdr(y, 25.0, -10.0, 5.0);
        assert!(almost(o, 0.1887, 0.03), "{o}");
        let d = v2_hs_delta(-1.0, -0.5, 0.4);
        let ws = 1.0 - smoothstep(-4.8, 0.3, -1.0);
        let wh = smoothstep(-1.0, 2.8, -1.0);
        let expect = 0.4 * 1.7 * ws * ws.sqrt() + (-0.5) * 1.7 * wh;
        assert!(almost(d, expect, 1e-6));
    }

    #[test]
    fn gpu_equivalence_skips_without_adapter() {
        // LightCraft `crates/gpu/tests/it/equivalence.rs`: skip when no adapter.
        let instance = wgpu::Instance::default();
        let adapter = pollster::block_on(instance.request_adapter(&Default::default()));
        if adapter.is_err() {
            eprintln!("skip gpu equivalence: no GPU adapter");
            return;
        }
        let src = include_str!("shaders/lightcraft.wgsl");
        assert!(src.contains("fn lc_tone_hdr"), "WGSL twin missing lc_tone_hdr");
        assert!(src.contains("fn lc_v2_hs_delta"), "WGSL twin missing V2 H/S");
        assert!(src.contains("fn lc_apply_wb"), "WGSL twin missing WB");
        assert!(src.contains("fn lc_vibrance_sat"), "WGSL twin missing vibrance");
        assert!(src.contains("SONY_DRO_OFF"), "WGSL twin missing camera tone");
    }
}
