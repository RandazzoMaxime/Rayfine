# Public RAW + Lightroom settings + Lightroom export

Only sources that can be used locally for research comparison. **Pixels are not
committed** — `download_public_pairs.py` writes `datasets/` (gitignored).

## MIT-Adobe FiveK — used (research)

- Official page: https://data.csail.mit.edu/graphics/fivek/
- Per image: DNG + Expert A–E 16-bit ProPhoto TIFF + Lightroom catalog in the 50 GB archive.
- Expert C TIFFs embed the Lightroom 3.4.1 `crs:` packet (`ProcessVersion` 5.0). That is the settings source; the 50 GB `.lrcat` is optional (`extract_lrcat_xmp.py`).
- **License**: `LicenseAdobe.txt` / `LicenseAdobeMIT.txt` — research only, no commercial advantage, keep the copyright notice, do not use Adobe/MIT names to promote products. This script downloads **LicenseAdobeMIT** IDs only.
- Cite: Bychkovsky, Paris, Chan, Durand, CVPR 2011.
- Curated subset (outdoor / nature, train ≠ val): see `download_public_pairs.py` `FIVEK_PAIRS`.

## PPR10K — supported, not auto-downloaded

- https://github.com/csjliang/PPR10K (CVPR 2021)
- RAW + `xmp_target_{a,b,c}` Camera Raw sidecars (PV2012) + 8-bit sRGB TIF targets (360p pack).
- **License**: non-commercial research; do not reproduce / sell / trade the images.
- Hosted on Google Drive / Baidu (~406 GB). The downloader only writes the local folder layout.

## raw.pixls.us — RAW only

- https://raw.pixls.us/ — CC0 / public domain camera samples.
- Unmodified RAWs, no Lightroom catalog, no expert JPEG. Useful as extra RAW input, **not** a full triple.

## Play Raw (discuss.pixls.us) — accepted if crs:

- Forum asks for RAW + sidecar + small JPEG, typically **CC-BY-SA**.
- Most sidecars are **darktable** (`darktable:` namespace), not Lightroom. The compare pipeline keeps a file only when the XMP contains `crs:Exposure2012` / `crs:Highlights2012` / PV2010 `crs:Exposure`.
- No curated Lightroom triple is vendored here; drop verified CC posts under `datasets/playraw/<id>/`.

## Rejected / not used

- Private `A7S02588.ARW` catalog in `bench/lr-compare/README.md` (not redistributable).
- FiveK files listed only in `filesAdobe.txt` (same research terms, but this pass sticks to `filesAdobeMIT.txt`).
- Any sample without a documented license.
