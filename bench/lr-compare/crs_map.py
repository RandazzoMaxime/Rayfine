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
    brightness: float = 0.0
    temperature_k: float | None = None
    tint: float | None = None
    white_balance: str | None = None
    process_version: str | None = None
    crs_version: str | None = None
    tone_curve_name: str | None = None
    camera_profile: str | None = None
    vibrance: float = 0.0
    saturation: float = 0.0
    dehaze: float = 0.0
    clarity: float = 0.0
    texture: float = 0.0
    look_name: str | None = None
    look_uuid: str | None = None
    look_amount: float = 1.0
    color_nr: float = 25.0
    luma_nr: float = 0.0
    sharpness: float = 40.0
    parametric: dict[str, float] = field(default_factory=dict)
    hsl: dict[str, float] = field(default_factory=dict)
    calibration: dict[str, float] = field(default_factory=dict)
    crop: dict[str, float] | None = None
    tone_curve_pv2012: list[tuple[float, float]] = field(default_factory=list)
    unused: dict[str, Any] = field(default_factory=dict)
    limits: list[str] = field(default_factory=list)
    source: str = "empty"
    lens_profile: bool = False
    remove_ca: bool = False

    def sliders_json(self) -> dict[str, float]:
        return {
            "exposure": self.exposure,
            "highlights": self.highlights,
            "shadows": self.shadows,
            "whites": self.whites,
            "blacks": self.blacks,
            "contrast": self.contrast,
        }

    def adobe_json(self) -> dict[str, Any]:
        """Sliders for the Adobe colour/light path. Exposure is the XMP EV,
        brightness stays separate (not folded), WB is Temperature/Tint."""
        exposure = self.exposure
        if self.source == "pv2010":
            exposure = self.exposure - self.brightness / 100.0
        use_as_shot = self.white_balance in {None, "As Shot", "AsShot"}
        # FiveK XMP says ACR 4.4, but ColorMatrix-only + CAT measured *worse*
        # (a0045 profile ΔE 19→31). ForwardMatrix + LookTable stay on as the
        # best public approximation; the proprietary ACR 4.4 HSB is reported.
        return {
            "exposure": exposure,
            "brightness": self.brightness,
            "contrast": self.contrast,
            "highlights": self.highlights,
            "shadows": self.shadows,
            "whites": self.whites,
            "blacks": self.blacks,
            "temperature_k": self.temperature_k,
            "tint": self.tint,
            "use_as_shot": use_as_shot,
            "tone_curve": self.tone_curve_name or "Linear",
            "use_forward_matrix": True,
            "apply_look": True,
            "camera_profile": self.camera_profile,
            "look_name": self.look_name,
            "look_uuid": self.look_uuid,
            "look_amount": self.look_amount,
            "vibrance": self.vibrance,
            "saturation": self.saturation,
            "dehaze": self.dehaze,
            "clarity": self.clarity,
            "texture": self.texture,
            "parametric": self.parametric,
            "hsl": self.hsl,
            "calibration": self.calibration,
            "crop": self.crop,
            "tone_curve_pv2012": self.tone_curve_pv2012,
        }

    def raw_exposure(self) -> float:
        if self.source == "pv2010":
            return self.exposure - self.brightness / 100.0
        return self.exposure

    def banner(self) -> str:
        temp = f"{self.temperature_k:.0f}" if self.temperature_k is not None else "?"
        tint = f"{self.tint:+.0f}" if self.tint is not None else "?"
        return (
            f"Exp {self.raw_exposure():+.2f}  Br {self.brightness:+.0f}  "
            f"H {self.highlights:+.0f}  S {self.shadows:+.0f}  "
            f"W {self.whites:+.0f}  B {self.blacks:+.0f}  C {self.contrast:+.0f}  "
            f"Vib {self.vibrance:+.0f} Sat {self.saturation:+.0f}  "
            f"Temp {temp} Tint {tint}  curve={self.tone_curve_name or 'Linear'}  "
            f"pv={self.process_version or '?'}  acr={self.crs_version or '?'}  "
            f"prof={self.camera_profile or '?'}  look={self.look_name or '-'}  "
            f"uuid={(self.look_uuid or '-')[:8]}  "
            f"CNR {self.color_nr:.0f} Lum {self.luma_nr:.0f} Sh {self.sharpness:.0f}  "
            f"src={self.source}"
        )

    def neutral_adobe_json(self) -> dict[str, Any]:
        """All develop sliders at 0; keep Temperature/Tint so WB/profile can be judged."""
        payload = self.adobe_json()
        for key in (
            "exposure",
            "brightness",
            "contrast",
            "highlights",
            "shadows",
            "whites",
            "blacks",
            "vibrance",
            "saturation",
            "dehaze",
            "clarity",
            "texture",
        ):
            payload[key] = 0.0
        payload["tone_curve"] = "Linear"
        payload["tone_curve_pv2012"] = []
        payload["parametric"] = {}
        payload["hsl"] = {}
        payload["calibration"] = {}
        payload["apply_look"] = False
        return payload

    def lightcraft_json(self) -> dict[str, Any]:
        """Partial LightCraft `DevelopSettings` JSON (`develop.merge` / `render --settings`).

        Numeric PV2012 sliders are 1:1 (`docs/xmp-interop.md`). Look extras already
        folded into this mapping (H/S/Clarity + Look ToneCurvePV2012) are applied as
        sliders/curve. Adobe Landscape HSV LookTable has no LightCraft equivalent —
        `lc.landscape` is a different slider recipe and is *not* selected, to avoid
        stacking it on those extras. IR JPEG sidecars are `AlreadyApplied=True` and
        must not be passed as `--settings` XMP (LightCraft would skip every field).
        """
        adobe = self.adobe_json()
        wb_name = (self.white_balance or "As Shot").replace(" ", "")
        as_shot = wb_name.lower() in {"asshot", ""}
        settings: dict[str, Any] = {
            "process": 2,
            "profile": {"id": "lc.color", "amount": 100.0},
            "light": {
                "exposure": adobe["exposure"],
                "contrast": adobe["contrast"],
                "highlights": adobe["highlights"],
                "shadows": adobe["shadows"],
                "whites": adobe["whites"],
                "blacks": adobe["blacks"],
            },
            "color": {
                "vibrance": adobe["vibrance"],
                "saturation": adobe["saturation"],
            },
            "effects": {
                "texture": adobe["texture"],
                "clarity": adobe["clarity"],
                "dehaze": adobe["dehaze"],
            },
            "detail": {
                "sharpen_amount": self.sharpness,
                "nr_luminance": self.luma_nr,
                "nr_color": self.color_nr,
            },
            "optics": {
                "lens_profile": self.lens_profile,
                "remove_ca": self.remove_ca,
            },
        }
        if as_shot:
            settings["wb"] = {"mode": "asShot"}
        elif self.temperature_k is not None:
            # Auto / Custom: replay Lightroom's recorded Kelvin, not LightCraft Auto.
            settings["wb"] = {
                "mode": "custom",
                "temp": self.temperature_k,
                "tint": self.tint if self.tint is not None else 0.0,
                "scale": "kelvin",
            }
        else:
            settings["wb"] = {"mode": "auto" if wb_name.lower() == "auto" else "asShot"}
        curve = adobe.get("tone_curve_pv2012") or []
        identity = curve in ([], [(0.0, 0.0), (255.0, 255.0)])
        if not identity:
            settings["curve"] = {
                "master": [{"x": x / 255.0, "y": y / 255.0} for x, y in curve]
            }
        parametric = adobe.get("parametric") or {}
        if parametric:
            settings.setdefault("curve", {})
            key_map = {
                "ParametricShadows": "shadows",
                "ParametricDarks": "darks",
                "ParametricLights": "lights",
                "ParametricHighlights": "highlights",
                "ParametricShadowSplit": "split_shadows",
                "ParametricMidtoneSplit": "split_mid",
                "ParametricHighlightSplit": "split_highlights",
            }
            for src, dest in key_map.items():
                if src in parametric:
                    settings["curve"][dest] = parametric[src]
        mixer: dict[str, dict[str, float]] = {}
        band_map = {
            "Red": "red",
            "Orange": "orange",
            "Yellow": "yellow",
            "Green": "green",
            "Aqua": "aqua",
            "Blue": "blue",
            "Purple": "purple",
            "Magenta": "magenta",
        }
        for band, dest in band_map.items():
            hue = (self.hsl or {}).get(f"HueAdjustment{band}", 0.0)
            sat = (self.hsl or {}).get(f"SaturationAdjustment{band}", 0.0)
            lum = (self.hsl or {}).get(f"LuminanceAdjustment{band}", 0.0)
            if hue or sat or lum:
                mixer[dest] = {"hue": hue, "sat": sat, "lum": lum}
        if mixer:
            settings["mixer"] = mixer
        return settings


