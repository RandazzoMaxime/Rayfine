#!/usr/bin/env python3
"""Extract XMP develop packets from a Lightroom Classic `.lrcat` (SQLite).

The FiveK 50 GB archive includes `fivek.lrcat`. Individual Expert C TIFFs already
embed the same crs:* packet, so this is only needed when you have a catalog
without exported TIFFs.

Usage:
  python bench/lr-compare/extract_lrcat_xmp.py fivek.lrcat --out datasets/fivek/xmp
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from crs_map import inflate_lrcat_xmp_blob


def _column_names(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in rows]


def extract(catalog: Path, out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(f"file:{catalog}?mode=ro", uri=True)
    written = 0
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "Adobe_AdditionalMetadata" in tables:
        cols = set(_column_names(conn, "Adobe_AdditionalMetadata"))
        xmp_col = "xmp" if "xmp" in cols else ("XMP" if "XMP" in cols else None)
        if xmp_col:
            image_col = "image" if "image" in cols else "id_local"
            for image_id, blob in conn.execute(
                f"SELECT {image_col}, {xmp_col} FROM Adobe_AdditionalMetadata WHERE {xmp_col} IS NOT NULL"
            ):
                if not blob:
                    continue
                try:
                    text = inflate_lrcat_xmp_blob(bytes(blob))
                except Exception as exc:  # noqa: BLE001
                    print(f"skip blob {image_id}: {exc}", file=sys.stderr)
                    continue
                dest = out_dir / f"{image_id}.xmp"
                dest.write_text(text, encoding="utf-8")
                written += 1
    if "Adobe_imageDevelopSettings" in tables and written == 0:
        cols = set(_column_names(conn, "Adobe_imageDevelopSettings"))
        text_col = "text" if "text" in cols else None
        if text_col:
            dest = out_dir / "develop_settings.jsonl"
            with dest.open("w", encoding="utf-8") as handle:
                for row in conn.execute(f"SELECT {text_col} FROM Adobe_imageDevelopSettings WHERE {text_col} IS NOT NULL"):
                    handle.write(str(row[0]).replace("\n", " ") + "\n")
                    written += 1
    conn.close()
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract XMP from a Lightroom .lrcat")
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    n = extract(args.catalog, args.out)
    print(f"wrote {n} records under {args.out}")


if __name__ == "__main__":
    main()
