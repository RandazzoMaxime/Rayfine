#!/usr/bin/env python3
"""Image comparison metrics used against Lightroom exports.

ΔE2000, SSIM, per-channel histogram L1, clipping fraction, and separate
highlight (luma > 0.8) / shadow (luma < 0.1) mean absolute errors.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np

HIGHLIGHT_LUMA = 0.8
SHADOW_LUMA = 0.1


def srgb_to_linear(srgb: np.ndarray) -> np.ndarray:
    x = np.clip(srgb, 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(linear: np.ndarray) -> np.ndarray:
    x = np.clip(linear, 0.0, None)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def prophoto_to_srgb(prophoto: np.ndarray) -> np.ndarray:
    """ProPhoto RGB (gamma 1.8, D50) → sRGB display. Approximate Bradford D50→D65."""
    linear = np.clip(prophoto, 0.0, None) ** 1.8
    # ProPhoto RGB → XYZ D50
    m_pprgb_to_xyz = np.array(
        [
            [0.7976749, 0.1351917, 0.0313534],
            [0.2880402, 0.7118741, 0.0000857],
            [0.0000000, 0.0000000, 0.8252100],
        ],
        dtype=np.float64,
    )
    # Bradford D50 → D65
    m_d50_to_d65 = np.array(
        [
            [0.9555766, -0.0230393, 0.0631636],
            [-0.0282895, 1.0099416, 0.0210077],
            [0.0122982, -0.0204830, 1.3299098],
        ],
        dtype=np.float64,
    )
    m_xyz_to_srgb = np.array(
        [
            [3.2404542, -1.5371385, -0.4985314],
            [-0.9692660, 1.8760108, 0.0415560],
            [0.0556434, -0.2040259, 1.0572252],
        ],
        dtype=np.float64,
    )
    xyz_d50 = linear @ m_pprgb_to_xyz.T
    xyz_d65 = xyz_d50 @ m_d50_to_d65.T
    srgb_lin = xyz_d65 @ m_xyz_to_srgb.T
    return np.clip(linear_to_srgb(srgb_lin), 0.0, 1.0)


def _f_lab(t: np.ndarray) -> np.ndarray:
    delta = 6.0 / 29.0
    return np.where(t > delta**3, np.cbrt(t), t / (3.0 * delta**2) + 4.0 / 29.0)


def srgb_to_lab(srgb: np.ndarray) -> np.ndarray:
    linear = srgb_to_linear(srgb)
    m = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        dtype=np.float64,
    )
    xyz = linear @ m.T
    xn, yn, zn = 0.95047, 1.0, 1.08883
    fx = _f_lab(xyz[..., 0] / xn)
    fy = _f_lab(xyz[..., 1] / yn)
    fz = _f_lab(xyz[..., 2] / zn)
    lab = np.stack([116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], axis=-1)
    return lab


def delta_e2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000. Inputs are Lab arrays of shape (..., 3)."""
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    k_l = k_c = k_h = 1.0
    c1 = np.sqrt(a1 * a1 + b1 * b1)
    c2 = np.sqrt(a2 * a2 + b2 * b2)
    c_bar = 0.5 * (c1 + c2)
    c7 = c_bar**7
    g = 0.5 * (1.0 - np.sqrt(c7 / (c7 + 25.0**7)))
    a1p = (1.0 + g) * a1
    a2p = (1.0 + g) * a2
    c1p = np.sqrt(a1p * a1p + b1 * b1)
    c2p = np.sqrt(a2p * a2p + b2 * b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0
    dlp = l2 - l1
    dcp = c2p - c1p
    dhp = h2p - h1p
    dhp = np.where(c1p * c2p == 0.0, 0.0, dhp)
    dhp = np.where(dhp > 180.0, dhp - 360.0, dhp)
    dhp = np.where(dhp < -180.0, dhp + 360.0, dhp)
    dhp = 2.0 * np.sqrt(c1p * c2p) * np.sin(np.radians(dhp) / 2.0)
    l_bar = 0.5 * (l1 + l2)
    c_bar_p = 0.5 * (c1p + c2p)
    h_sum = h1p + h2p
    h_bar = np.where(
        c1p * c2p == 0.0,
        h_sum,
        np.where(
            np.abs(h1p - h2p) > 180.0,
            np.where(h_sum < 360.0, h_sum + 360.0, h_sum - 360.0) / 2.0,
            h_sum / 2.0,
        ),
    )
    t = (
        1.0
        - 0.17 * np.cos(np.radians(h_bar - 30.0))
        + 0.24 * np.cos(np.radians(2.0 * h_bar))
        + 0.32 * np.cos(np.radians(3.0 * h_bar + 6.0))
        - 0.20 * np.cos(np.radians(4.0 * h_bar - 63.0))
    )
    sl = 1.0 + (0.015 * (l_bar - 50.0) ** 2) / np.sqrt(20.0 + (l_bar - 50.0) ** 2)
    sc = 1.0 + 0.045 * c_bar_p
    sh = 1.0 + 0.015 * c_bar_p * t
    dtheta = 30.0 * np.exp(-(((h_bar - 275.0) / 25.0) ** 2))
    rc = 2.0 * np.sqrt(c_bar_p**7 / (c_bar_p**7 + 25.0**7))
    rt = -np.sin(np.radians(2.0 * dtheta)) * rc
    return np.sqrt(
        (dlp / (k_l * sl)) ** 2
        + (dcp / (k_c * sc)) ** 2
        + (dhp / (k_h * sh)) ** 2
        + rt * (dcp / (k_c * sc)) * (dhp / (k_h * sh))
    )


def luma(srgb: np.ndarray) -> np.ndarray:
    return 0.2126 * srgb[..., 0] + 0.7152 * srgb[..., 1] + 0.0722 * srgb[..., 2]


def histogram_l1(a: np.ndarray, b: np.ndarray, bins: int = 256) -> dict[str, float]:
    out: dict[str, float] = {}
    names = ("r", "g", "b")
    for i, name in enumerate(names):
        ha, _ = np.histogram(a[..., i], bins=bins, range=(0.0, 1.0), density=True)
        hb, _ = np.histogram(b[..., i], bins=bins, range=(0.0, 1.0), density=True)
        out[name] = float(np.mean(np.abs(ha - hb)))
    out["mean"] = float(np.mean([out["r"], out["g"], out["b"]]))
    return out


def clip_fraction(img: np.ndarray) -> dict[str, float]:
    hi = np.any(img >= 1.0 - 1.0 / 255.0, axis=-1)
    lo = np.any(img <= 1.0 / 255.0, axis=-1)
    n = float(img.shape[0] * img.shape[1])
    return {"hi": float(hi.mean()) if n else 0.0, "lo": float(lo.mean()) if n else 0.0}


def region_mae(pred: np.ndarray, ref: np.ndarray, mask: np.ndarray) -> float:
    if not np.any(mask):
        return float("nan")
    return float(np.mean(np.abs(pred[mask] - ref[mask])))


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Mean SSIM on luma, 8×8 non-overlapping windows, constants for 0–1 data."""
    ya = luma(a)
    yb = luma(b)
    c1 = 0.01**2
    c2 = 0.03**2
    h, w = ya.shape
    hs, ws = h - h % 8, w - w % 8
    if hs < 8 or ws < 8:
        mu_a = ya.mean()
        mu_b = yb.mean()
        sig_a = ya.var()
        sig_b = yb.var()
        sig_ab = ((ya - mu_a) * (yb - mu_b)).mean()
        return float(((2 * mu_a * mu_b + c1) * (2 * sig_ab + c2)) / ((mu_a**2 + mu_b**2 + c1) * (sig_a + sig_b + c2)))
    ya = ya[:hs, :ws].reshape(hs // 8, 8, ws // 8, 8)
    yb = yb[:hs, :ws].reshape(hs // 8, 8, ws // 8, 8)
    mu_a = ya.mean(axis=(1, 3))
    mu_b = yb.mean(axis=(1, 3))
    sig_a = ya.var(axis=(1, 3))
    sig_b = yb.var(axis=(1, 3))
    sig_ab = ((ya - mu_a[:, None, :, None]) * (yb - mu_b[:, None, :, None])).mean(axis=(1, 3))
    s = ((2 * mu_a * mu_b + c1) * (2 * sig_ab + c2)) / ((mu_a**2 + mu_b**2 + c1) * (sig_a + sig_b + c2))
    return float(s.mean())


@dataclass
class PairMetrics:
    de_mean: float
    de_p95: float
    ssim: float
    hist_l1: dict[str, float]
    clip_pred: dict[str, float]
    clip_ref: dict[str, float]
    highlight_mae: float
    shadow_mae: float
    mid_mae: float

    def as_dict(self) -> dict:
        return asdict(self)


def compare_srgb(pred: np.ndarray, ref: np.ndarray) -> PairMetrics:
    if pred.shape != ref.shape:
        raise ValueError(f"shape mismatch {pred.shape} vs {ref.shape}")
    lab_p = srgb_to_lab(pred)
    lab_r = srgb_to_lab(ref)
    de = delta_e2000(lab_p, lab_r)
    y_ref = luma(ref)
    hi = y_ref > HIGHLIGHT_LUMA
    sh = y_ref < SHADOW_LUMA
    mid = ~hi & ~sh
    return PairMetrics(
        de_mean=float(de.mean()),
        de_p95=float(np.percentile(de, 95)),
        ssim=ssim(pred, ref),
        hist_l1=histogram_l1(pred, ref),
        clip_pred=clip_fraction(pred),
        clip_ref=clip_fraction(ref),
        highlight_mae=region_mae(pred, ref, hi),
        shadow_mae=region_mae(pred, ref, sh),
        mid_mae=region_mae(pred, ref, mid),
    )


def nan_safe(value: float) -> float | None:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return None
    return float(value)
