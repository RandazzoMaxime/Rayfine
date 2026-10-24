#!/usr/bin/env python3
"""Mean Lab D50 C* and zone chroma for LR vs LightCraft vs Rayfine.

Zones: sky, vegetation (green-yellow), warm/skin, neutrals. Also HSV sat hist.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from diagnose_cast import load_srgb, neutral_mask, resize_to, srgb_to_lab_d50
from metrics import zone_masks

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "lc-vs-lr"


def hsv_sat(srgb: np.ndarray) -> np.ndarray:
    mx = srgb.max(axis=-1)
    mn = srgb.min(axis=-1)
    return np.where(mx > 1e-6, (mx - mn) / mx, 0.0)


def chroma_stats(srgb: np.ndarray) -> dict:
    lab = srgb_to_lab_d50(srgb)
    c = np.hypot(lab[..., 1], lab[..., 2])
    h = (np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) + 360.0) % 360.0
    sat = hsv_sat(srgb)
    sky = zone_masks(srgb)["sky"]
    # Vegetation: green-yellow hue, enough chroma, not sky.
    veg = (h >= 70.0) & (h < 170.0) & (c >= 8.0) & ~sky
    # Warm / skin: orange-red, mid L*.
    warm = (h >= 20.0) & (h < 70.0) & (c >= 8.0) & (lab[..., 0] >= 25.0) & (lab[..., 0] <= 85.0)
    neut = neutral_mask(lab)

    def zone(mask: np.ndarray) -> dict:
        if int(mask.sum()) < 40:
            return {"n": int(mask.sum()), "C": None, "sat": None}
        return {
            "n": int(mask.sum()),
            "C": float(c[mask].mean()),
            "sat": float(sat[mask].mean()),
        }

    hist, _ = np.histogram(sat.reshape(-1), bins=8, range=(0.0, 1.0), density=True)
    return {
        "C_mean": float(c.mean()),
        "C_p50": float(np.median(c)),
        "C_p90": float(np.percentile(c, 90)),
        "sat_mean": float(sat.mean()),
        "sat_hist": [float(x) for x in hist],
        "zones": {
            "all": zone(np.ones(c.shape, dtype=bool)),
            "sky": zone(sky),
            "vegetation": zone(veg),
            "warm": zone(warm),
            "neutrals": zone(neut),
        },
    }


def ratio(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or abs(b) < 1e-6:
        return None
    return float(a / b)


def main() -> None:
    rows = []
    for work in sorted(OUT.iterdir()):
        if not work.is_dir() or work.name == "sheets":
            continue
        rf = load_srgb(work / "rayfine_lc.png")
        if rf is None:
            rf = load_srgb(work / "lightcraft_hs.png")
        lc = load_srgb(work / "lightcraft.jpg")
        datasets = ROOT / "datasets" / "ir" / work.name
        ref = None
        if datasets.exists():
            for p in datasets.iterdir():
                if p.suffix.lower() in {".jpg", ".jpeg"} and "raw" not in p.name.lower():
                    ref = load_srgb(p)
                    if ref is not None:
                        break
        if rf is None or lc is None or ref is None:
            print(f"skip {work.name}")
            continue
        lc = resize_to(lc, rf)
        ref = resize_to(ref, rf)
        row = {
            "id": work.name,
            "lr": chroma_stats(ref),
            "lc": chroma_stats(lc),
            "rf": chroma_stats(rf),
        }
        row["rf_over_lr"] = ratio(row["rf"]["C_mean"], row["lr"]["C_mean"])
        row["lc_over_lr"] = ratio(row["lc"]["C_mean"], row["lr"]["C_mean"])
        row["rf_over_lc"] = ratio(row["rf"]["C_mean"], row["lc"]["C_mean"])
        rows.append(row)
        print(
            f"{work.name:14}  C* LR {row['lr']['C_mean']:.2f}  LC {row['lc']['C_mean']:.2f}  "
            f"RF {row['rf']['C_mean']:.2f}  RF/LR {row['rf_over_lr']:.3f}  LC/LR {row['lc_over_lr']:.3f}  "
            f"RF/LC {row['rf_over_lc']:.3f}"
        )
        for z in ("sky", "vegetation", "warm", "neutrals"):
            lr_c = row["lr"]["zones"][z]["C"]
            lc_c = row["lc"]["zones"][z]["C"]
            rf_c = row["rf"]["zones"][z]["C"]
            if lr_c is None and lc_c is None and rf_c is None:
                continue
            def f(v):
                return "—" if v is None else f"{v:.2f}"
            r = ratio(rf_c, lr_c)
            print(
                f"               {z:11}  LR {f(lr_c)}  LC {f(lc_c)}  RF {f(rf_c)}"
                + (f"  RF/LR {r:.3f}" if r else "")
            )
    dest = OUT / "chroma.json"
    dest.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    train_ids = {"a6600-0046", "a6600-0089", "g95-0192", "g95-0314", "z6ii-0086"}
    for name, ids in (("train", train_ids), ("val", None)):
        subset = [r for r in rows if (r["id"] in train_ids) == (name == "train")]
        if not subset:
            continue
        rf_lr = [r["rf_over_lr"] for r in subset if r["rf_over_lr"]]
        lc_lr = [r["lc_over_lr"] for r in subset if r["lc_over_lr"]]
        print(
            f"{name:5}  mean RF/LR {sum(rf_lr)/len(rf_lr):.3f}  "
            f"LC/LR {sum(lc_lr)/len(lc_lr):.3f}  n={len(subset)}"
        )
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
