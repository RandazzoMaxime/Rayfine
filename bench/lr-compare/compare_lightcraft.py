#!/usr/bin/env python3
"""LightCraft vs Lightroom vs Rayfine on Imaging Resource triples.

1. Map `crs:` XMP → LightCraft DevelopSettings JSON (`crs_map.lightcraft_json`).
2. Render with `lightcraft-cli render` (never the AlreadyApplied JPEG sidecar).
3. Render Rayfine Adobe path (or reuse an existing `adobe_hs.png`).
4. Geometrically align both develops onto the LR JPEG, then score ~512 + blur.

Usage:
  python bench/lr-compare/compare_lightcraft.py \\
    --datasets bench/lr-compare/datasets/ir --out bench/lr-compare/out/lc-vs-lr
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from align import align_pair
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
from metrics import (
    compare_srgb,
    de_heatmap_srgb,
    delta_e_map,
    nan_safe,
    robust_compare,
    sky_lab_stats,
    zone_delta_e,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
DE_SCALE = 20.0
DEFAULT_DCP_DIR = ROOT / "datasets" / "dcp"
DEFAULT_LOOK_DIR = ROOT / "datasets" / "looks"
DEFAULT_LC = Path(os.environ.get("LIGHTCRAFT_CLI", "/tmp/lightcraft/target/release/lightcraft-cli"))
LC_SRC = Path(os.environ.get("LIGHTCRAFT_SRC", "/tmp/lightcraft"))


def _fmt(value: float | None, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    return f"{value:.{digits}f}"


def _banner(text: str, width: int, fill: tuple[int, int, int] = (28, 28, 32), height: int = 56) -> Image.Image:
    font = _font(12)
    bar = Image.new("RGB", (width, height), fill)
    draw = ImageDraw.Draw(bar)
    y = 4
    for line in text.replace("\r", " ").split("\n"):
        line = " ".join(line.split())
        while len(line) > 92:
            draw.text((6, y), line[:92], fill=(235, 235, 235), font=font)
            y += 14
            line = line[92:]
            if y > height - 14:
                return bar
        if line:
            draw.text((6, y), line, fill=(235, 235, 235), font=font)
            y += 14
        if y > height - 14:
            break
    return bar


def _panel(title: str, arr: np.ndarray, extra: str = "") -> Image.Image:
    img = _to_image(arr)
    text = title if not extra else f"{title}\n{extra}"
    return _stack_v([_banner(text, img.width, height=56 if extra else 36), img])


def _colorbar(height: int, scale: float = DE_SCALE) -> Image.Image:
    width = 28
    ramp = np.linspace(scale, 0.0, height, dtype=np.float64)
    de = np.repeat(ramp[:, None], width, axis=1)
    img = _to_image(de_heatmap_srgb(de, scale))
    draw = ImageDraw.Draw(img)
    font = _font(10)
    draw.text((2, 2), f"{scale:.0f}", fill=(255, 255, 255), font=font)
    draw.text((2, height // 2 - 6), f"{scale / 2:.0f}", fill=(0, 0, 0), font=font)
    draw.text((2, height - 14), "0", fill=(255, 255, 255), font=font)
    return img


def _lc_version(cli: Path) -> dict[str, str]:
    info = {"cli": str(cli), "version": "unknown", "commit": "unknown", "src": str(LC_SRC)}
    if cli.is_file():
        try:
            out = subprocess.run([str(cli), "--version"], check=True, capture_output=True, text=True)
            info["version"] = out.stdout.strip() or out.stderr.strip()
        except (OSError, subprocess.CalledProcessError) as exc:
            info["version"] = f"error: {exc}"
    if (LC_SRC / ".git").exists():
        try:
            out = subprocess.run(
                ["git", "-C", str(LC_SRC), "rev-parse", "--short=9", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            )
            info["commit"] = out.stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            pass
    return info


def _render_rayfine(
    raw: Path,
    sliders: dict,
    out_dir: Path,
    long_edge: int,
    dcp_dir: Path | None,
    look_dir: Path | None,
    path: str = "lightcraft",
) -> None:
    sliders_path = out_dir / f"{path}_sliders.json"
    sliders_path.write_text(json.dumps(sliders, indent=2) + "\n", encoding="utf-8")
    binary = REPO / "src-tauri" / "target" / "release" / "lr_public_compare"
    dest = out_dir / ("lightcraft_hs.png" if path.startswith("lightcraft") else "adobe_hs.png")
    if binary.is_file():
        cmd = [
            str(binary),
            "--raw",
            str(raw.resolve()),
            "--sliders",
            str(sliders_path.resolve()),
            "--out",
            str(out_dir.resolve()),
            "--long-edge",
            str(long_edge),
            "--path",
            path,
            "--stage",
            "all",
        ]
    else:
        cmd = [
            "cargo",
            "run",
            "--quiet",
            "--release",
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
            path,
            "--stage",
            "all",
        ]
    if dcp_dir is not None and dcp_dir.is_dir():
        cmd.extend(["--dcp-dir", str(dcp_dir.resolve())])
    if look_dir is not None and look_dir.is_dir():
        cmd.extend(["--look-dir", str(look_dir.resolve())])
    print(" ".join(cmd))
    subprocess.run(cmd, cwd=str(REPO / "src-tauri"), check=True)
    if path.startswith("lightcraft") and dest.is_file():
        # Keep a stable name for the ported path.
        (out_dir / "rayfine_lc.png").write_bytes(dest.read_bytes())


def _render_lightcraft(cli: Path, raw: Path, settings: dict, dest: Path, long_edge: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    settings_path = dest.with_suffix(".json")
    settings_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    cmd = [
        str(cli),
        "render",
        str(raw.resolve()),
        "-o",
        str(dest.resolve()),
        "--settings",
        str(settings_path.resolve()),
        "--size",
        str(long_edge),
        "--quality",
        "92",
        "--opt",
        "colorSpace=srgb",
    ]
    print(" ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    log = dest.with_suffix(".log")
    log.write_text((result.stdout or "") + "\n" + (result.stderr or ""), encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(
            f"lightcraft-cli failed ({result.returncode}) for {raw.name}:\n"
            f"{(result.stderr or result.stdout or '').strip()}"
        )


def _score(pred: np.ndarray, ref: np.ndarray) -> dict:
    full = compare_srgb(pred, ref)
    payload = full.as_dict()
    payload["zones"] = zone_delta_e(pred, ref)
    payload["robust"] = robust_compare(pred, ref)
    payload["ev_median"] = nan_safe((payload["robust"] or {}).get("ev_median"))
    return payload


def _sheet(
    ident: str,
    banner: str,
    lc_line: str,
    rf_line: str,
    lr: np.ndarray,
    lc: np.ndarray,
    rf: np.ndarray,
    lc_m: dict,
    rf_m: dict,
    dest: Path,
    notes: str,
    rf_old: np.ndarray | None = None,
    rf_old_m: dict | None = None,
    rf_old_line: str = "",
) -> None:
    heat_lc = de_heatmap_srgb(delta_e_map(lc, lr), DE_SCALE)
    heat_rf = de_heatmap_srgb(delta_e_map(rf, lr), DE_SCALE)
    panels = [
        _panel("Lightroom JPEG  sRGB IEC61966-2.1  Adobe Standard + Landscape", lr, banner),
        _panel("LightCraft", lc, lc_line),
        _panel("Rayfine (porté LC)", rf, rf_line),
    ]
    if rf_old is not None:
        panels.append(_panel("Rayfine (ancien)", rf_old, rf_old_line))
    top = _stack_h(panels)
    heat_panels = [
        _panel("ΔE LightCraft vs LR", heat_lc, f"plein {_fmt(lc_m.get('de_mean'))}  réduit {_fmt((lc_m.get('robust') or {}).get('de_mean'))}"),
        _panel("ΔE Rayfine porté vs LR", heat_rf, f"plein {_fmt(rf_m.get('de_mean'))}  réduit {_fmt((rf_m.get('robust') or {}).get('de_mean'))}"),
    ]
    if rf_old is not None:
        heat_old = de_heatmap_srgb(delta_e_map(rf_old, lr), DE_SCALE)
        heat_panels.append(
            _panel(
                "ΔE Rayfine ancien vs LR",
                heat_old,
                f"plein {_fmt((rf_old_m or {}).get('de_mean'))}  réduit {_fmt(((rf_old_m or {}).get('robust') or {}).get('de_mean'))}",
            )
        )
    heat_panels.append(_colorbar(heat_lc.shape[0] + 56))
    heat_row = _stack_h(heat_panels)
    def _z(m: dict, key: str) -> str:
        return _fmt(((m.get("robust") or {}).get("zones") or {}).get(key))

    caption = (
        f"{ident}  {banner}\n"
        f"LC  ΔE réduit {_fmt((lc_m.get('robust') or {}).get('de_mean'))}  "
        f"ciel {_z(lc_m, 'sky')}  hor {_z(lc_m, 'horizon')}  mil {_z(lc_m, 'mids')}  "
        f"omb {_z(lc_m, 'shadows')}  ΔEV {_fmt(lc_m.get('ev_median'), 3)}\n"
        f"RF  ΔE réduit {_fmt((rf_m.get('robust') or {}).get('de_mean'))}  "
        f"ciel {_z(rf_m, 'sky')}  hor {_z(rf_m, 'horizon')}  mil {_z(rf_m, 'mids')}  "
        f"omb {_z(rf_m, 'shadows')}  ΔEV {_fmt(rf_m.get('ev_median'), 3)}\n"
        f"{notes}"
    )
    sheet = _stack_v([_banner(caption, top.width, (20, 32, 48), height=96), top, heat_row])
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)


def _mean(rows: list[dict], engine: str, *keys: str) -> float | None:
    vals = []
    for row in rows:
        cur: object = (row.get("engines") or {}).get(engine) or {}
        for key in keys:
            if not isinstance(cur, dict):
                cur = None
                break
            cur = cur.get(key)
        if isinstance(cur, (int, float)) and not (math.isnan(cur) or math.isinf(cur)):
            vals.append(float(cur))
    if not vals:
        return None
    return sum(vals) / len(vals)


def _table(rows: list[dict]) -> str:
    header = (
        "| Split | Image | LC ΔE | RF porté ΔE | RF ancien ΔE | LC ciel | RF ciel | "
        "LC ΔEV | RF porté ΔEV | RF ancien ΔEV |\n"
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n"
    )
    lines = [header]
    for row in rows:
        lc = row["engines"]["lightcraft"]
        rf = row["engines"]["rayfine"]
        old = row["engines"].get("rayfine_old") or {}
        lcz = (lc.get("robust") or {}).get("zones") or {}
        rfz = (rf.get("robust") or {}).get("zones") or {}
        lines.append(
            "| {split} | `{ident}` | {lc} | {rf} | {old} | {lcs} | {rfs} | "
            "{lce} | {rfe} | {olde} |\n".format(
                split=row["split"],
                ident=row["id"],
                lc=_fmt((lc.get("robust") or {}).get("de_mean")),
                rf=_fmt((rf.get("robust") or {}).get("de_mean")),
                old=_fmt((old.get("robust") or {}).get("de_mean")),
                lcs=_fmt(lcz.get("sky")),
                rfs=_fmt(rfz.get("sky")),
                lce=_fmt(lc.get("ev_median"), 3),
                rfe=_fmt(rf.get("ev_median"), 3),
                olde=_fmt(old.get("ev_median"), 3),
            )
        )
    return "".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="LightCraft vs Lightroom vs Rayfine.")
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets" / "ir")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "lc-vs-lr")
    parser.add_argument("--long-edge", type=int, default=1280)
    parser.add_argument("--lightcraft-cli", type=Path, default=DEFAULT_LC)
    parser.add_argument("--dcp-dir", type=Path, default=DEFAULT_DCP_DIR)
    parser.add_argument("--look-dir", type=Path, default=DEFAULT_LOOK_DIR)
    parser.add_argument("--skip-lc-render", action="store_true")
    parser.add_argument("--skip-rayfine-render", action="store_true")
    parser.add_argument("--force-old", action="store_true", help="re-render the Adobe/old Rayfine path")
    parser.add_argument("--only", action="append", default=[])
    args = parser.parse_args()
    pairs = [p for p in _find_pairs(args.datasets) if p.get("source") != "fivek"]
    pairs.sort(key=lambda p: (0 if p["split"] == "train" else 1, p["id"]))
    if args.only:
        wanted = set(args.only)
        pairs = [p for p in pairs if p["id"] in wanted]
    if not pairs:
        raise SystemExit(f"no complete pairs under {args.datasets}")
    args.out.mkdir(parents=True, exist_ok=True)
    lc_info = _lc_version(args.lightcraft_cli)
    (args.out / "lightcraft_version.json").write_text(json.dumps(lc_info, indent=2) + "\n", encoding="utf-8")
    errors: list[dict] = []
    summary: list[dict] = []
    for pair in pairs:
        work = args.out / pair["id"]
        work.mkdir(parents=True, exist_ok=True)
        mapped = map_xmp_path(pair["xmp"])
        mapping = mapping_to_json(mapped)
        (work / "mapping.json").write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")
        lc_settings = mapped.lightcraft_json()
        (work / "lightcraft_settings.json").write_text(json.dumps(lc_settings, indent=2) + "\n", encoding="utf-8")
        print(f"== {pair['id']} {mapped.banner()}")
        lc_jpg = work / "lightcraft.jpg"
        try:
            if not (args.skip_lc_render and lc_jpg.exists()):
                if not args.lightcraft_cli.is_file():
                    raise FileNotFoundError(f"lightcraft-cli not found: {args.lightcraft_cli}")
                _render_lightcraft(args.lightcraft_cli, pair["raw"], lc_settings, lc_jpg, args.long_edge)
        except Exception as exc:
            errors.append({"id": pair["id"], "engine": "lightcraft", "error": str(exc)})
            (work / "lightcraft_error.txt").write_text(str(exc) + "\n", encoding="utf-8")
            print(f"   LightCraft FAILED: {exc}")
            continue
        rf_png = work / "rayfine_lc.png"
        rf_old_png = work / "adobe_hs.png"
        if not (args.skip_rayfine_render and rf_png.exists()):
            _render_rayfine(
                pair["raw"], mapped.adobe_json(), work, args.long_edge, args.dcp_dir, args.look_dir, "lightcraft"
            )
        # The Adobe/old path is unchanged by the LightCraft port; reuse it.
        if not rf_old_png.exists() or args.force_old:
            _render_rayfine(
                pair["raw"], mapped.adobe_json(), work, args.long_edge, args.dcp_dir, args.look_dir, "adobe"
            )
        lr_full = _load_srgb(pair["reference"], args.long_edge, pair["reference_space"])
        lc_raw = _load_png_srgb(lc_jpg, None)
        rf_raw = _load_png_srgb(rf_png if rf_png.exists() else work / "lightcraft_hs.png", None)
        rf_old_raw = _load_png_srgb(rf_old_png, None) if rf_old_png.exists() else None
        lc_img, lr_lc, lc_align = align_pair(lc_raw, lr_full)
        rf_img, lr_rf, rf_align = align_pair(rf_raw, lr_lc if lr_lc.shape == lr_full.shape else lr_full)
        rf_old_img = None
        rf_old_align = None
        lr_old = lr_rf
        if rf_old_raw is not None:
            rf_old_img, lr_old, rf_old_align = align_pair(rf_old_raw, lr_rf)
        h = min(lr_lc.shape[0], lr_rf.shape[0], lc_img.shape[0], rf_img.shape[0])
        w = min(lr_lc.shape[1], lr_rf.shape[1], lc_img.shape[1], rf_img.shape[1])
        if rf_old_img is not None:
            h = min(h, rf_old_img.shape[0], lr_old.shape[0])
            w = min(w, rf_old_img.shape[1], lr_old.shape[1])
        lr = lr_lc[:h, :w]
        lc_img = lc_img[:h, :w]
        rf_img = rf_img[:h, :w]
        if rf_old_img is not None:
            rf_old_img = rf_old_img[:h, :w]
        lc_m = _score(lc_img, lr)
        rf_m = _score(rf_img, lr)
        rf_old_m = _score(rf_old_img, lr) if rf_old_img is not None else None
        lc_m["align"] = lc_align.as_dict()
        rf_m["align"] = rf_align.as_dict()
        if rf_old_m is not None and rf_old_align is not None:
            rf_old_m["align"] = rf_old_align.as_dict()
        profile_name = "rawler"
        notes_path = work / "adobe_profile.json"
        if notes_path.exists():
            profile = json.loads(notes_path.read_text(encoding="utf-8"))
            profile_name = str(profile.get("profile_name") or profile.get("dcp_source") or profile_name)
        tone_name = "Hdr"
        lc_notes = work / "lightcraft_profile.json"
        if lc_notes.exists():
            tone_name = str(json.loads(lc_notes.read_text(encoding="utf-8")).get("tone") or tone_name)
        lc_line = (
            f"{lc_info['version']}  {lc_info['commit']}  process V2  "
            f"profil {lc_settings['profile']['id']}  "
            f"WB {lc_settings['wb']['mode']}  "
            f"E {lc_settings['light']['exposure']:+.2f}  "
            f"H {lc_settings['light']['highlights']:+.0f}  "
            f"S {lc_settings['light']['shadows']:+.0f}  "
            f"sRGB"
        )
        rf_line = (
            f"Rayfine porté LC  tone {tone_name}  "
            f"WB {mapped.white_balance}  E {mapped.raw_exposure():+.2f}  sRGB"
        )
        rf_old_line = (
            f"Rayfine ancien Adobe  {profile_name}  Look {mapped.look_name or '-'}  "
            f"E {mapped.raw_exposure():+.2f}  sRGB"
        )
        notes = (
            f"LC {lc_info['version']} commit {lc_info['commit']}  "
            f"Rayfine porte lightcraft-gpu/pipeline (WB, expo, base_tone/camera_tone, H/S, vib)  "
            f"export sRGB  align {lc_align.method}/{rf_align.method}  "
            f"DCP optionnel couleur seule (off sur le porté)"
        )
        _sheet(
            pair["id"],
            mapped.banner(),
            lc_line,
            rf_line,
            lr,
            lc_img,
            rf_img,
            lc_m,
            rf_m,
            args.out / "sheets" / f"{pair['id']}.png",
            notes,
            rf_old=rf_old_img,
            rf_old_m=rf_old_m,
            rf_old_line=rf_old_line,
        )
        artifacts = Path("/opt/cursor/artifacts/lr-compare/lc-vs-lr/sheets")
        artifacts.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.out / "sheets" / f"{pair['id']}.png", artifacts / f"{pair['id']}.png")
        sky = None
        if pair["id"] == "z6ii-0086":
            sky = {
                "lr": sky_lab_stats(lr),
                "lightcraft": sky_lab_stats(lc_img),
                "rayfine": sky_lab_stats(rf_img),
            }
        row = {
            "id": pair["id"],
            "split": pair["split"],
            "banner": mapped.banner(),
            "lightcraft_settings": lc_settings,
            "lightcraft_profile": lc_settings["profile"]["id"],
            "rayfine_profile": profile_name,
            "look_name": mapped.look_name,
            "engines": {
                "lightcraft": lc_m,
                "rayfine": rf_m,
                "rayfine_old": rf_old_m,
            },
            "sky": sky,
        }
        (work / "compare.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        summary.append(row)
        print(
            f"   LC dE {_fmt((lc_m.get('robust') or {}).get('de_mean'))}  "
            f"RF dE {_fmt((rf_m.get('robust') or {}).get('de_mean'))}  "
            f"align {lc_align.method}/{rf_align.method}"
        )
    (args.out / "summary.json").write_text(
        json.dumps({"lightcraft": lc_info, "rows": summary, "errors": errors}, indent=2) + "\n",
        encoding="utf-8",
    )
    train = [r for r in summary if r["split"] == "train"]
    val = [r for r in summary if r["split"] == "val"]
    body = (
        "# LightCraft vs Lightroom vs Rayfine\n\n"
        f"LightCraft `{lc_info['version']}` commit `{lc_info['commit']}` "
        f"(`{lc_info['src']}`). Export `colorSpace=srgb`. Process V2. "
        "Profil créatif `lc.color` — Adobe Landscape HSV LookTable n’a pas d’équivalent "
        "(le look `lc.landscape` est une autre recette de curseurs, non empilée).\n\n"
        "Alignement géométrique (ORB + homographie + ECC) sur le JPEG LR, puis "
        "ΔE2000 ~512 px + flou, zones ciel / horizon / milieux / ombres, ΔEV médian.\n\n"
        + _table(summary)
        + "\n### Moyennes (ΔE réduit)\n\n"
        f"- Train LC / RF porté / RF ancien : {_fmt(_mean(train, 'lightcraft', 'robust', 'de_mean'))} / "
        f"{_fmt(_mean(train, 'rayfine', 'robust', 'de_mean'))} / "
        f"{_fmt(_mean(train, 'rayfine_old', 'robust', 'de_mean'))}\n"
        f"- Val LC / RF porté / RF ancien : {_fmt(_mean(val, 'lightcraft', 'robust', 'de_mean'))} / "
        f"{_fmt(_mean(val, 'rayfine', 'robust', 'de_mean'))} / "
        f"{_fmt(_mean(val, 'rayfine_old', 'robust', 'de_mean'))}\n"
        f"- Train LC / RF ciel : {_fmt(_mean(train, 'lightcraft', 'robust', 'zones', 'sky'))} / "
        f"{_fmt(_mean(train, 'rayfine', 'robust', 'zones', 'sky'))}\n"
        f"- Train LC / RF horizon : {_fmt(_mean(train, 'lightcraft', 'robust', 'zones', 'horizon'))} / "
        f"{_fmt(_mean(train, 'rayfine', 'robust', 'zones', 'horizon'))}\n"
        f"- Train LC / RF ΔEV : {_fmt(_mean(train, 'lightcraft', 'ev_median'), 3)} / "
        f"{_fmt(_mean(train, 'rayfine', 'ev_median'), 3)}\n"
    )
    if errors:
        body += "\n## Erreurs LightCraft\n\n"
        for err in errors:
            body += f"- `{err['id']}`: `{err['error'].splitlines()[0]}`\n"
    (args.out / "summary.md").write_text(body, encoding="utf-8")
    artifacts = Path("/opt/cursor/artifacts/lr-compare/lc-vs-lr")
    artifacts.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.out / "summary.md", artifacts / "summary.md")
    print(body)
    if errors and not summary:
        raise SystemExit("LightCraft failed on every image")


if __name__ == "__main__":
    main()
