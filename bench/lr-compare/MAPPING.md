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
| `crs:ToneCurvePV2012` | unused | — | Point curve is not replayed. |
| Parametric / HSL / calib / profile | unused | — | See `unused` in `mapping.json`. |

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
| `crs:Shadows` (default 5) | `blacks` | `−4 × (Shadows − 5)`. Default 5 → 0. |
| `crs:Whites2012` | `whites` | missing → 0. |
| `crs:Brightness` | folded into `exposure` | `exposure += Brightness / 100` (FiveK 0-base). LR3 UI default 50/25 is treated as identity. |
| `crs:Contrast` | `contrast` | 1:1 from the FiveK 0-base. |
| Parametric 4-point + Medium Contrast | unused | FiveK often uses these; they inflate residual ΔE. |
| ACR 4.4 / Adobe Standard | unused | Demosaic + camera matrix stay Rayfine/rawler. |

## Limits that will show up in ΔE

1. **Color**: as-shot WB vs expert custom Kelvin/tint; no DCP; ProPhoto TIFF → sRGB is a matrix, not Adobe ACE.
2. **PV2010 ≠ PV2012**: Highlight Recovery is not Highlights 2012. Mapping is signed-magnitude only.
3. **Unmapped looks**: parametric curve, point curve, vibrance, saturation, clarity, profile.
4. **Headroom**: Rayfine keeps scene-linear overrange and a soft shoulder; Lightroom 3 used a different highlight compressor.
5. **Identity**: all mapped sliders at 0 leave `ToneSliders::is_identity()` true. Do not “fix” residual look by adding a default curve.

## Calibration knobs (CPU + WGSL must stay in lockstep)

In `scene_tone.rs` / `shader.wgsl` `apply_scene_local_tone`:

- highlight log gain `2.0` (UI ±100 → about 1.7 stops at the mask peak)
- shadow log gain `2.0`
- whites `0.24`, blacks `0.32`
- overrange Reinhard `k = pull * 4.0`
- guided radii preview 2/6, quality 3/10

Tune on the **train** FiveK IDs only. Report **val** separately.
