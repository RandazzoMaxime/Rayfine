# FlashRaw as an optional raw backend

> **Last updated:** 2026-10-27 · **Status:** a safety net. On by default, used only for raw files our own decoders refuse.

[FlashRaw](https://github.com/ybouane/flashraw) (0.1.1, pure Rust, MIT OR Apache-2.0) is a raw decoder with a small
built-in developer. `lightcraft-flashraw` plugs it into `lightcraft-raw` as a second backend so it can be measured
against our own decoders and demosaic on the same files, in the real app.

## Use it

```text
cargo build --release -p lightcraft-cli                          # the `flashraw` feature is on by default
lightcraft-cli --raw-backend flashraw render in.cr2 -o out.jpg   # FlashRaw for everything, to compare
lightcraft --raw-backend native                                   # ours only; env: LIGHTCRAFT_RAW_BACKEND
```

| Backend | Decoder | Demosaic |
|---|---|---|
| `auto` (**default**) | ours; FlashRaw only for a file ours refuses | ours |
| `native` | ours only (FlashRaw off) | ours (AHD, PPG, bilinear, X-Trans directional) |
| `flashraw` | FlashRaw for every file (an unreadable file is an error): for comparisons | FlashRaw's, for every mosaic |

The `flashraw` feature of the apps is on by default (`--no-default-features` or `--raw-backend native` turns it off).
A file our decoders read never reaches FlashRaw, so nothing changes for it. What the safety net catches: a **compressed
Olympus ORF** (every Olympus / OM body since ~2008; the E-M1 and E-M10 III corpus files), which `lightcraft-raw` refuses
("unsupported raw variant: Olympus compressed ORF") and the app used to show as its embedded 3200×2400 preview. It now
develops from the sensor at 4608×3456 (test: `tests/fallback.rs`). Other refusals listed in
[raw-parity.md](raw-parity.md) (GoPro GPR, compressed SRW, CR3 variants, A100 ARW) are candidates, untested here.
Limits of a fallback file: colour comes from FlashRaw's database matrices (flatter than our camera-look fits, see the
colour table below), DNG-only features are absent, and the pipeline's per-file camera-look fit may not apply.

It is a start-up choice. `lightcraft_raw::backend` holds the switch and the hook (`External`); `lightcraft_engine::raw_backend`
registers what the build includes; the new crate `lightcraft-flashraw` (L1) is the adapter. A build without the
`flashraw` feature has one backend and `--raw-backend flashraw` says so.

## What crosses over, and what does not

- **Crosses**: sensor samples, CFA, black/white levels, active area, default crop, orientation, as-shot white balance,
  the colour tags a DNG or maker note states, and EXIF metadata (read by `lightcraft-meta`, as for our decoders).
- **Camera database matrices cross too** (maintainer decision, 2026-10-27). For non-DNG files FlashRaw fills colour
  matrices from its database, which is the well-known dcraw / Adobe DNG Converter table (the Canon EOS 5D Mark IV
  entry starts `6446, -366`). The first version of the adapter left them out under the clean-room rule; that rule no
  longer covers camera matrices, so a non-DNG raw under `flashraw` (and under `auto` for a file ours refuses) takes
  them instead of our `spectral` / pooled / per-file fallbacks. The other clean-room rules (Adobe icons, DCP/LCP
  profiles, fonts, GPL code) are unchanged.
- **Not available through it**: DNG profile look tables, opcode lists (embedded lens corrections), lens-correction
  records, semantic masks. A DNG under `flashraw` develops without them; `auto` keeps ours for any file ours reads.
- FlashRaw's demosaic clamps each channel to `[0, 1]`: highlights above white and negative noise are lost before our
  highlight reconstruction sees them.

## Results (26 MP-class CC0 files from `cargo xtask corpus`, one machine, release build)

### Decoding (`compare decode`, best of two, whole `decode()` including metadata)

Sensor samples are **identical on 14 of 15 files** (Canon CR2 and CR3, Nikon NEF 12/14-bit, Fuji X-Trans RAF
uncompressed / compressed / lossless, Hasselblad 3FR, five DNGs): two independent decoders agree sample for sample.

| File | ours ms | FlashRaw ms |
|---|---:|---:|
| Canon 80D CR2 | 514 | 137 |
| Canon M50 CR3 | 266 | 96 |
| Fuji X-T2 RAF compressed | 558 | 131 |
| Fuji X-T4 RAF lossless | 654 | 155 |
| Nikon Z6 NEF (3 variants) | 178–212 | 105–120 |
| DNG (iPhone, Hasselblad) | 110–129 | 22–38 |
| Sony A7 III ARW | 39 | 93 |
| Fuji X-T20 RAF uncompressed | 21 | 102 |

Open differences:

1. **Sony A7 III compressed ARW** (resolved, no bug in either): 28,086 of 24.3 M samples differ, by 21 + 32·k units
   (21 to 245 of 16383), all in the top rows. The ARW2 tone curve (file tag `0x7010`) climbs to 17,220; ours stops it at the
   14-bit white level (16,383), FlashRaw lets it run. Every differing sample is a saturated one (ours is exactly at white,
   theirs above it), so nothing visible changes. Locked by a test (`arw2_decoders_differ_only_on_saturated_samples`).
2. **Canon M50 CR3 white level**: the file's data peaks at 11,428; ours reads 11,892 from the file, FlashRaw falls back to
   16,383 (14-bit nominal). With FlashRaw highlights near saturation would render ~27 % dimmer and clipping would not
   be detected.
3. Hasselblad 3FR default crop: ours 8272×6200, FlashRaw 8278×6208 (6 px / 8 px larger).

### Demosaic (`compare demosaic`: ground truth = a raw's 2×2 superpixels, or a synthetic zone plate; re-mosaicked, then demosaiced)

FlashRaw's bilinear gives **exactly our bilinear's score on every image** (same algorithm, same result). Our default
methods are better on Bayer: Sony A7 III 30.32 dB (AHD) vs 29.27 dB; Canon 80D 33.58 vs 32.13 dB; zone plate 19.67 vs
17.85 dB, with less false colour everywhere. On a smooth, dark Nikon file AHD and bilinear are within 0.2 dB. On
X-Trans-patterned mosaics our directional method wins by 0.6–1.2 dB on photographs and loses by 0.5 dB on the zone
plate (extreme aliasing). In this integration FlashRaw's kernel is not faster (37 vs 12 ms for bilinear on 2.4 MP): its
fused-pass advantage needs its own pipeline, which our develop path does not use.

### Colour (`compare preview`: each full render against the camera's own JPEG, the raw's embedded preview)

Mean ΔE76 over a 96×64 grid, then again with the render's mean luminance matched to the preview's so that it measures
colour, not brightness. Seven corpus files, each rendered by the app with each backend (FlashRaw with its database
matrices):

| File | native ΔE | FlashRaw ΔE | native, brightness matched | FlashRaw, brightness matched |
|---|---:|---:|---:|---:|
| Canon 80D | 4.1 | 13.5 | 4.2 | 7.0 |
| Sony A7 III | 2.8 | 17.2 | 2.7 | 4.1 |
| Fuji X-T2 | 2.5 | 23.1 | 2.4 | 5.3 |
| Canon M50 | 4.1 | 28.0 | 4.1 | 11.3 |
| Fuji X-T4 | 3.4 | 13.1 | 2.9 | 10.8 |
| Fuji X-T20 | 1.6 | 13.8 | 1.5 | 8.3 |
| Nikon Z6 | 1.9 | 20.3 | 1.9 | 2.0 |

**Read this with a caveat: our native path fits its colours to the camera JPEG file by file** (the "guarded per-file fit"
in [raw-parity.md](raw-parity.md)), so this metric favours it by construction. It still shows that FlashRaw renders
darker (no camera-style exposure or tone: ΔE 13–28 as rendered) and that its matrices are close on some bodies (Nikon Z6,
Sony A7 III, X-T2 within 2–5 once brightness is matched) and far on others (Canon M50 11.3, Fuji X-T4 10.8; the M50 also
has the wrong white level above).

### In the app (`lightcraft-cli render`, CPU, 24 MP)

Wall time is the same within noise (3.9–4.7 s per file, either backend); `auto` writes a JPEG byte-identical to
`native`; `flashraw` is visibly softer at 100 % (fewer fine branches, smoother noise) with a smaller file.

## Reproduce

```text
cargo xtask corpus --download
cargo run --release -p lightcraft-flashraw --example compare -- decode corpus/raw/*.{arw,cr2,cr3,raf,nef,dng}
cargo run --release -p lightcraft-flashraw --example compare -- diff corpus/raw/arw-sony-a7m3-compressed.arw
cargo run --release -p lightcraft-flashraw --example compare -- demosaic OUT_DIR corpus/raw/cr2-canon-80d.cr2
cargo test -p lightcraft-flashraw
```

## Verdict

Decision (maintainer, 2026-10-27): FlashRaw is used only when our decoders refuse a file. As a **decoder** it is a credible
second opinion (identical samples wherever it can be checked, faster on Canon, compressed Fuji and DNG) and it
covers compressed ORF, which we do not. As a **developer** it is a bilinear demosaic with database colour matrices:
behind ours on both, so it is never chosen for a file we can read. Open: the Canon CR3 white level (it falls back to the
14-bit nominal), the matrices that are far from the camera's on some bodies (M50, X-T4), and its GPU path, untested.
