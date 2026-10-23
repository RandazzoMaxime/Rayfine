#!/usr/bin/env python3
"""Compare Rayfine develops against public Lightroom exports.

Pipeline:
  1. Read crs:* from XMP (sidecar or embedded in the LR TIFF/JPEG).
  2. Map to Rayfine sliders (crs_map.py / MAPPING.md).
  3. Render the RAW with the legacy path (before) and the scene-linear path (after).
  4. Score vs the Lightroom JPEG/TIFF: ΔE2000 mean/p95, histogram L1, clip %,
     highlight/shadow MAE, SSIM.
  5. Write contact sheets and a before/after summary table.

Usage:
  python bench/lr-compare/compare_public_pairs.py --datasets bench/lr-compare/datasets --out bench/lr-compare/out/public
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from crs_map import map_xmp_path, mapping_to_json
from metrics import compare_srgb, nan_safe, prophoto_to_srgb

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
RAW_EXTS = {".dng", ".cr2", ".nef", ".arw", ".raf", ".orf", ".rw2", ".pef"}
REF_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png"}


def _find_pairs(datasets: Path) -> list[dict]:
    pairs = []
    if not datasets.exists():
        return pairs
    for meta_path in sorted(datasets.rglob("meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        folder = meta_path.parent
        raw = folder / meta.get("raw", "raw.dng")
        if not raw.exists():
            found = [p for p in folder.iterdir() if p.suffix.lower() in RAW_EXTS]
            raw = found[0] if found else raw
        xmp = folder / meta.get("xmp", "expert_c.xmp")
        if not xmp.exists():
            found = list(folder.glob("*.xmp"))
            xmp = found[0] if found else xmp
        ref = folder / meta.get("reference", "expert_c.tif")
        if not ref.exists():
            found = [p for p in folder.iterdir() if p.suffix.lower() in REF_EXTS and p.name != raw.name]
            ref = found[0] if found else ref
        if not (raw.exists() and xmp.exists() and ref.exists()):
            print(f"skip incomplete {folder}", file=sys.stderr)
            continue
        pairs.append(
            {
                "id": meta.get("id", folder.name),
                "split": meta.get("split", "train"),
                "source": meta.get("source", folder.parent.name),
                "license": meta.get("license", ""),
                "reference_space": meta.get("reference_space", ""),
                "folder": folder,
                "raw": raw,
                "xmp": xmp,
                "reference": ref,
                "meta": meta,
            }
        )
    return pairs


def _load_srgb(path: Path, long_edge: int, space: str) -> np.ndarray:
    img = Image.open(path)
    if img.mode not in {"RGB", "RGBA", "I;16", "I;16B"}:
        img = img.convert("RGB")
    if img.mode == "RGBA":
        img = img.convert("RGB")
    arr = np.asarray(img)
    if arr.dtype == np.uint16 or arr.max() > 255:
        arr_f = arr.astype(np.float64) / 65535.0
        if space == "prophoto16" or "prophoto" in space:
            arr_f = prophoto_to_srgb(arr_f if arr_f.ndim == 3 else np.stack([arr_f] * 3, axis=-1))
        else:
            arr_f = np.clip(arr_f, 0.0, 1.0)
    else:
        arr_f = arr.astype(np.float64) / 255.0
        if arr_f.ndim == 2:
            arr_f = np.stack([arr_f] * 3, axis=-1)
        if space == "prophoto16":
            arr_f = prophoto_to_srgb(arr_f)
    rgb = Image.fromarray(np.clip(arr_f * 255.0 + 0.5, 0, 255).astype(np.uint8), mode="RGB")
    w, h = rgb.size
    scale = long_edge / max(w, h)
    if scale < 1.0:
        rgb = rgb.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    return np.asarray(rgb).astype(np.float64) / 255.0


def _load_png_srgb(path: Path, size: tuple[int, int]) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if img.size != size:
        img = img.resize(size, Image.Resampling.LANCZOS)
    return np.asarray(img).astype(np.float64) / 255.0


def _run_rust(raw: Path, sliders: dict, out_dir: Path, long_edge: int) -> tuple[Path, Path]:
    sliders_path = out_dir / "sliders.json"
    sliders_path.write_text(json.dumps(sliders, indent=2) + "\n", encoding="utf-8")
    bin_name = "lr_public_compare"
    cargo = [
        "cargo",
        "run",
        "--quiet",
        "-p",
        "Rayfine",
        "--bin",
        bin_name,
        "--",
        "--raw",
        str(raw.resolve()),
        "--sliders",
        str(sliders_path.resolve()),
        "--out",
        str(out_dir.resolve()),
        "--long-edge",
        str(long_edge),
    ]
    print(" ".join(cargo))
    subprocess.run(cargo, cwd=str(REPO / "src-tauri"), check=True)
    return out_dir / "rayfine_before.png", out_dir / "rayfine_after.png"


def _font(size: int) -> ImageFont.ImageFont:
    for name in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8), mode="RGB")


def _banner(text: str, width: int, fill: tuple[int, int, int] = (28, 28, 32), height: int = 36) -> Image.Image:
    font = _font(15)
    bar = Image.new("RGB", (width, height), fill)
    draw = ImageDraw.Draw(bar)
    y = 8
    for line in text.split("\n"):
        draw.text((10, y), line, fill=(235, 235, 235), font=font)
        y += 18
    return bar


def _panel(title: str, arr: np.ndarray) -> Image.Image:
    img = _to_image(arr)
    return _stack_v([_banner(title, img.width), img])


def _stack_h(parts: list[Image.Image]) -> Image.Image:
    h = max(p.height for p in parts)
    w = sum(p.width for p in parts)
    out = Image.new("RGB", (w, h), (12, 12, 14))
    x = 0
    for part in parts:
        out.paste(part, (x, 0))
        x += part.width
    return out


def _stack_v(parts: list[Image.Image]) -> Image.Image:
    w = max(p.width for p in parts)
    h = sum(p.height for p in parts)
    out = Image.new("RGB", (w, h), (12, 12, 14))
    y = 0
    for part in parts:
        out.paste(part, (0, y))
        y += part.height
    return out


def _fmt(value: float | None, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    return f"{value:.{digits}f}"


def _contact_sheet(
    ident: str,
    sliders_banner: str,
    lr: np.ndarray,
    before: np.ndarray,
    after: np.ndarray,
    before_m,
    after_m,
    dest: Path,
) -> None:
    row = _stack_h(
        [
            _panel("Lightroom JPEG/TIFF", lr),
            _panel(f"Rayfine avant  dE={_fmt(before_m.de_mean)}", before),
            _panel(f"Rayfine apres  dE={_fmt(after_m.de_mean)}", after),
        ]
    )
    caption = (
        f"{ident}  {sliders_banner}\n"
        f"dE {_fmt(before_m.de_mean)}->{_fmt(after_m.de_mean)}  "
        f"p95 {_fmt(before_m.de_p95)}->{_fmt(after_m.de_p95)}  "
        f"SSIM {_fmt(before_m.ssim, 3)}->{_fmt(after_m.ssim, 3)}  "
        f"hiMAE {_fmt(before_m.highlight_mae, 3)}->{_fmt(after_m.highlight_mae, 3)}"
    )
    sheet = _stack_v([_banner(caption, row.width, (20, 32, 48), height=48), row])
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)


def _markdown_table(rows: list[dict]) -> str:
    header = (
        "| Split | Image | LR sliders | ΔE mean avant→après | ΔE p95 | SSIM | "
        "hi MAE | sh MAE | hist L1 | clip hi |\n"
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n"
    )
    lines = [header]
    for row in rows:
        b, a = row["before"], row["after"]
        lines.append(
            "| {split} | `{ident}` | {banner} | {de0} → **{de1}** | {p0} → {p1} | "
            "{s0} → {s1} | {h0} → {h1} | {sh0} → {sh1} | {hist0} → {hist1} | {c0} → {c1} |\n".format(
                split=row["split"],
                ident=row["id"],
                banner=row["banner"],
                de0=_fmt(b["de_mean"]),
                de1=_fmt(a["de_mean"]),
                p0=_fmt(b["de_p95"]),
                p1=_fmt(a["de_p95"]),
                s0=_fmt(b["ssim"], 3),
                s1=_fmt(a["ssim"], 3),
                h0=_fmt(b["highlight_mae"], 3),
                h1=_fmt(a["highlight_mae"], 3),
                sh0=_fmt(b["shadow_mae"], 3),
                sh1=_fmt(a["shadow_mae"], 3),
                hist0=_fmt(b["hist_l1"]["mean"], 3),
                hist1=_fmt(a["hist_l1"]["mean"], 3),
                c0=_fmt(b["clip_pred"]["hi"] * 100.0, 1) + "%",
                c1=_fmt(a["clip_pred"]["hi"] * 100.0, 1) + "%",
            )
        )
    return "".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Rayfine vs public Lightroom exports.")
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "public")
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
        print(f"== {pair['id']} {mapped.banner()}")
        if args.skip_render and (work / "rayfine_before.png").exists():
            before_png = work / "rayfine_before.png"
            after_png = work / "rayfine_after.png"
        else:
            before_png, after_png = _run_rust(pair["raw"], mapped.sliders_json(), work, args.long_edge)
        lr = _load_srgb(pair["reference"], args.long_edge, pair["reference_space"])
        size = (lr.shape[1], lr.shape[0])
        before = _load_png_srgb(before_png, size)
        after = _load_png_srgb(after_png, size)
        before_m = compare_srgb(before, lr)
        after_m = compare_srgb(after, lr)
        _contact_sheet(
            pair["id"],
            mapped.banner(),
            lr,
            before,
            after,
            before_m,
            after_m,
            args.out / "sheets" / f"{pair['id']}.png",
        )
        row = {
            "id": pair["id"],
            "split": pair["split"],
            "source": pair["source"],
            "license": pair["license"],
            "banner": mapped.banner(),
            "sliders": mapped.sliders_json(),
            "limits": mapped.limits,
            "before": before_m.as_dict(),
            "after": after_m.as_dict(),
            "de_mean_delta": nan_safe(before_m.de_mean - after_m.de_mean),
            "highlight_mae_delta": nan_safe(
                (before_m.highlight_mae if not math.isnan(before_m.highlight_mae) else 0.0)
                - (after_m.highlight_mae if not math.isnan(after_m.highlight_mae) else 0.0)
            ),
        }
        (work / "metrics.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        summary.append(row)
        print(
            f"   dE {before_m.de_mean:.2f}->{after_m.de_mean:.2f}  "
            f"hi {before_m.highlight_mae} -> {after_m.highlight_mae}"
        )
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    table = _markdown_table(summary)
    (args.out / "summary.md").write_text(
        "# Lightroom public-pair comparison\n\n"
        "RAW+XMP → Lightroom export vs Rayfine avant (legacy) / après (scene-linear).\n"
        "Hold-out rows use `split=val`. Datasets are not in git.\n\n"
        + table
        + "\n",
        encoding="utf-8",
    )
    print(table)


if __name__ == "__main__":
    main()
