# FlashRaw as an optional raw backend

> **Last updated:** 2026-10-27 · **Status:** evaluation. Optional, off by default; nothing here changes the default build.

[FlashRaw](https://github.com/ybouane/flashraw) (0.1.1, pure Rust, MIT OR Apache-2.0) is a raw decoder with a small
built-in developer. `lightcraft-flashraw` plugs it into `lightcraft-raw` as a second backend so it can be measured
against our own decoders and demosaic on the same files, in the real app.

## Use it

```text
cargo build --release -p lightcraft-cli --features flashraw     # or -p lightcraft
lightcraft-cli --raw-backend flashraw render in.cr2 -o out.jpg
lightcraft --raw-backend auto                                    # env: LIGHTCRAFT_RAW_BACKEND
```

| Backend | Decoder | Demosaic |
|---|---|---|
| `native` (default) | ours | ours (AHD, PPG, bilinear, X-Trans directional) |
| `flashraw` | FlashRaw for every file (an unreadable file is an error) | FlashRaw's, for every mosaic |
| `auto` | ours; FlashRaw only for a file ours refuses | ours |

It is a start-up choice. `lightcraft_raw::backend` holds the switch and the hook (`External`); `lightcraft_engine::raw_backend`
registers what the build includes; the new crate `lightcraft-flashraw` (L1) is the adapter. A build without the
`flashraw` feature has one backend and `--raw-backend flashraw` says so.

## What crosses over, and what does not

- **Crosses**: sensor samples, CFA, black/white levels, active area, default crop, orientation, as-shot white balance,
  the colour tags a DNG or maker note states, and EXIF metadata (read by `lightcraft-meta`, as for our decoders).
- **Not imported: FlashRaw's camera database matrices.** For non-DNG files it fills colour matrices from its database,
  and those values are the well-known dcraw / Adobe DNG Converter table (for example the Canon EOS 5D Mark IV entry
  starts `6446, -366`). LightCraft's clean-room rules forbid those values, whatever FlashRaw's own licence says, so the
  adapter keeps a matrix only when FlashRaw reports it came from the file (`ColorSource::File`). A non-DNG raw then
  takes our own colour fallbacks (`spectral`, pooled profiles, neutral). **Do not make the database path the default
  without a decision on this.**
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

1. **Sony A7 III compressed ARW**: 28,086 of 24.3 M samples differ (0.12 %), by 21 + 32·k units (21 to 245 of 16383),
   all in the top 512 rows. Their pattern suggests the ARW2 tone-curve step; **which decoder is right is not yet
   established** (neither value fits its neighbours better). Low impact, but one of the two is wrong.
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

## Verdict so far

As a **decoder** FlashRaw is a credible second opinion and faster on Canon, compressed Fuji and DNG; it agrees with us
sample for sample where it can be checked, and `auto` would let it cover files ours refuses. As a **developer** it is
a bilinear demosaic, not an upgrade. Before it becomes more than optional: settle the ARW difference, decide what to do
about its database matrices (we cannot use them), and re-run the comparison against its GPU path.
