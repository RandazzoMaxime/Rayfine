# LightCraft vs Lightroom vs Rayfine (IR, aligned)

LightCraft `lightcraft-cli 0.13.0` commit `38f8d2508` (clone `/tmp/lightcraft`,
public `storytold/lightcraft`). Export `colorSpace=srgb`. Process V2.
Creative profile `lc.color`. Mapping: [LIGHTCRAFT.md](LIGHTCRAFT.md).

IR JPEG sidecars are `crs:AlreadyApplied=True` — LightCraft would skip every
`crs:` field. Settings go in as DevelopSettings JSON. Both develops are
**geometrically aligned** (ORB + homography + ECC) onto the LR JPEG before
ΔE. Metric: ~512 px + Gaussian, zones ciel / horizon / milieux / ombres,
median ΔEV.

Planches 4 colonnes: `/opt/cursor/artifacts/lr-compare/lc-vs-lr/sheets/`
and `out/lc-vs-lr/sheets/` (gitignored pixels).

## Tableau (ΔE réduit, avant port du process tone)

| Split | Image | LC ΔE | RF ΔE | LC ciel | RF ciel | LC hor | RF hor | LC mil | RF mil | LC omb | RF omb | LC ΔEV | RF ΔEV |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| train | `a6600-0046` | 3.35 | 13.36 | 3.33 | 14.88 | 2.78 | 13.92 | 3.45 | 11.46 | 4.74 | 7.28 | -0.019 | -0.372 |
| train | `a6600-0089` | 6.53 | 18.96 | 4.37 | 19.34 | 4.39 | 19.55 | 8.74 | 18.41 | — | — | -0.009 | -0.589 |
| train | `g95-0192` | 13.48 | 16.47 | 14.78 | 17.26 | 10.35 | 14.64 | 12.46 | 15.73 | 13.91 | 17.05 | 0.207 | -0.206 |
| train | `g95-0314` | 10.55 | 19.56 | 7.24 | 15.96 | 7.53 | 20.10 | 12.30 | 21.16 | 35.26 | 23.42 | 0.097 | -0.501 |
| train | `z6ii-0086` | 14.70 | 12.86 | 17.14 | 14.41 | 20.01 | 16.85 | 15.99 | 14.63 | 11.98 | 10.61 | 0.035 | -0.276 |
| val | `a6600-0156` | 10.38 | 21.06 | 7.98 | 19.09 | 11.68 | 21.56 | 11.67 | 22.26 | 15.29 | 8.81 | 0.001 | -0.761 |
| val | `a7riv-1852` | 14.19 | 24.33 | 21.06 | 28.72 | 12.17 | 21.75 | 9.98 | 21.19 | — | — | -0.130 | -0.584 |
| val | `g95-0273` | 9.19 | 13.52 | 13.20 | 8.77 | 8.64 | 10.53 | 10.35 | 11.29 | 7.78 | 15.65 | 1.034 | 0.800 |
| val | `g95-1146` | 14.17 | 18.24 | 12.59 | 18.24 | 13.82 | 16.06 | 14.85 | 17.62 | 26.40 | 22.79 | 0.169 | -0.363 |

Moyennes train LC / RF : **9.72 / 16.24**. Val : **11.98 / 19.29**.
Train ΔEV LC / RF : **+0.06 / −0.39**.

LightCraft rendered all 9 vendor RAWs (NEF / ARW / RW2) on CPU
(`no GPU adapter`). No render failure.

## Why LightCraft wins (code)

1. **Base exposure (ΔEV ≈ 0).** LightCraft finish (`crates/pipeline/src/finish.rs`
   `base_tone`) uses a grey-centered `ToneMap::hdr` (Reinhard, grey 0.18,
   white 2.9 EV) and, when an embedded JPEG is usable, a per-photo
   `CameraTone` from `camera_preview.rs`. Sony ARW also clamps to the
   pooled DRO-off curve (`assets/camera-tone/sony-dro-off.json`, CC0
   pixls). Rayfine’s Adobe path had only `DEFAULT_PROCESS_EV = 0.28` on an
   identity ProfileToneCurve — systematically ~0.4 EV too dark on this set.
2. **A6600 daylight (ΔE 3.3 vs 13).** No Adobe DCP in LightCraft; the
   JPEG-fitted / DRO-off tone places snow and water next to the IR JPEG.
   That is a *camera* look, not Adobe Landscape HSV. Porting the fitter
   would pull vendor RAW toward the camera JPEG and would fight the DCP
   on Z 6 II (where Rayfine already wins: 12.86 vs 14.70).
3. **z6ii-0086 horizon.** LightCraft is *worse* (20.0 vs 16.9). Bundled
   `NIKON_Z_6_2.json` is a camera-JPEG HueSatMap, not Adobe Standard +
   Landscape. The dusk warmth is still missing on both sides.

## Port in Rayfine

`DEFAULT_PROCESS_EV` 0.28 → **0.62** (midtone-weighted, highlight fade
kept). This is the portable part of LightCraft’s grey placement, not the
per-photo JPEG fitter and not `NIKON_Z_6_2`.

### After the port (same align / metric)