def _num(raw: str) -> float | None:
    try:
        return float(raw.strip().lstrip("+"))
    except ValueError:
        return None


def parse_crs_attrs(xmp: str) -> dict[str, str]:
    """Parse the *root* Camera Raw description, not nested Look.Parameters."""
    attrs: dict[str, str] = {}
    root = xmp
    look_at = re.search(r"<crs:Look[\s>]", xmp)
    if look_at:
        root = xmp[: look_at.start()]
    one_line = " ".join(root.splitlines())
    for match in CRS_ATTR.finditer(one_line):
        # First wins: nested Correction / RangeMask / Gradient must not
        # overwrite the root rdf:Description (crs:Version="+2" on masks).
        attrs.setdefault(match.group(1), match.group(2))
    for match in CRS_ELEM.finditer(root):
        attrs.setdefault(match.group(1), match.group(2).strip())
    return attrs


def parse_look_parameters(xmp: str) -> dict[str, str]:
    """Numeric extras inside crs:Look / crs:Parameters (Adobe Landscape etc.)."""
    match = re.search(
        r"<crs:Parameters>\s*<rdf:Description\b([^>]*)>",
        xmp,
        flags=re.DOTALL,
    )
    if not match:
        return {}
    return {k: v for k, v in CRS_ATTR.findall(match.group(1))}


