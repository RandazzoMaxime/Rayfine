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
        self.assertAlmostEqual(mapped.brightness, -13.0)
        adobe = mapped.adobe_json()
        self.assertAlmostEqual(adobe["exposure"], 2.81)
        self.assertAlmostEqual(adobe["brightness"], -13.0)
        self.assertAlmostEqual(adobe["temperature_k"], 4000.0)
        self.assertAlmostEqual(adobe["tint"], -31.0)
        self.assertFalse(adobe["use_as_shot"])
        self.assertTrue(adobe["use_forward_matrix"])

    def test_acr44_disables_forward_and_look(self) -> None:
        mapped = map_xmp_text(
            """<rdf:Description crs:ProcessVersion="5.0" crs:CameraProfile="ACR 4.4"
               crs:WhiteBalance="Custom" crs:Temperature="4900" crs:Tint="-5"
               crs:Exposure="0" crs:HighlightRecovery="0" crs:FillLight="0"
               crs:Shadows="5" crs:Brightness="0" crs:Contrast="0"/>"""
        )
        adobe = mapped.adobe_json()
        self.assertEqual(mapped.camera_profile, "ACR 4.4")
        self.assertTrue(adobe["use_forward_matrix"])
        self.assertTrue(adobe["apply_look"])

    def test_pv2010_shadows_scale_is_mild(self) -> None:
        mapped = map_xmp_text(
            """<rdf:Description crs:ProcessVersion="5.0" crs:Shadows="30"
               crs:Exposure="0" crs:HighlightRecovery="0" crs:FillLight="0"
               crs:Brightness="0" crs:Contrast="0"/>"""
        )
        self.assertAlmostEqual(mapped.blacks, -50.0)

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

    def test_look_parameters_do_not_replace_user_sliders(self) -> None:
        mapped = map_xmp_path(FIXTURES / "look_landscape.xmp")
        self.assertAlmostEqual(mapped.exposure, 0.05)
        self.assertAlmostEqual(mapped.highlights, -41.0 + -12.0)
        self.assertAlmostEqual(mapped.shadows, 58.0 + 12.0)
        self.assertAlmostEqual(mapped.clarity, 10.0)
        self.assertEqual(mapped.look_name, "Adobe Landscape")
        self.assertEqual(mapped.process_version, "11.0")
        self.assertEqual(mapped.crs_version, "11.3.1")
        self.assertEqual(mapped.camera_profile, "Adobe Standard")
        self.assertEqual(mapped.tone_curve_name, "Linear")
        self.assertEqual(
            mapped.tone_curve_pv2012,
            [(0.0, 0.0), (64.0, 60.0), (128.0, 128.0), (192.0, 196.0), (255.0, 255.0)],
        )
        adobe = mapped.adobe_json()
        self.assertAlmostEqual(adobe["highlights"], -53.0)
        self.assertEqual(adobe["tone_curve"], "Linear")
        ir = Path(__file__).resolve().parent / "datasets" / "ir" / "g95-0192" / "develop.xmp"
        if ir.exists():
            live = map_xmp_path(ir)
            self.assertAlmostEqual(live.highlights, -41.0 + -12.0)
            self.assertAlmostEqual(live.shadows, 58.0 + 12.0)
            self.assertEqual(live.look_name, "Adobe Landscape")

    def test_nested_mask_version_does_not_replace_acr(self) -> None:
        xmp = """<rdf:Description crs:Version="11.3.1" crs:ProcessVersion="11.0"
           crs:Exposure2012="+0.20" crs:Highlights2012="0"/>
           <crs:CorrectionRangeMask crs:Version="+2" crs:Type="0"/>"""
        mapped = map_xmp_text(xmp)
        self.assertEqual(mapped.crs_version, "11.3.1")
        self.assertAlmostEqual(mapped.exposure, 0.20)

    def test_neutral_json_zeros_sliders_keeps_wb(self) -> None:
        mapped = map_xmp_path(FIXTURES / "look_landscape.xmp")
        neutral = mapped.neutral_adobe_json()
        self.assertEqual(neutral["highlights"], 0.0)
        self.assertEqual(neutral["shadows"], 0.0)
        self.assertEqual(neutral["clarity"], 0.0)
        self.assertEqual(neutral["tone_curve"], "Linear")
        self.assertFalse(neutral["apply_look"])
        self.assertAlmostEqual(neutral["temperature_k"], 5250.0)

    def test_lightcraft_json_is_one_to_one(self) -> None:
        mapped = map_xmp_path(FIXTURES / "look_landscape.xmp")
        lc = mapped.lightcraft_json()
        self.assertEqual(lc["process"], 2)
        self.assertEqual(lc["profile"]["id"], "lc.color")
        self.assertAlmostEqual(lc["light"]["exposure"], 0.05)
        self.assertAlmostEqual(lc["light"]["highlights"], -53.0)
        self.assertAlmostEqual(lc["light"]["shadows"], 70.0)
        self.assertAlmostEqual(lc["effects"]["clarity"], 10.0)
        self.assertEqual(lc["wb"]["mode"], "asShot")
        self.assertEqual(
            lc["curve"]["master"],
            [
                {"x": 0.0, "y": 0.0},
                {"x": 64.0 / 255.0, "y": 60.0 / 255.0},
                {"x": 128.0 / 255.0, "y": 128.0 / 255.0},
                {"x": 192.0 / 255.0, "y": 196.0 / 255.0},
                {"x": 1.0, "y": 1.0},
            ],
        )

    def test_lightcraft_auto_wb_replays_kelvin(self) -> None:
        mapped = map_xmp_text(
            """<rdf:Description crs:ProcessVersion="11.0" crs:WhiteBalance="Auto"
               crs:Temperature="7500" crs:Tint="0"
               crs:Exposure2012="+0.30" crs:Highlights2012="0" crs:Shadows2012="+56"
               crs:Whites2012="0" crs:Blacks2012="-26" crs:Contrast2012="0"/>"""
        )
        lc = mapped.lightcraft_json()
        self.assertEqual(lc["wb"]["mode"], "custom")
        self.assertEqual(lc["wb"]["scale"], "kelvin")
        self.assertAlmostEqual(lc["wb"]["temp"], 7500.0)
        self.assertAlmostEqual(lc["light"]["exposure"], 0.30)


if __name__ == "__main__":
    unittest.main()
