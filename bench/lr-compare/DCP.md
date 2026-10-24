# Adobe DCP (not committed)

Adobe Standard / Adobe Color / Adobe Landscape `.dcp` for the Imaging Resource
bodies (G95, A6600, Z 6 II, A7R IV) come from **Adobe DNG Converter**.

- **Source**: `https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_16_3.exe`
  (AUR `adobe-dng-dcp` uses the same URL). After `innoextract`, profiles live under
  `commonappdata/Adobe/CameraRaw/CameraProfiles/Adobe Standard` and
  `…/Camera/<model>/`.
- **Licence**: Adobe copyright. Redistribution of the `.dcp` files is forbidden.
  Rayfine commits only `fetch_adobe_dcp.py`. Extracted files stay in
  `datasets/dcp/` (gitignored).
- **Fetch**: `python bench/lr-compare/fetch_adobe_dcp.py`
- **Runtime**: `RAYFINE_DCP_DIR` or `lr_public_compare --dcp-dir`. The compare
  harness merges `{slug}-adobe_standard.dcp` onto the vendor RAW's AsShotNeutral.

Public stand-ins (not Adobe Standard):

- rawler ColorMatrix (already used when no DCP is present).
- LightCraft spectral CM/FM for ILCE-7RM4 (Apache-2.0, matrices only).
- dcraw / rawspeed `adobe_coeff` — historical 3×3, no HueSatMap / LookTable /
  ProfileToneCurve / BaselineExposure.
- RawTherapee / darktable / dcamprof `.dcp` — their own profiles, not Camera Raw
  Adobe Standard.

Do not commit any Adobe `.dcp` or a DNG produced by Adobe DNG Converter.
