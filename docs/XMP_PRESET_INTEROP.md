# Lightroom XMP develop preset interop (RustROOM)

## Import
- UI: Presets panel → import files (multi `.xmp` / `.lrtemplate` / `.rrpreset`) or **folder**
- Backend: `handle_import_legacy_presets_from_file|paths|directory`
- Groups: `crs:Group` → preset folders
- Parser: `preset_converter::convert_xmp_to_preset(_with_group)`

## Export
- Single preset → context menu **Export as Lightroom XMP**
- Current develop settings → Develop left **XMP**
- All presets → toolbar **XMP** → choose folder (`export_presets_to_xmp_directory`)

## Covered fields (best-effort)
Tone, WB (absolute + incremental), presence, HSL, point curves, parametric curve,
color grading / split toning, calibration, B&W GrayMixer, vignette, grain, NR,
sharpen, CA, defringe, lens profile name, perspective/transform, upright.

## Tests
`cargo test --lib preset_converter` in `src-tauri` (15 unit tests + optional user CameraRaw walk).

## Notes
Not a full Adobe CRS implementation. Values are scaled to RapidRAW’s adjustment model.
Pixel-identical Lightroom UI is intentionally out of scope.


## Photo sidecars (`.xmp` next to images)
When **XMP sync** is enabled in settings:

### Read (`sync_metadata_from_xmp`)
1. Imports rating / labels / keywords
2. **If** RapidRAW has no develop adjustments yet, imports **crs:*** develop settings from the Lightroom photo XMP (does not overwrite existing RR edits)

### Write (`sync_metadata_to_xmp`)
On save (rating/tags/adjustments), merges develop settings into the photo `.xmp` via `merge_develop_into_xmp` (crs attributes + nested tone curves). Preserves other XMP packets when possible.

Tests: `cargo test --lib xmp_sidecar_tests`


## Reload Develop from XMP (user-initiated)
- Context menu on image (library or editor): **Reload Develop from XMP**
- Shortcut: **Ctrl+Shift+X**
- Overwrites RapidRAW develop settings from the photo `.xmp` sidecar; keeps rating/tags


## Finder / Explorer
Context menu **Show XMP sidecar** reveals `basename.xmp` / `.XMP` next to the image when present.


## Thumbnails / previews after XMP reimport
Reloading Develop from XMP:
1. Writes adjustments into the RapidRAW sidecar
2. Clears frontend thumbnail + preview caches (and open-editor preview URLs)
3. Applies develop to the open editor with `hasRenderedFirstFrame: false`
4. Queues `update_thumbnail_queue` so workers rebuild thumbs (cache key includes adjustments)
5. Marks library items as edited when import succeeds


## Force-write Develop to photo XMP
- Command: `export_develop_to_xmp` (optional live adjustments override)
- UI: context menu **Write Develop to XMP**, Develop left **XMP out**
- Shortcut: **Ctrl+Shift+E**
- Always creates a missing `.xmp` sidecar; flushes open-editor save first


## Sidecar path styles
`resolve_xmp_path` accepts:
- `photo.xmp` / `photo.XMP` (stem.xmp)
- `photo.ARW.xmp` / `photo.ARW.XMP` (full-name.xmp)

Library import copies the source XMP next to the destination image, preserving naming style.
Develop preset on import applies only to `importedPaths` from `import-complete` (not the whole folder).


## Optics flags
- `crs:AutoLateralCA` ↔ `lensTcaEnabled`
- `crs:LensManualDistortionAmount` ↔ `transformDistortion`


## Crop (HasCrop)
Lightroom stores crop as normalized edges `0–1`:
- `crs:HasCrop`, `crs:CropTop`, `crs:CropLeft`, `crs:CropBottom`, `crs:CropRight`, optional `crs:CropAngle`

RapidRAW maps to percent crop:
```json
{ "unit": "%", "x": left*100, "y": top*100, "width": (right-left)*100, "height": (bottom-top)*100 }
```
Full-frame identity crops are skipped. Pixel crops without image size are not exported to XMP.
`include_crop_transform` is set when a non-identity crop is imported.