| Split | Image | LC ΔE | RF ΔE | RF ΔEV |
|---|---|---:|---:|---:|
| train | `a6600-0046` | 3.35 | 12.18 | -0.293 |
| train | `a6600-0089` | 6.53 | 16.01 | -0.498 |
| train | `g95-0192` | 13.48 | 16.08 | -0.117 |
| train | `g95-0314` | 10.55 | 17.67 | -0.399 |
| train | `z6ii-0086` | 14.70 | **12.57** | -0.075 |
| val | `a6600-0156` | 10.41 | 18.17 | -0.596 |
| val | `a7riv-1852` | 14.19 | 21.94 | -0.483 |
| val | `g95-0273` | 9.20 | 14.55 | +0.961 |
| val | `g95-1146` | 14.17 | 17.38 | -0.245 |

Train RF ΔE **16.24 → 14.90**. Val **19.29 → 18.01**. Train ΔEV
**−0.39 → −0.28**. z6ii exposure is almost neutral (−0.08 EV).
g95-0273 (already too bright) got slightly worse, as expected.
Target < 5 is still not reached; LightCraft’s remaining A6600 gap is
the JPEG-fitted camera tone, not a slider we should copy onto the
Adobe path.

## After the LightCraft develop port (wgpu + CPU twin)

Default path is now LightCraft global develop (`lightcraft_develop` /
`lightcraft.wgsl`): V2 H/S, Reinhard `hdr` / Sony DRO-off `camera_tone`,
Bradford Temperature/Tint from inverted AsShotNeutral, OkLab vibrance.
Old Adobe path kept as `developPath=adobe`. Same 9 IR triples, ORB+ECC,
ΔE réduit ~512 + flou. LightCraft CLI still `0.13.0` / `38f8d2508`.

| Split | Image | LC ΔE | RF porté ΔE | RF ancien ΔE | LC ΔEV | RF porté ΔEV | RF ancien ΔEV |
|---|---|---:|---:|---:|---:|---:|---:|
| train | `a6600-0046` | 3.32 | **5.98** | 13.53 | -0.019 | **-0.001** | -0.286 |
| train | `a6600-0089` | 6.45 | **6.03** | 16.45 | -0.010 | -0.018 | -0.507 |
| train | `g95-0192` | 12.67 | 17.78 | 17.83 | 0.213 | -0.335 | -0.086 |
| train | `g95-0314` | 10.65 | 21.10 | 17.54 | 0.095 | -0.573 | -0.400 |
| train | `z6ii-0086` | 14.84 | **13.88** | 12.58 | 0.028 | 0.166 | -0.127 |
| val | `a6600-0156` | 10.09 | **10.61** | 19.46 | 0.004 | 0.069 | -0.631 |
| val | `a7riv-1852` | 14.06 | 18.75 | 20.27 | -0.130 | -0.080 | -0.490 |
| val | `g95-0273` | 9.24 | **9.12** | 14.33 | 1.020 | 0.586 | 0.914 |
| val | `g95-1146` | 14.30 | 19.44 | 16.88 | 0.171 | -0.407 | -0.230 |

Moyennes train LC / RF porté / RF ancien : **9.59 / 12.95 / 15.59**.
Val : **11.92 / 14.48 / 17.74**. Train ΔEV LC / RF porté : **+0.06 / −0.15**.

Sony DRO-off + inverted as-shot Kelvin closed the A6600 hole
(0046 12.18→5.98, ΔEV −0.29→0.00; 0089 **beats** LC 6.45). z6ii and
g95-0273 also beat LightCraft. The port does **not** yet equal LC’s
9.59 / 11.92 overall.

### Residual vs LightCraft (why not ≤ 9.72 / 11.99)

1. **No per-photo JPEG `CameraTone` fitter.** LightCraft
   `camera_preview.rs` fits a 32-knot curve to the embedded preview.
   We only ported the pooled Sony DRO-off curve (`sony-dro-off.json`).
   Panasonic G95 (`DC-G99`) therefore stays on `ToneMap::hdr` and is
   the whole remaining train gap: 0192 17.78 vs 12.67, 0314 21.10 vs
   10.65 (ΔEV −0.57). Those two images alone keep train RF at 12.95.
   Sony-only train mean is 8.63 vs LC 8.20.
2. **Colour is still rawler, not LightCraft’s camera model.** DCP is
   optional and colour-only (`--path lightcraft-dcp`). Default path
   does not apply Adobe Standard / Landscape — matching LC’s `lc.color`,
   but rawler’s matrix ≠ LC’s. a7riv-1852 (18.75 vs 14.06) is mostly
   that, not exposure (ΔEV −0.08).
3. **Guided V2 mask on GPU is a blurred-luma proxy**, not LC’s full
   guided filter. CPU bench uses the real guided filter; GPU preview
   will be slightly softer. This remesure is the CPU twin.

Highlight recovery did not regress (synthetic sky H−100 clip 57%→0%;
Sony a7III / Canon 5D IV / a6600 contre-jour sheets in
`/opt/cursor/artifacts/tone-recovery/`). 4-col planches:
`/opt/cursor/artifacts/lr-compare/lc-vs-lr/sheets/`.
