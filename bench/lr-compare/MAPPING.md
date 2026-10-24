# Lightroom → Rayfine tone mapping

Used by `crs_map.py` and `src-tauri/src/preset_converter.rs`. Slider **numbers**
match Lightroom UI units; the **response** does not. Identity at all zeros is
preserved.

## PV2012 (Lightroom 4+ / Camera Raw 7+, PPR10K, modern sidecars)

| Lightroom | Rayfine UI | Scale inside `ToneSliders` | Notes |
|---|---|---|---|
| `crs:Exposure2012` | `exposure` (EV) | × 1 | Linear `2^EV`. |
| `crs:Highlights2012` | `highlights` (−100…100) | ÷ 120 | Log-luma mask `smoothstep(−1, 2.8)`. Negative recovers. |
| `crs:Shadows2012` | `shadows` | ÷ 120 | Log-luma mask `1−smoothstep(−4.8, 0.3)`. |
| `crs:Whites2012` | `whites` | ÷ 30 | Extremes `smoothstep(0.5, 3.0)`. |
| `crs:Blacks2012` | `blacks` | ÷ 40 | Extremes `1−smoothstep(−6.0, −1.5)`. |
| `crs:Contrast2012` | `contrast` | ÷ 100 | Pivot 0.18 scene-linear. |
| `crs:Temperature` / `Tint` | recorded | — | **Not applied** on the CPU compare path (as-shot WB). |
| `crs:ToneCurvePV2012` / Look curve | Adobe path | 0–255 → 0–1 | Applied as a luma point curve. |
| Parametric 4-bands + splits | Adobe path | ÷100 × 0.6 EV | Shadows / Darks / Lights / Highlights. |
| HSL / Calibration / Vibrance / Saturation | Adobe path | ÷100 | Applied at the `color` stage. |
| Dehaze / Clarity / Texture | Adobe path | approx. | Applied at `hs` (not Adobe’s operator). |
| `crs:Look.Parameters` | added to H/S/Clarity | 1:1 | Adobe Landscape typically −12 / +12 / +10. LookTable is not public. |

`preset_converter` already maps the 2012 tone sliders 1:1 (test
`crs_tone_sliders_map_one_to_one`). This compare path reuses that contract.

## PV2010 (FiveK Expert TIFF XMP, Lightroom 3 / Process 5.0)

FiveK was retouched in Lightroom 3.4. Expert C TIFFs embed the develop packet
(`AlreadyApplied=True`). There is no `Highlights2012`.

| Lightroom PV2010 | Rayfine UI | Approximation |
|---|---|---|
| `crs:Exposure` | `exposure` | 1:1 EV. |
| `crs:HighlightRecovery` 0…100 | `highlights` | `−HighlightRecovery` (48 → −48). |
| `crs:FillLight` 0…100 | `shadows` | same number; strength is not equivalent. |
| `crs:Shadows` (default 5) | `blacks` | `−2 × (Shadows − 5)`, clamped ±100. Default 5 → 0. Train IDs used 5; val `a0006` (Shadows 30) crushed at 4× so the scale was halved. |
| `crs:Whites2012` | `whites` | missing → 0. |
| `crs:Brightness` | folded into `exposure` | `exposure += Brightness / 100` (FiveK 0-base). LR3 UI default 50/25 is treated as identity. |
| `crs:Contrast` | `contrast` | 1:1 from the FiveK 0-base. |
| Parametric 4-point + Medium Contrast | unused | FiveK often uses these; they inflate residual ΔE. |
| ACR 4.4 / Adobe Standard | unused on the **legacy** path | The Adobe-match path reads DNG ColorMatrix / ForwardMatrix / LookTable. |

## Adobe colour / light path (`--path adobe`)

Used by `compare_adobe_match.py` / `lr_public_compare --path adobe`. This is **not**
the library GPU preview. Stages are cumulative:

| Stage | What is applied |
|---|---|
| `wb` | `crs:Temperature` / `Tint` → Planckian xy + CIE 1960 tint (`kTintScale = −3000`), illuminant mix A↔D65 by inverse CCT, camera ÷ Neutral, Inverse(CameraCalibration). No matrix. |
| `profile` | + ForwardMatrix (DNG) or inverse ColorMatrix + Bradford (vendor RAW) → XYZ D50 → ProPhoto linear + LookTable when present. |
| `exposure` | + `BaselineExposure` + `crs:Exposure` (`2^EV`). Brightness still off. |
| `curve` | + named ToneCurve (`Linear` / `Medium Contrast`), Contrast, parametric 4-bands, ToneCurvePV2012 (incl. Look curve). |
| `color` | + Calibration, HSL, Vibrance, Saturation. |
| `hs` | + Dehaze / Clarity / Texture + Highlights / Shadows / Whites / Blacks (guided log masks). |

Working space is ProPhoto linear, then ProPhoto→sRGB (Bradford D50→D65) encoded
as sRGB. The IR oracle is an 8-bit sRGB JPEG; FiveK 16-bit ProPhoto TIFFs are
not used as the PV2012 reference. `crs:Brightness` is **not** folded into
Exposure on this path. For PV2012, `ToneCurveName2012` wins over the leftover
PV2010 `ToneCurveName`.

**HueSatMap is missing** on these FiveK DNGs (no tag 50937). Only the embedded
LookTable is public. That gap is reported with the measured ΔE, not hidden.

FiveK Expert C XMP stores `crs:CameraProfile = ACR 4.4` (proprietary 2008
profile). A ColorMatrix-only + Bradford CAT path was measured and **raised**
ΔE (a0045 profile 19 → 31). The compare therefore keeps DNG ForwardMatrix +
LookTable as the best public stand-in. The missing ACR 4.4 HSB table, plus
unmapped Vibrance / Saturation / parametric, is reported with the measured ΔE.

## Exposure baseline (legacy path only)

`develop_raw_image` (legacy) normalizes sensor white to 1.0 **and** applies
rawler/custom cam→sRGB + as-shot WB. Lightroom’s `crs:Exposure` is relative to
Adobe’s hidden baseline. Adding Expert C’s `+2.81` EV on top of that already
bright linear blows midtones. The Adobe path starts from camera-native linear
and adds `BaselineExposure` first, so the same EV is in the right units.

## Limits that will show up in ΔE

1. **HueSatMap / proprietary DCP**: not in the FiveK DNG; Adobe Standard’s full HSB table is unavailable.
2. **WB locus**: Kang CCT→xy, not Adobe’s unpublished Planckian table.
3. **PV2010 ≠ PV2012**: Highlight Recovery is not Highlights 2012. Mapping is signed-magnitude only.
4. **Unmapped looks**: parametric curve, point ToneCurve, vibrance, saturation, clarity.
5. **Expert C TIFF already includes HR**: the `curve` column is colour+light without our H/S, so full-frame ΔE vs the TIFF is inflated by that missing recovery.
6. **Identity**: all mapped sliders at 0 leave `ToneSliders::is_identity()` true on the legacy path.

## Calibration knobs (CPU + WGSL must stay in lockstep)

In `scene_tone.rs` / `shader.wgsl` `apply_scene_local_tone`:

- highlight log gain `2.0` (UI ±100 → about 1.7 stops at the mask peak)
- shadow log gain `2.0`
- whites `0.24`, blacks `0.32`
- overrange Reinhard `k = pull * 4.0`
- guided radii preview 2/6, quality 3/10

Tune on the **train** Imaging Resource IDs only. Report **val** separately.
FiveK remains downloadable (`--source fivek`) but is not the colour/light oracle.
