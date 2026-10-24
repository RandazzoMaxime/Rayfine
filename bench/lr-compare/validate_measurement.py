#!/usr/bin/env python3
"""Validate the comparison geometry *before* any slider-curve tuning.

Checks, for each Imaging Resource triple:
  - JPEG is 8-bit sRGB (ICC / photoshop:ICCProfile)
  - EXIF orientation is 1 (or we transpose)
  - crs:HasCrop / Crop* vs JPEG vs RAW aspect
  - alignment / size after long-edge resize
  - encoded-sRGB load (÷255, no extra γ)
  - XMP versions (crs:Version, ProcessVersion, CameraProfile)

Neutral sanity: render with every develop slider at 0 (WB kept). A low ΔE
against the JPEG is only expected if that JPEG was itself a default export.
IR field-test JPEGs are processed; the identity ΔE therefore measures the
remaining WB/profile/default-curve gap plus the Look/edits still in the JPEG.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from compare_public_pairs import _align_pred_to_ref, _find_pairs, _load_png_srgb, _load_srgb
from crs_map import extract_xmp_from_path, map_xmp_path, parse_crs_attrs
from metrics import compare_srgb, luma, nan_safe

ROOT = Path(__file__).resolve().parent


def _exif_orientation(img: Image.Image) -> int:
    try:
        value = img.getexif().get(274)
        return int(value) if value is not None else 1
    except Exception:
        return 1


def _icc_name(img: Image.Image, xmp: str) -> str:
    if "sRGB IEC61966-2.1" in xmp:
        return "sRGB IEC61966-2.1"
    profile = img.info.get("icc_profile")
    if not profile:
        return "none"
    raw = profile if isinstance(profile, (bytes, bytearray)) else bytes(profile)
    if b"sRGB" in raw or b"IEC 61966" in raw:
        return "sRGB (ICC tag)"
    return f"embedded-{len(raw)}B"


def _inspect_pair(pair: dict, long_edge: int) -> dict:
    xmp_text = extract_xmp_from_path(pair["xmp"]) or ""
    attrs = parse_crs_attrs(xmp_text)
    mapped = map_xmp_path(pair["xmp"])
    jpeg = Image.open(pair["reference"])
    jpeg_ori = _exif_orientation(jpeg)
    jpeg_t = ImageOps.exif_transpose(jpeg) or jpeg
    jpeg_size = jpeg_t.size
    jpeg_arr = np.asarray(jpeg_t.convert("RGB"), dtype=np.float64) / 255.0
    mean_luma = float(luma(jpeg_arr).mean())
    # A linear-as-sRGB mistake would look very dark (~0.18^2.2 ≈ 0.02).
    gamma_ok = 0.08 < mean_luma < 0.85
    crop = mapped.crop
    jpeg_aspect = jpeg_size[0] / max(jpeg_size[1], 1)
    lr = _load_srgb(pair["reference"], long_edge, pair["reference_space"])
    issues: list[str] = []
    if jpeg_ori not in {1, None}:
        issues.append(f"JPEG EXIF orientation is {jpeg_ori}; loader must transpose.")
    if _icc_name(jpeg, xmp_text) == "none":
        issues.append("JPEG has no sRGB ICC tag.")
    if attrs.get("HasCrop") == "True":
        issues.append(f"crs:HasCrop True {crop}")
    if "DistortionCorrectionAlreadyApplied=\"True\"" in xmp_text:
        issues.append("JPEG already has lens distortion/CA applied (RAW will not).")
    if not gamma_ok:
        issues.append(f"mean luma {mean_luma:.3f} is outside a plausible sRGB scene.")
    user_zero = all(
        abs(getattr(mapped, key)) < 1e-6
        for key in ("exposure", "contrast", "whites", "blacks")
    ) and abs(mapped.highlights + 12.0) < 1e-6 and abs(mapped.shadows - 12.0) < 1e-6
    return {
        "id": pair["id"],
        "split": pair["split"],
        "source": pair["source"],
        "license": pair["license"],
        "page": pair["meta"].get("page"),
        "jpeg_url": pair["meta"].get("jpeg_url"),
        "raw_url": pair["meta"].get("raw_url"),
        "camera": pair["meta"].get("camera"),
        "jpeg_size": list(jpeg_size),
        "jpeg_aspect": round(jpeg_aspect, 4),
        "compare_size": [int(lr.shape[1]), int(lr.shape[0])],
        "orientation": jpeg_ori,
        "icc": _icc_name(jpeg, xmp_text),
        "mean_luma": mean_luma,
        "gamma_ok": gamma_ok,
        "crs_version": mapped.crs_version,
        "process_version": mapped.process_version,
        "camera_profile": mapped.camera_profile,
        "look": mapped.look_name,
        "has_crop": attrs.get("HasCrop"),
        "crop": crop,
        "white_balance": mapped.white_balance,
        "banner": mapped.banner(),
        "near_neutral_user": user_zero,
        "issues": issues,
        "limits": mapped.limits,
    }


def _maybe_render_neutral(pair: dict, out: Path, long_edge: int, skip_render: bool) -> dict | None:
    from compare_adobe_match import _run_adobe

    mapped = map_xmp_path(pair["xmp"])
    work = out / pair["id"]
    work.mkdir(parents=True, exist_ok=True)
    sliders = mapped.neutral_adobe_json()
    if not (skip_render and (work / "adobe_hs.png").exists()):
        _run_adobe(pair["raw"], sliders, work, long_edge)
    pred_path = work / "adobe_hs.png"
    if not pred_path.exists():
        return None
    lr = _load_srgb(pair["reference"], long_edge, pair["reference_space"])
    pred = _align_pred_to_ref(_load_png_srgb(pred_path, None), lr)
    m = compare_srgb(pred, lr)
    payload = m.as_dict()
    payload["de_mean"] = nan_safe(m.de_mean)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate LR-compare measurement geometry.")
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets" / "ir")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "measure")
    parser.add_argument("--long-edge", type=int, default=640)
    parser.add_argument("--render-neutral", action="store_true")
    parser.add_argument("--skip-render", action="store_true")
    args = parser.parse_args()
    pairs = _find_pairs(args.datasets)
    if not pairs:
        raise SystemExit(f"no complete pairs under {args.datasets}")
    args.out.mkdir(parents=True, exist_ok=True)
    rows = []
    for pair in pairs:
        row = _inspect_pair(pair, args.long_edge)
        if args.render_neutral:
            row["neutral"] = _maybe_render_neutral(pair, args.out / "neutral", args.long_edge, args.skip_render)
        rows.append(row)
        print(
            f"{row['id']:14} {row['jpeg_size'][0]}x{row['jpeg_size'][1]}  "
            f"ori={row['orientation']} icc={row['icc']}  "
            f"PV={row['process_version']} ACR={row['crs_version']}  "
            f"prof={row['camera_profile']} look={row['look']}  "
            f"luma={row['mean_luma']:.3f}  issues={len(row['issues'])}"
        )
    (args.out / "measurement_validation.json").write_text(
        json.dumps(rows, indent=2) + "\n", encoding="utf-8"
    )
    lines = [
        "# Measurement validation (before tuning)\n\n",
        "Reference JPEGs are loaded as encoded sRGB (÷255). ΔE2000 is CIEDE2000 in Lab D65 ",
        "(same space as `metrics.srgb_to_lab`). Orientation 1, no `crs:Crop*` on this set.\n\n",
        "| Image | Split | JPEG | Ori | ICC | ACR / PV | Profile / Look | mean Y | Issues |\n",
        "|---|---|---|---:|---|---|---|---:|---|\n",
    ]
    for row in rows:
        lines.append(
            "| `{id}` | {split} | {w}×{h} | {ori} | {icc} | {acr} / {pv} | {prof} / {look} | {y:.3f} | {iss} |\n".format(
                id=row["id"],
                split=row["split"],
                w=row["jpeg_size"][0],
                h=row["jpeg_size"][1],
                ori=row["orientation"],
                icc=row["icc"],
                acr=row["crs_version"] or "?",
                pv=row["process_version"] or "?",
                prof=row["camera_profile"] or "?",
                look=row["look"] or "-",
                y=row["mean_luma"],
                iss="; ".join(row["issues"]) or "—",
            )
        )
    if any(r.get("neutral") for r in rows):
        lines.append("\n## Neutral XMP (all sliders 0, WB kept) vs processed JPEG\n\n")
        lines.append("| Image | ΔE mean | ΔE p95 | hist L1 | clip hi pred/ref |\n|---|---:|---:|---:|---:|\n")
        for row in rows:
            n = row.get("neutral") or {}
            if not n:
                continue
            clip_p = n.get("clip_pred", {}).get("hi")
            clip_r = n.get("clip_ref", {}).get("hi")
            lines.append(
                "| `{id}` | {de} | {p95} | {hist} | {cp}/{cr} |\n".format(
                    id=row["id"],
                    de="—" if n.get("de_mean") is None else f"{n['de_mean']:.2f}",
                    p95="—" if n.get("de_p95") is None else f"{n['de_p95']:.2f}",
                    hist="—" if not n.get("hist_l1") else f"{n['hist_l1']['mean']:.3f}",
                    cp="—" if clip_p is None else f"{100 * clip_p:.1f}%",
                    cr="—" if clip_r is None else f"{100 * clip_r:.1f}%",
                )
            )
        lines.append(
            "\nNo IR JPEG is a default Adobe Standard export (Look Adobe Landscape is "
            "always on). Identity ΔE is therefore *not* a pass/fail of H/S — it is the "
            "WB / ColorMatrix / missing DCP+LookTable residual.\n"
        )
    (args.out / "measurement_validation.md").write_text("".join(lines), encoding="utf-8")
    print(f"wrote {args.out / 'measurement_validation.md'}")


if __name__ == "__main__":
    main()
