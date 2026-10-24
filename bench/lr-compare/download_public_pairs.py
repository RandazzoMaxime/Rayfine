#!/usr/bin/env python3
"""Download licensed public RAW + Lightroom-settings + Lightroom-export triples.

Datasets are written to bench/lr-compare/datasets/ (gitignored). This script
never commits pixels.

Sources (see SOURCES.md):
  ir        Imaging Resource field-test ACR exports (primary).
            RAW + `-MOD.JPG` (sRGB, embedded crs: PV2012+) + extracted XMP.
  fivek     MIT-Adobe FiveK — kept for history, not the PV2012 reference.
  ppr10k    Layout helper only — files are on Google Drive / Baidu (research).
  playraw   Optional curated discuss.pixls.us triples (CC, crs: XMP only).

Usage:
  python bench/lr-compare/download_public_pairs.py --accept-ir-evaluation-license --source ir
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from download_ir_triples import download_ir

ROOT = Path(__file__).resolve().parent
DATASETS = ROOT / "datasets"
FIVEK_BASE = "https://data.csail.mit.edu/graphics/fivek"
FIVEK_LEGAL = f"{FIVEK_BASE}/legal"

# LicenseAdobeMIT + outdoor / nature-leaning scenes from the public FiveK table.
# Train / val split is fixed so highlight curves are not fit on the hold-out.
FIVEK_PAIRS = [
    {
        "id": "a0041-IMG_4972",
        "split": "train",
        "subject": "nature",
        "light": "sun_sky",
        "location": "outdoors",
        "license": "LicenseAdobeMIT",
        "note": "Expert C: Exposure +2.81, HighlightRecovery 48 — highlight push.",
    },
    {
        "id": "a0045-20050320_081337__E6B1177",
        "split": "train",
        "subject": "nature",
        "light": "sun_sky",
        "location": "outdoors",
        "license": "LicenseAdobeMIT",
    },
    {
        "id": "a0077-20080627_at_14h31m24__MG_0714",
        "split": "train",
        "subject": "nature",
        "light": "sun_sky",
        "location": "outdoors",
        "license": "LicenseAdobeMIT",
    },
    {
        "id": "a0006-IMG_2787",
        "split": "val",
        "subject": "animal",
        "light": "sun_sky",
        "location": "outdoors",
        "license": "LicenseAdobeMIT",
    },
    {
        "id": "a0097-JI2E5089",
        "split": "val",
        "subject": "nature",
        "light": "sun_sky",
        "location": "outdoors",
        "license": "LicenseAdobeMIT",
    },
]

# Play Raw entries must be CC and carry a Lightroom (crs:) sidecar, not darktable.
# Keep empty unless a specific post is re-verified; the compare script still
# accepts a local folder of RAW+XMP+JPEG.
PLAYRAW_PAIRS: list[dict] = []


def _urlopen(url: str, dest: Path, timeout: int = 120) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "rayfine-lr-compare/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as src, dest.open("wb") as out:
        while True:
            chunk = src.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def _maybe_download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"skip exists {dest}")
        return
    print(f"GET {url} -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        _urlopen(url, tmp)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _quote_name(name: str) -> str:
    return urllib.parse.quote(name, safe="-_.~")


def download_fivek(out_root: Path, accept: bool) -> None:
    if not accept:
        raise SystemExit(
            "FiveK is a non-commercial research license. Re-run with --accept-research-license."
        )
    legal = out_root / "_legal"
    legal.mkdir(parents=True, exist_ok=True)
    for name in (
        "LicenseAdobeMIT.txt",
        "LicenseAdobe.txt",
        "filesAdobeMIT.txt",
        "filesAdobe.txt",
    ):
        try:
            _maybe_download(f"{FIVEK_LEGAL}/{name}", legal / name)
        except urllib.error.HTTPError as exc:
            print(f"warn: {name}: {exc}", file=sys.stderr)
    allowed: set[str] | None = None
    listing = legal / "filesAdobeMIT.txt"
    if listing.exists():
        allowed = {line.strip() for line in listing.read_text(encoding="utf-8").splitlines() if line.strip()}
    from crs_map import extract_xmp_from_path

    for item in FIVEK_PAIRS:
        ident = item["id"]
        if allowed is not None and ident not in allowed:
            print(f"skip {ident}: not in filesAdobeMIT.txt", file=sys.stderr)
            continue
        dest = out_root / ident
        dest.mkdir(parents=True, exist_ok=True)
        dng = dest / "raw.dng"
        tif = dest / "expert_c.tif"
        _maybe_download(f"{FIVEK_BASE}/img/dng/{_quote_name(ident)}.dng", dng)
        _maybe_download(f"{FIVEK_BASE}/img/tiff16_c/{_quote_name(ident)}.tif", tif)
        xmp_text = extract_xmp_from_path(tif)
        if not xmp_text:
            raise RuntimeError(f"no XMP in {tif}")
        (dest / "expert_c.xmp").write_text(xmp_text, encoding="utf-8")
        (dest / "LICENSE.txt").write_text(
            "MIT-Adobe FiveK — LicenseAdobeMIT research license.\n"
            "Local use only. Do not commit this folder.\n"
            f"Cite: Bychkovsky et al., CVPR 2011. File {ident} expert C.\n",
            encoding="utf-8",
        )
        meta = {
            **item,
            "raw": str(dng.name),
            "reference": str(tif.name),
            "xmp": "expert_c.xmp",
            "reference_space": "prophoto16",
            "source": "fivek",
        }
        (dest / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"ready {ident} split={item['split']}")


def write_ppr10k_readme(out_root: Path) -> None:
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "README.md").write_text(
        "# PPR10K local layout\n\n"
        "The dataset is research-only and hosted on Google Drive / Baidu "
        "(https://github.com/csjliang/PPR10K). Place a small subset here:\n\n"
        "```\n"
        "datasets/ppr10k/<stem>/\n"
        "  raw.<ext>          # original RAW\n"
        "  expert_a.xmp       # xmp_target_a\n"
        "  expert_a.tif       # 8-bit sRGB target (360p pack is fine)\n"
        "  meta.json          # {\"split\":\"train\",\"source\":\"ppr10k\",\"license\":\"research\"}\n"
        "```\n"
        "Do not commit images. Agreement: non-commercial research; no redistribution.\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Download public RAW+XMP+LR-export pairs.")
    parser.add_argument(
        "--source",
        action="append",
        choices=("ir", "fivek", "ppr10k", "playraw", "all"),
        help="Dataset to prepare (repeatable). Default: ir",
    )
    parser.add_argument(
        "--accept-research-license",
        action="store_true",
        help="Required for FiveK / PPR10K (non-commercial research).",
    )
    parser.add_argument(
        "--accept-ir-evaluation-license",
        action="store_true",
        help="Required for Imaging Resource samples (evaluation / no redistribution).",
    )
    parser.add_argument("--out", type=Path, default=DATASETS)
    args = parser.parse_args()
    sources = args.source or ["ir"]
    if "all" in sources:
        sources = ["ir", "fivek", "ppr10k", "playraw"]
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    if "ir" in sources:
        download_ir(out / "ir", args.accept_ir_evaluation_license)
    if "fivek" in sources:
        download_fivek(out / "fivek", args.accept_research_license)
    if "ppr10k" in sources:
        write_ppr10k_readme(out / "ppr10k")
        print("PPR10K: wrote layout README (manual download).")
    if "playraw" in sources:
        if not PLAYRAW_PAIRS:
            print(
                "Play Raw: no curated Lightroom (crs:) triples yet. "
                "Most sidecars are darktable. Drop local RAW+XMP+JPEG in datasets/playraw/."
            )
        else:
            dest = out / "playraw"
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "index.json").write_text(json.dumps(PLAYRAW_PAIRS, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
