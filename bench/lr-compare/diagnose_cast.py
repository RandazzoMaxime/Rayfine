#!/usr/bin/env python3
"""Neutral-zone Lab D50 a*/b* and R/B for LR vs LightCraft vs Rayfine porté.

Uses already-rendered IR triples. Neutrals: high L*, low chroma (snow / grey).
Lab is CIE Lab D50 (sRGB → XYZ D65 → Bradford D65→D50).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from metrics import srgb_to_linear

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "lc-vs-lr"

# Bradford D65 → D50 (CIECAT02-adjacent Bradford, CIE white points).
M_D65_TO_D50 = np.array(
    [
        [1.0478112, 0.0228866, -0.0501270],
        [0.0295424, 0.9904844, -0.0170491],
        [-0.0092345, 0.0150436, 0.7521316],
    ],
    dtype=np.float64,
)
M_SRGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ],
    dtype=np.float64,
)
D50 = np.array([0.96422, 1.0, 0.82521], dtype=np.float64)


def _f_lab(t: np.ndarray) -> np.ndarray:
    delta = 6.0 / 29.0
    return np.where(t > delta**3, np.cbrt(t), t / (3.0 * delta**2) + 4.0 / 29.0)


def srgb_to_lab_d50(srgb: np.ndarray) -> np.ndarray:
    linear = srgb_to_linear(srgb)
    xyz_d65 = linear @ M_SRGB_TO_XYZ.T
    xyz = xyz_d65 @ M_D65_TO_D50.T
    f = _f_lab(xyz / D50)
    return np.stack(
        [116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])],
        axis=-1,
    )


def load_srgb(path: Path) -> np.ndarray | None:
    if not path.exists():
        return None
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.float64) / 255.0


def resize_to(a: np.ndarray, ref: np.ndarray) -> np.ndarray:
    if a.shape[:2] == ref.shape[:2]:
        return a
    img = Image.fromarray(np.clip(a * 255.0, 0, 255).astype(np.uint8), "RGB")
    img = img.resize((ref.shape[1], ref.shape[0]), Image.Resampling.BILINEAR)
    return np.asarray(img, dtype=np.float64) / 255.0


def neutral_mask(lab: np.ndarray) -> np.ndarray:
    l = lab[..., 0]
    c = np.hypot(lab[..., 1], lab[..., 2])
    snow = (l >= 70.0) & (c <= 14.0)
    grey = (l >= 35.0) & (l < 70.0) & (c <= 8.0)
    mask = snow | grey
    if int(mask.sum()) < 80:
        mask = (l >= 55.0) & (c <= 18.0)
    return mask


def stats(srgb: np.ndarray, mask: np.ndarray) -> dict:
    lab = srgb_to_lab_d50(srgb)
    if not np.any(mask):
        return {"n": 0, "L": None, "a": None, "b": None, "rb": None}
    pix = srgb[mask]
    labp = lab[mask]
    r = pix[:, 0].mean()
    b = pix[:, 2].mean()
    return {
        "n": int(mask.sum()),
        "L": float(labp[:, 0].mean()),
        "a": float(labp[:, 1].mean()),
        "b": float(labp[:, 2].mean()),
        "rb": float(r / max(b, 1e-6)),
        "frame_b": float(lab[..., 2].mean()),
        "frame_a": float(lab[..., 1].mean()),
    }


def main() -> None:
    rows = []
    for work in sorted(OUT.iterdir()):
        if not work.is_dir() or work.name == "sheets":
            continue
        lr_meta = None
        # LR JPEG lives in the dataset, not the work dir. Use compare.json banner only.
        rf = load_srgb(work / "rayfine_lc.png")
        if rf is None:
            rf = load_srgb(work / "lightcraft_hs.png")
        lc = load_srgb(work / "lightcraft.jpg")
        old = load_srgb(work / "adobe_hs.png")
        # Find LR reference
        datasets = ROOT / "datasets" / "ir" / work.name
        ref = None
        if datasets.exists():
            for p in datasets.iterdir():
                if p.suffix.lower() in {".jpg", ".jpeg"} and "raw" not in p.name.lower():
                    ref = load_srgb(p)
                    if ref is not None:
                        break
        if rf is None or lc is None or ref is None:
            print(f"skip {work.name}: missing render")
            continue
        lc = resize_to(lc, rf)
        old = resize_to(old, rf) if old is not None else None
        ref = resize_to(ref, rf)
        # Neutrals from LR (the reference white)
        mask = neutral_mask(srgb_to_lab_d50(ref))
        row = {
            "id": work.name,
            "lr": stats(ref, mask),
            "lc": stats(lc, mask),
            "rf": stats(rf, mask),
            "old": stats(old, mask) if old is not None else None,
        }
        notes = work / "lightcraft_profile.json"
        if notes.exists():
            row["profile"] = json.loads(notes.read_text())
        rows.append(row)
        def fmt(s: dict) -> str:
            if not s or s.get("n") == 0:
                return "—"
            return f"a*{s['a']:+.2f} b*{s['b']:+.2f} R/B {s['rb']:.3f} n={s['n']}"
        print(
            f"{work.name:14}  LR {fmt(row['lr'])}  |  LC {fmt(row['lc'])}  |  RF {fmt(row['rf'])}  |  "
            f"Δb* RF-LC {row['rf']['b']-row['lc']['b']:+.2f}  Δb* LC-LR {row['lc']['b']-row['lr']['b']:+.2f}  "
            f"ΔRB RF-LC {row['rf']['rb']-row['lc']['rb']:+.3f}"
        )
        if row.get("profile"):
            p = row["profile"]
            print(
                f"{'':14}  tone={p.get('tone')} wb={p.get('wb')} as_shot={p.get('as_shot_temp'):.0f}/{p.get('as_shot_tint'):+.1f}"
                if isinstance(p.get("as_shot_temp"), (int, float))
                else f"{'':14}  tone={p.get('tone')} wb={p.get('wb')}"
            )
    dest = OUT / "cast_neutrals.json"
    dest.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
