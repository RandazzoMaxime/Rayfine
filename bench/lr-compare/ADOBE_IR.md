# IR ACR ablation (PV 11.0) — measured 2026-10-24

Oracle: Imaging Resource RAW + `crs:` XMP + sRGB JPEG. FiveK is not used.
Long edge 640. ΔE2000 in Lab D65 on encoded sRGB. Train ≠ val.

## Ablation (mean ΔE2000)

| Split | Image | WB | +profil | +expo | +courbe | +couleur | +H/S | H/S forts |
|---|---|---:|---:|---:|---:|---:|---:|:---|
| train | `a6600-0046` | 17.48 | 18.04 | 15.57 | 16.16 | 16.16 | 15.88 | oui |
| train | `a6600-0089` | 11.47 | 11.08 | 14.65 | 15.43 | 15.60 | 24.12 | oui |
| train | `g95-0192` | 21.75 | 20.40 | 20.21 | 20.57 | 20.57 | 20.05 | oui |
| train | `g95-0314` | 22.87 | 23.23 | 21.46 | 22.60 | 22.77 | 22.41 | oui |
| train | `z6ii-0086` | 14.82 | 14.96 | 13.90 | 14.04 | 14.04 | 14.49 | oui |
| val | `a6600-0156` | 21.02 | 21.51 | 17.61 | 18.18 | 18.18 | 24.94 | oui |
| val | `a7riv-1852` | 32.88 | 28.91 | 23.96 | 25.09 | 25.08 | 25.39 | oui |
| val | `g95-0273` | 12.35 | 15.85 | 15.85 | 15.61 | 15.99 | 16.24 | non |
| val | `g95-1146` | 21.34 | 20.57 | 20.57 | 20.99 | 21.00 | 21.32 | oui |

Means: train color / H/S **17.83 / 19.39**. Val (hold-out) **20.06 / 21.97**.
Best colour+light: `z6ii-0086` 14.04, `a6600-0046` 16.16.
Target ΔE2000 &lt; 5 (aim &lt; 3): **not reached**.

## Cause (not fitted away)

1. **Adobe Standard DCP + Adobe Landscape LookTable** are not in vendor RAW.
   rawler ColorMatrix (D65, row-normalized only for XYZ invert) is the public
   stand-in. Look.Parameters H/S/Clarity and the Look ToneCurvePV2012 *are*
   applied. The 3D LookTable is not.
2. **No BaselineExposure** and no PV2012 default process tone on vendor RAW.
   Mid-grey is systematically darker than the ACR JPEG (e.g. a6600-0046
   Y 0.35 vs 0.51).
3. **H/S response ≠ Lightroom** on strong Blacks/Highlights: a6600-0089
   colour 15.60 → H/S **24.12** (B −35, H −55); val a6600-0156 18.18 → 24.94.
4. **Geometry**: several JPEGs already have lens distortion/CA; g95-0192 /
   g95-0314 / z6ii-0086 JPEG aspect ≠ RAW 4:3/3:2 (center-crop, not ACR crop).
5. Local gradient masks (g95-0273), sharpening, NR: not applied.

A CAT from the user's CCT on a single D65 vendor matrix was measured to add
+10–20 ΔE and was removed. That is the only colour-path change after the
measurement check; slider curves were not fitted on val.

## Unimplemented vs applied

| XMP | Status | Measured impact on this set |
|---|---|---|
| Exposure / Contrast / H/S/W/B 2012 | applied | H/S can raise ΔE when Blacks/Highlights are strong |
| Look extras H −12 / S +12 / Clarity +10 | added to sliders | included in every row |
| Look ToneCurvePV2012 | applied | small (Linear 2012 + mild S) |
| Parametric / HSL / Calibration / Vibrance / Sat | applied | colour vs curve usually &lt; 0.4 ΔE (near-zero sliders) |
| Dehaze / Clarity / Texture | approximation | Clarity +10 from Look |
| Adobe Standard DCP / LookTable 3D | **missing** | dominant residual (~15–20 ΔE) |
| BaselineExposure | **missing** | darker midtones |
| ToneCurvePV2012 R/G/B | identity here | none |
| Local masks | **missing** | g95-0273 |
| Lens profile already in JPEG | **missing** | G95 / Z6 II |

Catalog: [IR_TRIPLES.md](IR_TRIPLES.md). Geometry: [MEASUREMENT.md](MEASUREMENT.md).
