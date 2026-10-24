#!/usr/bin/env python3
"""Download Imaging Resource ACR-processed RAW + XMP + sRGB JPEG triples.

Each curated field-test shot is a Lightroom / Camera Raw export: the `-MOD.JPG`
embeds a full `crs:` packet (ProcessVersion 11.0+, Adobe Standard) and IR also
hosts the original RAW. Pixels stay in `datasets/ir/` (gitignored).

License: Imaging Resource copyright. Local evaluation / research comparison
only — do not commit or redistribute the images.
  https://www.imaging-resource.com/USAGE.HTM
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

from crs_map import extract_xmp_from_path, map_xmp_text, parse_crs_attrs

ROOT = Path(__file__).resolve().parent
DATASETS = ROOT / "datasets"
IR_HOST = "https://www.imaging-resource.com"
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
RAW_EXTS = (".RW2", ".ARW", ".NEF", ".RAF", ".CR2", ".CR3", ".ORF", ".PEF", ".DNG")

# Varied bodies, outdoor / sky / highlight-heavy field tests. Train ≠ val.
IR_PAIRS = [
    {
        "id": "g95-0192",
        "split": "train",
        "prod": "panasonic-g95",
        "stem": "Y-JG-G95-0192",
        "camera": "Panasonic G95",
        "subject": "wildlife",
        "light": "sky_tele",
        "page": f"{IR_HOST}/cameras/panasonic-g95-review/shooting/",
    },
    {
        "id": "g95-1462",
        "split": "train",
        "prod": "panasonic-g95",
        "stem": "Y-JG-G95-1462",
        "camera": "Panasonic G95",
        "subject": "landscape",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/panasonic-g95-review/shooting/",
    },
    {
        "id": "g95-0314",
        "split": "train",
        "prod": "panasonic-g95",
        "stem": "Y-JG-G95-0314",
        "camera": "Panasonic G95",
        "subject": "wildlife",
        "light": "highlights",
        "page": f"{IR_HOST}/cameras/panasonic-g95-review/shooting/",
    },
    {
        "id": "a6600-0046",
        "split": "train",
        "prod": "sony-a6600",
        "stem": "Y-JG-A6600-0046",
        "camera": "Sony A6600",
        "subject": "field",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/sony-a6600-review/gallery/",
    },
    {
        "id": "z6ii-0086",
        "split": "train",
        "prod": "nikon-z6-ii",
        "stem": "Y-JG-Z6-II-0086",
        "camera": "Nikon Z6 II",
        "subject": "field",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/nikon-z6-ii-review/shooting/",
    },
    {
        "id": "xt4-0023",
        "split": "train",
        "prod": "fuji-x-t4",
        "stem": "Y-JG-XF-50MM-F1-0023",
        "camera": "Fujifilm X-T4",
        "subject": "portrait_lens",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/fujifilm-x-t4-review/gallery/",
    },
    {
        "id": "g95-0273",
        "split": "val",
        "prod": "panasonic-g95",
        "stem": "Y-JG-G95-0273",
        "camera": "Panasonic G95",
        "subject": "wide_landscape",
        "light": "sky",
        "page": f"{IR_HOST}/cameras/panasonic-g95-review/shooting/",
    },
    {
        "id": "a6600-0156",
        "split": "val",
        "prod": "sony-a6600",
        "stem": "Y-JG-A6600-0156",
        "camera": "Sony A6600",
        "subject": "field",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/sony-a6600-review/gallery/",
    },
    {
        "id": "z6ii-0384",
        "split": "val",
        "prod": "nikon-z6-ii",
        "stem": "Y-JG-Z6-II-0384",
        "camera": "Nikon Z6 II",
        "subject": "field",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/nikon-z6-ii-review/shooting/",
    },
    {
        "id": "a6600-0089",
        "split": "train",
        "prod": "sony-a6600",
        "stem": "Y-JG-A6600-0089",
        "camera": "Sony A6600",
        "subject": "field",
        "light": "daylight",
        "page": f"{IR_HOST}/cameras/sony-a6600-review/gallery/",
    },
    {
        "id": "g95-1146",
        "split": "val",
        "prod": "panasonic-g95",
        "stem": "Y-JG-G95-1146",
        "camera": "Panasonic G95",
        "subject": "wildlife",
        "light": "sky_tele",
        "page": f"{IR_HOST}/cameras/panasonic-g95-review/shooting/",
    },
    {
        "id": "a7riv-1852",
        "split": "val",
        "prod": "sony-a7r-iv",
        "stem": "Y-JG-A7R-IV-TAMRON-150-500-1852",
        "camera": "Sony A7R IV",
        "subject": "wildlife",
        "light": "sky_tele",
        "page": f"{IR_HOST}/lenses/tamron-150-500mm-f-5-6-7-di-iii-vc-vxd-model-a057/",
    },
]


def _request(url: str, referer: str | None = None, method: str = "GET"):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=180)


def _download(url: str, dest: Path, referer: str | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"skip exists {dest}")
        return
    print(f"GET {url} -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with _request(url, referer=referer) as src, tmp.open("wb") as out:
            while True:
                chunk = src.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
        tmp.replace(dest)
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def _head_ok(url: str, referer: str | None = None) -> tuple[bool, int]:
    try:
        with _request(url, referer=referer, method="HEAD") as resp:
            length = int(resp.headers.get("Content-Length") or 0)
            return resp.status == 200, length
    except urllib.error.HTTPError as exc:
        if exc.code in {403, 405}:
            # Some IR paths reject HEAD; try a tiny GET.
            try:
                with _request(url, referer=referer) as resp:
                    length = int(resp.headers.get("Content-Length") or 0)
                    return True, length
            except Exception:
                return False, 0
        return False, 0
    except Exception:
        return False, 0


def _jpeg_candidates(prod: str, stem: str) -> list[str]:
    return [
        f"{IR_HOST}/PRODS/{prod}/FULLRES/{stem}-MOD.JPG",
        f"{IR_HOST}/PRODS/{prod}/{stem}-MOD.JPG",
        f"https://old.imaging-resource.com/PRODS/{prod}/FULLRES/{stem}-MOD.JPG",
    ]


def _htm_candidates(prod: str, stem: str) -> list[str]:
    return [
        f"{IR_HOST}/PRODS/{prod}/FULLRES/{stem}-MOD.HTM",
        f"{IR_HOST}/PRODS/{prod}/{stem}-MOD.HTM",
    ]


def _raw_candidates(prod: str, stem: str) -> list[str]:
    urls = []
    for folder in (f"{IR_HOST}/PRODS/{prod}/FULLRES", f"{IR_HOST}/PRODS/{prod}"):
        for ext in RAW_EXTS:
            urls.append(f"{folder}/{stem}{ext}")
    return urls


def _xmp_summary(xmp: str) -> dict:
    attrs = parse_crs_attrs(xmp)
    mapped = map_xmp_text(xmp)
    look = re.search(r'crs:Name="([^"]+)"', xmp)
    model = re.search(r'tiff:Model="([^"]+)"', xmp)
    return {
        "crs_version": attrs.get("Version"),
        "process_version": attrs.get("ProcessVersion"),
        "camera_profile": attrs.get("CameraProfile"),
        "look": look.group(1) if look else None,
        "model": model.group(1) if model else None,
        "white_balance": attrs.get("WhiteBalance"),
        "temperature": attrs.get("Temperature"),
        "tint": attrs.get("Tint"),
        "exposure2012": attrs.get("Exposure2012"),
        "highlights2012": attrs.get("Highlights2012"),
        "shadows2012": attrs.get("Shadows2012"),
        "whites2012": attrs.get("Whites2012"),
        "blacks2012": attrs.get("Blacks2012"),
        "contrast2012": attrs.get("Contrast2012"),
        "has_crop": attrs.get("HasCrop"),
        "icc": "sRGB IEC61966-2.1" if "sRGB IEC61966-2.1" in xmp else None,
        "banner": mapped.banner(),
    }


def download_pair(item: dict, out_root: Path) -> Path:
    dest = out_root / item["id"]
    dest.mkdir(parents=True, exist_ok=True)
    referer = item["page"]
    for htm in _htm_candidates(item["prod"], item["stem"]):
        ok, _ = _head_ok(htm, referer=item["page"])
        if ok:
            referer = htm
            break

    jpeg = dest / "lr_export.jpg"
    jpeg_url = None
    last_err: Exception | None = None
    xmp_text = None
    if jpeg.exists() and jpeg.stat().st_size > 1_000_000:
        cached = extract_xmp_from_path(jpeg)
        if cached and "crs:" in cached:
            jpeg_url = item.get("jpeg_url") or "local-cache"
            xmp_text = cached
    for url in _jpeg_candidates(item["prod"], item["stem"]):
        if xmp_text and jpeg_url:
            break
        try:
            if jpeg.exists():
                jpeg.unlink()
            _download(url, jpeg, referer=referer)
            xmp_text = extract_xmp_from_path(jpeg)
            if xmp_text and "crs:" in xmp_text:
                jpeg_url = url
                break
            last_err = RuntimeError(f"{url} has no crs: XMP ({jpeg.stat().st_size} bytes)")
        except Exception as exc:
            last_err = exc
            if jpeg.exists():
                jpeg.unlink()
    if jpeg_url is None or not xmp_text:
        raise RuntimeError(f"{item['id']}: no ACR MOD JPEG ({last_err})")
    (dest / "develop.xmp").write_text(xmp_text, encoding="utf-8")
    summary = _xmp_summary(xmp_text)

    raw_path = dest / "raw.bin"
    raw_url = None
    for url in _raw_candidates(item["prod"], item["stem"]):
        ok, length = _head_ok(url, referer=referer)
        if not ok or length < 1_000_000:
            continue
        ext = Path(url).suffix.lower()
        raw_path = dest / f"raw{ext}"
        _download(url, raw_path, referer=referer)
        raw_url = url
        break
    if raw_url is None:
        raise RuntimeError(f"{item['id']}: no RAW sibling for {item['stem']}")

    (dest / "LICENSE.txt").write_text(
        "Imaging Resource sample. Copyright Imaging Resource.\n"
        "Local evaluation / research comparison only. Do not commit or redistribute.\n"
        f"Source page: {item['page']}\n"
        f"JPEG: {jpeg_url}\n"
        f"RAW: {raw_url}\n"
        "https://www.imaging-resource.com/USAGE.HTM\n",
        encoding="utf-8",
    )
    meta = {
        **item,
        "raw": raw_path.name,
        "reference": jpeg.name,
        "xmp": "develop.xmp",
        "reference_space": "srgb",
        "source": "imaging-resource",
        "license": "IR-evaluation-no-redistribution",
        "jpeg_url": jpeg_url,
        "raw_url": raw_url,
        "xmp_summary": summary,
    }
    (dest / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        f"ready {item['id']} split={item['split']} "
        f"PV={summary.get('process_version')} ACR={summary.get('crs_version')} "
        f"prof={summary.get('camera_profile')} look={summary.get('look')} "
        f"{summary.get('banner')}"
    )
    return dest


def download_ir(out_root: Path, accept: bool) -> None:
    if not accept:
        raise SystemExit(
            "Imaging Resource samples are copyrighted (evaluation / research only). "
            "Re-run with --accept-ir-evaluation-license."
        )
    out_root.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    for item in IR_PAIRS:
        try:
            download_pair(item, out_root)
        except Exception as exc:
            errors.append(f"{item['id']}: {exc}")
            print(f"FAIL {item['id']}: {exc}", file=sys.stderr)
    ready = list(out_root.glob("*/meta.json"))
    if errors:
        print("IR download failures:\n" + "\n".join(errors), file=sys.stderr)
    if len(ready) < 6:
        raise SystemExit(f"Need ≥6 complete triples, have {len(ready)}")
    print(f"IR ready {len(ready)} triples")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download IR ACR RAW+XMP+JPEG triples.")
    parser.add_argument("--accept-ir-evaluation-license", action="store_true")
    parser.add_argument("--out", type=Path, default=DATASETS / "ir")
    args = parser.parse_args()
    download_ir(args.out, args.accept_ir_evaluation_license)


if __name__ == "__main__":
    main()
