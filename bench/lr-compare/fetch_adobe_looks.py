#!/usr/bin/env python3
"""Fetch Adobe Landscape / Adobe Color Look XMP (RGBTable / LookTable).

Adobe DNG Converter (and Camera Raw) ship these under
`Settings/Adobe/Profiles/Adobe Raw/*.xmp`. They are Adobe copyright —
this script copies them locally and writes a manifest. Do not commit the
`.xmp` files.

The IR oracle references Landscape by UUID
`0B3BFB5CFB7DBF7FF175E98F24D316B0` (`crs:LookTable` + `crs:Table_<UUID>`).
DNG Converter 16.3 stores that blob as a dng_big_table HSV LookTable
(36×16×16, encoding 0). Newer Camera Raw builds may ship a type-1 RGB 3D LUT
in the same attribute; both are decoded at runtime (not here).

Usage:
  python bench/lr-compare/fetch_adobe_looks.py
  python bench/lr-compare/fetch_adobe_looks.py --out bench/lr-compare/datasets/looks

Reuses the installer cache of fetch_adobe_dcp.py (`RAYFINE_DCP_CACHE`).
Requires: curl or wget, innoextract (apt: innoextract).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "datasets" / "looks"
CACHE = Path(os.environ.get("RAYFINE_DCP_CACHE", "/tmp/adobe-dng-converter"))

# Same public installers as fetch_adobe_dcp.py (newer first).
INSTALLERS = [
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_17_5.exe",
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_17_4.exe",
    "https://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_16_3.exe",
    "http://download.adobe.com/pub/adobe/dng/win/AdobeDNGConverter_x64_16_3.exe",
]

WANTED = {
    "Adobe Landscape": "0B3BFB5CFB7DBF7FF175E98F24D316B0",
    "Adobe Color": "E1095149FDB39D7A057BAB208837E2E1",
}

LICENSE = """Adobe Camera Raw Look profiles (.xmp)

Source: Adobe DNG Converter / Camera Raw Settings/Adobe/Profiles/Adobe Raw.
Copyright Adobe. Redistribution of the .xmp files (and their Table_ blobs)
is not permitted.

This directory is produced by fetch_adobe_looks.py for local research
comparison only (Imaging Resource ACR oracle). Do not commit or publish
these files. The fetch script itself is MIT-licensed with Rayfine.
"""

TABLE_RE = re.compile(r'crs:Table_([0-9A-Fa-f]+)="')
LOOK_RE = re.compile(r'crs:LookTable="([0-9A-Fa-f]+)"')
NAME_RE = re.compile(r"<crs:Name>\s*([^<]+)\s*</crs:Name>")


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
    if marker.exists() and any(work.rglob("Adobe Landscape.xmp")):
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


def _meta(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    names = NAME_RE.findall(text)
    tables = TABLE_RE.findall(text)
    looks = LOOK_RE.findall(text)
    uuid = (looks[0] if looks else tables[0] if tables else "").upper()
    return {
        "name": names[0].strip() if names else path.stem,
        "uuid": uuid,
        "table_uuids": [u.upper() for u in tables],
    }


def copy_wanted(extracted: Path, out: Path) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    (out / "LICENSE-ADOBE-LOOKS.txt").write_text(LICENSE, encoding="utf-8")
    found: list[dict] = []
    raw_dir = None
    for cand in extracted.rglob("Adobe Landscape.xmp"):
        raw_dir = cand.parent
        break
    if raw_dir is None:
        print("no Settings/Adobe/Profiles/Adobe Raw/Adobe Landscape.xmp", file=sys.stderr)
        return found
    for name, uuid in WANTED.items():
        src = raw_dir / f"{name}.xmp"
        if not src.is_file():
            print(f"missing {name}.xmp", file=sys.stderr)
            continue
        meta = _meta(src)
        dest = out / f"{name.replace(' ', '_').lower()}.xmp"
        shutil.copy2(src, dest)
        rec = {
            "name": meta["name"],
            "file": dest.name,
            "bytes": dest.stat().st_size,
            "sha256": _sha256(dest),
            "uuid": meta["uuid"],
            "expected_uuid": uuid,
            "uuid_match": meta["uuid"] == uuid,
            "extracted_from": str(src.relative_to(extracted)),
            "license": "Adobe copyright; local use only, not redistributable",
        }
        found.append(rec)
        print(f"copied {dest.name}  {rec['bytes']} bytes  uuid={meta['uuid']}")
    found.sort(key=lambda r: r["name"])
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
        cached = CACHE / "AdobeDNGConverter_x64_16_3.exe"
        if cached.is_file() and cached.stat().st_size > 50_000_000:
            installer = cached
        else:
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
    print(f"wrote {len(found)} looks under {args.out}")
    have = {r["name"] for r in found}
    missing = [name for name in WANTED if name not in have]
    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)
        return 3
    mismatched = [r["name"] for r in found if not r["uuid_match"]]
    if mismatched:
        print("UUID mismatch (still copied):", ", ".join(mismatched), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
