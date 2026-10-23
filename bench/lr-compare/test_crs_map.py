#!/usr/bin/env python3
"""Unit tests for Lightroom XMP → Rayfine mapping (no images)."""

from __future__ import annotations

import unittest
from pathlib import Path

from crs_map import extract_xmp_from_path, map_xmp_path, map_xmp_text

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class CrsMapTests(unittest.TestCase):
    def test_pv2012_one_to_one(self) -> None:
        mapped = map_xmp_path(FIXTURES / "pv2012_tone.xmp")
        self.assertEqual(mapped.source, "pv2012")
        self.assertAlmostEqual(mapped.exposure, 0.41)
        self.assertAlmostEqual(mapped.highlights, -48.0)
        self.assertAlmostEqual(mapped.shadows, 44.0)
        self.assertAlmostEqual(mapped.whites, -25.0)
        self.assertAlmostEqual(mapped.blacks, -41.0)
        self.assertAlmostEqual(mapped.contrast, 12.0)
        self.assertTrue(mapped.sliders_json()["highlights"] == -48.0)

    def test_pv2010_fivek_style(self) -> None:
        mapped = map_xmp_path(FIXTURES / "pv2010_tone.xmp")
        self.assertEqual(mapped.source, "pv2010")
        self.assertAlmostEqual(mapped.exposure, 2.81 - 0.13)
        self.assertAlmostEqual(mapped.highlights, -48.0)
        self.assertAlmostEqual(mapped.shadows, 12.0)
        self.assertAlmostEqual(mapped.blacks, 0.0)
        self.assertAlmostEqual(mapped.whites, 0.0)
        self.assertAlmostEqual(mapped.contrast, -15.0)

    def test_pv2010_ui_defaults_are_identity(self) -> None:
        xmp = """<rdf:Description crs:ProcessVersion="5.0"
           crs:Exposure="0" crs:HighlightRecovery="0" crs:FillLight="0"
           crs:Shadows="5" crs:Brightness="50" crs:Contrast="25"/>"""
        mapped = map_xmp_text(xmp)
        self.assertAlmostEqual(mapped.exposure, 0.0)
        self.assertAlmostEqual(mapped.highlights, 0.0)
        self.assertAlmostEqual(mapped.shadows, 0.0)
        self.assertAlmostEqual(mapped.blacks, 0.0)
        self.assertAlmostEqual(mapped.contrast, 0.0)

    def test_identity_xmp_has_zero_sliders(self) -> None:
        xmp = """<rdf:Description crs:ProcessVersion="11.0"
           crs:Exposure2012="0" crs:Highlights2012="0" crs:Shadows2012="0"
           crs:Whites2012="0" crs:Blacks2012="0" crs:Contrast2012="0"/>"""
        mapped = map_xmp_text(xmp)
        self.assertEqual(mapped.sliders_json(), {
            "exposure": 0.0,
            "highlights": 0.0,
            "shadows": 0.0,
            "whites": 0.0,
            "blacks": 0.0,
            "contrast": 0.0,
        })

    def test_extract_from_sidecar(self) -> None:
        text = extract_xmp_from_path(FIXTURES / "pv2012_tone.xmp")
        self.assertIsNotNone(text)
        self.assertIn("Highlights2012", text or "")


if __name__ == "__main__":
    unittest.main()
