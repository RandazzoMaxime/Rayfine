# IR ACR ablation (PV 11.0) — measured 2026-10-24 (Adobe Standard DCP)

Oracle: Imaging Resource RAW + `crs:` XMP + sRGB JPEG. FiveK is not used.
Long edge 640. ΔE2000 in Lab D65 on encoded sRGB. Train ≠ val.

Profile: Adobe Standard `.dcp` from Adobe DNG Converter 16.3 (local only,
[DCP.md](DCP.md)). G95 uses `Panasonic DC-G99` (same body as US G95 / EU G90).
HueSatMap 90×30×1, LookTable 36×8×16, ForwardMatrix1/2. **No** ProfileToneCurve
and **no** BaselineExposureOffset in these DCPs. A +0.28 EV midtone-weighted
process lift stands in for the missing curve (LightCraft measured ~0.8 EV dark
on Adobe Standard DNGs without a preview-fitted tone).

LightCraft contents: [LIGHTCRAFT.md](LIGHTCRAFT.md). JPEG-fit profiles are not
the oracle.

## Profile layers (DNG order: Look after BaselineExposure)

| Split | Image | matrice | +HueSatMap | +BaselineExposure | +LookTable | +ProfileToneCurve | +curseurs | profil |
|---|---|---:|---:|---:|---:|---:|---:|:---|
| train | `a6600-0046` | 17.56 | 18.05 | 18.05 | 17.90 | 16.18 | 14.49 | Adobe Standard |
| train | `a6600-0089` | 11.78 | 10.89 | 10.89 | 10.94 | 9.23 | 21.29 | Adobe Standard |
| train | `g95-0192` | 21.70 | 20.51 | 20.51 | 20.74 | 19.91 | 19.72 | Adobe Standard |
| train | `g95-0314` | 22.97 | 23.17 | 23.17 | 22.99 | 20.96 | 20.32 | Adobe Standard |
| train | `z6ii-0086` | 14.89 | 14.92 | 14.92 | 14.70 | 14.22 | 14.02 | Adobe Standard |
| val | `a6600-0156` | 21.17 | 21.42 | 21.42 | 21.21 | 19.61 | 22.46 | Adobe Standard |
| val | `a7riv-1852` | 32.94 | 29.19 | 29.19 | 29.31 | 26.62 | 23.32 | Adobe Standard |
| val | `g95-0273` | 12.65 | 15.46 | 15.46 | 14.53 | 15.36 | 15.89 | Adobe Standard |
| val | `g95-1146` | 21.33 | 20.53 | 20.53 | 20.56 | 19.64 | 20.55 | Adobe Standard |

Train layer means: matrix 17.78 → HSM 17.51 → BE 17.51 → Look 17.45 → tone **16.10** → sliders **17.97**.

## Develop ablation (mean ΔE2000)

| Split | Image | WB | +profil | +expo | +courbe | +couleur | +H/S | H/S forts |
|---|---|---:|---:|---:|---:|---:|---:|:---|
| train | `a6600-0046` | 17.48 | 16.18 | 13.90 | 14.42 | 14.42 | 14.49 | oui |
| train | `a6600-0089` | 11.47 | 9.23 | 12.41 | 13.02 | 13.12 | 21.29 | oui |
| train | `g95-0192` | 21.75 | 19.91 | 19.75 | 20.07 | 20.07 | 19.72 | oui |
| train | `g95-0314` | 22.87 | 20.96 | 19.26 | 20.30 | 20.46 | 20.32 | oui |
| train | `z6ii-0086` | 14.82 | 14.22 | 13.24 | 13.37 | 13.37 | 14.02 | oui |
| val | `a6600-0156` | 21.02 | 19.61 | 16.16 | 16.66 | 16.66 | 22.46 | oui |
| val | `g95-0273` | 12.35 | 15.36 | 15.36 | 15.06 | 15.52 | 15.89 | non |
| val | `g95-1146` | 21.34 | 19.64 | 19.64 | 20.00 | 19.98 | 20.55 | oui |
| val | `a7riv-1852` | 32.93 | 26.62 | 21.76 | 22.85 | 22.82 | 23.32 | oui |

Means: train color / H/S **16.29 / 17.97** (was 17.83 / 19.39 without DCP).
Val **18.74 / 20.56**. Best colour: `a6600-0089` 9.23, `z6ii-0086` 13.37.
Target ΔE2000 &lt; 5 (aim &lt; 3): **not reached**.

## z6ii-0086 light (Shadows +67)

Settings on the JPEG: Exp +0.65, Shadows +55 + Look +12 = **+67**, Highlights
Look −12, Clarity +10, Adobe Landscape Look, Linear 2012, As Shot 6000 K / +17.
No mono-slider LR exports exist; stages below isolate our stack.

| Stage | mean Y | median Y | R−B |
|---|---:|---:|---:|
| Lightroom JPEG | 0.231 | 0.160 | −0.043 |
| matrix | 0.130 | 0.105 | −0.015 |
| +HueSatMap | 0.124 | 0.100 | −0.029 |
| +LookTable | 0.129 | 0.105 | −0.023 |
| +default tone | 0.143 | 0.118 | −0.024 |
| +Exposure +0.65 | 0.182 | 0.153 | −0.030 |
| +H/S (S +67) | 0.204 | 0.199 | −0.024 |

The base (matrix) is already **~0.83 EV** darker than the finished LR JPEG.
Shadows +67 now lift the median *above* LR (0.199 vs 0.160) while the mean stays
~0.16 EV dark: the mask still under-lifts mid-highlights and over-lifts the
floor. The image also stays slightly warmer (R−B −0.024 vs −0.043). Blacks
0.32→0.20 reduced the a6600-0089 H/S blow-up (24.12→21.29) but B −35 still
raises ΔE.

Slider-at-a-time vs LR is not available (IR ships one finished JPEG). Our
one-at-a-time response on this frame: Exposure moves mean Y; Shadows moves
median more than mean; Highlights/Whites/Blacks/Contrast are 0 on the XMP
except Look Highlights −12 and Clarity +10.

## Cause (not fitted away)

1. **Adobe Landscape 3D LookTable** (`crs:LookTable` UUID on the XMP) is not in
   the DNG Converter CameraProfiles tree. We apply Adobe Standard's LookTable
   plus Look.Parameters sliders / ToneCurvePV2012. The Landscape LUT is the
   remaining proprietary colour step.
2. **No ProfileToneCurve / BaselineExposure** in Adobe Standard DCP. The +0.28 EV
   stand-in is weaker than Lightroom's process tone (~0.8 EV on DNG previews).
   Raising it further over-lifts the shadow median once S +67 is applied.
3. **H/S ≠ Lightroom** on strong Blacks (a6600-0089 colour 9.23 → H/S 21.29).
4. **Geometry**: IR JPEGs already have lens distortion/CA; several frames have
   a different aspect than the RAW (center-crop).
5. Local masks (g95-0273), sharpening, NR: not applied.

Sheets: `/opt/cursor/artifacts/lr-compare/ir-dcp/sheets/{id}_{stage}.png`
(LR | Rayfine | ΔE, banner = settings + `profile=Adobe Standard`).
