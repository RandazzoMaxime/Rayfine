# LightCraft contents vs Rayfine (profiles / colour / light)

LightCraft (https://github.com/storytold/lightcraft, MIT OR Apache-2.0) was
cloned locally under `/tmp/vendor/lightcraft` for this study. Nothing Adobe is
shipped there: `assets/ATTRIBUTION.md` says *“No asset may come from Adobe”*.

## What LightCraft ships (the “contenus”)

| Asset | What it is | Licence | Useful as Adobe Standard? |
|---|---|---|---|
| `assets/camera-profiles/*.json` | Fitted **camera-JPEG** look: 3×3 chromaticity matrix + 72×5×5 HueSatMap | MIT/Apache-2.0 | **No.** Nikon Z 6II (`NIKON_Z_6_2.json`) matches in-camera Standard/Auto JPEG, not ACR Adobe Standard. |
| `crates/raw/src/spectral_table.rs` | ColorMatrix1/2 + ForwardMatrix1/2 for 52 bodies (A + D65), from rawtoaces-data | Apache-2.0 | **Matrices only.** Includes `ILCE-7RM4`. Alias `Z 6_2` → `Z f` (same sensor). No G95 / ILCE-6600. |
| `assets/camera-tone/sony-dro-off.json` | 32-knot Sony DRO-off JPEG tone, includes ILCE-6600 among CC0 pixls sources | MIT/Apache (sources CC0) | Camera JPEG tone, not PV2012 / Adobe Standard. |
| DNG profile **implementation** (`crates/raw/src/profile.rs`) | `HsvTable`, `ToneCurve`, `ProfileLook`, `ProfileTables` | MIT/Apache-2.0 | **Yes — algorithm.** Rayfine ports the DNG ch. 6 behaviour (original code). |
| Adobe `.dcp` | **Not shipped** | — | Fetch via `fetch_adobe_dcp.py`. |

IR bodies vs LightCraft assets:

- **Z 6 II** — JPEG-fit HueSatMap (MIT) + spectral alias to Z f. Not Adobe.
- **A7R IV** — spectral CM/FM (Apache-2.0). No HueSatMap/LookTable.
- **A6600 / G95** — no LightCraft camera profile. A6600 only appears in the Sony DRO-off tone pool.

## How LightCraft applies a DNG/DCP profile

From `crates/raw/src/profile.rs` and `dng.rs` (DNG spec 1.6/1.7 ch. 6):

1. Colour matrices (interpolated by inverse-CCT illuminant weight).
2. **`ProfileHueSatMapData1/2`** in linear ProPhoto HSV. Value-major, hue-middle, sat-minor. Saturation needs ≥ 2 divisions. Encoding 1 indexes value through the sRGB transfer. Headroom &gt; 1 is only ever lowered.
3. Exposure gain (`BaselineExposure` + `BaselineExposureOffset` + user Exposure).
4. **`ProfileLookTableData`** (same HSV table type), *after* exposure.
5. **`ProfileToneCurve`**: linear 0..1 knots, Fritsch–Carlson monotone cubic.
6. `ProfileGainTableMap*` is read but **not** rendered by default (Apple ProRAW; measured worse vs LrC).

Tag IDs used (ExifTool / DNG): HueSatMapDims **50937**, Data1 **50938**, Data2 **50939**, ProfileToneCurve **50940**, LookTableDims **50981**, Data **50982**, encodings **51107/51108**, BaselineExposure **50730**, BaselineExposureOffset **51109**.

When a Lightroom-written DNG has a LookTable but an identity / missing ProfileToneCurve (typical Adobe Standard), LightCraft **fits a tone curve to the embedded preview** (~0.8 EV too dark otherwise). Vendor RAW has no Adobe preview, so Rayfine cannot reuse that trick unless a DCP actually carries a curve.

## Highlights / Shadows (LightCraft)

`crates/raw/src/highlight.rs` is **clipped-channel reconstruction**, not the H/S sliders.

Process V2 (`docs/parity-checklist.md`): Highlights/Shadows share an edge-aware filter of the 0.15 %-of-long-edge median of **log luminance**; dark areas keep local contrast when lifted. Rayfine already uses a He 2012 guided luma + log-domain H/S (`scene_tone.rs`). Strengths still differ from Lightroom (see z6ii-0086).

## What Rayfine reused

- HSV table layout, sRGB value encoding, headroom rule, illuminant blend, Look-after-exposure, Fritsch–Carlson ProfileToneCurve — ported into `src-tauri/src/adobe_color.rs`.
- Spectral ILCE-7RM4 matrices are **not** baked in: the real Adobe Standard DCP (when fetched) supersedes them. They remain a documented Apache-2.0 fallback if DCP extraction fails.
- LightCraft JPEG-fit `NIKON_Z_6_2.json` is **not** used as the IR oracle (wrong look).

## Gaps that remain vs LightCraft / Lightroom

| Topic | LightCraft | Rayfine now |
|---|---|---|
| Adobe Standard DCP | Never ships; reads tags from the user's DNG | Sidecar `.dcp` via `fetch_adobe_dcp.py` + merge on vendor RAW |
| Preview-fitted tone when ProfileToneCurve is identity | Yes (DNG with embedded Lr preview) | No (vendor RAW has no Adobe preview) |
| GainTableMap | Stored, off by default | Not read |
| H/S slider character | Process V2 log + edge-aware | Guided log; strengths tuned separately |
| Camera JPEG profiles | 8 bodies | Not loaded |
