# Measurement validation (before any slider-curve tuning)

Run: `python bench/lr-compare/validate_measurement.py --datasets bench/lr-compare/datasets/ir`

Reference JPEGs are loaded as **encoded sRGB** (8-bit ÷ 255). ΔE2000 is CIEDE2000
in Lab D65 (`metrics.srgb_to_lab`). Predictions are center-cropped to the JPEG
aspect then resized — no squash when the RAW crop differs.

| Image | Split | JPEG | Ori | ICC | ACR / PV | Profile / Look | mean Y | Issues |
|---|---|---|---:|---|---|---|---:|---|
| `a6600-0046` | train | 6000×4000 | 1 | sRGB IEC61966-2.1 | 13.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.514 | — |
| `a6600-0089` | train | 6000×4000 | 1 | sRGB IEC61966-2.1 | 13.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.667 | — |
| `a6600-0156` | val | 5758×3839 | 1 | sRGB IEC61966-2.1 | 13.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.487 | — |
| `a7riv-1852` | val | 8302×5535 | 1 | sRGB IEC61966-2.1 | 13.2 / 11.0 | Adobe Standard / Adobe Landscape | 0.670 | — |
| `g95-0192` | train | 5184×2592 | 1 | sRGB IEC61966-2.1 | 11.3.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.369 | JPEG already has lens distortion/CA |
| `g95-0273` | val | 5184×3888 | 1 | sRGB IEC61966-2.1 | 11.3.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.118 | JPEG already has lens distortion/CA |
| `g95-0314` | train | 5184×2592 | 1 | sRGB IEC61966-2.1 | 11.3.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.529 | JPEG already has lens distortion/CA |
| `g95-1146` | val | 4489×3367 | 1 | sRGB IEC61966-2.1 | 11.3.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.442 | JPEG already has lens distortion/CA |
| `z6ii-0086` | train | 5595×2798 | 1 | sRGB IEC61966-2.1 | 13.1 / 11.0 | Adobe Standard / Adobe Landscape | 0.231 | JPEG already has lens distortion/CA |

- `crs:HasCrop` is False on every complete triple. EXIF orientation is 1.
- Nested `crs:CorrectionRangeMask crs:Version="+2"` must not overwrite root
  `crs:Version` (first-wins in `parse_crs_attrs`).
- Default ACR NR on this set: `ColorNoiseReduction` 25, `Sharpness` 40.
  `LuminanceSmoothing` is 0 except z6ii-0086 (14) and g95-0273 (26). Metrics
  are reported full-res **and** on a ~512 px + Gaussian pair so colour/light
  is not dominated by grain. ΔE is also split by zone (ciel / milieux / ombres).
- No IR JPEG is a default Adobe Standard export: Adobe Landscape Look extras
  (H −12 / S +12 / Clarity +10 + Look ToneCurvePV2012 + LookTable UUID) are always present.
  A synthetic all-zero XMP vs these JPEGs therefore measures the
  WB / ColorMatrix / missing DCP+LookTable residual, not H/S.

Catalog, URLs and licenses: [IR_TRIPLES.md](IR_TRIPLES.md).
