# Public UI layout reference (Lightroom Classic–style)

Remote Adobe help screenshots could not always be downloaded in this environment.
This note records the **publicly known** Lightroom Classic workspace structure
used as a **layout guide only** (not a license to copy Adobe assets/branding).

## Top
- Module picker (left→right): Library · Develop · Map · Book · Slideshow · Print · Web
- Identity / catalog name often left or right of the strip

## Library
- **Left**: Catalog / Folders / Collections / Publish Services
- **Center**: Grid / Loupe / Compare / Survey + filter bar
- **Right**: Histogram, Quick Develop, Metadata, Keywording, …
- **Bottom**: Filmstrip

## Develop
- **Left**: Navigator, Presets, Snapshots, History, Collections
- **Center**: Loupe + toolbar (crop, spot, red-eye, graduated/radial/brush, …)
- **Right**: Histogram, then collapsible panels:
  1. Basic (WB, Tone, Presence incl. Texture/Clarity/Dehaze)
  2. Tone Curve
  3. HSL / Color / B&W
  4. Color Grading
  5. Detail
  6. Lens Corrections
  7. Transform
  8. Effects
  9. Calibration
- **Bottom**: Filmstrip

## Other modules (public structure)
| Module | Left | Center | Right |
|---|---|---|---|
| Map | Locations / tagged | Map canvas | Map style / pins |
| Book | Pages / collections | Page preview | Book settings |
| Slideshow | Template browser | Slide preview | Duration / music |
| Print | Template browser | Page preview | Layout / print job |
| Web | Template browser | Gallery preview | Site info / upload |

## RustROOM mapping (original chrome)
| LR zone | RustROOM |
|---|---|
| Module bar | `ModuleBar.tsx` (all 7 modules clickable) |
| Map/Book/Slideshow/Print/Web | `*ModuleView.tsx` + `ModuleShell.tsx` (layout shells) |
| Left folders/collections | `FolderTree.tsx` |
| Library grid | `MainLibrary` / `LibraryGrid` |
| Library right | `LibraryRightPanel` (Histogram · Quick Develop · Metadata) |
| Library Compare | `CompareView` (Select / Candidate 2-up) |
| Local masks XMP | `parse_mask_group_based_corrections` / export MaskGroupBasedCorrections |
| Develop canvas | `Editor` / `ImageCanvas` |
| Develop left | `DevelopLeftPanel` (Nav / Presets / Snapshots / History) |
| Right develop | `ControlsPanel` basic → curves → color → details → optics → geometry → effects |
| Filmstrip | `BottomBar` + `Filmstrip` |
| Import | `ImportSettingsModal` + `import_files` |
| Develop presets XMP | `preset_converter` + Presets panel import |
| Flags | `flag:pick` / `flag:reject` + Shift+P/X/U |

## Theme
- Grey theme retuned toward mid-grey desktop photo workspace (`themes.ts` Grey).

## Legal
- Structure from public UI knowledge / screenshots only.
- No Adobe binary RE, trademarks, or pixel-identical proprietary chrome.


## Develop Before / After
- Solo original: toolbar eye or **O** (`showOriginal`)
- Split view: toolbar Columns2 or **\\** (`beforeAfterSplit`) — left Before, right After

## Soft Proofing (shell)
- Toolbar printer icon or **Ctrl+Shift+P**
- Amber strip: profile select (sRGB / Display P3 / Adobe RGB / ProPhoto)
- Layout only — not a full ICC soft-proof engine

## Before / After split
- Draggable vertical divider (ratio 8%–92%)

## Map module
- OpenStreetMap embed with pins from library EXIF GPS
- Left: All / GPS tagged / No GPS / Selected + pin list
- Right: map style (Standard/Cycle/Transport), show pins, open in OSM

## Develop Calibration
- Separate collapsible section after Effects (public LR order)
- Camera Calibration primaries + shadows tint

## Library view shortcuts
- Shift+G Grid · L Loupe · C Compare · N Survey (library only)

## Print / Slideshow / Book / Web (live previews)
- **Print**: single · contact sheet · 2×2; paper A4/Letter/5×7; margins; system `window.print`
- **Slideshow**: playlist from selection; play/pause; duration; fade/slide; Space/arrows
- **Book**: cover/pages; single or two-page spread; cells from selection thumbs
- **Web**: classic/grid/mosaic gallery preview; site title; HTML export stub

## Catalog — Previous Import
- After an import, `lastImportedPaths` is stored
- Catalog **Previous Import** scopes the library to that batch (LR Classic behavior)
- All Photographs clears the scope

## Before / After orientations
- **\\** toggles split; **Shift+\\** (or Shift+click BA button) cycles vertical ↔ horizontal
- Vertical: Before | After · Horizontal: Before / After (top/bottom)
- Drag the divider in either orientation

## Quick Collection
- Session target collection (LR **B** to add/remove current selection)
- **Ctrl+B** show only QC · **Ctrl+Shift+B** clear
- Catalog list entry with live count
- Independent of albums / Previous Import scope

## Module filmstrip
- Map / Book / Slideshow / Print / Web show a bottom filmstrip (same BottomBar/Filmstrip as Develop)
- Select / rate / flag without leaving the module

## Quick Collection persistence
- Stored in `localStorage` key `rustroom.quickCollection.v1` (max 5000 paths)

## Virtual copy
- **Ctrl+Alt+V** creates a virtual copy of the active/single selection

## Web HTML export
- Save dialog → single `.html` gallery (title, template, captions)
- Uses `write_text_file` backend; embeds portable data-URL thumbnails when present

## Library Cull shortcut
- **Shift+C** → Cull view (in addition to mode switcher)

## Before / After modes
- **\\** toggle split
- **Shift+\\** (or Shift+click BA button) cycles: **vertical → horizontal → two-up**
- Two-up: Before left half / After right half (fixed 50%, no drag)

## Book HTML export
- Multi-page print-ready HTML (single or spread); browser Print → PDF

## Library camera filter
- Filter strip dropdown of distinct Make+Model from current folder EXIF

## Target Collection
- Default target = Quick Collection (`targetCollectionId: null`)
- Right-click album → **Set as Target Collection** (amber ●)
- **B** toggles membership of the current selection in the target
- Right-click Quick Collection → reset target to QC
- Persisted: `rustroom.targetCollection.v1`

## Slideshow HTML export
- Self-contained HTML with Play/Prev/Next and keyboard (Space/arrows)
- Embeds portable data-URL thumbs when available

## Soft Proofing controls
- Profile: sRGB / Display P3 / Adobe RGB / ProPhoto
- Intent: Relative | Perceptual (CSS approximation)
- Paper: simulate paper & ink (sepia/brightness)
- Gamut: approximate out-of-gamut wash overlay

## Print HTML export
- Export current template/page layout as HTML (then browser Print → PDF)

## Keyword filter
- Filter strip text field matches tags (user:/color:/flag: stripped)

## Library date filter
- Filter strip **from–to** date inputs (YYYY-MM-DD)
- Matches EXIF `DateTimeOriginal` / `CreateDate` (day portion)

## Import keywords
- Import settings: comma-separated keywords applied to all imported paths after copy
- Written to RapidRAW tags (`user:…`) and XMP when sync is enabled

## AutoTone XMP
- Import/export `crs:AutoTone` / `crs:AutoExposure` as boolean flags on adjustments

## Library lens filter
- Filter strip dropdown of distinct EXIF `LensModel` / `Lens` values in the current folder

## AutoTone flag
- Applying **Auto** sets `autoTone: true` on adjustments (exported as `crs:AutoTone`)
- Auto button highlights when AutoTone is active

## Copy as DNG
- Import option accepted and reported; full DNG conversion pipeline not yet implemented

## Catalog smart collections
- **Edited** — `editedStatus: EditedOnly`
- **Has GPS** / **No GPS** — EXIF GPSLatitude/Longitude presence

## ISO filter
- Filter strip ISO min–max (PhotographicSensitivity / ISOSpeedRatings)

## Library EXIF range filters
- **ISO** min–max
- **Aperture** (f/) min–max from EXIF FNumber
- **Focal length** (mm) min–max from EXIF FocalLength

## Catalog smart: Unedited
- `editedStatus: UneditedOnly` — photos without develop edits

## List view shortcut
- **Shift+L** — Library List view (Grid remains Shift+G; Loupe L)

## Shutter speed filter
- Filter strip **s** min–max in seconds (EXIF ExposureTime; e.g. `0.004` = 1/250)

## Catalog smart: ratings
- **5 Stars** — exact 5★ (`rating: 5`)
- **Unrated** — zero stars (`rating: -1`)

## Catalog color labels
- Swatches under Smart: red / yellow / green / blue / purple / none
- Filters `colors: [name]` (toggle off when re-clicked)

## Keyword filter datalist
- Library filter strip keyword field suggests distinct `user:` tags in the folder (top 80)

## Develop Match Previous
- **Ctrl+Alt+P** or bottom-bar **Previous** (undo-style icon)
- Stores `previousDevelopAdjustments` when leaving a photo (switch or back to Library)
- Pastes via the same include/merge rules as Copy/Paste Settings
- Does not overwrite the clipboard used by Copy/Paste

## Develop Sync Settings
- **Ctrl+Alt+S** or bottom-bar **Sync** (refresh icon)
- Requires multi-selection of 2+ photos
- Source = active Develop photo (or primary selection); targets = other selected paths
- Uses Copy/Paste include + merge rules; does not keep clipboard changed after sync