## Looks (`crs:Look`)
Nested Adobe Look block:
```xml
<crs:Look>
  <rdf:Description crs:Name="Adobe Monochrome" crs:Amount="1" crs:Stubbed="true">...</rdf:Description>
</crs:Look>
```
Mapped to `lookName` on import; re-exported as a stub Look description when present.


## PresetType
`crs:PresetType` (`Normal` / `Look`) is stored as `xmpPresetType` and re-exported.


## Orientation
`crs:ImageOrientation` (and sometimes `Orientation`) maps to RapidRAW:
- `orientationSteps` (0–3 × 90° CW)
- `flipHorizontal` / `flipVertical`
- raw value kept as `imageOrientation`

EXIF-like codes 1–8 are supported; 0 is treated as normal.


## Post-crop vignette extras
- `crs:PostCropVignetteStyle` → `vignetteStyle` (0/1/2)
- `crs:PostCropVignetteHighlightContrast` → `vignetteHighlightContrast`


## Lens blur & profile setup
- `crs:BlurAmount` ↔ `lensBlurAmount` (+ `lensBlurEnabled` when amount > 0)
- `crs:LensProfileSetup` ↔ `lensProfileSetup` (string, e.g. LensDefaults)
- `crs:ToneCurveName2012` falls back into `toneCurveName` (also exported as twin of ToneCurveName)
- `crs:CurveRefineSaturation` ↔ `curveRefineSaturation`


## Lens blur / bokeh companions
- `crs:BlurAmount` ↔ `lensBlurAmount` (enable only if non-default activity)
- `crs:BokehShape` 0/1/2/3 ↔ `lensBlurShape` circle/hexagon/octagon/ring
- Also stored: `BokehShapeDetail`, `BokehAspect`, `BokehRotation`, `SphericalAberration`, `CatEyeAmount/Scale`
- `crs:HDREditMode` ↔ `hdrEditMode`
- `crs:LensProfileFilename` ↔ `lensProfileFilename`


## Grain seed & profile digests
- `crs:GrainSeed` ↔ `grainSeed` (UI: Random button under Grain)
- `crs:CameraProfileDigest` / `crs:LensProfileDigest` stored for fidelity
- `crs:HighlightsBoost` / `HighlightsThreshold` stored
- `crs:CropConstrainToUnitSquare` ↔ `cropConstrainToUnitSquare`


## As-shot white balance
- `crs:AsShotTemperature` / `crs:AsShotTint` stored as `asShotTemperature` / `asShotTint`
- Used when converting absolute Temperature Kelvin to relative RapidRAW temperature sliders


## Pick / Reject flags
Stored as RapidRAW tags `flag:pick` and `flag:reject` (not Adobe binary flags).
When `enable_xmp_sync` is on, tags sync into `dc:subject` keywords on the photo XMP.
Keyboard: **Shift+P** pick, **Shift+X** reject, **Shift+U** clear (P alone remains Presets panel).


## Local masks (MaskGroupBasedCorrections)
Best-effort import/export of LR local corrections:
- **Import**: `crs:MaskGroupBasedCorrections` / nested `CorrectionMasks`
  - `Mask/CircularGradient` → RapidRAW `radial` (normalized coords + `normalized: true`)
  - `Mask/Gradient` → `linear`
  - `Mask/Brush` → `brush` (geometry dabs not reconstructed)
  - Local tone: `LocalExposure2012`, `LocalContrast2012`, Highlights/Shadows/Whites/Blacks, Clarity, Dehaze, Texture, Saturation, Vibrance, Temp/Tint, Sharpness, LuminanceNoise
- **Export**: reverse mapping into `crs:MaskGroupBasedCorrections`
- Brush stroke polylines and AI masks are **not** fully reconstructed from XMP.


## Normalized mask coordinates
Imported radial/linear geometry is stored with `parameters.normalized: true` (CRS 0–1 space).
On image open, `denormalizeMaskCoordinates` scales to pixel space for ImageCanvas.
