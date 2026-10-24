#!/usr/bin/env python3
"""Ablation: match Lightroom colour + light before judging H/S.

Stages (each includes the previous):
  wb        Temperature/Tint (or As Shot) only — camera RGB, no matrix
  profile   + ColorMatrix/ForwardMatrix + HueSatMap + Look + ProfileToneCurve (BE skipped)
  exposure  + BaselineExposure + Exposure
  curve     + named ToneCurve / Contrast / parametric / ToneCurvePV2012
  color     + HSL + Calibration + Vibrance/Saturation
  hs        + Dehaze / Clarity / Texture + Highlights/Shadows/Whites/Blacks

Profile-layer ablation (DNG ch. 6 / LightCraft order):
  matrix, huesat, baseline, look, tone, sliders

Usage:
  python bench/lr-compare/compare_adobe_match.py \\
    --datasets bench/lr-compare/datasets/ir --out bench/lr-compare/out/adobe
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
    _align_pred_to_ref,
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
    luma,
    nan_safe,
    robust_compare,
    sky_lab_stats,
    zone_delta_e,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
STAGES = ("wb", "profile", "exposure", "curve", "color", "hs")
PROFILE_LAYERS = ("matrix", "huesat", "baseline", "look", "tone", "sliders")
DE_SCALE = 20.0
DEFAULT_DCP_DIR = ROOT / "datasets" / "dcp"
DEFAULT_LOOK_DIR = ROOT / "datasets" / "looks"


def _fmt(value: float | None, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
        return "—"
    return f"{value:.{digits}f}"


def _run_adobe(
    raw: Path,
    sliders: dict,
    out_dir: Path,
    long_edge: int,
    dcp_dir: Path | None,
    look_dir: Path | None = None,
) -> None:
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
    if dcp_dir is not None and dcp_dir.is_dir():
        cargo.extend(["--dcp-dir", str(dcp_dir.resolve())])
    if look_dir is not None and look_dir.is_dir():
        cargo.extend(["--look-dir", str(look_dir.resolve())])
    print(" ".join(cargo))
    subprocess.run(cargo, cwd=str(REPO / "src-tauri"), check=True)


def _banner(text: str, width: int, fill: tuple[int, int, int] = (28, 28, 32), height: int = 52) -> Image.Image:
    font = _font(13)
    bar = Image.new("RGB", (width, height), fill)
    draw = ImageDraw.Draw(bar)
    y = 4
    cleaned = text.replace("\r", " ")
    wrapped: list[str] = []
    for line in cleaned.split("\n"):
        line = " ".join(line.split())
        while len(line) > 140:
            wrapped.append(line[:140])
            line = line[140:]
        if line:
            wrapped.append(line)
    for line in wrapped:
        try:
            draw.text((8, y), line, fill=(235, 235, 235), font=font)
        except Exception:
            draw.text((8, y), line.encode("ascii", "replace").decode("ascii"), fill=(235, 235, 235), font=font)
        y += 16
        if y > height - 14:
            break
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
    zones: dict | None = None,
    robust: dict | None = None,
    look_name: str | None = None,
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
    zone_txt = ""
    if zones:
        zone_txt = (
            f"  zones ciel {_fmt(zones.get('sky'))}  "
            f"mil {_fmt(zones.get('mids'))}  omb {_fmt(zones.get('shadows'))}"
        )
    robust_txt = ""
    if robust:
        rz = robust.get("zones") or {}
        robust_txt = (
            f"  réduit ΔE {_fmt(robust.get('de_mean'))}  "
            f"ciel {_fmt(rz.get('sky'))} mil {_fmt(rz.get('mids'))} omb {_fmt(rz.get('shadows'))}"
        )
    look_txt = f"  look={look_name}" if look_name else ""
    caption = (
        f"{ident}  stage={stage}  {banner}{look_txt}\n"
        f"ΔE mean {_fmt(metrics.de_mean)}  p95 {_fmt(metrics.de_p95)}  "
        f"mid {_fmt(_mid_de(pred, lr))}  SSIM {_fmt(metrics.ssim, 3)}  "
        f"histL {_fmt(_luma_hist_l1(pred, lr), 3)}  "
        f"hiMAE {_fmt(metrics.highlight_mae, 3)}  shMAE {_fmt(metrics.shadow_mae, 3)}  "
        f"clip hi {_fmt(metrics.clip_pred['hi'] * 100.0, 1)}%/{_fmt(metrics.clip_ref['hi'] * 100.0, 1)}%"
        f"{zone_txt}{robust_txt}\n"
        f"{notes}"
    )
    sheet = _stack_v([_banner(caption, row.width, (20, 32, 48), height=88), row])
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)


def _layer_table(rows: list[dict]) -> str:
    header = (
        "| Split | Image | matrice | +HueSatMap | +BaselineExposure | +LookTable | "
        "+ProfileToneCurve | +curseurs | profil |\n"
        "|---|---|---:|---:|---:|---:|---:|---:|:---|\n"
    )
    lines = [header]
    for row in rows:
        st = row["stages"]
        lines.append(
            "| {split} | `{ident}` | {m} | {h} | {b} | {l} | {t} | {s} | {prof} |\n".format(
                split=row["split"],
                ident=row["id"],
                m=_fmt((st.get("matrix") or {}).get("de_mean")),
                h=_fmt((st.get("huesat") or {}).get("de_mean")),
                b=_fmt((st.get("baseline") or {}).get("de_mean")),
                l=_fmt((st.get("look") or {}).get("de_mean")),
                t=_fmt((st.get("tone") or {}).get("de_mean")),
                s=_fmt((st.get("sliders") or st.get("hs") or {}).get("de_mean")),
                prof=row.get("profile_name") or "rawler",
            )
        )
    return "".join(lines)


def _ablation_table(rows: list[dict]) -> str:
    header = (
        "| Split | Image | WB | +profil | +expo | +courbe | +couleur | +H/S | "
        "ΔE mid couleur | hist L couleur | H/S forts |\n"
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:---|\n"
    )
    lines = [header]
    for row in rows:
        st = row["stages"]
        color = st.get("color") or st.get("curve") or {}
        lines.append(
            "| {split} | `{ident}` | {wb} | {pr} | {ex} | {cu} | {co} | {hs} | {mid} | {hist} | {strong} |\n".format(
                split=row["split"],
                ident=row["id"],
                wb=_fmt(st["wb"]["de_mean"]),
                pr=_fmt(st["profile"]["de_mean"]),
                ex=_fmt(st["exposure"]["de_mean"]),
                cu=_fmt(st["curve"]["de_mean"]),
                co=_fmt(color.get("de_mean")),
                hs=_fmt(st["hs"]["de_mean"]),
                mid=_fmt(color.get("de_mid")),
                hist=_fmt(color.get("hist_luma"), 3),
                strong="oui" if row["strong_hs"] else "non",
            )
        )
    return "".join(lines)


def _strong_hs(mapped) -> bool:
    return abs(mapped.highlights) >= 40 or abs(mapped.shadows) >= 20 or abs(mapped.blacks) >= 30


def main() -> None:
    parser = argparse.ArgumentParser(description="Adobe-match ablation vs Lightroom exports.")
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets" / "ir")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "adobe")
    parser.add_argument("--long-edge", type=int, default=640)
    parser.add_argument("--skip-render", action="store_true")
    parser.add_argument("--dcp-dir", type=Path, default=DEFAULT_DCP_DIR)
    parser.add_argument("--look-dir", type=Path, default=DEFAULT_LOOK_DIR)
    args = parser.parse_args()
    pairs = [p for p in _find_pairs(args.datasets) if p.get("source") != "fivek"]
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
            _run_adobe(pair["raw"], adobe, work, args.long_edge, args.dcp_dir, args.look_dir)
        lr = _load_srgb(pair["reference"], args.long_edge, pair["reference_space"])
        profile_notes = []
        profile_name = "rawler ColorMatrix"
        notes_path = work / "adobe_profile.json"
        if notes_path.exists():
            profile = json.loads(notes_path.read_text(encoding="utf-8"))
            profile_notes = list(profile.get("notes") or [])
            if profile.get("profile_name"):
                profile_name = str(profile["profile_name"])
            elif profile.get("dcp_source"):
                profile_name = str(profile["dcp_source"])
            if not profile.get("has_forward"):
                profile_notes.append("No ForwardMatrix — inverse ColorMatrix + Bradford CAT.")
            if not profile.get("has_look"):
                profile_notes.append("No ProfileLookTable.")
            if profile.get("has_hue_sat_map"):
                profile_notes.append(f"HueSatMap {profile.get('hue_sat_dims')}")
            if profile.get("look_name") or profile.get("look_uuid"):
                profile_notes.append(
                    f"Look {profile.get('look_name') or mapped.look_name} "
                    f"uuid={(profile.get('look_uuid') or '')[:16]} "
                    f"dims={profile.get('look_dims')}"
                )
            if profile.get("has_rgb_lut"):
                profile_notes.append(
                    f"RGBTable {profile.get('rgb_lut_div')}³ "
                    f"γ={profile.get('rgb_gamma')} prim={profile.get('rgb_primaries')}"
                )
            if profile.get("tone_curve_knots"):
                profile_notes.append(f"ProfileToneCurve {profile.get('tone_curve_knots')} knots")
            be = profile.get("baseline_exposure")
            if be:
                profile_notes.append(f"BaselineExposure {be}")
        provenance = (
            f"{pair['source']}  license={pair['license']}  profile={profile_name}  "
            f"{pair['meta'].get('page') or pair['meta'].get('jpeg_url') or ''}"
        )
        notes = " | ".join([provenance] + profile_notes + mapped.limits[:4])
        notes = " ".join(notes.replace("\r", " ").split())
        stage_metrics: dict[str, dict] = {}
        for stage in (*STAGES, *PROFILE_LAYERS):
            png = work / f"adobe_{stage}.png"
            pred = _align_pred_to_ref(_load_png_srgb(png, None), lr)
            m = compare_srgb(pred, lr)
            payload = m.as_dict()
            payload["de_mid"] = nan_safe(_mid_de(pred, lr))
            payload["hist_luma"] = nan_safe(_luma_hist_l1(pred, lr))
            payload["zones"] = zone_delta_e(pred, lr)
            payload["robust"] = robust_compare(pred, lr)
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
                zones=payload["zones"],
                robust=payload["robust"],
                look_name=mapped.look_name or profile_name,
            )
            print(
                f"   {stage:8}  dE {m.de_mean:.2f}  mid {payload['de_mid']}  "
                f"histL {payload['hist_luma']}  "
                f"rob {payload['robust']['de_mean']:.2f}  "
                f"ciel {payload['robust']['zones'].get('sky')}"
            )
        sky = None
        if pair["id"] == "z6ii-0086":
            hs_pred = _align_pred_to_ref(_load_png_srgb(work / "adobe_hs.png", None), lr)
            color_pred = _align_pred_to_ref(_load_png_srgb(work / "adobe_color.png", None), lr)
            sky = {
                "lr": sky_lab_stats(lr),
                "rayfine_color": sky_lab_stats(color_pred),
                "rayfine_hs": sky_lab_stats(hs_pred),
                "zones_hs": stage_metrics["hs"]["zones"],
                "robust_hs": stage_metrics["hs"]["robust"],
            }
            print(
                "   z6ii sky Lab LR={lr}  color={c}  hs={h}".format(
                    lr=sky["lr"], c=sky["rayfine_color"], h=sky["rayfine_hs"]
                )
            )
        row = {
            "id": pair["id"],
            "split": pair["split"],
            "source": pair["source"],
            "license": pair["license"],
            "page": pair["meta"].get("page"),
            "banner": mapped.banner(),
            "adobe": adobe,
            "strong_hs": _strong_hs(mapped),
            "notes": profile_notes,
            "profile_name": profile_name,
            "look_name": mapped.look_name,
            "nr": {
                "color": mapped.color_nr,
                "luminance": mapped.luma_nr,
                "sharpness": mapped.sharpness,
            },
            "sky": sky,
            "stages": stage_metrics,
        }
        (work / "adobe_metrics.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        summary.append(row)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    table = _ablation_table(summary)
    layers = _layer_table(summary)
    weak = [r for r in summary if not r["strong_hs"]]
    val = [r for r in summary if r["split"] == "val"]
    train = [r for r in summary if r["split"] == "train"]

    def _mean_vals(rows: list[dict], stage: str, key: str = "de_mean") -> list[float]:
        return [r["stages"][stage][key] for r in rows if r["stages"].get(stage, {}).get(key) is not None]

    def _mean(rows: list[dict], stage: str, key: str = "de_mean") -> str:
        vals = _mean_vals(rows, stage, key)
        if not vals:
            return "—"
        return _fmt(sum(vals) / len(vals))

    def _mean_num(rows: list[dict], stage: str, key: str = "de_mean") -> float | None:
        vals = _mean_vals(rows, stage, key)
        if not vals:
            return None
        return sum(vals) / len(vals)

    def _robust_mean(rows: list[dict], stage: str) -> float | None:
        vals = []
        for row in rows:
            rob = (row["stages"].get(stage) or {}).get("robust") or {}
            if rob.get("de_mean") is not None:
                vals.append(rob["de_mean"])
        if not vals:
            return None
        return sum(vals) / len(vals)

    def _zone_mean(rows: list[dict], stage: str, zone: str) -> float | None:
        vals = []
        for row in rows:
            rob = (row["stages"].get(stage) or {}).get("robust") or {}
            z = rob.get("zones") or {}
            if z.get(zone) is not None:
                vals.append(z[zone])
        if not vals:
            return None
        return sum(vals) / len(vals)

    train_color = _mean_num(train, "color")
    train_hs = _mean_num(train, "hs")
    val_color = _mean_num(val, "color")
    val_hs = _mean_num(val, "hs")
    train_rob = _robust_mean(train, "color")
    train_rob_hs = _robust_mean(train, "hs")
    val_rob = _robust_mean(val, "color")
    val_rob_hs = _robust_mean(val, "hs")
    target = 5.0
    aim = 3.0
    verdict = "reached" if train_rob is not None and train_rob < target else "not reached"
    zone_table = (
        "| Split | Image | Look | ΔE plein couleur | ΔE réduit | ciel | milieux | ombres | CNR / Lum / Sh |\n"
        "|---|---|:---|---:|---:|---:|---:|---:|:---|\n"
    )
    for row in summary:
        st = row["stages"].get("color") or {}
        rob = st.get("robust") or {}
        rz = rob.get("zones") or {}
        nr = row.get("nr") or {}
        zone_table += (
            "| {split} | `{ident}` | {look} | {full} | {rob} | {sky} | {mid} | {sh} | "
            "{cnr}/{lum}/{sharp} |\n".format(
                split=row["split"],
                ident=row["id"],
                look=row.get("look_name") or "—",
                full=_fmt(st.get("de_mean")),
                rob=_fmt(rob.get("de_mean")),
                sky=_fmt(rz.get("sky")),
                mid=_fmt(rz.get("mids")),
                sh=_fmt(rz.get("shadows")),
                cnr=_fmt(nr.get("color"), 0),
                lum=_fmt(nr.get("luminance"), 0),
                sharp=_fmt(nr.get("sharpness"), 0),
            )
        )
    z6 = next((r for r in summary if r["id"] == "z6ii-0086"), None)
    z6_txt = ""
    if z6 and z6.get("sky"):
        s = z6["sky"]
        z6_txt = (
            "## z6ii-0086 ciel (orangé LR vs gris-bleu Rayfine)\n\n"
            f"- LR sky Lab L*={_fmt((s['lr'] or {}).get('L'))} a*={_fmt((s['lr'] or {}).get('a'))} "
            f"b*={_fmt((s['lr'] or {}).get('b'))} hue={_fmt((s['lr'] or {}).get('hue_deg'))} "
            f"C*={_fmt((s['lr'] or {}).get('chroma'))}\n"
            f"- Rayfine couleur L*={_fmt((s['rayfine_color'] or {}).get('L'))} "
            f"a*={_fmt((s['rayfine_color'] or {}).get('a'))} "
            f"b*={_fmt((s['rayfine_color'] or {}).get('b'))} "
            f"hue={_fmt((s['rayfine_color'] or {}).get('hue_deg'))}\n"
            f"- Rayfine H/S L*={_fmt((s['rayfine_hs'] or {}).get('L'))} "
            f"a*={_fmt((s['rayfine_hs'] or {}).get('a'))} "
            f"b*={_fmt((s['rayfine_hs'] or {}).get('b'))} "
            f"hue={_fmt((s['rayfine_hs'] or {}).get('hue_deg'))}\n"
            f"- ΔE réduit ciel/mil/ombre: {_fmt(((s.get('robust_hs') or {}).get('zones') or {}).get('sky'))} / "
            f"{_fmt(((s.get('robust_hs') or {}).get('zones') or {}).get('mids'))} / "
            f"{_fmt(((s.get('robust_hs') or {}).get('zones') or {}).get('shadows'))}\n"
            "b* > 0 et hue ~40–70° = orangé ; b* ≤ 0 ou hue ~200–250° = gris-bleu.\n\n"
        )
    body = (
        "# Adobe colour / light match (Imaging Resource ACR JPEG, PV 11.0)\n\n"
        "Pipeline: camera-linear demosaic → Temperature/Tint WB (DNG SDK Planckian + CIE 1960 tint) "
        "→ Inverse(CameraCalibration) → ColorMatrix / ForwardMatrix (Adobe Standard DCP when "
        "fetched) → XYZ D50 → ProPhoto linear → HueSatMap → BaselineExposure + Exposure → "
        "LookTable (Adobe Landscape XMP 36×16×16 when fetched) → optional RGBTable → "
        "ProfileToneCurve → Contrast / parametric / ToneCurvePV2012 → HSL / "
        "Calibration → Highlights/Shadows/Whites/Blacks → ProPhoto→sRGB (Bradford D50→D65).\n\n"
        "Reference: Imaging Resource `-MOD.JPG` (sRGB IEC61966-2.1, Camera Raw 11.3–13.2, "
        "`ProcessVersion` 11.0, `CameraProfile` Adobe Standard, Look Adobe Landscape). "
        "Pixels are not committed (IR evaluation license). Hold-out rows use `split=val`.\n"
        "FiveK Expert C is **not** the oracle (ACR 4.4 + already-tonemapped ProPhoto TIFF).\n"
        "Criterion: mean ΔE2000 < 5 (aim < 3) on the **reduced** (~512 px + Gaussian) pair, "
        "train and val reported separately.\n\n"
        "## Ablation (mean ΔE2000, full-res 640)\n\n"
        + table
        + "\n## Profile layers (DNG order: Look after BaselineExposure)\n\n"
        + layers
        + "\n## Robust + zones (colour stage, ~512 px + blur)\n\n"
        + zone_table
        + "\n### Means\n\n"
        f"- Train color / hs (full): {_mean(train, 'color')} / {_mean(train, 'hs')}\n"
        f"- Train color / hs (réduit): {_fmt(train_rob)} / {_fmt(train_rob_hs)}\n"
        f"- Train réduit ciel / mil / ombre: {_fmt(_zone_mean(train, 'color', 'sky'))} / "
        f"{_fmt(_zone_mean(train, 'color', 'mids'))} / {_fmt(_zone_mean(train, 'color', 'shadows'))}\n"
        f"- Train midtones (color): {_mean(train, 'color', 'de_mid')}\n"
        f"- Weak H/S color / hs: {_mean(weak, 'color')} / {_mean(weak, 'hs')}\n"
        f"- Val color / hs (full): {_mean(val, 'color')} / {_mean(val, 'hs')}  (not used to tune)\n"
        f"- Val color / hs (réduit): {_fmt(val_rob)} / {_fmt(val_rob_hs)}\n\n"
        f"Target (réduit, train color): mean ΔE2000 < {target:.0f} (aim < {aim:.0f}). "
        f"**{verdict}** (train réduit={_fmt(train_rob)}, train full color={_fmt(train_color)}, "
        f"val réduit={_fmt(val_rob)}, val full={_fmt(val_color)}).\n\n"
        + z6_txt
        + "## Gaps that stay open\n\n"
        "- Adobe Standard `.dcp` and Adobe Landscape `.xmp` are fetched locally "
        "(`fetch_adobe_dcp.py`, `fetch_adobe_looks.py`). Copyright Adobe — not committed.\n"
        "- **Lens distortion / CA** are already applied in the IR JPEG "
        "(`aux:DistortionCorrectionAlreadyApplied`). Geometry residual is expected.\n"
        "- WB uses Kang CCT→xy + CIE 1960 tint (`kTintScale = −3000`), not Adobe’s unpublished "
        "Planckian table. Illuminant mix is inverse-CCT between A (2856 K) and D65 (6504 K).\n"
        "- Per-channel `ToneCurvePV2012Red/Green/Blue` are identity on this set and not replayed.\n"
        "- Sharpening / NR are read from XMP (default Color 25, Sharpness 40) and motivate the "
        "reduced+blur metric; they are not applied in the develop path.\n"
        "- Mono-slider LR exports: see [PROTOCOL.md](PROTOCOL.md).\n"
    )
    (args.out / "summary.md").write_text(body, encoding="utf-8")
    print(table)


if __name__ == "__main__":
    main()