def extract_xmp_packet(data: bytes) -> str | None:
    packets = [m.group(0).decode("utf-8", "replace") for m in XMP_META.finditer(data)]
    if packets:
        for packet in packets:
            if "crs:" in packet or "camera-raw-settings" in packet:
                return packet
        return max(packets, key=len)
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
    # JPEG/TIFF often store a stub XMP first and the crs: packet later.
    with path.open("rb") as handle:
        blob = handle.read(8_000_000)
    packet = extract_xmp_packet(blob)
    if packet and ("crs:" in packet or "camera-raw-settings" in packet):
        return packet
    if path.stat().st_size > 8_000_000:
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - 4_000_000))
            tail = handle.read()
        later = extract_xmp_packet(tail)
        if later:
            return later
    return packet


def _is_pv2012(attrs: dict[str, str]) -> bool:
    if any(key.endswith("2012") and key.startswith(("Exposure", "Highlights", "Shadows", "Whites", "Blacks", "Contrast")) for key in attrs):
        return True
    process = attrs.get("ProcessVersion", "")
    try:
        return float(process) >= 6.7
    except ValueError:
        return False


def map_crs_to_rayfine(attrs: dict[str, str]) -> ToneMapping:
    pv2012 = _is_pv2012(attrs)
    mapped = ToneMapping(
        process_version=attrs.get("ProcessVersion"),
        crs_version=attrs.get("Version"),
        tone_curve_name=(
            attrs.get("ToneCurveName2012") or attrs.get("ToneCurveName")
            if pv2012
            else attrs.get("ToneCurveName") or attrs.get("ToneCurveName2012")
        ),
        white_balance=attrs.get("WhiteBalance"),
        camera_profile=attrs.get("CameraProfile"),
        vibrance=_num(attrs.get("Vibrance", "0")) or 0.0,
        saturation=_num(attrs.get("Saturation", "0")) or 0.0,
    )
    temp = _num(attrs["Temperature"]) if "Temperature" in attrs else None
    tint = _num(attrs["Tint"]) if "Tint" in attrs else None
    mapped.temperature_k = temp
    mapped.tint = tint

    if pv2012:
        mapped.source = "pv2012"
        mapped.exposure = _num(attrs.get("Exposure2012", "0")) or 0.0
        mapped.highlights = _num(attrs.get("Highlights2012", "0")) or 0.0
        mapped.shadows = _num(attrs.get("Shadows2012", "0")) or 0.0
        mapped.whites = _num(attrs.get("Whites2012", "0")) or 0.0
        mapped.blacks = _num(attrs.get("Blacks2012", "0")) or 0.0
        mapped.contrast = _num(attrs.get("Contrast2012", "0")) or 0.0
        mapped.dehaze = _num(attrs.get("Dehaze", "0")) or 0.0
        mapped.clarity = _num(attrs.get("Clarity2012", attrs.get("Clarity", "0"))) or 0.0
        mapped.texture = _num(attrs.get("Texture", "0")) or 0.0
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
        mapped.blacks = max(-100.0, min(100.0, -(shadows_pv2010 - 5.0) * 2.0))
        mapped.whites = 0.0
        mapped.contrast = contrast
        mapped.brightness = brightness
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
                "PV2010 Shadows (default 5) → Blacks2012 via −2×(Shadows−5), clamped ±100; Whites stay 0.",
                "PV2010 Brightness is folded as Exposure += Brightness/100 (FiveK 0-base).",
            ]
        )

    hsl_keys = (
        "HueAdjustmentRed",
        "HueAdjustmentOrange",
        "HueAdjustmentYellow",
        "HueAdjustmentGreen",
        "HueAdjustmentAqua",
        "HueAdjustmentBlue",
        "HueAdjustmentPurple",
        "HueAdjustmentMagenta",
        "SaturationAdjustmentRed",
        "SaturationAdjustmentOrange",
        "SaturationAdjustmentYellow",
        "SaturationAdjustmentGreen",
        "SaturationAdjustmentAqua",
        "SaturationAdjustmentBlue",
        "SaturationAdjustmentPurple",
        "SaturationAdjustmentMagenta",
        "LuminanceAdjustmentRed",
        "LuminanceAdjustmentOrange",
        "LuminanceAdjustmentYellow",
        "LuminanceAdjustmentGreen",
        "LuminanceAdjustmentAqua",
        "LuminanceAdjustmentBlue",
        "LuminanceAdjustmentPurple",
        "LuminanceAdjustmentMagenta",
    )
    mapped.hsl = {
        key: value
        for key in hsl_keys
        if (value := _num(attrs.get(key, "0")) or 0.0)
    }
    mapped.parametric = {
        key: _num(attrs.get(key, "0")) or 0.0
        for key in (
            "ParametricShadows",
            "ParametricDarks",
            "ParametricLights",
            "ParametricHighlights",
            "ParametricShadowSplit",
            "ParametricMidtoneSplit",
            "ParametricHighlightSplit",
        )
        if key in attrs
    }
    mapped.calibration = {
        key: value
        for key in (
            "RedHue",
            "RedSaturation",
            "GreenHue",
            "GreenSaturation",
            "BlueHue",
            "BlueSaturation",
            "ShadowTint",
        )
        if (value := _num(attrs.get(key, "0")) or 0.0)
    }
    if attrs.get("HasCrop") == "True":
        mapped.crop = {
            key: _num(attrs.get(key, "0")) or 0.0
            for key in ("CropLeft", "CropTop", "CropRight", "CropBottom", "CropAngle")
        }
    unimplemented = []
    if mapped.tone_curve_name and mapped.tone_curve_name not in {
        "Linear",
        "Linear Contrast",
        "Medium Contrast",
        "MediumContrast",
    }:
        unimplemented.append(f"named curve {mapped.tone_curve_name!r} (applied as Medium Contrast stand-in)")
    if mapped.white_balance and mapped.white_balance not in {"As Shot", "AsShot"}:
        mapped.limits.append(
            f"White balance {mapped.white_balance!r} is recorded; the Adobe path applies Temperature/Tint."
        )
    if unimplemented:
        mapped.limits.extend(unimplemented)
    return mapped


