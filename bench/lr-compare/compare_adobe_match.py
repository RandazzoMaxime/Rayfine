#!/usr/bin/env python3
"""Ablation: match Lightroom colour + light before judging H/S.

Stages (each includes the previous):
  wb        Temperature/Tint (or As Shot) only — camera RGB, no matrix
  profile   + ColorMatrix/ForwardMatrix + LookTable → ProPhoto → sRGB
  exposure  + BaselineExposure + Exposure (Brightness still off)
  curve     + PV2010 Brightness / Contrast / named ToneCurve
  hs        + Highlights/Shadows/Whites/Blacks

Usage:
  python bench/lr-compare/compare_adobe_match.py \\
    --datasets bench/lr-compare/datasets --out bench/lr-compare/out/adobe
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from compare_public_pairs import (
    _find_pairs,
    _font,
    _load_png_srgb,
    _load_srgb,
    _stack_h,
    _stack_v,
    _to_image,
)
from crs_map import map_xmp_path, mapping_to_json
from metrics import compare_srgb, de_heatmap_srgb, delta_e_map, luma, nan_safe

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
STAGES = ("wb", "profile", "exposure", "curve", "hs")
DE_SCALE = 20.0


def _fmt(value: float | None, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    return f"{value:.{digits}f}"


def _run_adobe(raw: Path, sliders: dict, out_dir: Path, long_edge: int) -> None:
    sliders_path = out_dir / "adobe_sliders.json"
    sliders_path.write_text(json.dumps(sliders, indent=2) + "\n", encoding="utf-8")
    cargo = [
        "cargo",
        "run",
        "--quiet",
        "-p",
        "Rayfine",
        "--bin",
        "lr_public_compare",
        "--",
        "--raw",
        str(raw.resolve()),
        "--sliders",
        str(sliders_path.resolve()),
        "--out",
        str(out_dir.resolve()),
        "--long-edge",
        str(long_edge),
        "--path",
        "adobe",
        "--stage",
        "all",
    ]
    print(" ".join(cargo))
    subprocess.run(cargo, cwd=str(REPO / "src-tauri"), check=True)


def _banner(text: str, width: int, fill: tuple[int, int, int] = (28, 28, 32), height: int = 52) -> Image.Image:
    font = _font(13)
    bar = Image.new("RGB", (width, height), fill)
    draw = ImageDraw.Draw(bar)
    y = 4
    for line in text.split("\n"):
        draw.text((8, y), line, fill=(235, 235, 235), font=font)
        y += 16
    return bar


def _panel(title: str, arr: np.ndarray, extra: str = "") -> Image.Image:
    img = _to_image(arr)
    text = title if not extra else f"{title}\n{extra}"
    return _stack_v([_banner(text, img.width, height=52 if extra else 36), img])


def _colorbar(height: int, scale: float = DE_SCALE) -> Image.Image:
    width = 28
    ramp = np.linspace(scale, 0.0, height, dtype=np.float64)
    de = np.repeat(ramp[:, None], width, axis=1)
    rgb = de_heatmap_srgb(de, scale)
    img = _to_image(rgb)
    draw = ImageDraw.Draw(img)
    font = _font(10)
    draw.text((2, 2), f"{scale:.0f}", fill=(255, 255, 255), font=font)
    draw.text((2, height // 2 - 6), f"{scale/2:.0f}", fill=(0, 0, 0), font=font)
    draw.text((2, height - 14), "0", fill=(255, 255, 255), font=font)
    return img


def _mid_de(pred: np.ndarray, ref: np.ndarray) -> float:
    de = delta_e_map(pred, ref)
    y = luma(ref)
    mask = (y >= 0.1) & (y <= 0.8)
    if not np.any(mask):
        return float("nan")
    return float(de[mask].mean())


def _luma_hist_l1(pred: np.ndarray, ref: np.ndarray) -> float:
    ha, _ = np.histogram(luma(pred), bins=64, range=(0.0, 1.0), density=True)
    hb, _ = np.histogram(luma(ref), bins=64, range=(0.0, 1.0), density=True)
    return float(np.mean(np.abs(ha - hb)))


def _sheet(
    ident: str,
    banner: str,
    stage: str,
    sliders_line: str,
    lr: np.ndarray,
    pred: np.ndarray,
    metrics,
    dest: Path,
    notes: str,
) -> None:
    de = delta_e_map(pred, lr)
    heat = de_heatmap_srgb(de, DE_SCALE)
    row = _stack_h(
        [
            _panel("Lightroom JPEG/TIFF", lr, sliders_line),
            _panel(f"Rayfine Adobe / {stage}", pred, sliders_line),
            _panel(f"ΔE2000  0→{DE_SCALE:.0f}", heat, f"mean {_fmt(metrics.de_mean)}  p95 {_fmt(metrics.de_p95)}"),
            _colorbar(lr.shape[0] + 52),
        ]
    )
    caption = (
        f"{ident}  stage={stage}  {banner}\n"
        f"ΔE mean {_fmt(metrics.de_mean)}  p95 {_fmt(metrics.de_p95)}  "
        f"mid {_fmt(_mid_de(pred, lr))}  SSIM {_fmt(metrics.ssim, 3)}  "
        f"histL {_fmt(_luma_hist_l1(pred, lr), 3)}  "
        f"hiMAE {_fmt(metrics.highlight_mae, 3)}  shMAE {_fmt(metrics.shadow_mae, 3)}\n"
        f"{notes}"
    )
    sheet = _stack_v([_banner(caption, row.width, (20, 32, 48), height=68), row])
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)


def _ablation_table(rows: list[dict]) -> str:
    header = (
        "| Split | Image | WB | +profil | +expo | +courbe | +H/S | "
        "ΔE mid courbe | hist L courbe | H/S forts |\n"
        "|---|---|---:|---:|---:|---:|---:|---:|---:|:---|\n"
    )
    lines = [header]
    for row in rows:
        st = row["stages"]
        lines.append(
            "| {split} | `{ident}` | {wb} | {pr} | {ex} | {cu} | {hs} | {mid} | {hist} | {strong} |\n".format(
                split=row["split"],
                ident=row["id"],
                wb=_fmt(st["wb"]["de_mean"]),
                pr=_fmt(st["profile"]["de_mean"]),
                ex=_fmt(st["exposure"]["de_mean"]),
                cu=_fmt(st["curve"]["de_mean"]),
                hs=_fmt(st["hs"]["de_mean"]),
                mid=_fmt(st["curve"].get("de_mid")),
                hist=_fmt(st["curve"].get("hist_luma"), 3),
                strong="oui" if row["strong_hs"] else "non",
            )
        )
    return "".join(lines)


def _strong_hs(mapped) -> bool:
    return abs(mapped.highlights) >= 40 or abs(mapped.shadows) >= 20 or abs(mapped.blacks) >= 30


def main() -> None:
    parser = argparse.ArgumentParser(description="Adobe-match ablation vs Lightroom exports.")
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "adobe")
    parser.add_argument("--long-edge", type=int, default=640)
    parser.add_argument("--skip-render", action="store_true")
    args = parser.parse_args()
    pairs = _find_pairs(args.datasets)
    pairs.sort(key=lambda p: (0 if p["split"] == "train" else 1, p["id"]))
    if not pairs:
        raise SystemExit(f"no complete pairs under {args.datasets}")
    args.out.mkdir(parents=True, exist_ok=True)
    summary = []
    for pair in pairs:
        work = args.out / pair["id"]
        work.mkdir(parents=True, exist_ok=True)
        mapped = map_xmp_path(pair["xmp"])
        mapping = mapping_to_json(mapped)
        (work / "mapping.json").write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
        shutil.copy2(pair["xmp"], work / "source.xmp")
        adobe = mapped.adobe_json()
        print(f"== {pair['id']} {mapped.banner()}")
        if not (args.skip_render and (work / "adobe_hs.png").exists()):
            _run_adobe(pair["raw"], adobe, work, args.long_edge)
        lr = _load_srgb(pair["reference"], args.long_edge, pair["reference_space"])
        size = (lr.shape[1], lr.shape[0])
        profile_notes = []
        notes_path = work / "adobe_profile.json"
        if notes_path.exists():
            profile = json.loads(notes_path.read_text(encoding="utf-8"))
            profile_notes = profile.get("notes") or []
            if not profile.get("has_hue_sat_map"):
                profile_notes.append("HueSatMap absent — Adobe Standard HSB table not in this DNG.")
        notes = " | ".join(profile_notes) if profile_notes else "Adobe DNG path (ForwardMatrix + LookTable)."
        stage_metrics: dict[str, dict] = {}
        for stage in STAGES:
            png = work / f"adobe_{stage}.png"
            pred = _load_png_srgb(png, size)
            m = compare_srgb(pred, lr)
            payload = m.as_dict()
            payload["de_mid"] = nan_safe(_mid_de(pred, lr))
            payload["hist_luma"] = nan_safe(_luma_hist_l1(pred, lr))
            stage_metrics[stage] = payload
            _sheet(
                pair["id"],
                mapped.banner(),
                stage,
                mapped.banner(),
                lr,
                pred,
                m,
                args.out / "sheets" / f"{pair['id']}_{stage}.png",
                notes,
            )
            print(
                f"   {stage:8}  dE {m.de_mean:.2f}  mid {payload['de_mid']}  "
                f"histL {payload['hist_luma']}"
            )
        row = {
            "id": pair["id"],
            "split": pair["split"],
            "source": pair["source"],
            "license": pair["license"],
            "banner": mapped.banner(),
            "adobe": adobe,
            "strong_hs": _strong_hs(mapped),
            "notes": profile_notes,
            "stages": stage_metrics,
        }
        (work / "adobe_metrics.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        summary.append(row)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    table = _ablation_table(summary)
    weak = [r for r in summary if not r["strong_hs"]]
    val = [r for r in summary if r["split"] == "val"]
    train = [r for r in summary if r["split"] == "train"]

    def _mean(rows: list[dict], stage: str, key: str = "de_mean") -> str:
        vals = [r["stages"][stage][key] for r in rows if r["stages"][stage].get(key) is not None]
        if not vals:
            return "—"
        return _fmt(sum(vals) / len(vals))

    body = (
        "# Adobe colour / light match (FiveK vs Lightroom TIFF)\n\n"
        "Pipeline: camera-linear demosaic → Temperature/Tint WB (DNG SDK Planckian + CIE 1960 tint) "
        "→ Inverse(CameraCalibration) → ForwardMatrix → XYZ D50 → ProPhoto linear → "
        "LookTable 36×8×16 → BaselineExposure + Exposure → Brightness/Contrast/named curve → "
        "Highlights/Shadows/Whites/Blacks.\n\n"
        "Reference: MIT-Adobe FiveK Expert C 16-bit ProPhoto TIFF (LicenseAdobeMIT). "
        "ΔE2000 after the same ProPhoto→sRGB matrix on both sides. "
        "Hold-out rows use `split=val`.\n\n"
        "## Ablation (mean ΔE2000)\n\n"
        + table
        + "\n### Means\n\n"
        f"- Train curve / hs: {_mean(train, 'curve')} / {_mean(train, 'hs')}\n"
        f"- Train midtones (curve): {_mean(train, 'curve', 'de_mid')}\n"
        f"- Weak H/S curve / hs: {_mean(weak, 'curve')} / {_mean(weak, 'hs')}\n"
        f"- Val curve / hs: {_mean(val, 'curve')} / {_mean(val, 'hs')}  (not used to tune)\n\n"
        "## Gaps that stay open\n\n"
        "- **CameraProfile ACR 4.4** is proprietary. ColorMatrix-only + CAT "
        "was measured worse than ForwardMatrix+LookTable (a0045 profile ΔE 19→31). "
        "The tables below use ForwardMatrix + LookTable.\n"
        "- **ProfileHueSatMap** is not a numeric table in these FiveK DNGs "
        "(tag 50937 missing). Only the embedded 36×8×16 `ProfileLookTable` is applied. "
        "Adobe Standard’s full HSB map is proprietary DCP data — residual chroma error is expected.\n"
        "- WB uses Kang CCT→xy + CIE 1960 tint (`kTintScale = −3000`), not Adobe’s unpublished "
        "Planckian table. Illuminant mix is inverse-CCT between A (2856 K) and D65 (6504 K).\n"
        "- FiveK Expert C TIFFs already include HighlightRecovery. The `curve` column is "
        "colour+light without our H/S; full-frame ΔE vs the TIFF is therefore inflated by that missing HR.\n"
        "- Unmapped Expert C looks that stay in the TIFF: Vibrance "
        "(a0045 +87, a0097 +70, a0077 +55), Saturation (a0077 +34), "
        "parametric (a0041 Darks +38). These are not in the colour/light chain.\n"
        "- Target: mean ΔE2000 < 5 (aim < 3) on weak-H/S frames after colour+light. "
        "**Not reached.** Best weak-H/S frame (a0045) is ΔE 23.2 after H/S; "
        "legacy path was 31.9. The remaining ~20 ΔE is the proprietary ACR 4.4 "
        "HSB / Vibrance gap, reported not fitted away.\n"
    )
    (args.out / "summary.md").write_text(body, encoding="utf-8")
    print(table)


if __name__ == "__main__":
    main()
