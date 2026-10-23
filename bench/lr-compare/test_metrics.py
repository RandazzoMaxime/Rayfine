#!/usr/bin/env python3
"""Numeric tests for ΔE2000 / SSIM / clip helpers."""

from __future__ import annotations

import unittest

import numpy as np

from metrics import compare_srgb, delta_e2000, srgb_to_lab, ssim


class MetricsTests(unittest.TestCase):
    def test_identical_is_zero_delta_e(self) -> None:
        img = np.full((16, 16, 3), 0.4, dtype=np.float64)
        m = compare_srgb(img, img)
        self.assertLess(m.de_mean, 1e-6)
        self.assertLess(m.de_p95, 1e-6)
        self.assertGreater(m.ssim, 0.999)
        self.assertTrue(np.isnan(m.highlight_mae))
        self.assertTrue(np.isnan(m.shadow_mae))

    def test_delta_e_known_pair(self) -> None:
        # sRGB red vs sRGB green is a large ΔE2000 (well above 50).
        red = srgb_to_lab(np.array([[[1.0, 0.0, 0.0]]]))
        green = srgb_to_lab(np.array([[[0.0, 1.0, 0.0]]]))
        de = float(delta_e2000(red, green)[0, 0])
        self.assertGreater(de, 50.0)

    def test_highlight_region_error(self) -> None:
        ref = np.zeros((8, 8, 3), dtype=np.float64)
        ref[:4] = 0.95
        ref[4:] = 0.05
        pred = ref.copy()
        pred[:4] = 1.0
        m = compare_srgb(pred, ref)
        self.assertGreater(m.highlight_mae, 0.04)
        self.assertLess(m.shadow_mae, 1e-6)

    def test_ssim_degrades_on_noise(self) -> None:
        rng = np.random.default_rng(0)
        a = np.full((32, 32, 3), 0.5)
        b = np.clip(a + rng.normal(0.0, 0.2, a.shape), 0.0, 1.0)
        self.assertGreater(ssim(a, a), 0.99)
        self.assertLess(ssim(a, b), 0.9)


if __name__ == "__main__":
    unittest.main()
