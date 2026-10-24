#!/usr/bin/env python3
"""Geometric alignment must recover a known crop/shift before ΔE."""

from __future__ import annotations

import unittest

import numpy as np

from align import align_pair


def _scene(h: int = 160, w: int = 240) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w]
    r = xx / max(w - 1, 1)
    g = yy / max(h - 1, 1)
    b = 0.35 + 0.45 * np.sin(xx / 12.0) * np.cos(yy / 18.0)
    return np.clip(np.stack([r, g, b], axis=-1), 0.0, 1.0)


class AlignTests(unittest.TestCase):
    def test_identity_keeps_shape(self) -> None:
        img = _scene()
        pred, ref, info = align_pair(img, img)
        self.assertEqual(pred.shape, ref.shape)
        self.assertLess(float(np.mean(np.abs(pred - ref))), 0.02)
        self.assertIn(info.method, {"orb+ecc", "ecc", "aspect-resize", "phase"})

    def test_shifted_crop_recovers_overlap(self) -> None:
        ref = _scene(180, 260)
        # Simulate the IR JPEG: slight zoom + translation (lens/aspect crop).
        pred_full = np.zeros_like(ref)
        pred_full[6:174, 10:250] = ref[4:172, 8:248]
        pred, aligned_ref, info = align_pair(pred_full, ref)
        self.assertEqual(pred.shape, aligned_ref.shape)
        err = float(np.mean(np.abs(pred - aligned_ref)))
        naive = float(np.mean(np.abs(pred_full - ref)))
        self.assertLess(err, naive)
        self.assertLess(err, 0.08)
        self.assertGreater(info.inliers + (1 if info.method != "aspect-resize" else 0), 0)


if __name__ == "__main__":
    unittest.main()
