# Lightroom Classic comparison — 2026-10-02

Source: A7S02588.ARW (Sony ILCE-7SM3, 4240×2832). Lightroom Classic 15.5.1,
Adobe Standard, as-shot WB (5650 K / tint 14), linear point curves, sharpening
and colour NR disabled. Dedicated virtual copies preserve the masters. A second
reference, A7S02589.ARW, checks scene-dependent responses on skin and greenery.

## Result: partial calibration, not full parity

The shipped Basic RAW shader calibrates its neutral transfer and tonal responses,
and uses sRGB-encoded ProPhoto for RAW point curves. RAW vibrance uses the
recovered PV6 extrema operator; positive RAW dehaze uses guided transmission
maps. This is not an implementation of the complete Adobe DCP profile. Existing
Basic RAW edits render differently. JPEG channel curves keep their independent
sRGB behavior.

Metric: mean absolute sRGB channel difference divided by the full 0–1 code range.
All pixels are included. No fitted exposure, alignment, crop or black exclusions.
Images are 1600×1069. P95 and RMSE are reported separately; passing mean error
is not a guarantee that every pixel or region differs by less than 5%.

| Case | Original MAE | Current MAE |
|---|---:|---:|
| Neutral | 12.91% | 1.37% / 1.91% |
| Combined six tone sliders | 10.04% | 1.78% / 2.65% |
| Highlights +100 | — | 2.64% / non mesuré |
| Shadows +100 | — | 2.89% / 3.40% |
| Whites +100 | — | 3.34% / 12.01% |
| Blacks -100 | — | 2.92% / 3.80% |
| Clarity +100 | — | 3.16% / 2.54% |

**75/75 primary and 37/38 secondary cases pass ≤5% RGB MAE. Full equivalence
is not achieved.** The remaining measured failure is secondary-scene Whites +100
(12.01% mean RGB error). Positive dehaze +100 is 2.98% / 2.41%, and vibrance
+100 is 2.83% / 2.00% on the two scenes. The report also shows P95, worst-region,
lightness, and chroma error separately; a passing mean does not bound every pixel.

The offline [settings-comparison.html](settings-comparison.html) inventories all
Develop controls and measured values. Run `python bench/lr-compare/build_settings_report.py`
to refresh it; `measure_develop.py` also refreshes it automatically after saving
measurements. Untested controls remain unavailable, and combined cases never
claim isolated slider accuracy. Lightness L* error, chroma distance in Lab units,
P95 and worst spatial region are reported separately from RGB mean error.

Covered: exposure ±1 EV; contrast/highlights/shadows/whites/blacks/texture/clarity/
dehaze/vibrance/saturation ±50 and ±100; master and individual RGB curves,
symmetric and asymmetric combinations; 4000/8000 K; tint ±40 relative to as-shot;
eight HSL bands; four grading ranges; one combined tonal treatment.

Not established: other photos/cameras/process versions, parametric curves, masks,
denoising/sharpening parity, geometry/lens-profile parity, grain, vignette, AI,
or arbitrary combinations. B&W profile / Gray Mixer parity has not yet been measured
against a dedicated Lightroom B&W capture. Camera-specific looks beyond the decoder's
camera matrix are not bundled; Adobe DCP looks are not used by the native pipeline.

## Preview/export validation

The fixture uses the production decoder, saved preprocessing settings (highlight
compression 2.5, colour NR 0.5, sharpening 0.35), parser, processor and shader,
on RTX 4070 / Vulkan. For all 66 cases, native preview working_texture pixels
and tile export readback on the **same resized Basic RAW input** match within
1/255, with equal lengths. This does not validate full-resolution export against
reduced-resolution preview, AGX, monitor ICC appearance or different blur scales.

A JPEG red-only GPU regression checks independent channel behavior. RAW curve
and vibrance checks use measured Lightroom color/lightness errors. Cache refresh,
HDR vibrance continuity and full-image/zoom ROI dehaze have GPU regressions.
Rust suite: 120 passed, 15 ignored. This includes the monochrome GPU regression,
Lensfun catalogue parsing/matching and defringe behavior. The production frontend
build passes. Full TypeScript checking still reports pre-existing errors in
ControlsPanel and other files.

## Reproduce

Start the existing bridge: python -m lightroom bridge start. If needed, run
Library → Plug-in Extras → lightroom-py: Start bridge. capture_develop.py's UUIDs
refer to this catalog's master and virtual copy: never substitute the master.

```powershell
python bench/lr-compare/capture_develop.py
$env:RAYFINE_COMPARE_MANIFEST='B:/RustROOM/bench/lr-compare/out/A7S02588/cases.json'
$env:RAYFINE_COMPARE_SETTINGS='C:/Users/maxim/AppData/Roaming/app.rayfine.Rayfine/settings.json'
cargo test --manifest-path src-tauri/Cargo.toml --lib lightroom_render_cases -- --ignored --nocapture --test-threads=1
python bench/lr-compare/measure_develop.py --require
python bench/lr-compare/verify_master.py
cargo test --manifest-path src-tauri/Cargo.toml --lib jpeg_rgb_curve_does_not_renormalize_other_channels -- --ignored --nocapture --test-threads=1
```

--require intentionally exits 2 for failed or missing cases. Cached captures are
validated against requested settings, excluding Lightroom's inferred curve name.
RAYFINE_COMPARE_SHADER is test-only; leave it unset for production verification.
The Basic fixture rejects an enabled AGX override rather than misreporting parity.
Probe scripts are throwaway diagnostics and do not change the app.

Artifacts: ignored out/A7S02588/cases.json, measurements.json, comparison.jpg,
Lightroom TIFF/settings per case, Rayfine PNGs, baseline-measurements.json,
baseline-rayfine/, master-settings.json, native-verification-metrics.txt,
and typecheck.log. Original photo files are not overwritten.

## Earlier demosaic experiment

compare_demosaic.py remains separate. Its old 42.6% result mixes linear camera-space
DNG values with calibrated linear sRGB after a fitted scalar. It is not a developed
Lightroom comparison or proof of demosaic-only error. The TIFF oracle supersedes
that experiment for slider parity.
