#!/usr/bin/env python3
"""Geometric alignment of a develop render onto a Lightroom JPEG.

IR JPEGs already include lens distortion / CA and a light aspect crop. A
center-crop + resize therefore measures shifted edges. This module estimates a
homography (ORB + RANSAC, then ECC) and crops both images to the overlap.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from PIL import Image

from compare_public_pairs import _center_crop_to_aspect


@dataclass
class AlignInfo:
    method: str
    inliers: int = 0
    matches: int = 0
    ecc: float | None = None
    crop: tuple[int, int, int, int] | None = None
    residual_px: float | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def _to_u8(arr: np.ndarray) -> np.ndarray:
    return np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)


def _gray_u8(arr: np.ndarray) -> np.ndarray:
    rgb = _to_u8(arr)
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.uint8)


def _resize_to(arr: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    if arr.shape[0] == size[1] and arr.shape[1] == size[0]:
        return arr
    img = Image.fromarray(_to_u8(arr), mode="RGB")
    img = img.resize(size, Image.Resampling.LANCZOS)
    return np.asarray(img).astype(np.float64) / 255.0


def _init_aspect(pred: np.ndarray, ref: np.ndarray) -> np.ndarray:
    target_aspect = ref.shape[1] / max(ref.shape[0], 1)
    cropped = _center_crop_to_aspect(pred, target_aspect)
    return _resize_to(cropped, (ref.shape[1], ref.shape[0]))


def _valid_crop(mask: np.ndarray, margin: int = 4) -> tuple[int, int, int, int] | None:
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return None
    y0, y1 = int(rows[0]), int(rows[-1]) + 1
    x0, x1 = int(cols[0]), int(cols[-1]) + 1
    y0 = min(mask.shape[0] - 1, y0 + margin)
    x0 = min(mask.shape[1] - 1, x0 + margin)
    y1 = max(y0 + 1, y1 - margin)
    x1 = max(x0 + 1, x1 - margin)
    if (y1 - y0) < mask.shape[0] * 0.55 or (x1 - x0) < mask.shape[1] * 0.55:
        return None
    return x0, y0, x1, y1


def _warp_homography(pred: np.ndarray, h: np.ndarray, size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    import cv2

    w, ht = size
    warped = cv2.warpPerspective(
        _to_u8(pred),
        h,
        (w, ht),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    ones = np.ones((pred.shape[0], pred.shape[1]), dtype=np.uint8) * 255
    mask = cv2.warpPerspective(ones, h, (w, ht), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return warped.astype(np.float64) / 255.0, mask > 127


def _orb_homography(pred_g: np.ndarray, ref_g: np.ndarray) -> tuple[np.ndarray | None, int, int]:
    import cv2

    orb = cv2.ORB_create(nfeatures=2500, scaleFactor=1.2, nlevels=8)
    kp1, d1 = orb.detectAndCompute(pred_g, None)
    kp2, d2 = orb.detectAndCompute(ref_g, None)
    if d1 is None or d2 is None or len(kp1) < 12 or len(kp2) < 12:
        return None, 0, 0
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    knn = matcher.knnMatch(d1, d2, k=2)
    good = []
    for pair in knn:
        if len(pair) < 2:
            continue
        a, b = pair
        if a.distance < 0.75 * b.distance:
            good.append(a)
    if len(good) < 12:
        return None, 0, len(good)
    src = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    h, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if h is None or mask is None:
        return None, 0, len(good)
    inliers = int(mask.ravel().sum())
    if inliers < 10:
        return None, inliers, len(good)
    return h, inliers, len(good)


def _ecc_refine(pred_g: np.ndarray, ref_g: np.ndarray, h0: np.ndarray) -> tuple[np.ndarray, float | None]:
    import cv2

    pred_f = pred_g.astype(np.float32) / 255.0
    ref_f = ref_g.astype(np.float32) / 255.0
    warp = h0.astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-6)
    try:
        cc, warp = cv2.findTransformECC(
            ref_f,
            pred_f,
            warp,
            cv2.MOTION_HOMOGRAPHY,
            criteria,
            None,
            5,
        )
        return warp.astype(np.float64), float(cc)
    except cv2.error:
        return h0, None


def _phase_shift(pred_g: np.ndarray, ref_g: np.ndarray) -> tuple[float, float]:
    a = pred_g.astype(np.float64)
    b = ref_g.astype(np.float64)
    a -= a.mean()
    b -= b.mean()
    fa = np.fft.fft2(a)
    fb = np.fft.fft2(b)
    r = fa * np.conj(fb)
    r /= np.maximum(np.abs(r), 1e-12)
    c = np.fft.ifft2(r).real
    peak = np.unravel_index(int(np.argmax(c)), c.shape)
    dy = float(peak[0] if peak[0] <= c.shape[0] / 2 else peak[0] - c.shape[0])
    dx = float(peak[1] if peak[1] <= c.shape[1] / 2 else peak[1] - c.shape[1])
    return dx, dy


def align_pair(pred: np.ndarray, ref: np.ndarray) -> tuple[np.ndarray, np.ndarray, AlignInfo]:
    """Warp `pred` onto `ref` and crop both to the common overlap."""
    init = _init_aspect(pred, ref)
    info = AlignInfo(method="aspect-resize")
    aligned = init
    mask = np.ones(init.shape[:2], dtype=bool)

    try:
        import cv2
    except ImportError:
        cv2 = None

    if cv2 is not None:
        pred_g = _gray_u8(init)
        ref_g = _gray_u8(ref)
        h, inliers, matches = _orb_homography(pred_g, ref_g)
        info.matches = matches
        info.inliers = inliers
        if h is None:
            h = np.eye(3, dtype=np.float64)
        h, ecc = _ecc_refine(pred_g, ref_g, h)
        info.ecc = ecc
        info.method = "orb+ecc" if inliers >= 10 else "ecc"
        aligned, mask = _warp_homography(init, h, (ref.shape[1], ref.shape[0]))
        corners = np.array([[0, 0], [init.shape[1], 0], [init.shape[1], init.shape[0]], [0, init.shape[0]]], dtype=np.float64)
        ones = np.ones((4, 1))
        mapped = (h @ np.hstack([corners, ones]).T).T
        mapped = mapped[:, :2] / mapped[:, 2:3]
        info.residual_px = float(np.mean(np.linalg.norm(mapped - corners, axis=1)))
    else:
        pred_g = _gray_u8(init)
        ref_g = _gray_u8(ref)
        dx, dy = _phase_shift(pred_g, ref_g)
        if abs(dx) >= 0.4 or abs(dy) >= 0.4:
            info.method = "phase"
            shifted = np.zeros_like(init)
            x0 = int(round(dx))
            y0 = int(round(dy))
            src_x0 = max(0, -x0)
            src_y0 = max(0, -y0)
            dst_x0 = max(0, x0)
            dst_y0 = max(0, y0)
            w = min(init.shape[1] - src_x0, init.shape[1] - dst_x0)
            h = min(init.shape[0] - src_y0, init.shape[0] - dst_y0)
            if w > 8 and h > 8:
                shifted[dst_y0 : dst_y0 + h, dst_x0 : dst_x0 + w] = init[src_y0 : src_y0 + h, src_x0 : src_x0 + w]
                mask = np.zeros(init.shape[:2], dtype=bool)
                mask[dst_y0 : dst_y0 + h, dst_x0 : dst_x0 + w] = True
                aligned = shifted
                info.residual_px = float(np.hypot(dx, dy))

    box = _valid_crop(mask)
    if box is None:
        return aligned, ref, info
    x0, y0, x1, y1 = box
    info.crop = box
    return aligned[y0:y1, x0:x1], ref[y0:y1, x0:x1], info