## Develop Expand / Collapse all
- Toolbar chevrons on Adjustments panel header open or close all Develop sections

## XMP LensProfileIsEmbedded
- Stored as `lensProfileIsEmbedded` boolean; re-exported as `crs:LensProfileIsEmbedded`

## Develop History Clear
- Left panel History section **Clear** collapses history to the current adjustments only (LR-style)

## Library file type filter
- Filter strip dropdown of distinct file extensions in the current folder (ARW, JPG, …)

## Library List view columns
- Thumbnail · Name · Modified · Rating · Label
- With metadata overlay on: Shutter · Aperture · ISO · Focal · **Camera** · **Lens**
- Click column headers to sort (camera / lens included)

## Library List Capture Time
- Date column shows EXIF `DateTimeOriginal` / `CreateDate` when present (else file modified)
- Column header sorts by `date_taken`

## Soft proof profiles (CSS shell)
- sRGB · Display P3 · Adobe RGB · ProPhoto · Rec. 2020 · Gray Gamma 2.2
- Intents: Relative · Perceptual · Absolute (simulated via CSS filters, not full ICC)

## Develop WB picker
- **W** toggles the white-balance eyedropper while an image is open in Develop

## Compare Swap
- Toolbar **Swap** exchanges Select and Candidate (reorders multi-selection)

## Library caption filter
- Filter strip **Caption…** matches ImageDescription / XPComment / XPTitle / Description

## Survey remove
- Hover a survey cell → **X** removes that photo from the multi-selection (LR-style)

## Develop Straighten
- **Q** opens Crop panel and toggles the straighten tool

## Library Loupe
- **Fit / Fill** toolbar (or click image to toggle)
- EXIF exposure strip overlay (shutter · f/ · ISO · focal · camera)
- Bottom: stars · Pick/Reject · color label swatches
- Arrows prev/next · double-click → Develop

## Module keyboard shortcuts
- **Ctrl+Alt+1** Library · **2** Develop · **3** Map · **4** Book · **5** Slideshow · **6** Print · **7** Web

## Rating filter (and higher)
- 1–4★ = that rating **and higher** (badge shows `+` when active)
- 5★ = exact five stars · 0 = all

## Develop Navigator
- Click thumbnail: cycle Fit ↔ 1:1 · Double-click: 100%

## Panel visibility (Lightroom-style)
| Shortcut | Action |
|----------|--------|
| **Tab** | Hide/show side panels (folder tree, develop left, right panel) |
| **Shift+Tab** | Hide/show all panels including filmstrip |
| **F5** | Filmstrip |
| **F6** | Left panels (folder tree + develop left) |
| **F7** | Right panels |

## Library Selected filter
- Filter bar **Selected** chip (or **Ctrl+Alt+A**) shows only multi-selected photos
- Falls back to the active photo if multi-selection is empty
- Cleared when choosing Catalog → All Photographs / QC / Previous Import

## Library selection shortcuts
| Shortcut | Action |
|----------|--------|
| **Ctrl+A** | Select all (current filtered view) |
| **Ctrl+D** | Deselect all |
| **Ctrl+Shift+I** | Invert selection |
| **Ctrl+Alt+A** | Filter: selected only |

## Lights Out
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+L** | Cycle normal → dim → black (hide panels) |
| **Esc** | Exit Lights Out and restore panels |

## XMP Dublin Core metadata
When saving caption / artist / copyright from Metadata (or `update_exif_fields`):
| RR EXIF key | XMP |
|-------------|-----|
| ImageDescription / Description / Caption | `dc:description` |
| Artist / Creator | `dc:creator` |
| Copyright / Rights | `dc:rights` |

Import from sidecar populates the same EXIF map for the Metadata panel.

## Develop clipping (J)
- **J** toggles `showClipping` on adjustments (shadow/highlight clipping overlay — same control as histogram/waveform)

## Catalog smart: keywords
- **Has Keywords** — any `user:` tag
- **No Keywords** — no `user:` tags

## White Balance As Shot
- Develop Basic **As Shot** sets `whiteBalance: "As Shot"` and `temperature`/`tint` to **0** (relative as-shot)
- Moving temperature/tint sliders sets `whiteBalance: "Custom"`

## Catalog smart: Virtual Copies
- Filters `virtualCopies: yes` — `is_virtual_copy` or path contains `?vc=`

## Named white balance (Basic)
Relative temp/tint offsets (not absolute Kelvin):
| Preset | Temp | Tint |
|--------|------|------|
| As Shot / Auto | 0 | 0 |
| Daylight | +5 | +2 |
| Cloudy | +18 | +5 |
| Shade | +32 | +8 |
| Tungsten | −55 | −8 |
| Fluorescent | −22 | +28 |
| Flash | +8 | 0 |

Slider moves → `whiteBalance: Custom`.

## Filmstrip double-click
- Module filmstrip (Map/Book/…) and Develop filmstrip: double-click opens/switches Develop for that photo

## Library Keyword Set
- Keywording panel shows up to 12 most common `user:` tags from the current folder that are not on the selection
- Click **+ keyword** to apply to all selected photos

## Develop flip shortcuts
| Shortcut | Action |
|----------|--------|
| **H** | Flip horizontal |
| **V** | Flip vertical |

## Batch export develop XMP
- **Ctrl+Shift+E** (or context menu Export develop XMP) exports `.xmp` for **all multi-selected** photos
- Single selection still exports one sidecar

## Develop left preset search
- Search field filters presets by name and folder
- Empty query shows full list; "No matching presets" when filter misses

## Batch reimport develop XMP
- **Ctrl+Shift+X** reimports develop from `.xmp` for multi-selection (or the active photo)
- Uses `reimportDevelopFromXmpPaths` for batches; toast reports ok/fail counts

## Catalog smart: date
- **Today** — `dateFrom`/`dateTo` = local today (EXIF DateTimeOriginal)
- **Past 7 Days** — capture date from today−6 through today

## Catalog smart: This Month / This Year
- **This Month** — first…last day of current local month
- **This Year** — Jan 1 … Dec 31 of current year

