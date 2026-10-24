#!/usr/bin/env python3
"""Consume Maxime's mono-slider Lightroom JPEGs (see PROTOCOL.md).

Looks for `datasets/ir/<id>/mono/<slider><sign><value>.jpg`. Renders Rayfine
with that one slider overridden and writes ΔE + contact sheets. Exits 0 with
an empty summary when no mono exports are present yet.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from compare_adobe_match import (
    DEFAULT_DCP_DIR,
    DEFAULT_LOOK_DIR,
    _run_adobe,
    _sheet,
)
from compare_public_pairs import _align_pred_to_ref, _load_png_srgb, _load_srgb
from crs_map import map_xmp_path, mapping_to_json
from metrics import compare_srgb, robust_compare, zone_delta_e

ROOT = Path(__file__).resolve().parent
NAME_RE = re.compile(r"^(shadows|blacks|highlights|whites)([+-]\d+)\.jpe?g$", re.I)
SLIDER_KEY = {
    "shadows": "shadows",
    "blacks": "blacks",
    "highlights": "highlights",
    "whites": "whites",
}


def _pairs(datasets: Path) -> list[dict]:
    found: list[dict] = []
    for mono in sorted(datasets.glob("*/mono")):
        ident = mono.parent.name
        xmp = mono.parent / "develop.xmp"
        raw = next((p for p in mono.parent.iterdir() if p.name.startswith("raw.")), None)
        if not xmp.is_file() or raw is None:
            continue
        for jpg in sorted(mono.glob("*.jpg")) + sorted(mono.glob("*.jpeg")):
            match = NAME_RE.match(jpg.name)
            if not match:
                continue
            found.append(
                {
                    "id": ident,
                    "slider": match.group(1).lower(),
                    "value": float(match.group(2)),
                    "raw": raw,
                    "xmp": xmp,
                    "reference": jpg,
                }
            )
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--datasets", type=Path, default=ROOT / "datasets" / "ir")
    parser.add_argument("--out", type=Path, default=ROOT / "out" / "mono")
    parser.add_argument("--long-edge", type=int, default=640)
    parser.add_argument("--dcp-dir", type=Path, default=DEFAULT_DCP_DIR)
    parser.add_argument("--look-dir", type=Path, default=DEFAULT_LOOK_DIR)
    args = parser.parse_args()
    pairs = _pairs(args.datasets)
    args.out.mkdir(parents=True, exist_ok=True)
    summary = []
    if not pairs:
        (args.out / "summary.json").write_text("[]\n", encoding="utf-8")
        (args.out / "summary.md").write_text(
            "# Mono-slider bench\n\nNo `*/mono/<slider>±N.jpg` yet. See [PROTOCOL.md](../PROTOCOL.md).\n",
            encoding="utf-8",
        )
        print("no mono-slider JPEGs (protocol not filled yet)")
        return 0
    for pair in pairs:
        mapped = map_xmp_path(pair["xmp"])
        adobe = mapped.adobe_json()
        adobe[SLIDER_KEY[pair["slider"]]] = pair["value"]
        work = args.out / f"{pair['id']}_{pair['slider']}{pair['value']:+.0f}"
        work.mkdir(parents=True, exist_ok=True)
        (work / "mapping.json").write_text(json.dumps(mapping_to_json(mapped), indent=2) + "\n")
        _run_adobe(pair["raw"], adobe, work, args.long_edge, args.dcp_dir, args.look_dir)
        lr = _load_srgb(pair["reference"], args.long_edge, "srgb")
        pred = _align_pred_to_ref(_load_png_srgb(work / "adobe_hs.png", None), lr)
        full = compare_srgb(pred, lr)
        robust = robust_compare(pred, lr)
        zones = zone_delta_e(pred, lr)
        row = {
            "id": pair["id"],
            "slider": pair["slider"],
            "value": pair["value"],
            "full": full.as_dict(),
            "robust": robust,
            "zones": zones,
        }
        (work / "metrics.json").write_text(json.dumps(row, indent=2) + "\n")
        banner = f"{pair['slider']} {pair['value']:+.0f}  (others from IR XMP)"
        _sheet(
            pair["id"],
            banner,
            "hs",
            banner,
            lr,
            pred,
            full,
            args.out / "sheets" / f"{pair['id']}_{pair['slider']}{pair['value']:+.0f}.png",
            f"mono-slider protocol  robust ΔE {robust['de_mean']:.2f}",
            zones=zones,
            robust=robust,
            look_name=mapped.look_name,
        )
        summary.append(row)
        print(
            f"{pair['id']} {pair['slider']}{pair['value']:+.0f}  "
            f"full {full.de_mean:.2f}  robust {robust['de_mean']:.2f}"
        )
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    lines = [
        "# Mono-slider bench\n\n",
        "| Photo | Curseur | Valeur | ΔE plein | ΔE réduit | ciel | milieux | ombres |\n",
        "|---|---|---:|---:|---:|---:|---:|---:|\n",
    ]
    for row in summary:
        z = row["zones"]
        lines.append(
            f"| `{row['id']}` | {row['slider']} | {row['value']:+.0f} | "
            f"{row['full']['de_mean']:.2f} | {row['robust']['de_mean']:.2f} | "
            f"{z.get('sky') or float('nan'):.2f} | {z.get('mids') or float('nan'):.2f} | "
            f"{z.get('shadows') or float('nan'):.2f} |\n"
        )
    (args.out / "summary.md").write_text("".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
