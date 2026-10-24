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
