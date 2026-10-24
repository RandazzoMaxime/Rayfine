#!/usr/bin/env python3
"""Fetch Adobe Standard (and Color/Landscape) DCP for the IR bodies.

Adobe DNG Converter (Windows installer) ships Camera Raw .dcp profiles.
Those files are Adobe copyright — this script extracts them locally and
writes a manifest. Do not commit the .dcp files.

Usage:
  python bench/lr-compare/fetch_adobe_dcp.py
  python bench/lr-compare/fetch_adobe_dcp.py --out bench/lr-compare/datasets/dcp

Requires: curl or wget, innoextract (apt: innoextract).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "datasets" / "dcp"
CACHE = Path(os.environ.get("RAYFINE_DCP_CACHE", "/tmp/adobe-dng-converter"))

# Official public installer URLs (AUR adobe-dng-dcp + Adobe download.adobe.com).
# Newer versions first; 16.3 is the last one with a published AUR sha256.
INSTALLERS = [
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_17_5.exe",
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_17_4.exe",
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_16_3.exe",
    "http://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_16_3.exe",
]

# Imaging Resource bodies used by the Rayfine oracle.
# Exact Adobe Standard filenames (DNG Converter 16.3). G95 is sold as G90/G91/G99;
# Adobe ships "Panasonic DC-G99 Adobe Standard.dcp".
EXACT_STANDARD = {
    "g95": "Panasonic DC-G99 Adobe Standard.dcp",
    "a6600": "Sony ILCE-6600 Adobe Standard.dcp",
    "z6ii": "Nikon Z 6 2 Adobe Standard.dcp",
    "a7riv": "Sony ILCE-7RM4 Adobe Standard.dcp",
}
BODY_LABEL = {
    "g95": "Panasonic DC-G95 / DC-G99",
    "a6600": "Sony ILCE-6600",
    "z6ii": "Nikon Z 6_2",
    "a7riv": "Sony ILCE-7RM4",
}

LICENSE = """Adobe DNG Camera Profiles (.dcp)

Source: Adobe DNG Converter Windows installer (Camera Raw CameraProfiles).
Copyright Adobe. Redistribution of the .dcp files is not permitted.

This directory is produced by fetch_adobe_dcp.py for local research
comparison only (Imaging Resource ACR oracle). Do not commit or publish
these files. The fetch script itself is MIT-licensed with Rayfine.
"""


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def _download(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if dest.exists() and dest.stat().st_size > 50_000_000:
        print(f"reusing {dest} ({dest.stat().st_size} bytes)")
        return True
    for tool in (
        ["curl", "-fL", "--retry", "4", "--retry-delay", "8", "-C", "-", "-o", str(part), url],
        ["wget", "-c", "-O", str(part), url],
    ):
        if shutil.which(tool[0]) is None:
            continue
        try:
            _run(tool)
            part.rename(dest)
            return dest.exists() and dest.stat().st_size > 1_000_000
        except subprocess.CalledProcessError as exc:
            print(f"{tool[0]} failed for {url}: {exc}", file=sys.stderr)
    return False


def _extract(installer: Path, work: Path) -> Path:
    work.mkdir(parents=True, exist_ok=True)
    marker = work / ".extracted"
    if marker.exists() and any(work.rglob("*.dcp")):
        return work
    _run(["innoextract", "-e", "-c", "0", "-d", str(work), str(installer)])
    marker.write_text(installer.name + "\n", encoding="utf-8")
    return work


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_wanted(extracted: Path, out: Path) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    (out / "LICENSE-ADOBE-DCP.txt").write_text(LICENSE, encoding="utf-8")
    found: list[dict] = []
    standard_root = None
    for cand in extracted.rglob("Adobe Standard"):
        if cand.is_dir():
            standard_root = cand
            break
    if standard_root is None:
        print("no CameraProfiles/Adobe Standard directory", file=sys.stderr)
        return found
    for slug, filename in EXACT_STANDARD.items():
        src = standard_root / filename
        if not src.is_file():
            print(f"missing {filename}", file=sys.stderr)
            continue
        dest_name = f"{slug}-adobe_standard.dcp"
        dest = out / dest_name
        shutil.copy2(src, dest)
        rec = {
            "body": BODY_LABEL[slug],
            "style": "Adobe Standard",
            "slug": slug,
            "file": dest_name,
            "bytes": dest.stat().st_size,
            "sha256": _sha256(dest),
            "extracted_from": str(src.relative_to(extracted)),
            "license": "Adobe copyright; local use only, not redistributable",
        }
        found.append(rec)
        print(f"copied {dest_name}  {rec['bytes']} bytes  from {filename}")
    found.sort(key=lambda r: r["slug"])
    (out / "MANIFEST.json").write_text(json.dumps(found, indent=2) + "\n", encoding="utf-8")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--installer", type=Path, default=None)
    args = parser.parse_args()

    if shutil.which("innoextract") is None:
        print("innoextract is required (apt install innoextract)", file=sys.stderr)
        return 2

    installer = args.installer
    if installer is None:
        CACHE.mkdir(parents=True, exist_ok=True)
        for url in INSTALLERS:
            dest = CACHE / Path(url).name
            print(f"trying {url}")
            if _download(url, dest):
                installer = dest
                break
        if installer is None:
            print("could not download Adobe DNG Converter", file=sys.stderr)
            return 1

    work = CACHE / "extracted"
    _extract(installer, work)
    found = copy_wanted(work, args.out)
    print(f"wrote {len(found)} profiles under {args.out}")
    have = {(r["slug"], r["style"]) for r in found}
    missing = []
    for slug in ("g95", "a6600", "z6ii", "a7riv"):
        if (slug, "Adobe Standard") not in have:
            missing.append(f"{slug} Adobe Standard")
    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
