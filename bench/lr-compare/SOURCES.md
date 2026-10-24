# Public RAW + Lightroom settings + Lightroom export

Only sources that can be used locally for research comparison. **Pixels are not
committed** — the download scripts write `datasets/` (gitignored).

## Imaging Resource field tests — primary (PV2012+)

- Pages: camera / lens field tests that say the JPEG was “converted and
  processed to taste in Adobe Camera Raw”, plus a RAW download.
- Per image: vendor RAW + `-MOD.JPG` (sRGB IEC61966-2.1, Photoshop/ACR export)
  + `crs:` packet extracted from the JPEG.
- Typical packet: `crs:Version` 11.3–13.2, `crs:ProcessVersion` 11.0 (PV5),
  `crs:CameraProfile` Adobe Standard, optional `crs:Look` (Adobe Landscape /
  Adobe Color). `crs:RawFileName` names the RAW sibling.
- Curated subset (varied bodies, outdoor / sky / highlights, train ≠ val):
  see `download_ir_triples.py` `IR_PAIRS`.
- **License**: Imaging Resource copyright. Local evaluation / research
  comparison only. Do not commit or redistribute.
  https://www.imaging-resource.com/USAGE.HTM
- Downloader: `download_ir_triples.py` / `download_public_pairs.py --source ir`.

## MIT-Adobe FiveK — not the PV2012 reference

- Official page: https://data.csail.mit.edu/graphics/fivek/
- Expert C is a 16-bit ProPhoto TIFF already retouched in Lightroom 3
  (`ProcessVersion` 5.0, `CameraProfile` ACR 4.4). That is the wrong process
  version and the TIFF is not a Lightroom sRGB JPEG. Kept only as a historical
  download target (`--source fivek`).
- **License**: `LicenseAdobeMIT` research only.

## PPR10K — supported, not auto-downloaded

- https://github.com/csjliang/PPR10K (CVPR 2021)
- RAW + `xmp_target_{a,b,c}` Camera Raw sidecars (PV2012) + 8-bit sRGB TIF
  targets. Google Drive / Baidu (~406 GB). Research non-commercial; do not
  redistribute. The 360p pack is a true Lightroom TIFF export (see
  `docs/dataset_usage.md`).
- HuggingFace `JarvisArt/MMArt-PPR10k` has ACR 12.4 / PV 11.0 `config.xmp` +
  `processed.jpg` but **no RAW**.

## Play Raw (discuss.pixls.us)

- Typically CC-BY-SA RAW + sidecar + JPEG. Sidecars scanned so far are
  **darktable**, not `crs:`. No curated Lightroom triple is vendored.

## raw.pixls.us

- CC0 RAWs, no Lightroom catalog, no expert JPEG. Not a full triple.

## Rejected / not used

- FiveK Expert C as the colour/light oracle (ACR 4.4 + already-tonemapped
  ProPhoto TIFF).
- Private catalogs.
- GitHub repos with NEF+XMP but no Lightroom JPEG (`dcapaccio/profile24`,
  `marchyman/GeoTag`, `z-x/pushu.ps`).
- Any sample without a documented license.
