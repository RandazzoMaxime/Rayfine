# Imaging Resource ACR triples (PV 11.0)

Public RAW + `crs:` XMP + Lightroom/Camera Raw sRGB JPEG. Pixels stay in
`datasets/ir/` (gitignored). License: Imaging Resource copyright, local
evaluation / research comparison only — do not commit or redistribute.
https://www.imaging-resource.com/USAGE.HTM

Downloader: `download_ir_triples.py` / `download_public_pairs.py --source ir`.

All packets below were read from the extracted `develop.xmp`
(`crs:ProcessVersion` 11.0 = PV5, `crs:CameraProfile` Adobe Standard,
`crs:Look` Adobe Landscape). User sliders are the root `crs:*` values;
Look extras (H −12 / S +12 / Clarity +10 + Look ToneCurvePV2012) are added
on top by `crs_map.py`.

| ID | Split | Body | ACR | JPEG | Light | User sliders (root) | Source page |
|---|---|---|---|---|---|---|---|
| g95-0192 | train | Panasonic G95 | 11.3.1 | 5184×2592 sRGB | sky / tele wildlife | E +0.05 H −41 S +58 | [G95 shooting](https://www.imaging-resource.com/cameras/panasonic-g95-review/shooting/) |
| g95-0314 | train | Panasonic G95 | 11.3.1 | 5184×2592 sRGB | highlights | E +0.20 S +37 C +9 B +2 Medium Contrast name (2012 Linear) | same |
| a6600-0046 | train | Sony A6600 | 13.1 | 6000×4000 sRGB | daylight | E +0.30 S +56 B −26 Temp 7500 | [A6600 gallery](https://www.imaging-resource.com/cameras/sony-a6600-review/gallery/) |
| a6600-0089 | train | Sony A6600 | 13.1 | 6000×4000 sRGB | daylight | E −0.30 H −43 B −35 | same |
| z6ii-0086 | train | Nikon Z6 II | 13.1 | 5595×2798 sRGB | daylight | E +0.65 S +55 Temp 6000 | [Z6 II shooting](https://www.imaging-resource.com/cameras/nikon-z6-ii-review/shooting/) |
| g95-0273 | val | Panasonic G95 | 11.3.1 | 5184×3888 sRGB | sky / wide | E 0 W +31 B −23 Temp 4500 | G95 shooting |
| g95-1146 | val | Panasonic G95 | 11.3.1 | 4489×3367 sRGB | sky / tele | E 0 H −97 (strong HL) | G95 shooting |
| a6600-0156 | val | Sony A6600 | 13.1 | 5758×3839 sRGB | daylight | E +0.55 S +37 B −30 | A6600 gallery |
| a7riv-1852 | val | Sony A7R IV | 13.2 | 8302×5535 sRGB | sky / tele wildlife | E +0.40 S +31 Temp 5400 Tint +30 | [Tamron 150-500](https://www.imaging-resource.com/lenses/tamron-150-500mm-f-5-6-7-di-iii-vc-vxd-model-a057/) |

Incomplete downloads (stripped JPEG without `crs:`, not used): g95-1462, xt4-0023, z6ii-0384.

`crs:HasCrop` is False on every complete triple. Several G95 / Z6 II JPEGs set
`aux:DistortionCorrectionAlreadyApplied`. No image in this set is a default
(all-zero) Adobe Standard export — Adobe Landscape is always present.