## Soft proof keyboard
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+P** | Toggle soft proofing |
| **Ctrl+Shift+]** | Next proof profile (when soft proof on) |
| **Ctrl+Shift+[** | Previous proof profile |
| **Esc** | Close soft proof (before straighten / lights-out restore order) |

## Crop aspect cycle
- With **Crop** tool open: **Shift+A** cycles Free → Original → 1:1 → 5:4 → 4:3 → 3:2 → 16:9 → 21:9 → …
- **O** still cycles crop overlays; **Shift+O** rotates overlay

## Develop preset → multi-selection
- Applying a preset from Develop left also pushes adjustments to other multi-selected photos (same as LR “sync on apply” workflow for selection)

## Develop snapshots keyboard
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+S** | Create snapshot |
| **Ctrl+Shift+↓** | Next snapshot (newer → older in list) |
| **Ctrl+Shift+↑** | Previous snapshot |
| **Ctrl+Shift+U** | Auto Tone (same as Auto button) |

## Map → Develop
- Double-click a GPS pin list item, or use **Open in Develop** when a pin is focused
- Selects the photo and opens Develop (same as library double-click)

## Crop reset
- With Crop tool open: **Shift+R** resets crop / aspect / flips / orientation (same as Reset button)

## Soft proof intent cycle
- **Ctrl+Shift+;** cycles Relative → Perceptual → Absolute (when soft proof is on)

## Develop history step
| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** / **Ctrl+Y** | Undo / Redo (existing) |
| **Ctrl+Alt+←** | Step back in history stack |
| **Ctrl+Alt+→** | Step forward in history stack |

## Export Show in folder
- After a successful export, **Show in folder** reveals the output path in the system file manager

## Library flag-and-advance (culling)
- **Shift+P** (pick) and **Shift+X** (reject) in Library advance selection to the next photo in the current filtered order
- Does not auto-advance while a photo is open in Develop (flags apply to the open image only)
- **Shift+U** unflag does not advance

## Soft proof paper / gamut keys
| Shortcut | Action (soft proof must be on) |
|----------|--------------------------------|
| **Ctrl+Shift+O** | Toggle paper & ink simulation |
| **Ctrl+Shift+G** | Toggle gamut warning |

## Library color-label-and-advance
- **Shift+1…5** set color labels (red…purple) and advance to the next photo in Library
- **Shift+0** clears color label without advancing
- Same culling flow as flag-and-advance; disabled while Develop has an open photo

## Compare swap shortcut
- **Shift+S** swaps Select and Candidate (first two multi-selected paths) in Library Compare workflow

## Reset develop
- **Ctrl+Shift+R** resets develop adjustments for the current photo (same as Reset)

## Library star-and-advance (culling)
- **1–5** set star rating and advance to the next photo in Library
- **0** clears rating without advancing
- Same Library-only rule as flag/color advance (no advance while Develop has an open photo)

## Web gallery lightbox
- Exported HTML galleries support click-to-open lightbox, Esc close, ←/→ navigation
- After export, **Show in folder** reveals the saved HTML path

## Module HTML exports — Show in folder
- **Web**, **Book**, **Slideshow**, and **Print** remember the last export path and offer **Show in folder** (system file manager)

## Slideshow shuffle
- **Shuffle play order** reorders the playlist with a deterministic shuffle for the current set (stable while the set is unchanged)

## Slideshow loop
- **Loop / repeat** continues playback from the first slide after the last (in-app and exported HTML)

## Map pin keyboard
| Key | Action |
|-----|--------|
| **← / →** (or **↑ / ↓**) | Cycle GPS pins in the filtered list |
| **Enter** | Open current pin in Develop |
| **Double-click** pin | Open in Develop |

## Book page keyboard
| Key | Action |
|-----|--------|
| **←** / **PageUp** | Previous page |
| **→** / **PageDown** | Next page |
| **Home** / **End** | First / last page |

## Survey remove
- **X**, **Delete**, or **Backspace** (no modifiers) removes the focused photo from the multi-selection survey
- Does not steal **Shift+X** (flag reject)

## Module filmstrip arrows
- **← / →** move the selection along the filmstrip under Map/Book/Slideshow/Print/Web

## Library filter bar — GPS / keywords / virtual copies
| Control | Filter |
|---------|--------|
| **GPS: all / Has GPS / No GPS** | `filterCriteria.hasGps` |
| **Keywords: all / Has / No** | `filterCriteria.hasKeywords` |
| **VC: all / Virtual copies / Masters only** | `filterCriteria.virtualCopies` |

Smart collections in the left catalog still set the same criteria.

## Print shortcut
- **Ctrl/Cmd+P** in the Print module opens the system print dialog (same as **Print…**)

## Develop delete snapshot
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+S** | Create snapshot |
| **Ctrl+Shift+↓ / ↑** | Next / previous snapshot |
| **Ctrl+Shift+Backspace** | Delete active snapshot (or newest if none active) |

## Compare candidate navigation
| Key | Action |
|-----|--------|
| **↑ / ↓** | Move Candidate through the library (Select stays first multi-select) |
| **Shift+S** | Swap Select / Candidate |

## Loupe Fit/Fill
| Key | Action |
|-----|--------|
| **Z** (or click image) | Toggle Fit (contain) ↔ Fill (cover) |

## Clear develop history
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+H** | Clear history stack, keep current adjustments (same as History → Clear) |
| **Ctrl+Alt+← / →** | Step history back / forward |

## Develop expand / collapse all
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+.** | Expand all adjustment panels |
| **Ctrl+Shift+,** | Collapse all adjustment panels |
| **Alt-click** section header | Solo that section (existing) |

## Library IPTC (right panel)
- **Caption** → EXIF `ImageDescription` / XMP `dc:description`
- **Creator** → EXIF `Artist` / XMP `dc:creator`
- **Copyright** → EXIF `Copyright` / XMP `dc:rights`
- Edits apply via `UpdateExifFields` and sync into the library list + sidecar pipeline

## Library IPTC multi-edit
- Caption / Creator / Copyright in the Library right panel apply to **all multi-selected photos** (not only the primary)
- Toast confirms when more than one photo is updated

## Soft proof canvas badge
- When soft proofing is on, the image frame shows a badge: profile · intent · paper (if simulated)

## Masks brush keyboard (Masks panel open)
| Shortcut | Action |
|----------|--------|
| **[ / ]** | Decrease / increase brush size (overrides rotate while Masks is open) |
| **Ctrl+↑ / ↓** | Increase / decrease brush size |
| **Ctrl+Shift+↑ / ↓** | Increase / decrease brush feather |
| **E** | Toggle Brush ↔ Eraser (overrides Export panel shortcut while Masks is open) |
| **I** | Invert active mask container (overrides Metadata panel shortcut while Masks is open) |
| **H** | Show / hide active mask (overrides flip H while Masks is open) |
| **Shift+[ / ]** | Cycle previous / next mask container |
| **Delete** / **Backspace** | Delete active mask container (existing) |

## Masks overlay + clipboard
| Shortcut | Action (Masks panel open) |
|----------|---------------------------|
| **O** | Toggle mask overlay preview on the canvas (overrides show-original while Masks is open) |
| **Ctrl+Alt+C** | Copy active mask container |
| **Ctrl+Alt+V** | Paste mask container (after active, or at end) |

## Masks duplicate
| Shortcut | Action (Masks panel open) |
|----------|---------------------------|
| **Ctrl+Alt+D** | Duplicate active mask container |

## Module filmstrip selection
- Filmstrip under Map/Book/Slideshow/Print/Web uses the Library **active path** (and multi-select) for highlight + auto-scroll, not only Develop `selectedImage`

## White balance keyboard
| Shortcut | Action |
|----------|--------|
| **W** | Toggle WB eyedropper (existing) |
| **Shift+W** | Cycle named WB: As Shot → Auto → Daylight → Cloudy → Shade → Tungsten → Fluorescent → Flash → Custom |

## Snapshot rename
| Shortcut | Action |
|----------|--------|
| **F2** | Rename active snapshot (or newest if none active) |
| **Double-click** snapshot name | Rename (existing) |

## Library grid keyword badge
- Thumbnails with user keywords show a **Tag** icon in the top-right badge cluster (with count tooltip)

## Develop presets by folder
- Preset list groups by folder name (collapsible headers with count)
- Search still filters across folder names and preset names
- Ungrouped presets appear without a folder header

## Soft proof profiles (CSS shell)
RGB: sRGB · Display P3 · Adobe RGB · ProPhoto · Rec. 2020 · Gray Gamma 2.2  
CMYK press shells (approximate CSS only, not ICC): **Japan Color 2001 Coated** · **US Web Coated (SWOP) v2** · **Coated FOGRA39**

Shared list: `src/utils/softProofProfiles.ts`

## Library list keyword chip
- List view shows a Tag + count chip next to the filename when user keywords are present (tooltip lists them)

## Camera profile (Develop Basic)
- Chip selector: Adobe Standard · Camera Standard · Landscape · Portrait · Vivid · Neutral · Faithful · Embedded
- Writes `cameraProfile` on adjustments → XMP `crs:CameraProfile` (interop / display; not a full DCP renderer)

## Export filename tokens
| Token | Meaning |
|-------|---------|
| `{original_filename}` | Source stem |
| `{sequence}` | Zero-padded index in batch |
| `{YYYY}` `{MM}` `{DD}` `{hh}` `{mm}` `{ss}` | Capture/local date parts |
| `{YYYYMMDD}` | Compact date |
| `{folder}` | Parent folder name |

File naming section is shown for single-image exports as well as batches.

## Process Version (Lens / Optics panel)
| Chip | crs:ProcessVersion |
|------|---------------------|
| PV 2010 | 5.0 |
| PV 2012 | 6.7 |
| PV 2015+ | 11.0 |
| PV v15 | 15.4 |

## Curves channel cycle
| Shortcut | Action |
|----------|--------|
| **Shift+C** | Cycle curve channel Luma → R → G → B |

## Point Color UI
- Color panel lists XMP `pointColors` pins with hue shift, sat shift, and `colorVariance` range
- **+ Pin** adds a row; **Remove** deletes; values round-trip via existing preset_converter
- Canvas eyedropper pick UI still deferred

## Tone curve named presets
| Chip | Action |
|------|--------|
| **Linear** | Straight diagonal luma curve |
| **Med** | Medium Contrast S-curve (approx.) |
| **Strong** | Strong Contrast S-curve (approx.) |
| **Custom** | Mark curve as custom (crs:ToneCurveName) |

Editing points sets `toneCurveName` to **Custom**. RGB channels reset to linear when applying named presets.

## Creative Look (Develop Basic)
| Chip | XMP |
|------|-----|
| **None** | Clears `lookName` |
| **Monochrome / Modern 01 / Artistic 01 / BW Look 1 / Vintage 01 / Color 01** | `lookName` → `crs:Look` stub |

Looks are interop/display names (stubbed render), matching public LR look naming.

## Library filter — caption presence
| Control | Filter |
|---------|--------|
| **Caption: all / Has caption / No caption** | `filterCriteria.hasCaption` based on EXIF/IPTC description fields |

## HDR edit mode (Develop Basic)
| Control | XMP |
|---------|-----|
| **HDR Off / On** | `hdrEditMode` 0 / 1 → crs:HdrEditMode |

Display / interop flag (not a full HDR pipeline).

## Smart collections — caption
| Collection | Filter |
|------------|--------|
| **Has Caption** | `hasCaption: 'yes'` |
| **No Caption** | `hasCaption: 'no'` |

## Develop history labels
- Expanded keys: WB, profile, look, process version, tone curve, HDR, grain, vignette, masks, point color, calibration, parametric curve, etc.

## Export color space
| Chip | EXIF ColorSpace | Notes |
|------|-----------------|-------|
| **sRGB** | 1 | Default |
| **Adobe RGB** | 2 | Tag only; full gamut convert deferred |
| **Display P3** / **ProPhoto** | 65535 (Uncalibrated) | Tag only; pixel conversion deferred |

Setting is stored on export settings / presets as `colorSpace` and sent to the backend as `colorSpace`.

## Library sort (expanded)
name · date modified · **capture time** · rating · edited · **camera** · **lens** · focal · ISO · shutter · aperture

## Orientation filter
| Value | Rule (when EXIF width/height present) |
|-------|----------------------------------------|
| **Landscape** | width/height > ~1 |
| **Portrait** | width/height < ~1 |
| **Square** | ratio ≈ 1 |

## Export output sharpening
| Mode | Strength (after resize) |
|------|-------------------------|
| **None** | 0 |
| **Screen** | light |
| **Matte** | medium |
| **Glossy** | strong |

Simple unsharp boost (not full LR print sharpening pipeline).

## ModuleShell toolbar hints
Each module shows context shortcuts in the bottom strip (map pins, book pages, slideshow play, print Ctrl+P, web gallery).

## Soft proof profile groups
Dropdown groups: **RGB** · **Gray** · **CMYK (shell)** for clearer LR-like profile browsing.

## Export quality & size chips
| JPEG/WebP/JXL quality | Long-edge resize |
|----------------------|------------------|
| Max 100 · High 90 · Med 75 · Low 60 | 2048 · 2560 · 3840 · 5120 px |

## Recently Modified smart collection
- Filters by **file modification time** (`dateField: 'modified'`) over the past 7 days
- Capture-date collections (Today / Past 7 Days / This Month / This Year) set `dateField: 'capture'`

## Import Copy as DNG
- Switch is accepted and reported after import
- Real RAW→DNG conversion pipeline remains deferred; originals are imported with an informational toast/note

## Optics — Profile Corrections (LR labels)
| Control | Behavior |
|---------|----------|
| **Enable Profile Corrections** | Toggles distortion + vignette flags together |
| Distortion / Vignette (nested) | Individual overrides |
| **Remove Chromatic Aberration** | `lensTcaEnabled` → crs:AutoLateralCA |

`crs:LensProfileEnable` is written when a profile name is set **or** distortion/vignette is on.

## Date filter field
Library date range filter can use **Capture** (EXIF) or **Modified** (file mtime), matching Recently Modified smart collection.

## Transform Upright modes
Off (0) · Auto (1) · Level (2) · Vertical (3) · Full (4) · **Guided (5)**  
Values match crs:PerspectiveUpright semantics (guided is flag/interop; interactive guides deferred).

## Point Color pin editor
Each pin shows:
- **Source** H / S / L (row cols 0–2) + color swatch
- **Shift** hue / sat (cols 3–4)
- **Range** via colorVariance
- **Dup** / **Remove**

### Point Color canvas pick
| Action | Behavior |
|--------|----------|
| **Pipette** on Point Color header | Toggle pick mode (`isPointColorPickerActive`) |
| **Click image** | Average RGB under cursor → HSL → new pin `[srcH, srcS, srcL, 0, 0]` |
| **Esc** | Cancel pick (also cancels WB picker) |

WB picker and Point Color picker are mutually exclusive.

## Soft proof + Before/After
- When soft proofing is on, BA labels show **Before** | **Proof** (not After)
- Soft-proof CSS filter applies only to the developed layer, not the original/Before side

## Copy as DNG (import)
| Source | Result |
|--------|--------|
| Already `.dng` | Copied as `.dng` (passthrough) |
| Other RAW/JPEG | Copied with original extension; conversion deferred |

Import-complete payload includes `dngPassthrough` and `dngDeferred` counts for the toast.

## Soft proof — Create Proof Copy
- Soft Proof bar **Proof Copy** creates a virtual copy of the open photo
- Tags `lookName` with profile · intent · paper (e.g. `Proof · sRGB · relative · paper`) for XMP/look interop
- Selects the new VC in the library list

## Select flagged photos
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+P** | Select all **picks** in the current filtered list |
| **Ctrl+Alt+Shift+X** | Select all **rejects** in the current filtered list |

## Export resolution (DPI)
| Chip | EXIF |
|------|------|
| **72** | Screen |
| **150** | Medium |
| **240** | Default |
| **300** | Print |

Writes `XResolution` / `YResolution` (rational) and `ResolutionUnit=2` (inches).

## Create Proof Copy → Develop
After creating a proof virtual copy, the app opens that path in Develop via `rustroom:open-image`.

## Export quick destinations
| Preset | Format | Quality | Resize | Color | Sharpen | DPI |
|--------|--------|---------|--------|-------|---------|-----|
| **Email** | JPEG | 75 | 2048 long edge | sRGB | Screen | 72 |
| **Web** | JPEG | 85 | 2560 long edge | sRGB | Screen | 72 |
| **Print** | JPEG | 95 | none | Adobe RGB | Matte | 300 |
| **Full Size** | JPEG | 100 | none | sRGB | None | 240 |

## Select unrated / unflagged
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+0** | Select all unrated |
| **Ctrl+Alt+Shift+U** | Select all unflagged |

## Export — reveal after
- **Show in folder after export** (default on, persisted) auto-reveals the output path on success
- Manual **Show in folder** remains available on the success row

## Select edited / unedited
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+E** | Select all edited |
| **Ctrl+Alt+Shift+N** | Select all unedited |

## Soft proof B/A
- Soft Proof bar **B/A** toggles Before/Proof split (same as `\\` BA)

## Select same camera / lens
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+M** | Select all with same **camera** as active |
| **Ctrl+Alt+Shift+G** | Select all with same **lens** as active |

Also available on the thumbnail context menu (single selection).

## Proof Copy snapshot
Create Proof Copy writes a develop snapshot named `Proof · {profile} · {intent}` on the virtual copy.

## Sort by color label
Library sort key **color** / **color_label**: red → yellow → green → blue → purple → none.

## Select same color label
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+B** | Select same color label as active (or all unlabeled if none) |

Also on the thumbnail context menu.

## Export gamut (approx)
When color space ≠ sRGB, export applies a lightweight matrix transform (gamma 2.2 shell) for:
- Adobe RGB
- Display P3
- ProPhoto
- Gray (Rec.709 luminance)

Plus EXIF `ColorSpace` tag. Full ICC profile embedding still deferred.

## Web gallery package
| Action | Output |
|--------|--------|
| **Export HTML** | Single `.html` (embedded data-URL thumbs when available) |
| **Export package…** | `{title}/index.html` + `{title}/images/*` with unique basenames |

Lightbox navigation (Esc / ← →) included in generated HTML.

## Book / Slideshow packages
| Module | Export package |
|--------|----------------|
| **Book** | `{title}/index.html` + `images/*` (print CSS, spread/single) |
| **Slideshow** | `slideshow/index.html` + `images/*` (play/pause, ← →, loop) |
| **Web** | `{title}/index.html` + `images/*` (lightbox grid) |

Uses `copy_file_to` for unique basenames on collisions.

## Guided Upright (Develop → Transform)
| Step | Action |
|------|--------|
| 1 | Click **Guided** (sets `perspectiveUpright=5`, enables draw mode) |
| 2 | Draw **1–2 lines** along edges that should be H or V |
| 3 | Geometry sliders update (Vertical / Horizontal / Rotate) |
| 4 | **Clear guides** resets lines + geometry; **Esc** exits draw mode |

Guide lines stored as normalized coords in `guidedUprightLines`. XMP exports `crs:PerspectiveUpright="5"`.

## Print package
| Action | Output |
|--------|--------|
| **Export HTML** | Single print-layout `.html` |
| **Export package…** | `print-{template}/index.html` + `images/*` |

Templates: single · contact sheet · 2×2 package. Paper: A4 / Letter / 5×7.

## History — Transform / Guided Upright
History steps label **Guided Upright** when guides or upright=5 drive geometry changes. Individual Transform keys use Vertical / Horizontal / Rotate / etc.

## Map — GPX export
| Action | Behavior |
|--------|----------|
| **Export GPX…** | Writes GPX 1.1 waypoints for visible pins (or all tagged if none visible) |
| **Select all GPS-tagged** | Selects every library photo with EXIF GPS |
| **Show in folder** | Reveals the focused pin’s file |

Waypoints include name (filename) and desc (full path). Creator=`RustROOM`.

## Compare — zoom lock
| Control | Behavior |
|---------|----------|
| **Zoom lock** | Scroll-wheel zoom + drag pan shared between Select and Candidate (default on) |
| **Zoom free** | Independent zoom/pan per pane |
| **Make Select** | Promote Candidate to Select |

## Select same capture day
| Shortcut | Action (Library) |
|----------|------------------|
| **Ctrl+Alt+Shift+D** | Select all with same capture day (DateTimeOriginal) as active |

Also on the thumbnail context menu.

## Loupe — Fit / Fill / 1:1
| Control | Behavior |
|---------|----------|
| **Fit** | Contain entire image |
| **Fill** | Cover viewport |
| **1:1** | Near-native size; scroll to zoom further |
| **Z** / click | Cycle Fit → Fill → 1:1 |
| Scroll | Zoom (from Fit enters 1:1) |
| Drag | Pan when zoomed |

## Catalog — date smart filters
| Entry | Range |
|-------|-------|
| **Past 7 Days** | Rolling last 7 days (capture) |
| **This Week** | Monday of current week → today (capture) |
| **This Month / Year** | Calendar month / year |
| **Recently Modified** | Last 7 days by modified date |

## Export — Limit file size
| Chip | Behavior |
|------|----------|
| **Off** | Use quality slider as-is |
| **200 KB / 500 KB / 1 MB / 2 MB** | Binary-search quality for JPEG/WebP/JXL to stay under limit (metadata headroom) |

**Email** quick destination sets **500 KB** limit + 2048 long edge + 72 DPI.

## Select same keyword
| Action | Behavior |
|--------|----------|
| **Ctrl+Alt+Shift+K** | Select photos sharing a keyword with active; sets keyword filter (cycles if multiple) |
| **Click keyword chip** (Library right panel) | Filter + select all with that keyword |
| Context menu **Select same keyword** | First `user:` tag on the photo |

Clear the keyword filter from the Library filter bar when done.

## Virtual copy stack
| Shortcut | Action |
|----------|--------|
| **PageDown** | Next in stack (master → copies → wrap) |
| **PageUp** | Previous in stack |
| Toolbar chips | Click Master / Copy N to open that version |

Stack = same physical file (`path` and `path?vc=…`). Works in Library and Develop (`rustroom:open-image`).

## Export with Previous
| Shortcut | Behavior |
|----------|----------|
| **Ctrl+Alt+Shift+W** | Apply last export settings and export to last folder (no folder dialog) |

Opens Export panel, restores `__last_used__` preset, writes to `lastExportPath`.

## Filmstrip virtual-copy badge
Click the **VC** / **Stack** badge on a filmstrip thumbnail to cycle Master ↔ copies (same as PageDown for that file).

## Library grid/list virtual-copy badges
| Badge | Where | Click |
|-------|-------|-------|
| **VC** | Virtual copy | Cycle to next in stack |
| **×N** | Master with N versions | Cycle into stack |

Also: context menu **Next / Previous virtual copy**; filmstrip badge; PageUp/PageDown; Develop toolbar chips.

## Delete virtual copy
| Selection | Dialog |
|-----------|--------|
| **VC only** | “Delete Virtual Copy?” — master kept |
| **Master with VCs** | “Delete Image and All Virtual Copies?” |
| **Mixed / multi** | Standard multi-delete |

After deleting a VC, selection moves to another version in the same stack when available.

## Quick Develop (Library right panel)
| Control | Behavior |
|---------|----------|
| **−− / − / + / ++** | Relative nudges; double buttons apply 2× step |
| **Texture** | Maps to app `structure` → crs:Texture |
| **Saved Preset** | Apply any loaded develop preset to selection |
| **White Balance** | As Shot · Auto · Daylight · Cloudy · Shade · Tungsten · Fluor. · Flash |
| **Auto / Reset** | Auto tone or full reset on selection |

## Develop presets — Favorites & Recent
| Feature | Behavior |
|---------|----------|
| **★ on preset row** | Toggle favorite (persisted localStorage) |
| **Favorites** | Pinned list at top of Develop left Presets |
| **Recent** | Last 6 applied presets |

## Select same ISO
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+I** | Select all with same ISO as active |

Also on the thumbnail context menu.

## Go to Folder in Library
| Action | Behavior |
|--------|----------|
| Context menu **Go to Folder in Library** | Clears catalog scopes (Previous Import / QC / Selected / album), expands parents, opens the photo’s parent folder |
| **Ctrl+Alt+Shift+F** | Same for active / selected photo |

Virtual-copy paths use the physical file’s parent. Complements **Show in Explorer/Finder**.

## Create Collection from Selection
Thumbnail context menu → **Create Collection from Selection…**  
Opens the new-album name dialog; the new collection is seeded with the current multi-selection and becomes the active album.

## Sort by Flag
Library sort key **flag**: Pick → unflagged → Reject (ascending). Useful for culling review.

## Import — IPTC metadata
| Field | Applied after import |
|-------|----------------------|
| **Creator** | Artist / Creator (DC) |
| **Copyright** | Copyright (DC rights) |
| **Caption** | ImageDescription / XPTitle |
| Keywords | `user:` tags (existing) |
| Develop preset | ApplyAdjustmentsToPaths (existing) |

Empty fields are skipped. Values apply to all successfully imported paths.

## Auto-advance while culling
Settings → General → **Auto-advance while culling** (default **on**).

When enabled, setting a star rating (1–5), color label, or pick/reject in **Library** selects the next photo. Disable to keep the current selection (useful for multi-edit).

## Select same aperture
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+A** | Select all with same f-number as active |

Also on the thumbnail context menu.

## Recent Folders
Catalog sidebar lists up to **8** recently opened folders (paths stored in settings, max 12).  
Click a row to open that folder (same as tree selection). Newest first.

## Select same focal length
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+L** | Select all with same focal length (mm, prefers 35mm equiv.) as active |

Also on the thumbnail context menu.

## Library IPTC location
Multi-edit fields on the Library right panel (and XMP interop):

| UI field | EXIF map key | XMP |
|----------|--------------|-----|
| Headline | Headline | photoshop:Headline |
| City | City | photoshop:City |
| State / Province | State | photoshop:State |
| Country | Country | photoshop:Country |
| Location | Location | Iptc4xmpCore:Location |

## Select same shutter
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+T** | Select all with same ExposureTime as active |

Also on the thumbnail context menu.

## Filter / select by city
| Control | Behavior |
|---------|----------|
| Library filter **City** | Dropdown of cities present in current image list EXIF |
| **Ctrl+Alt+Shift+Y** | Select same city as active (+ sets city filter) |
| Context menu **Select same city** | Same |

## Clear recent folders
Catalog → Recent Folders → **Clear** wipes `appSettings.recentFolders`.

## Filter / select by country
| Control | Behavior |
|---------|----------|
| Library filter **Country** | Dropdown of countries in current list EXIF |
| **Ctrl+Alt+Shift+C** | Select same country as active (+ sets country filter) |
| Context menu **Select same country** | Same |

## Bottom bar quick filter flags
Expand **Quick Filter** (filter icon): stars · color labels · **P / X / U** flag filters (toggle; second click clears to All).

## Has Location / No Location
| Control | Behavior |
|---------|----------|
| Catalog **Has Location** | Photos with City, Country, Location, or State set |
| Catalog **No Location** | Photos missing all location IPTC fields |
| Filter bar **Loc** | yes / no / all |

GPS is separate (**Has GPS**).

## Soft proof profiles (CSS shell)
Extended list includes Rec. 709, Gray 1.8, Japan Uncoated, SWOP Uncoated, FOGRA51/29, GRACoL, ISO Coated v2.

| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+S** | Create Proof Copy (when soft proofing is on) |

## RAW/JPEG group badge
Grid badge (layers icon) is clickable: cycles through `group_id` variants (RAW ↔ JPEG, etc.) without expanding the whole library grouping UI.

## Select same location
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+O** | Select all with same IPTC Location / SubLocation as active |

Also on the thumbnail context menu.

## Hierarchical keywords
Enter `travel/paris` or `travel > paris` in Library keywording:
- Stores `user:travel` and `user:travel/paris`
- Display uses `travel › paris`
- Filter/select by parent matches children (substring)

## Develop filmstrip filter
When the filmstrip is visible: **All** · **Sel** · **Picks** scope chips (bottom bar).

## Select same folder
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+R** | Select all photos in the same parent folder as active |

Also on the thumbnail context menu.

## Hierarchical keywords → XMP
| Storage | XMP |
|---------|-----|
| `user:travel` | `dc:subject` → travel |
| `user:travel/paris` | `dc:subject` → paris + `lr:hierarchicalSubject` → `travel|paris` |

Lightroom reads `lr:hierarchicalSubject` with `|` path separators.

## Develop Metadata IPTC location
Author section editable fields include Headline, City, State, Country, Location (multi-select aware via UpdateExifFields).

## Keyword List (left catalog)
LR-style hierarchical keyword browser under Catalog:
- Built from `user:` tags on the current library
- Parent paths expanded (travel when travel/paris exists)
- Click filters + selects matching photos (includes children)
- Click again clears keyword filter

## Keyword Painter
LR-style spray/paint keywords:
1. Click the brush on a keyword chip (Library right panel), **or** double-click a keyword in the left **Keyword List**
2. Click thumbnails to apply (`user:` + parent path segments)
3. **Alt-click** thumbnail to remove that hierarchical keyword
4. **Stop** banner or re-click brush to exit paint mode
Cursor becomes `cell` while painting.

## Import — remember settings
The Import dialog restores the last-used filename template, organize-by-date, develop preset, keywords, IPTC creator/copyright/caption, previews, Copy as DNG, and skip-duplicates flags (`appSettings.lastImportSettings`).

Import keywords support hierarchy: `travel/paris` expands to `user:travel` + `user:travel/paris` (XMP hierarchicalSubject on sync).

## Manual photo stacks
| Shortcut | Action |
|----------|--------|
| **Ctrl+G** | Stack selected photos (≥2) |
| **Ctrl+Shift+G** | Unstack (Library; Develop uses this for soft-proof gamut) |

- Stored as tag `stack:<id>` (syncs to XMP `dc:subject`)
- Collapses in grid/list; badge **S#** — click cycles stack members
- Context menu: Stack photos / Unstack photos
- Coexists with automatic RAW/JPEG grouping

## Catalog — Stacked smart filter
Left catalog **Stacked** shows photos with a manual `stack:` tag. Toggle off by clicking again.

## Develop info overlay (I)
| Mode | Content |
|------|---------|
| off | Hidden |
| basic | Filename · dimensions · shutter/aperture/ISO/focal |
| full | + camera · lens · capture date |

- **I** cycles modes in Develop
- **Ctrl+I** opens Metadata panel
- Library Loupe: **I** cycles local info overlay

## Auto-stack by capture time
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+G** | Stack multi-selection into groups sharing the same EXIF second |
| **Ctrl+Alt+Shift+,** | Select all photos with the same capture time as active |

Also on thumbnail context menu.

## Copy / Paste metadata
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+J** | Copy IPTC fields + user keywords from active photo |
| **Ctrl+Alt+Shift+Q** | Paste onto selection (multi-select aware) |

Fields: caption/title, headline, creator, copyright, comments, city/state/country/location, keywords.

## Cycle stack
| Shortcut | Action |
|----------|--------|
| **Ctrl+S** (Library) | Cycle next photo in manual stack or RAW/JPEG group |

## Expand / collapse stacks
| Action | How |
|--------|-----|
| Expand/collapse active stack | **Ctrl+Alt+E** or **Shift-click** stack badge |
| Collapse all | **Ctrl+Alt+H** |
| Context menu | Expand/collapse stack |

Expanded stacks show all members in the grid (badge `S#↓`). Collapsed shows primary only.

## Bottom bar quick filter — Edited
| Chip | Filter |
|------|--------|
| **E** | Edited only |
| **NE** | Unedited only |

Toggle off by clicking again (with stars, colors, P/X/U flags + E/NE edited).

## Reject dimming
Rejected photos (`flag:reject`) render at reduced opacity with grayscale in the Library grid (and reduced opacity in List) — LR-style visual cull cue.

## Thumbnail size (+ / −)
| Key | Action |
|-----|--------|
| **+** (`Equal`) | Larger thumbnails (Small → Medium → Large) |
| **−** (`Minus`) | Smaller thumbnails |

Library only (not Develop). Also: Ctrl+scroll wheel on the grid.

## Bottom bar RAW filter
| Chip | Filter |
|------|--------|
| **RAW** | RAW files only |
| **JPG** | Non-RAW only |

## Hide rejected photos
| Control | Action |
|---------|--------|
| View Options → **Hide rejected photos** | Persist setting |
| Catalog → **Hide Rejected** | Toggle |
| **Ctrl+Alt+R** | Toggle hide rejected |
| **Ctrl+Alt+Shift+Backspace** | Delete all rejected (confirm) |

When hide is on, rejects are excluded from Library/Filmstrip **unless** you filter flag = Reject (catalog Rejects still works).

Rejected thumbs remain dimmed when visible.

## Library Painter (spray tool)
| Mode | How to arm | Click thumb | Alt-click |
|------|------------|-------------|-----------|
| Keyword | Brush on keyword chip / double-click Keyword List | Add keyword | Remove |
| Rating | **Shift-click** ★ in bottom quick filter | Set rating | Clear (0) |
| Color | **Shift-click** color in bottom quick filter | Set color | Clear |
| Flag | **Shift-click** P / X / U in bottom quick filter | Set flag | Clear |

- Banner at top of Library while active · **Esc** stops
- Cursor becomes `cell` on thumbnails

## Filmstrip scope
Develop filmstrip chips: **All** · **Sel** · **Picks** · **Rej**

## Batch virtual copies
- Multi-select → Create Virtual Copy shortcut / context menu creates one VC per selected photo

## Folder history
| Control | Action |
|---------|--------|
| **Alt+←** | Previous folder in history |
| **Alt+→** | Next folder in history |
| Catalog ← → buttons | Same |

History tracks physical folder navigations (not albums). Cap 50 entries. Navigating from mid-history drops the forward stack (browser-style).

## Create collection from selection
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+N** | Open create-album modal seeded with current selection |

Also available on the thumbnail context menu.

## Path breadcrumb
Library header shows a clickable folder breadcrumb (last segments if long).
Click a parent segment to navigate there (pushes folder history).

## Add all picks to target collection
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+B** | Add every **pick** in the current view to the Target Collection (or Quick Collection if target is QC) |

Also on the thumbnail context menu.

## Library filter presets
View Options → **Filter presets**:
- **Save** — store current attribute filters (name prompt); up to 20
- **Clear** — reset all filters (+ catalog scopes: Previous Import / QC / Selected)
- Click a preset name to apply · × to delete

| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+L** | Clear all filters |
| **Ctrl+Alt+F** | Save current filters as a preset |

Bottom bar quick filter also has **×** clear.

## Filmstrip scope
Develop: **All** · **Sel** · **Picks** · **Rej** · **Edit** (edited only)

## GPS badge
Photos with valid `GPSLatitude`/`GPSLongitude` show a small sky-blue **map pin** on:
- Library grid (top-left, after flag)
- Library list (next to name)
- Develop filmstrip

Catalog **Has GPS** smart filter still filters by GPS presence.

## Filmstrip scope (updated)
**All** · **Sel** · **Picks** · **Rej** · **Edit** · **U** (unflagged)

## Show file names in grid
View Options / Settings → **Show file names in grid** (default on).
When off, grid cells hide the filename unless EXIF overlay is Always/Hover.

## Go to parent folder
| Shortcut | Action |
|----------|--------|
| **Alt+↑** | Navigate to parent of current folder |

Uses the same folder history stack as breadcrumb navigation.

## Filmstrip scope (updated)
**All** · **Sel** · **Picks** · **Rej** · **Edit** · **U** · **★** (rated ≥1)

## Cycle flag
| Shortcut | Action |
|----------|--------|
| **`** (Backquote) | Cycle primary selection flag: *none → Pick → Reject → none* |

Applies to multi-selection via the same rules as P/X flag commands.

## Library status chips (bottom bar)
When the Library view has photos, the bottom bar shows counts for the current view:
- **P** picks · **X** rejects · **E** edited · **★** rated · **⌖** GPS-tagged

## Empty filter state
If filters hide every photo, Library shows a clear message and a **Clear filters** button (also **Ctrl+Alt+L**).

## Select same rating
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+2** | Select all photos with the **same star rating** as the active photo (including 0★) |

## Map from selection
| Control | Action |
|---------|--------|
| **Ctrl+Alt+M** | Open Map module with filter **Selected** |
| Module Map (**Ctrl+Alt+3**) | If selection has GPS, auto-focus selected pins |
| Grid **GPS pin** click | Select photo and open Map on that pin |

Catalog smart filter **Rated** = any rating ≥ 1★ (toggle).

## Orientation filters
| Control | Action |
|---------|--------|
| Bottom bar **L** / **P** / **S** | Filter landscape / portrait / square |
| Catalog **Landscape** / **Portrait** | Same (toggle) |
| **Ctrl+Alt+Shift+3** | Select all with same orientation as active |
| Filmstrip **L** / **P** | Scope filmstrip to landscape / portrait |

Uses image width/height (fallback EXIF dimensions). Square ≈ ratio 0.95–1.05.

## RAW badge
RAW files show an orange **RAW** badge:
- Grid: bottom-left
- List: chip next to name
- Filmstrip: small **R** bottom-left

## GPS quick filter
Bottom bar **GPS** chip toggles `hasGps: yes` (GPS-tagged only).

## Toggle recursive Library
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+T** | Toggle Flat (current folder) ↔ Recursive (include subfolders) |

Refreshes the current folder listing after the mode change.

## Cycle color label
| Shortcut | Action |
|----------|--------|
| **'** (Quote) | Cycle color label: none → red → yellow → green → blue → purple → none |

## Previous Import
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+N** | Toggle catalog **Previous Import** scope (last import batch) |

## Bottom bar KW
**KW** chip filters to photos that have user keywords (`hasKeywords: yes`).

## Keyword batch edit
| Shortcut / UI | Action |
|---------------|--------|
| **Ctrl+Alt+K** | Prompt to add keyword (supports `parent/child` hierarchy) |
| **Ctrl+Alt+D** | Clear all **user** keywords from selection (keeps color/flag/stack tags) |
| Context menu | Add keyword… · Clear keywords |

## Virtual copies filter
| Control | Action |
|---------|--------|
| Bottom bar **VC** | Filter to virtual copies only |
| Filmstrip **VC** | Filmstrip shows virtual copies only |
| Catalog **Virtual Copies** | *(existing smart filter)* |

## First / last photo
| Shortcut | Action |
|----------|--------|
| **Home** | Select first photo in current sort order |
| **End** | Select last photo in current sort order |

Works in Library and Develop (switches the open photo when developing).

## Sort shortcuts
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Y** | Sort by capture time (toggle newest/oldest) |
| **Ctrl+Alt+U** | Sort by rating (toggle high/low) |
| **Ctrl+Alt+O** | Sort by file name (toggle A–Z / Z–A) |
| **Ctrl+Alt+W** | Reverse current sort direction |

Bottom bar shows a **sort chip** (e.g. `Capture ↓`) — click to reverse direction.

## Keyboard range selection (Library)
| Shortcut | Action |
|----------|--------|
| **← → ↑ ↓** | Move active photo (wraps) |
| **Shift+Arrow** | Extend selection from anchor to new photo |
| **Ctrl+Arrow** | Jump ±10 photos (no wrap) |
| **Shift+Home** | Select from anchor through first photo |
| **Shift+End** | Select from anchor through last photo |
| **Home** / **End** | Jump to first / last (single select) |

Click selection still supports Shift-click range and Ctrl/Cmd-click toggle.

## Esc in Library
Priority order (after develop tools / lights-out / painter):
1. Clear multi-selection
2. Exit Selected-only / Previous Import / Quick Collection scopes

Does not clear the active photo path alone (still navigable).

## Import complete
After import finishes, a success toast shows the photo count.
**Click the toast** to open the **Previous Import** catalog filter and select the imported batch.
Also: **Ctrl+Alt+N** toggles Previous Import.

## Bottom bar metadata chips
| Chip | Filter |
|------|--------|
| **KW** | Has user keywords |
| **CAP** | Has caption / title |
| **LOC** | Has IPTC location (city/country/location/state) |
| **GPS** | Has GPS coordinates |
| **VC** | Virtual copies only |

## Soft proof simulation badge
Soft Proof bar shows a **Sim** badge and live profile/intent/paper/gamut summary.
Still a CSS approximation shell (not full ICC CMS).

## Select caption / location
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+1** | Select photos with caption/title |
| **Ctrl+Alt+Shift+6** | Select photos with IPTC location |

Bottom bar stats chips **CAP** / **LOC** also select those subsets when clicked.

## Cycle Library display
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Q** | Cycle Grid → List → Loupe → Compare → Survey → Cull → Grid |

## Select RAW / non-RAW
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+7** | Select all RAW photos in view |
| **Ctrl+Alt+Shift+8** | Select all non-RAW photos in view |

Bottom bar:
- **RAW** / **JPG** chips: click = filter · **Shift-click** = select matching
- **E** / **NE** chips: click = filter · **Shift-click** = select matching
- Stats chip **RAW n**: click to select all RAW in view

## Select virtual copies · grid filenames
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+9** | Select all virtual copies in view |
| **Ctrl+Shift+J** | Toggle grid filenames |

Bottom bar filter chips (CAP · LOC · GPS · VC · KW · RAW · JPG · E · NE):
- **Click** = filter
- **Shift-click** = select matching photos in view

## Filmstrip scopes (Develop / modules)
| Chip | Scope |
|------|--------|
| All · Sel · Picks · Rej · Edit · U · ★ · Ls · Pt · VC | existing |
| **RAW** | RAW files only |
| **CAP** | Has caption/title |
| **GPS** | GPS-tagged |
| **LOC** | IPTC location |

## Select has keywords
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+H** | Select photos with user keywords in view |

Orientation chips **L/P/S**: click = filter · **Shift-click** = select matching.

## Catalog smart filters (added)
| Entry | Filter |
|-------|--------|
| **RAW Photos** | `rawStatus = RawOnly` |
| **Non-RAW Photos** | `rawStatus = NonRawOnly` |
| **Unflagged** | `flagStatus = Unflagged` |

## Select flagged (any)
| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+Shift+V** | Select picks **and** rejects in view |

Filmstrip scope **KW** = photos with user keywords.

## Catalog Square · bottom SEL · no-keywords select
| Entry / Shortcut | Action |
|------------------|--------|
| Catalog **Square** | Toggle orientation = square |
| Bottom **SEL** | Toggle show selected only (same as Ctrl+Alt+A) |
| **Ctrl+Alt+Shift+Z** | Select photos **without** user keywords |
| Filmstrip **☆** | Unrated photos only |

## Metadata chips tri-state (KW · CAP · LOC · GPS)
| Interaction | Action |
|-------------|--------|
| **Click** | Cycle **all → yes → no → all** (no = strikethrough style) |
| **Shift-click** | Select photos **with** the attribute |
| **Alt-click** | Select photos **without** the attribute |

| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+W** | Select without caption |
| **Ctrl+Shift+Y** | Select without location |
| **Ctrl+Alt+Shift+Z** | Select without keywords |

## Masters (exclude virtual copies)
| Entry / Shortcut | Action |
|------------------|--------|
| Catalog **Masters** | Filter `virtualCopies = no` |
| Filmstrip **Mst** | Masters only in filmstrip |
| Bottom **VC** | Tri-state yes/no/all · Alt-click = select masters |
| **Ctrl+Shift+M** | Select all masters in view |

## IPTC Title
Library right panel: separate **Title** (`XPTitle`) field next to Caption (`ImageDescription`).

## Stacks filter / select
| Entry / Shortcut | Action |
|------------------|--------|
| Bottom **STK** | Tri-state hasStack yes/no/all · Shift=select stacked · Alt=unstacked |
| Filmstrip **Stk** / **USt** | Stacked / unstacked only |
| Stats **S n** | Click to select stacked |
| **Ctrl+Shift+A** | Select stacked photos |
| **Ctrl+Shift+T** | Select unstacked photos |
| **Ctrl+Shift+K** | Select photos without GPS |

## XMP Title vs Caption
| Field | XMP | UI |
|-------|-----|-----|
| Caption | `dc:description` | Library IPTC **Caption** (`ImageDescription`) |
| Title | `dc:title` | Library IPTC **Title** (`XPTitle`) |

No longer conflate XPTitle into description on write.

## Catalog Selected Photographs
Toggle **show selected only** (same as bottom **SEL** / Ctrl+Alt+A).

## Library layout (view options)
Segmented: Grid · List · Loupe · Compare · Survey · Cull (maps to `libraryDisplayMode`).
Folder scope remains Flat / Recursive (`libraryViewMode`).

## Select same stack
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+D** | Select all photos in the active photo’s stack |

## Filter preset chips (bottom bar)
Saved library filter presets appear as chips (up to 6): **click** apply · **Alt-click** delete.

## XMP DateCreated + IPTC location import
| Field | XMP | EXIF map |
|-------|-----|----------|
| Capture date | `photoshop:DateCreated` | `DateTimeOriginal` |
| City / Country / State | `photoshop:*` | same keys |
| Location | `Iptc4xmpCore:Location` | `Location` / `SubLocation` |
| Headline | `photoshop:Headline` | `Headline` |

## Select same filename base / extension
| Shortcut | Action |
|----------|--------|
| **Ctrl+Shift+F** | Select files with same basename (RAW+JPEG pairs) |
| **Ctrl+Shift+Z** | Select files with same extension |
| **Ctrl+Shift+Q** | Cycle saved filter presets (Shift = previous) |

## Color label chips
| Interaction | Action |
|-------------|--------|
| **Click** | Toggle color filter |
| **Shift-click** | Library Painter (paint color) |
| **Alt-click** | Select photos with that color (or none) |

## Stars · Flags · Colors (bottom bar)
| Chip | Click | Shift | Alt |
|------|-------|-------|-----|
| **★ 1–5** | Filter (≥N, exact at 5) | Paint rating | Select exact star count |
| **P / X / U** | Filter flag | Paint flag | Select matching flag |
| **Color dots** | Toggle color filter | Paint color | Select that color |

| Shortcut | Action |
|----------|--------|
| **Ctrl+Alt+X** | Select all **5★** in view |
| **Ctrl+Alt+Z** | Select all **unrated** in view |

## Sort field shortcuts
| Shortcut | Sort |
|----------|------|
| **Ctrl+Alt+Y** | Capture time |
| **Ctrl+Alt+U** | Rating |
| **Ctrl+Alt+O** | File name |
| **Ctrl+Alt+8** | Flag |
| **Ctrl+Alt+9** | Color label |
| **Ctrl+Alt+0** | Edited status |
| **Ctrl+Alt+W** | Toggle direction |
| **Ctrl+Alt+Shift+,** | Cycle sort field (Shift = previous) |

Bottom sort chip: **click** reverse · **Alt/Shift-click** cycle field.

## IPTC Credit / Source
Library right panel fields write `photoshop:Credit` and `photoshop:Source` in XMP.

## List view Flag column
Library **List** layout includes a **Flag** column (P/X) between Rating and Color Label.
- Header click sorts by flag
- Color Label header sorts by color

## IPTC Instructions
Library right panel **Instructions** → `photoshop:Instructions` in XMP (R/W + import).

## Flag keys (LR Classic)
| Key | Action |
|-----|--------|
| **P** | Flag pick |
| **X** | Flag reject |
| **U** | Unflag |

Presets panel toggle moved to **Y** (was P).

## List Edit column
Library List layout: **Edit** column shows **E** when `is_edited`.

## IPTC Job Title / Country Code
| UI | XMP |
|----|-----|
| Job Title | `photoshop:AuthorsPosition` |
| Country Code | `Iptc4xmpCore:CountryCode` |

## Color label keys (LR Classic)
| Key | Color |
|-----|--------|
| **6** | Red |
| **7** | Yellow |
| **8** | Green |
| **9** | Blue |
| **Shift+6** | Purple |
| **Shift+0** | None |

Ratings remain **0–5**.

## List Type column
Library List: **Type** shows RAW or file extension; header sorts by `file_type`.

## IPTC Rights Usage Terms
| UI | XMP |
|----|-----|
| Rights Usage Terms | `xmpRights:UsageTerms` (alt-lang) |

## Copyright Status · Web Statement
| UI | XMP |
|----|-----|
| Copyright Status (Unknown / Copyrighted / Public Domain) | `photoshop:CopyrightStatus` + `xmpRights:Marked` (True/False) |
| Copyright Info URL | `xmpRights:WebStatement` |

## Loupe zoom cycle
| Key | Action |
|-----|--------|
| **Z** | Cycle Fit → Fill → 1:1 (Library Loupe) |

## Quick Filter toggle
| Key | Action |
|-----|--------|
| **/** | Expand / collapse bottom Quick Filter bar |

## Survey remove
| Key | Action |
|-----|--------|
| **Delete** / **Backspace** | Remove focused photo from survey multi-select |
| **X** | Flag reject (not survey remove) |

## IPTC Genre
| UI | XMP |
|----|-----|
| Genre | `Iptc4xmpCore:IntellectualGenre` |

## Filmstrip scope cycle
| Key | Action |
|-----|--------|
| **.** | Next filmstrip scope (All → Sel → Picks → …) |
| **,** | Previous filmstrip scope |

## Metadata overlay cycle
| Key | Action |
|-----|--------|
| **;** | Cycle EXIF overlay Off → Hover → Always |

## IPTC Event
| UI | XMP |
|----|-----|
| Event | `Iptc4xmpExt:Event` (alt-lang) |

## IPTC People
| UI | XMP |
|----|-----|
| People (comma-separated) | `Iptc4xmpExt:PersonInImage` (`rdf:Bag` of names) |

## Soft proof feedback
Toggle / profile / intent / paper / gamut shortcuts show toast confirmations.
Filmstrip scope cycle (**.** / **,**) shows a toast with the active scope name.

## IPTC Scene
| UI | XMP |
|----|-----|
| Scene (comma-separated) | `Iptc4xmpCore:Scene` (`rdf:Bag`) |

## Compare keys
| Key | Action |
|-----|--------|
| **↑ / ↓** | Step Candidate |
| **Enter** | Make Candidate the Select |
| **Tab** | Toggle focus Select ↔ Candidate |
| **Shift+S** | Swap Select / Candidate |

## List GPS column
Library List: **GPS** column shows pin when coordinates exist; header sorts by GPS presence.

## Soft proof auto-enable
Cycling soft-proof profile (while Develop is open) turns soft proof **on** if it was off.

## Library view shortcuts (Shift+digit)
| Key | View |
|-----|------|
| **Shift+1** | Grid |
| **Shift+2** | Loupe |
| **Shift+3** | Compare |
| **Shift+4** | Survey |
| **Shift+5** | Cull |
| **Shift+6** | List |

## People filter
| Entry | Action |
|-------|--------|
| Bottom **PE** | Tri-state hasPeople yes/no/all · Shift=select with · Alt=without |
| Catalog **Has People** | Filter photos with `PersonInImage` |

## IPTC Subject Code
| UI | XMP |
|----|-----|
| Subject Code (comma-separated IPTC codes) | `Iptc4xmpCore:SubjectCode` (`rdf:Bag`) |

## Select people
| Shortcut | Action |
|----------|--------|
| **Shift+7** | Select photos with people tags |
| **Shift+8** | Select photos without people tags |

Filmstrip scope **PE** · bottom stats **PE n** · Catalog **No People**.

## IPTC Creator Website
| UI | XMP |
|----|-----|
| Creator Website | `Iptc4xmpCore:CreatorWorkURL` + `CiUrlWork` |

## Select event
| Shortcut | Action |
|----------|--------|
| **Shift+9** | Select photos with event tags |

Bottom **EV** chip: tri-state hasEvent · Shift=select with · Alt=without  
Filmstrip **EV** · stats **EV n** · Catalog **Has Event**

## IPTC Job Identifier
| UI | XMP |
|----|-----|
| Job Identifier | `photoshop:TransmissionReference` + `photoshop:JobIdentifier` |

## Scene filter / select
| Shortcut / Chip | Action |
|-----------------|--------|
| **Ctrl+3** | Select photos with scene tags |
| **Ctrl+4** | Select photos without scene |
| Bottom **SC** | Tri-state hasScene · Shift/Alt select |
| Filmstrip **SC** | Scene-tagged only |

| Shortcut | Action |
|----------|--------|
| **Ctrl+2** | Select photos without event |

Catalog **No Event** toggles `hasEvent = no`.

## IPTC Digital Source Type
| UI | XMP |
|----|-----|
| Digital Source Type (select) | `Iptc4xmpExt:DigitalSourceType` (IPTC NewsCodes URI) |

## Genre filter / select
| Shortcut / Chip | Action |
|-----------------|--------|
| **Ctrl+5** | Select photos with genre |
| **Ctrl+6** | Select photos without genre |
| Bottom **GE** | Tri-state hasGenre · Shift/Alt select |
| Filmstrip **GE** | Genre-tagged only |

Catalog **Has Scene** / **No Scene** for scene filter.

## IPTC Caption Writer
| UI | XMP |
|----|-----|
| Caption Writer | `photoshop:CaptionWriter` |

## Subject code filter / select
| Shortcut / Chip | Action |
|-----------------|--------|
| **Ctrl+7** | Select photos with subject code |
| **Ctrl+8** | Select photos without subject code |
| **Ctrl+9** | Select photos with job ID |
| Bottom **SU** | Tri-state hasSubjectCode · Shift/Alt select |
| Filmstrip **SU** | Subject-code photos only |

Catalog **Has Genre** / **No Genre**.

## IPTC Category
| UI | XMP |
|----|-----|
| Category | `photoshop:Category` |
| Supplemental Categories (comma-separated) | `photoshop:SupplementalCategories` (`rdf:Bag`) |

## Category / Job filters
| Chip | Filter | Shift / Alt |
|------|--------|-------------|
| **CA** | hasCategory yes/no/all | select with / without category |
| **JO** | hasJobId yes/no/all | select with / without job ID |

Filmstrip scopes **CA** / **JO**. Catalog **Has/No Subject Code**.

## IPTC Urgency
| UI | XMP |
|----|-----|
| Urgency (1–8 select) | `photoshop:Urgency` |

1 = High, 5 = Normal, 8 = Low (LR convention).

## Urgency filter
| Chip / Interaction | Action |
|--------------------|--------|
| **UR** click | Cycle hasUrgency all → yes → no |
| **UR** Ctrl/Cmd-click | High urgency only (1–2) · badge **UR!** |
| **UR** Shift/Alt | Select with / without urgency |
| Filmstrip **UR** | Photos with urgency set |
| Stats **UR n (!h)** | Click select all urgency · Shift-click high only |

Catalog **Has/No Category** · **Has Job ID**.

## IPTC Creator contact
| UI | XMP |
|----|-----|
| Creator Email | `Iptc4xmpCore:CiEmailWork` |
| Creator Phone | `Iptc4xmpCore:CiTelWork` |

## Urgency / Category / Job selects
| Shortcut | Action |
|----------|--------|
| **Alt+1** | Select high urgency (1–2) |
| **Alt+2** | Select has urgency |
| **Alt+3** | Select without urgency |
| **Alt+4** | Select has category |
| **Alt+5** | Select without category |
| **Alt+6** | Select without job ID |

Catalog **No Job ID** · **Has Urgency** · **High Urgency (1–2)**.

## IPTC Creator address
| UI | XMP |
|----|-----|
| Creator Address | `Iptc4xmpCore:CiAdrExtadr` |
| Creator City | `Iptc4xmpCore:CiAdrCity` |
| Creator State/Region | `Iptc4xmpCore:CiAdrRegion` |
| Creator Postal Code | `Iptc4xmpCore:CiAdrPcode` |
| Creator Country | `Iptc4xmpCore:CiAdrCtry` |

## Caption writer / Digital source filters
| Chip | Filter | Shift / Alt |
|------|--------|-------------|
| **CW** | hasCaptionWriter | select with / without |
| **DS** | hasDigitalSource | select with / without |

| Shortcut | Action |
|----------|--------|
| **Alt+7** | Select has caption writer |
| **Alt+8** | Select without caption writer |
| **Alt+9** | Select has digital source type |
| **Alt+0** | Select without digital source type |

Filmstrip **CW** / **DS**. Catalog **No Urgency**. Sort cycle includes **Urgency**.

## Headline / Title / Credit filters
| Chip | Filter | Select shortcut |
|------|--------|-----------------|
| **HL** | hasHeadline | **Alt+H** |
| **TI** | hasTitle | **Alt+T** |
| **CR** | hasCredit | **Alt+Y** |

Catalog **Has Caption Writer** · **Has Digital Source**.

## List Urgency column
Library List shows urgency 1–8 (red high / amber mid / muted low). Header sorts by urgency.
Sort cycle includes **Category** and **Urgency**.

## Source / Instructions filters
| Chip | Filter | Select |
|------|--------|--------|
| **SO** | hasSource | **Alt+S** |
| **IN** | hasInstructions | **Alt+N** |

Catalog **Has Headline** · **Has Title** · **Has Credit**.

Clear filters (× / Ctrl+Alt+L) resets all metadata presence filters including urgencyMax.

## Creator / Rights filters
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **CT** | hasCreator | **Alt+C** | CT |
| **RT** | hasRights | **Alt+R** | RT |
| **SO** | hasSource | **Alt+S** | SO |
| **IN** | hasInstructions | **Alt+N** | IN |

Catalog **Has Source** · **Has Instructions** · **Has Creator** · **Has Rights / Copyright**.

Filmstrip scopes also: HL · TI · CR · SO · IN · CT · RT (cycle with `.` / `,`).

## Job Title + list columns
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **JT** | hasJobTitle (AuthorsPosition) | **Alt+J** | JT |

List view columns: **Creator** · **Credit** (sortable). Sort cycle includes creator / credit / job_title.

Catalog **Has Job Title**.

## City / Country presence
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **CY** | hasCity | **Alt+M** | CY |
| **CN** | hasCountry | **Alt+O** | CN |

List column **City** (sortable). Catalog **Has City** · **Has Country**.
Sort cycle includes city / country.

## State / Province + list Country
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **ST** | hasState (State/Province) | **Alt+K** | ST |
| **CY** | hasCity | **Alt+M** | CY |
| **CN** | hasCountry | **Alt+O** | CN |

List columns **City** · **Country** (sortable). Sort cycle includes state.

Catalog **Has State / Province**. Library stats chips: CY · CN · ST · CT.

## Sub-location + list State
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **SL** | hasSubLocation (Location/SubLocation) | **Alt+L** | SL |
| **ST** | hasState | **Alt+K** | ST |
| **CY** | hasCity | **Alt+M** | CY |
| **CN** | hasCountry | **Alt+O** | CN |

List columns **City** · **Country** · **State**. Sort cycle includes sublocation · headline.

Catalog **Has Sub-location**. Stats chip **SL**.

## Country code + Usage terms + list Headline
| Chip | Filter | Select | Filmstrip |
|------|--------|--------|-----------|
| **CC** | hasCountryCode (ISO) | **Alt+I** | CC |
| **UT** | hasUsageTerms | **Alt+U** | UT |

List column **Headline** (sortable). Catalog **Has Country Code** · **Has Usage Terms**.
Stats chips **CC** · **UT** · **HL**. Sort cycle includes country_code · usage_terms.
