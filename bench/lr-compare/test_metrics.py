#!/usr/bin/env python3
"""Numeric tests for ΔE2000 / SSIM / clip helpers."""

from __future__ import annotations

import unittest

import numpy as np

from metrics import (
    compare_srgb,
    de_heatmap_srgb,
    delta_e2000,
    delta_e_map,
    downsample_blur,
    robust_compare,
    sky_lab_stats,
    srgb_to_lab,
    ssim,
    zone_delta_e,
)


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

    def test_delta_e_map_and_heatmap_shape(self) -> None:
        a = np.full((4, 6, 3), 0.2)
        b = np.full((4, 6, 3), 0.8)
        de = delta_e_map(a, b)
        self.assertEqual(de.shape, (4, 6))
        self.assertTrue(np.all(de > 10.0))
        heat = de_heatmap_srgb(de, 20.0)
        self.assertEqual(heat.shape, (4, 6, 3))

    def test_downsample_blur_shrinks_and_softens(self) -> None:
        rng = np.random.default_rng(1)
        img = rng.random((200, 800, 3))
        out = downsample_blur(img, width=200, radius=1.0)
        self.assertEqual(out.shape[1], 200)
        self.assertLess(out.std(), img.std())

    def test_zone_delta_e_splits_sky_and_shadows(self) -> None:
        ref = np.zeros((40, 40, 3), dtype=np.float64)
        ref[:12] = (0.55, 0.45, 0.25)  # warm sky
        ref[12:28] = 0.4
        ref[28:] = 0.05
        pred = ref.copy()
        pred[:12] = (0.35, 0.40, 0.50)  # grey-blue sky
        zones = zone_delta_e(pred, ref)
        self.assertIsNotNone(zones["sky"])
        self.assertGreater(zones["sky"], zones["mids"])
        robust = robust_compare(pred, ref, width=32, radius=0.6)
        self.assertGreater(robust["de_mean"], 1.0)
        sky = sky_lab_stats(ref)
        self.assertGreater(sky["b"], 0.0)  # yellow-orange


if __name__ == "__main__":
    unittest.main()
