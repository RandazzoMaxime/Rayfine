# Adobe Landscape / Color Looks (not committed)

Adobe Landscape and Adobe Color are **Looks on Adobe Standard**, not body
`.dcp` files. Imaging Resource XMP stores:

```text
crs:CameraProfile="Adobe Standard"
crs:Look Name="Adobe Landscape"
crs:LookTable="0B3BFB5CFB7DBF7FF175E98F24D316B0"
crs:Amount="1.000000"
```

plus Look.Parameters (Highlights −12, Shadows +12, Clarity +10) and a
Look ToneCurvePV2012.

## Where the table lives

Adobe DNG Converter ships
`Settings/Adobe/Profiles/Adobe Raw/Adobe Landscape.xmp` with
`crs:Table_<UUID>` = Adobe base85 + zlib (`dng_big_table`).

DNG Converter **16.3** (the IR-era installer) stores a **36×16×16 HSV
LookTable** (header `0, 1, 36, 16, 16, encoding=0`), not a type-1 RGB 3D
LUT. That is the blob referenced by the IR sidecars. Newer Camera Raw
builds may wrap a type-1 `dng_rgb_table` (uint16 deltas from an identity
ramp, primaries + gamma) in the same attribute; Rayfine decodes both.

## Fetch (local only)

```text
python bench/lr-compare/fetch_adobe_looks.py
```

Copyright Adobe. Files stay in `datasets/looks/` (gitignored). Runtime:
`RAYFINE_LOOK_DIR` or `lr_public_compare --look-dir`.

## ACR order

HueSatMap (Adobe Standard DCP) → BaselineExposure + Exposure → **this
LookTable (replaces the DCP 36×8×16 look)** → optional RGBTable →
ProfileToneCurve / Look curve → user H/S. Scene-referred
(`SupportsSceneReferred=True` on Landscape).
