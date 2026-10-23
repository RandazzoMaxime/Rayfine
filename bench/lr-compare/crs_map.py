#!/usr/bin/env python3
"""Parse Lightroom / Camera Raw XMP (or .lrcat blobs) and map sliders to Rayfine.

PV2012 (`crs:*2012`) maps 1:1 onto Rayfine UI units — the same contract as
`convert_xmp_to_preset` in `src-tauri/src/preset_converter.rs`.

PV2010 (FiveK / Lightroom 3) has no Highlights2012. Those older tags are mapped
approximately; see MAPPING.md.
"""

from __future__ import annotations

import json
import re
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

CRS_ATTR = re.compile(r'crs:([A-Za-z0-9]+)="([^"]*)"')
CRS_ELEM = re.compile(r"<crs:([A-Za-z0-9]+)>\s*([^<]+)\s*</crs:\1>")
XMP_META = re.compile(rb"<x:xmpmeta[\s\S]+?</x:xmpmeta>")


@dataclass
class ToneMapping:
    exposure: float = 0.0
    highlights: float = 0.0
    shadows: float = 0.0
    whites: float = 0.0
    blacks: float = 0.0
    contrast: float = 0.0
    temperature_k: float | None = None
    tint: float | None = None
    white_balance: str | None = None
    process_version: str | None = None
    tone_curve_name: str | None = None
    unused: dict[str, Any] = field(default_factory=dict)
    limits: list[str] = field(default_factory=list)
    source: str = "empty"

    def sliders_json(self) -> dict[str, float]:
        return {
            "exposure": self.exposure,
            "highlights": self.highlights,
            "shadows": self.shadows,
            "whites": self.whites,
            "blacks": self.blacks,
            "contrast": self.contrast,
        }

    def banner(self) -> str:
        return (
            f"Exp {self.exposure:+.2f}  H {self.highlights:+.0f}  "
            f"S {self.shadows:+.0f}  W {self.whites:+.0f}  "
            f"B {self.blacks:+.0f}  C {self.contrast:+.0f}  "
            f"pv={self.process_version or '?'}  src={self.source}"
        )


def _num(raw: str) -> float | None:
    try:
        return float(raw.strip().lstrip("+"))
    except ValueError:
        return None


def parse_crs_attrs(xmp: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    one_line = " ".join(xmp.splitlines())
    for match in CRS_ATTR.finditer(one_line):
        attrs[match.group(1)] = match.group(2)
    for match in CRS_ELEM.finditer(xmp):
        attrs.setdefault(match.group(1), match.group(2).strip())
    return attrs


def extract_xmp_packet(data: bytes) -> str | None:
    match = XMP_META.search(data)
    if match:
        return match.group(0).decode("utf-8", "replace")
    start = data.find(b"<?xpacket begin")
    if start < 0:
        return None
    end = data.find(b"<?xpacket end", start)
    if end < 0:
        return None
    return data[start:end].decode("utf-8", "replace")


def extract_xmp_from_path(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix in {".xmp", ".xml"}:
        return path.read_text(encoding="utf-8", errors="replace")
    # XMP packets sit near the start of DNG/TIFF/JPEG; cap the scan.
    with path.open("rb") as handle:
        head = handle.read(2_000_000)
    packet = extract_xmp_packet(head)
    if packet:
        return packet
    if path.stat().st_size > 2_000_000:
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - 2_000_000))
            tail = handle.read()
        return extract_xmp_packet(tail)
    return None


def _is_pv2012(attrs: dict[str, str]) -> bool:
    if any(key.endswith("2012") and key.startswith(("Exposure", "Highlights", "Shadows", "Whites", "Blacks", "Contrast")) for key in attrs):
        return True
    process = attrs.get("ProcessVersion", "")
    try:
        return float(process) >= 6.7
    except ValueError:
        return False