def _parse_curve_seq(xmp: str, tag: str) -> list[tuple[float, float]]:
    block = re.search(rf"<crs:{tag}>(.*?)</crs:{tag}>", xmp, flags=re.DOTALL)
    if not block:
        return []
    points = []
    for item in re.findall(r"<rdf:li>([^<]+)</rdf:li>", block.group(1)):
        parts = [p.strip() for p in item.split(",")]
        if len(parts) >= 2:
            x = _num(parts[0])
            y = _num(parts[1])
            if x is not None and y is not None:
                points.append((x, y))
    return points


def map_xmp_text(xmp: str) -> ToneMapping:
    mapped = map_crs_to_rayfine(parse_crs_attrs(xmp))
    look = parse_look_parameters(xmp)
    look_name = re.search(r'<crs:Look[\s\S]*?crs:Name="([^"]+)"', xmp)
    if look_name:
        mapped.look_name = look_name.group(1)
    look_uuid = re.search(r'crs:LookTable="([0-9A-Fa-f]+)"', xmp)
    if look_uuid:
        mapped.look_uuid = look_uuid.group(1).upper()
    look_amount = re.search(r'<crs:Look[\s\S]*?crs:Amount="([^"]+)"', xmp)
    if look_amount and (amt := _num(look_amount.group(1))) is not None:
        mapped.look_amount = amt
    attrs = parse_crs_attrs(xmp)
    if "ColorNoiseReduction" in attrs:
        mapped.color_nr = _num(attrs["ColorNoiseReduction"]) or 0.0
    if "LuminanceSmoothing" in attrs:
        mapped.luma_nr = _num(attrs["LuminanceSmoothing"]) or 0.0
    if "Sharpness" in attrs:
        mapped.sharpness = _num(attrs["Sharpness"]) or 0.0
    mapped.lens_profile = attrs.get("LensProfileEnable") in {"1", "True", "true"}
    mapped.remove_ca = attrs.get("AutoLateralCA") in {"1", "True", "true"}
    if look:
        mapped.highlights += _num(look.get("Highlights2012", "0")) or 0.0
        mapped.shadows += _num(look.get("Shadows2012", "0")) or 0.0
        mapped.clarity += _num(look.get("Clarity2012", "0")) or 0.0
        mapped.unused["look_parameters"] = look
        mapped.limits.append(
            f"Look {mapped.look_name or 'unnamed'} numeric extras were added to H/S/Clarity; "
            "LookTable UUID is applied from the fetched Adobe XMP when present."
        )
    mapped.tone_curve_pv2012 = _parse_curve_seq(xmp, "ToneCurvePV2012")
    look_curve = _parse_look_curve(xmp)
    if look_curve and look_curve != [(0.0, 0.0), (255.0, 255.0)]:
        mapped.tone_curve_pv2012 = look_curve
        mapped.limits.append("Look ToneCurvePV2012 is applied (Adobe Look S-curve).")
    elif mapped.tone_curve_pv2012 and mapped.tone_curve_pv2012 != [(0.0, 0.0), (255.0, 255.0)]:
        mapped.limits.append("ToneCurvePV2012 point curve is applied in the Adobe path.")
    for tag in ("ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue"):
        pts = _parse_curve_seq(xmp, tag)
        if pts and pts != [(0.0, 0.0), (255.0, 255.0)]:
            mapped.unused[tag] = pts
            mapped.limits.append(f"{tag} is recorded but not applied (per-channel point curve).")
    if "<crs:Correction" in xmp or "MaskGroupBasedCorrections" in xmp:
        mapped.limits.append("Local corrections / gradient masks are not applied.")
    return mapped


def _parse_look_curve(xmp: str) -> list[tuple[float, float]]:
    block = re.search(r"<crs:Look>(.*?)</crs:Look>", xmp, flags=re.DOTALL)
    if not block:
        return []
    return _parse_curve_seq(block.group(0), "ToneCurvePV2012")


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
    payload["adobe"] = mapped.adobe_json()
    payload["lightcraft"] = mapped.lightcraft_json()
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