def map_crs_to_rayfine(attrs: dict[str, str]) -> ToneMapping:
    mapped = ToneMapping(
        process_version=attrs.get("ProcessVersion"),
        tone_curve_name=attrs.get("ToneCurveName") or attrs.get("ToneCurveName2012"),
        white_balance=attrs.get("WhiteBalance"),
    )
    temp = _num(attrs["Temperature"]) if "Temperature" in attrs else None
    tint = _num(attrs["Tint"]) if "Tint" in attrs else None
    mapped.temperature_k = temp
    mapped.tint = tint

    if _is_pv2012(attrs):
        mapped.source = "pv2012"
        mapped.exposure = _num(attrs.get("Exposure2012", "0")) or 0.0
        mapped.highlights = _num(attrs.get("Highlights2012", "0")) or 0.0
        mapped.shadows = _num(attrs.get("Shadows2012", "0")) or 0.0
        mapped.whites = _num(attrs.get("Whites2012", "0")) or 0.0
        mapped.blacks = _num(attrs.get("Blacks2012", "0")) or 0.0
        mapped.contrast = _num(attrs.get("Contrast2012", "0")) or 0.0
        mapped.limits.append(
            "PV2012 tone sliders are 1:1 UI units; Adobe's response curves are not."
        )
    else:
        mapped.source = "pv2010"
        mapped.exposure = _num(attrs.get("Exposure", "0")) or 0.0
        highlight_recovery = _num(attrs.get("HighlightRecovery", "0")) or 0.0
        fill_light = _num(attrs.get("FillLight", "0")) or 0.0
        shadows_pv2010 = _num(attrs.get("Shadows", "5")) or 5.0
        brightness = _num(attrs.get("Brightness", "0")) or 0.0
        contrast = _num(attrs.get("Contrast", "0")) or 0.0
        # LR3 UI defaults are Brightness 50 / Contrast 25. FiveK stores 0 / 0.
        if brightness == 50.0 and contrast == 25.0:
            brightness = 0.0
            contrast = 0.0
            mapped.limits.append("Treated Brightness 50 / Contrast 25 as PV2010 UI identity.")
        mapped.highlights = -highlight_recovery
        mapped.shadows = fill_light
        mapped.blacks = -(shadows_pv2010 - 5.0) * 4.0
        mapped.whites = 0.0
        mapped.contrast = contrast
        mapped.exposure += brightness / 100.0
        mapped.unused["pv2010"] = {
            "HighlightRecovery": highlight_recovery,
            "FillLight": fill_light,
            "Shadows": shadows_pv2010,
            "Brightness": _num(attrs.get("Brightness", "0")),
            "Contrast": _num(attrs.get("Contrast", "0")),
        }
        mapped.limits.extend(
            [
                "PV2010 HighlightRecovery 0..100 → Highlights2012 0..−100 (same number, opposite sign).",
                "PV2010 FillLight 0..100 → Shadows2012 (same sign; strength is not equivalent).",
                "PV2010 Shadows (default 5) → Blacks2012 via −4×(Shadows−5); Whites stay 0.",
                "PV2010 Brightness is folded as Exposure += Brightness/100 (FiveK 0-base).",
            ]
        )

    unused_keys = (
        "Saturation",
        "Vibrance",
        "Clarity",
        "Clarity2012",
        "ParametricShadows",
        "ParametricDarks",
        "ParametricLights",
        "ParametricHighlights",
        "ToneCurveName",
        "ToneCurveName2012",
        "CameraProfile",
        "Dehaze",
        "Texture",
    )
    unused = {
        key: attrs[key]
        for key in unused_keys
        if key in attrs and attrs[key] not in {"0", "+0", "0.0", "Linear", ""}
    }
    if unused:
        mapped.unused.update(unused)
        mapped.limits.append(
            "Saturation / vibrance / clarity / parametric / point curve / camera profile are not applied."
        )
    if mapped.tone_curve_name and mapped.tone_curve_name not in {"Linear", "Linear Contrast"}:
        mapped.limits.append(f"Tone curve {mapped.tone_curve_name!r} is not applied.")
    if mapped.white_balance and mapped.white_balance not in {"As Shot", "AsShot"}:
        mapped.limits.append(
            f"White balance {mapped.white_balance!r} is recorded but the CPU develop path keeps as-shot WB."
        )
    return mapped


def map_xmp_text(xmp: str) -> ToneMapping:
    return map_crs_to_rayfine(parse_crs_attrs(xmp))


def map_xmp_path(path: Path) -> ToneMapping:
    text = extract_xmp_from_path(path)
    if not text:
        raise ValueError(f"no XMP packet in {path}")
    return map_xmp_text(text)


def inflate_lrcat_xmp_blob(blob: bytes) -> str:
    """Lightroom stores Adobe_AdditionalMetadata.xmp as u32le length + zlib."""
    payload = blob[4:] if len(blob) >= 4 else blob
    try:
        return zlib.decompress(payload).decode("utf-8", "replace")
    except zlib.error:
        return zlib.decompress(blob).decode("utf-8", "replace")


def mapping_to_json(mapped: ToneMapping) -> dict[str, Any]:
    payload = asdict(mapped)
    payload["sliders"] = mapped.sliders_json()
    payload["banner"] = mapped.banner()
    return payload


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Map a Lightroom XMP to Rayfine tone sliders.")
    parser.add_argument("xmp", type=Path)
    parser.add_argument("-o", "--out", type=Path)
    args = parser.parse_args()
    mapped = map_xmp_path(args.xmp)
    text = json.dumps(mapping_to_json(mapped), indent=2)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
