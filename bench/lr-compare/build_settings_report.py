"""Build the offline Develop comparison report from existing experiment files.

No image is embedded, no measurement is recomputed, and absent data is never zero.
Call build_report() after measure_develop writes measurements.json. A custom
--ray-dir must match the directory used by measure_develop for that run.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone, timedelta
import json
import math
from pathlib import Path
import struct
import zlib

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CLIENT_DATE = "2026-10-01"
METRICS = ("mae_srgb_pct", "lightness_mae_pct", "p95_srgb_pct",
           "worst_region_mae_pct", "chroma_delta_ab_mean", "rmse_srgb_pct")
BANDS = dict(reds="Rouges", oranges="Oranges", yellows="Jaunes", greens="Verts",
             aquas="Turquoises", blues="Bleus", purples="Violets", magentas="Magentas")
COMPONENTS = dict(hue="Teinte", saturation="Saturation", luminance="Luminance")
ADOBE = dict(exposure="Exposure2012", contrast="Contrast2012", highlights="Highlights2012",
             shadows="Shadows2012", whites="Whites2012", blacks="Blacks2012",
             clarity="Clarity2012", dehaze="Dehaze", structure="Texture", vibrance="Vibrance",
             saturation="Saturation", temperature="Temperature", tint="Tint",
             sharpness="Sharpness", grainAmount="GrainAmount", grainSize="GrainSize",
             grainRoughness="GrainFrequency", cameraProfile="CameraProfile",
             sharpenRadius="SharpenRadius", sharpenDetail="SharpenDetail", sharpenMasking="SharpenEdgeMasking")


def inventory():
    """Explicit UI inventory, audited against adjustments.ts and actual panels.

    Storage/cache fields (LUT bytes/path/size, depth-map bytes, mask ids, section
    expansion, generated curves) intentionally have no standalone control rows.
    """
    controls = []
    def add(group, values):
        controls.extend(dict(key=k, label=v, group=group) for k, v in values.items())
    add("Réglages de base", dict(exposure="Exposition", contrast="Contraste", highlights="Hautes lumières",
        shadows="Ombres", whites="Blancs", blacks="Noirs", temperature="Température", tint="Correction de teinte",
        vibrance="Vibrance", saturation="Saturation", cameraProfile="Profil caméra", whiteBalance="Préréglage balance des blancs",
        convertToGrayscale="Traitement noir et blanc", hdrEditMode="Mode HDR", autoAdjustments="Réglage automatique"))
    add("Présence", dict(structure="Texture", clarity="Clarté", dehaze="Correction du voile"))
    add("Détail", {
        "sharpness": "Netteté", "sharpenRadius": "Rayon de netteté", "sharpenDetail": "Détail de netteté",
        "sharpenMasking": "Masquage de netteté", "lumaNoiseReduction": "Bruit luminance",
        "lumaNoiseDetail": "Détail bruit luminance", "lumaNoiseContrast": "Contraste bruit luminance",
        "colorNoiseReduction": "Bruit couleur", "colorNoiseDetail": "Détail bruit couleur", "colorNoiseSmoothness": "Lissage bruit couleur",
        "chromaticAberrationRedCyan": "Aberration rouge/cyan", "chromaticAberrationBlueYellow": "Aberration bleu/jaune"})
    add("Courbes", {"curveMode": "Mode points / paramétrique"})
    for channel, label in dict(luma="RVB", red="Rouge", green="Vert", blue="Bleu").items():
        add("Courbes", {f"curves.{channel}": f"Courbe à points {label}"})
        for key, name in dict(whiteLevel="Niveau blanc", highlights="Hautes lumières", lights="Tons clairs",
                darks="Tons foncés", shadows="Ombres", blackLevel="Niveau noir", split1="Séparation 1",
                split2="Séparation 2", split3="Séparation 3").items():
            add("Courbes", {f"parametricCurve.{channel}.{key}": f"{label} · {name}"})
    add("Mélangeur de couleurs", {"hue": "Teinte globale"})
    for band, label in BANDS.items():
        for key, name in COMPONENTS.items():
            add("Mélangeur de couleurs", {f"hsl.{band}.{key}": f"{label} · {name}"})
        add("Mélange noir et blanc", {f"grayMixer.{band}": label})
    for key, name in dict(sourceHue="Teinte source", sourceSaturation="Saturation source", sourceLuminance="Luminance source",
            shiftHue="Décalage teinte", shiftSaturation="Décalage saturation", range="Étendue", selection="Sélection / suppression").items():
        add("Couleur ponctuelle", {f"pointColors.{key}": name})
    for zone, label in dict(shadows="Ombres", midtones="Tons moyens", highlights="Hautes lumières", global_="Global").items():
        zone = zone.rstrip("_")
        for key, name in COMPONENTS.items():
            add("Color grading", {f"colorGrading.{zone}.{key}": f"{label} · {name}"})
    add("Color grading", {"colorGrading.blending": "Fusion", "colorGrading.balance": "Balance"})
    add("Étalonnage", {"colorCalibration.shadowsTint": "Teinte des ombres"})
    for band, label in dict(red="Rouge", green="Vert", blue="Bleu").items():
        for component, name in dict(Hue="Teinte", Saturation="Saturation").items():
            add("Étalonnage", {f"colorCalibration.{band}{component}": f"Primaire {label} · {name}"})
    add("Optique", dict(lensCorrectionMode="Mode auto / manuel", lensMaker="Fabricant objectif", lensModel="Modèle objectif",
        lensDistortionEnabled="Correction de profil : distorsion", lensVignetteEnabled="Correction de profil : vignettage",
        lensTcaEnabled="Suppression aberrations chromatiques", lensDistortionAmount="Distorsion de profil : quantité",
        lensVignetteAmount="Vignettage de profil : quantité", defringePurpleAmount="Frange violette : quantité",
        defringePurpleHueLo="Frange violette : teinte basse", defringePurpleHueHi="Frange violette : teinte haute",
        defringeGreenAmount="Frange verte : quantité", defringeGreenHueLo="Frange verte : teinte basse",
        defringeGreenHueHi="Frange verte : teinte haute", lensManualVignetteAmount="Vignettage manuel : quantité",
        lensVignetteMidpoint="Vignettage manuel : milieu"))
    add("Géométrie et recadrage", dict(transformDistortion="Distorsion", transformVertical="Vertical", transformHorizontal="Horizontal",
        transformRotate="Rotation transformation", transformAspect="Aspect", transformScale="Échelle", transformXOffset="Décalage X",
        transformYOffset="Décalage Y", perspectiveUpright="Upright", guidedUprightLines="Guides Upright", cropConstrainToWarp="Contraindre le recadrage",
        crop="Recadrage", aspectRatio="Rapport de recadrage", rotation="Redressement", orientationSteps="Rotation 90°",
        flipHorizontal="Symétrie horizontale", flipVertical="Symétrie verticale", anamorphicSqueeze="Ratio anamorphique"))
    add("Flou d’objectif", dict(lensBlurEnabled="Activer", lensBlurAmount="Quantité", lensBlurDiffusion="Diffusion", lensBlurShape="Forme bokeh",
        lensBlurMinDepth="Profondeur min", lensBlurMaxDepth="Profondeur max", lensBlurMinFade="Transition min", lensBlurMaxFade="Transition max"))
    add("Effets", dict(glowAmount="Glow", halationAmount="Halation", flareAmount="Flare", grainAmount="Grain : quantité", grainSize="Grain : taille",
        grainRoughness="Grain : rugosité", vignetteAmount="Vignette : quantité", vignetteMidpoint="Vignette : milieu",
        vignetteRoundness="Vignette : arrondi", vignetteFeather="Vignette : contour", lutName="Sélection LUT", lutIntensity="Intensité LUT"))
    add("Masques et retouches", dict(masks="Masques locaux et leurs réglages", **{
        "masks.opacity": "Opacité masque", "masks.invert": "Inversion masque", "masks.visible": "Activation masque",
        "masks.subMasks": "Sélections / pinceaux / gradients", "aiPatches": "Retouche IA et prompt"}))
    return controls


def flatten(value, prefix=""):
    result = {}
    for key, v in value.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(v, dict):
            result.update(flatten(v, path))
        else:
            result[path.replace("pointCurves.", "curves.")] = v
    return result


def read_json(path, kind):
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(value, kind):
            raise ValueError("structure JSON inattendue")
        return value, None
    except (OSError, ValueError) as exc:
        return kind(), f"{path.name} : {exc}"


def adobe_key(key):
    parts = key.split(".")
    if parts[0] == "curves" and len(parts) == 2:
        return "ToneCurvePV2012" + ("" if parts[1] == "luma" else parts[1].title())
    if parts[0] == "hsl" and len(parts) == 3:
        band = dict(reds="Red", oranges="Orange", yellows="Yellow", greens="Green", aquas="Aqua", blues="Blue", purples="Purple", magentas="Magenta")[parts[1]]
        return parts[2].title() + "Adjustment" + band
    if parts[0] == "colorGrading" and len(parts) == 3:
        zone, component = parts[1:]
        if zone in ("shadows", "highlights") and component in ("hue", "saturation"):
            return "SplitToning" + ("Shadow" if zone == "shadows" else "Highlight") + component.title()
        return "ColorGrade" + dict(shadows="Shadow", midtones="Midtone", highlights="Highlight", global_="Global").get(zone, zone.title()) + dict(hue="Hue", saturation="Sat", luminance="Lum")[component]
    return ADOBE.get(key)


def valid_image(path):
    try:
        with path.open("rb") as stream:
            size = path.stat().st_size
            header = stream.read(8)
            if size < 64:
                return False
            if path.suffix.lower() == ".png":
                if header != b"\x89PNG\r\n\x1a\n":
                    return False
                seen = set()
                while stream.tell() < size:
                    length, kind = struct.unpack(">I4s", stream.read(8))
                    if length > size - stream.tell() - 4:
                        return False
                    payload = stream.read(length)
                    crc, = struct.unpack(">I", stream.read(4))
                    if zlib.crc32(kind + payload) & 0xffffffff != crc:
                        return False
                    seen.add(kind)
                    if kind == b"IEND":
                        return {b"IHDR", b"IDAT", b"IEND"} <= seen
                return False
            if header[:4] not in (b"II*\x00", b"MM\x00*"):
                return False
            endian = "<" if header[:2] == b"II" else ">"
            offset, = struct.unpack(endian + "I", header[4:])
            if offset < 8 or offset + 2 > size:
                return False
            stream.seek(offset)
            count, = struct.unpack(endian + "H", stream.read(2))
            if stream.tell() + count * 12 + 4 > size:
                return False
            entries = [stream.read(12) for _ in range(count)]
            tags = {}
            widths = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}
            for entry in entries:
                tag, typ, amount, value = struct.unpack(endian + "HHII", entry)
                length = widths.get(typ, 0) * amount
                if not length or length > size:
                    return False
                if length > 4:
                    if value + length > size:
                        return False
                    stream.seek(value)
                    raw = stream.read(length)
                else:
                    raw = entry[8:8 + length]
                if tag in (256, 257, 273, 279, 324, 325) and typ in (3, 4):
                    tags[tag] = struct.unpack(endian + ("H" if typ == 3 else "I") * amount, raw)
            offsets = tags.get(273, tags.get(324, ()))
            lengths = tags.get(279, tags.get(325, ()))
            return bool(tags.get(256) and tags.get(257) and offsets and len(offsets) == len(lengths)
                        and all(0 < n and 0 <= o and o + n <= size for o, n in zip(offsets, lengths)))
    except (OSError, struct.error, ValueError, OverflowError):
        return False


def dataset(root, controls, ray_dir):
    cases, case_error = read_json(root / "cases.json", list)
    measurements, metric_error = read_json(root / "measurements.json", list)
    warnings = [v for v in (case_error, metric_error) if v]
    names = [c.get("name") for c in cases if isinstance(c, dict)]
    duplicates = {n for n, count in Counter(names).items() if count > 1}
    by_name = {}
    for measurement in measurements:
        if not isinstance(measurement, dict) or not isinstance(measurement.get("case"), str):
            warnings.append("Ligne de mesure invalide")
            continue
        name = measurement["case"]
        if name in by_name:
            duplicates.add(name)
        by_name[name] = measurement
        if name not in names:
            warnings.append(f"Mesure hors manifeste : {name}")
    rows = []
    coverage = {c["key"]: [] for c in controls}
    metric_path = root / "measurements.json"
    mtime = metric_path.stat().st_mtime if metric_path.exists() else 0
    if not metric_error and (root / "cases.json").stat().st_mtime > mtime:
        warnings.append("Le manifeste est plus récent que les mesures : vérifier les cas ; mesures marquées périmées.")
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("name"), str) or not isinstance(case.get("adjustments"), dict):
            warnings.append("Cas invalide dans cases.json")
            continue
        name = case["name"]
        if Path(name).name != name or name in (".", ".."):
            warnings.append(f"Identifiant de cas non sûr : {name}")
            continue
        flat = flatten(case["adjustments"])
        keys = list(flat)
        known = [key for key in keys if key in coverage]
        unknown = [key for key in keys if key not in coverage]
        lr_path = root / "lightroom" / name / "settings.json"
        lr, lr_error = read_json(lr_path, dict)
        reasons = []
        if metric_error: reasons.append(metric_error)
        if name not in by_name: reasons.append("Cas absent du fichier de mesures courant (export partiel ou non mesuré)")
        if name in duplicates: reasons.append("Identifiant de cas dupliqué")
        if lr_error: reasons.append(lr_error)
        captures = list(lr_path.parent.glob("*.tif")) + list(lr_path.parent.glob("*.tiff"))
        native = root / ray_dir / f"{name}.png"
        if not captures or not all(valid_image(p) for p in captures): reasons.append("Capture Lightroom absente ou structure TIFF invalide / tronquée")
        if not valid_image(native): reasons.append("Capture Rayfine absente ou structure / checksum PNG invalide")
        inputs = [root / "cases.json", lr_path, native, *captures]
        if mtime and any(p.exists() and p.stat().st_mtime > mtime for p in inputs):
            reasons.append("Mesure périmée : manifeste, réglages ou capture modifiés après measurements.json")
        metric = by_name.get(name, {})
        if name in by_name:
            for key in METRICS:
                value = metric.get(key)
                if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0):
                    reasons.append(f"Métrique invalide : {key}")
            if not isinstance(metric.get("mae_srgb_pct"), (float, int)):
                reasons.append("MAE RVB manquante")
        mapped = {key: {"adobe_key": adobe_key(key), "value": lr.get(adobe_key(key))} for key in keys if adobe_key(key)}
        # An isolated case is valid only if unrelated basic sliders stayed neutral.
        # A successful controller reset alone does not guarantee that in Lightroom.
        if not lr_error:
            for correction in ("MaskGroupBasedCorrections", "PaintBasedCorrections", "GradientBasedCorrections", "CircularGradientBasedCorrections", "RetouchAreas", "RedEyeInfo"):
                if lr.get(correction) and not any(key.startswith(('masks','aiPatches')) for key in keys):
                    reasons.append(f"Référence non isolée : corrections locales présentes ({correction})")
            for key in ("exposure", "contrast", "highlights", "shadows", "whites", "blacks", "structure", "clarity", "dehaze", "vibrance", "saturation"):
                adobe = adobe_key(key)
                if adobe and lr.get(adobe) != flat.get(key, 0):
                    reasons.append(f"Référence non isolée : {adobe}={lr.get(adobe)}, attendu {flat.get(key, 0)}")
        # Validate direct-valued controls and point coordinates, not differently
        # scaled WB: temperature is relative mired, tint is an as-shot offset.
        for key in keys:
            adobe = adobe_key(key)
            if not adobe or key in ("temperature", "tint") or lr_error:
                continue
            expected = flat[key]
            if key.startswith("curves.") and isinstance(expected, list):
                expected = [v for point in expected for v in (point["x"], point["y"])]
            if adobe not in lr or lr[adobe] != expected:
                reasons.append(f"Réglage Lightroom incohérent : {adobe}")
        combined = len(keys) > 1
        group = "Combinaisons" if combined else next((c["group"] for c in controls if c["key"] in known), "Référence")
        status = "indisponible" if reasons else ("mesuré ≤ 5 %" if metric["mae_srgb_pct"] <= 5 else "mesuré > 5 %")
        row = dict(kind="case", group=group, label=name, photo=root.name, path=case.get("raw", "—"), keys=known,
            native=case["adjustments"], adobe=mapped, adobe_snapshot=lr, combined=combined,
            status=status, reason=" ; ".join(reasons), metrics={} if reasons else {key: metric.get(key) for key in METRICS},
            attribution="Cas combiné : résultat du cas entier, aucun écart attribué à un curseur isolé." if combined else "Cas isolé" if keys else "Référence neutre")
        rows.append(row)
        for key in known: coverage[key].append(row)
        if unknown: warnings.append(f"{name} : clés sans contrôle inventorié : {', '.join(unknown)}")
    for control in controls:
        linked = coverage[control["key"]]
        isolated = [r for r in linked if not r["combined"] and r["status"].startswith("mesuré")]
        combined = [r for r in linked if r["combined"] and r["status"].startswith("mesuré")]
        status = "couvert isolément" if isolated else "test combiné uniquement" if combined else "non testé"
        ranges = {}
        for key in METRICS:
            values = [r["metrics"][key] for r in isolated if isinstance(r["metrics"].get(key), (int, float))]
            if values:
                ranges[key] = [min(values), max(values)]
        rows.append(dict(kind="control", **control, photo=root.name, path="—", keys=[control["key"]],
            status=status, reason="Plage min–max des cas isolés mesurés, aux valeurs indiquées ; aucune extrapolation." if isolated else "Voir les cas combinés ; aucun pourcentage isolé." if linked else "Aucun cas enregistré pour ce contrôle.",
            native=None, adobe=None, metrics=ranges, isolated_details=[dict(case=r["label"], native=r["native"], metrics=r["metrics"]) for r in isolated], cases=[r["label"] for r in linked], combined=False))
    return dict(photo=root.name, case_count=len(cases), measured=sum(r["status"].startswith("mesuré") for r in rows),
        isolated_controls=sum(r["status"] == "couvert isolément" for r in rows),
        combined_only_controls=sum(r["status"] == "test combiné uniquement" for r in rows),
        warnings=warnings, rows=rows, measurement_updated_utc=datetime.fromtimestamp(mtime, timezone.utc).isoformat() if mtime else None,
        ray_dir=ray_dir, source=str(root))


TEMPLATE = r'''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rayfine / Lightroom — tous les réglages Develop</title>
<style>
:root{font-family:system-ui,sans-serif;color:#dae2ee;background:#10151d;color-scheme:dark}body{margin:28px;line-height:1.45}h1{font-size:24px}p{max-width:1200px}small,.muted{color:#a6b3c6}select,input,button{padding:8px;border:1px solid #465166;border-radius:5px;background:#202938;color:inherit}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}label{display:flex;gap:7px;align-items:center}.wrap{overflow:auto;max-height:70vh;border:1px solid #354056}table{border-collapse:collapse;width:100%;font-size:13px}th{position:sticky;top:0;background:#273245;text-align:left;white-space:nowrap}td,th{padding:9px;border-bottom:1px solid #354056;vertical-align:top}td.num{text-align:right;white-space:nowrap}td:nth-child(2){min-width:195px}details{max-width:450px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}tr.control{background:#17202d}.bad{color:#ffb4a8}.good{color:#a5d9b7}.warn{color:#f2cf8e}#summary{padding:12px;background:#202938;border-radius:7px}.optional{display:none}.show-optional .optional{display:table-cell}summary{cursor:pointer}a{color:#bbd1fc}
</style></head><body>
<h1>Rayfine / Lightroom · réglages Develop</h1>
<p class="muted" id="generated"></p>
<p>État des captures du pipeline natif actuel, sur les photos et valeurs indiquées. Ce rapport ne prouve pas une parité complète avec Lightroom. Les contrôles sans mesure affichent <strong>—</strong>, jamais 0 %.</p>
<details open><summary>Comment lire les écarts et la couverture</summary>
<p><strong>RVB moyen</strong> : MAE entre codes sRGB, normalisée sur toute la plage des codes (0–255 ou 0–65535), en %. <strong>Luminosité</strong> : MAE de L*, rapportée à l’échelle 0–100, en %. <strong>Chroma</strong> : distance moyenne dans le plan a*b*, en unités Lab ; ce n’est pas un pourcentage ni un ΔE complet.</p>
<p>Le seuil 5 % porte uniquement sur la moyenne RVB du cas entier : il ne garantit pas chaque pixel, ni P95, ni chaque région. P95 et pire région (grille 8 × 8) restent distincts. Les cas combinés mesurent plusieurs composantes ensemble : aucun résultat n’est attribué isolément à un curseur. La couverture vient des réglages du manifeste, pas des noms des cas. La référence neutre ne teste aucun curseur.</p>
<p>Inventaire des contrôles des panneaux Develop, recadrage, masques et retouches ; données internes, caches, état d’affichage et commandes d’interface exclus. Les contrôles locaux sont regroupés sous Masques. Aucun fichier photo n’est incorporé. Les en-têtes de captures et leur date sont vérifiés ; le décodage intégral des images appartient au script de mesure. Les fichiers de mesures ne contiennent pas d’empreinte du moteur : une mesure récente ne certifie pas qu’elle correspond au code actuellement modifié.</p></details>
<div id="summary"></div><details><summary>Sources, fraîcheur et anomalies</summary><div id="sources"></div></details>
<nav><label>Photo <select id="photo"></select></label><label>Groupe <select id="group"></select></label><label>Vue <select id="kind"><option value="">Contrôles et cas</option><option value="control">Tous les contrôles</option><option value="case">Cas expérimentaux</option></select></label><label>État <select id="status"></select></label><input id="search" aria-label="Recherche" placeholder="Rechercher réglage, cas, valeur…"><label><input type="checkbox" id="extra"> P95 / région / RMSE</label></nav>
<p id="count" class="muted"></p><div class="wrap"><table id="table"><thead><tr><th>Groupe</th><th>Réglage / cas</th><th>Valeur native / Adobe</th><th>Photo</th><th>RVB moyen %</th><th>Luminosité %</th><th>Chroma · unités Lab</th><th class="optional">P95 RVB %</th><th class="optional">Pire région %</th><th class="optional">RMSE RVB %</th><th>État / attribution</th></tr></thead><tbody id="rows"></tbody></table></div>
<script type="application/json" id="report-data">__DATA__</script>
<script>
const data=JSON.parse(document.getElementById('report-data').textContent),rows=data.datasets.flatMap(d=>d.rows),$=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e};
const fmt=v=>Array.isArray(v)?v.map(fmt).join(' – '):typeof v==='number'?v.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
$('generated').textContent=`Généré le ${data.generated_paris} (Europe/Paris) · UTC ${data.generated_utc} · date client source ${data.client_date}`;
for(const [id,values,label] of [['photo',data.datasets.map(d=>d.photo),'Toutes'],['group',rows.map(r=>r.group),'Tous'],['status',rows.map(r=>r.status),'Tous']]){const el=$(id);el.add(new Option(label,''));[...new Set(values)].sort().forEach(v=>el.add(new Option(v,v)));}
for(const d of data.datasets){const block=document.createElement('p');block.append(text('strong',d.photo+': '),text('span',`${d.measured}/${d.case_count} cas mesurés valides ; ${d.isolated_controls}/${data.control_count} contrôles couverts isolément, ${d.combined_only_controls} uniquement en combinaison. `));$('summary').append(block);const source=document.createElement('p');source.append(text('strong',d.photo+' '),text('span',`${d.source} · images natives : ${d.ray_dir} · mesures UTC : ${d.measurement_updated_utc||'indisponible'}`));$('sources').append(source);for(const w of d.warnings)$('sources').append(text('p',w,'warn'));}
function detail(cell,title,value){const box=document.createElement('details');box.append(text('summary',title),text('pre',JSON.stringify(value,null,2)));cell.append(box);}
function render(){const needle=$('search').value.toLocaleLowerCase('fr');const selected=rows.filter(r=>(!$('photo').value||r.photo===$('photo').value)&&(!$('group').value||r.group===$('group').value)&&(!$('kind').value||r.kind===$('kind').value)&&(!$('status').value||r.status===$('status').value)&&(!needle||JSON.stringify(r).toLocaleLowerCase('fr').includes(needle)));$('rows').replaceChildren();$('table').classList.toggle('show-optional',$('extra').checked);for(const r of selected){const tr=document.createElement('tr');tr.className=r.kind;tr.append(text('td',r.group));const label=text('td',r.label);label.append(document.createElement('br'),text('small',r.kind==='control'?r.key:r.keys.join(', ')||'Référence neutre'));tr.append(label);const values=document.createElement('td');if(r.kind==='case'){detail(values,'Rayfine : '+JSON.stringify(r.native),r.native);detail(values,'Adobe : réglages correspondants',r.adobe);detail(values,'Instantané Adobe complet',r.adobe_snapshot);}else {values.append(text('small',r.cases?.length?'Cas : '+r.cases.join(', '):'—'));if(r.isolated_details?.length)detail(values,'Valeurs et écarts des cas isolés',r.isolated_details);}tr.append(values);const photo=text('td',r.photo);photo.title=r.path;tr.append(photo);for(const [i,k] of ['mae_srgb_pct','lightness_mae_pct','chroma_delta_ab_mean','p95_srgb_pct','worst_region_mae_pct','rmse_srgb_pct'].entries())tr.append(text('td',fmt(r.metrics[k]),'num'+(i>=3?' optional':'')));const state=text('td',r.status,r.status==='mesuré > 5 %'?'bad':r.status==='mesuré ≤ 5 %'?'good':'warn');state.append(document.createElement('br'),text('small',r.reason||r.attribution||''));tr.append(state);$('rows').append(tr);}$('count').textContent=`${selected.length} lignes affichées · les contrôles présentent les plages min–max des essais isolés ; les cas montrent les écarts exacts.`;}
for(const id of ['photo','group','kind','status','search','extra'])$(id).addEventListener('input',render);render();
</script></body></html>'''


def build_report(output=None, roots=None, ray_dir="rayfine"):
    """Refresh the self-contained HTML and return its absolute Path."""
    controls = inventory()
    roots = [Path(p) for p in roots] if roots is not None else [HERE / "out" / p for p in ("A7S02588", "A7S02589")]
    now = datetime.now(timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        paris = now.astimezone(ZoneInfo("Europe/Paris"))
    except (ImportError, KeyError):
        # EU DST: last Sunday in March at 01:00 UTC through last Sunday in October.
        def last_sunday(month):
            end = datetime(now.year, month + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
            return end.replace(day=end.day - (end.weekday() + 1) % 7, hour=1)
        offset = 2 if last_sunday(3) <= now < last_sunday(10) else 1
        paris = now.astimezone(timezone(timedelta(hours=offset)))
    data = dict(generated_utc=now.isoformat(timespec="seconds"), generated_paris=paris.isoformat(timespec="seconds"),
        client_date=paris.date().isoformat(), control_count=len(controls), datasets=[dataset(root, controls, ray_dir) for root in roots])
    encoded = json.dumps(data, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    output = Path(output) if output else HERE / "settings-comparison.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(TEMPLATE.replace("__DATA__", encoded), encoding="utf-8")
    return output.resolve()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--root", type=Path, action="append", help="Dataset directory; repeat for several photos")
    parser.add_argument("--ray-dir", default="rayfine", help="Must match the measurement run's native image directory")
    args = parser.parse_args()
    print(build_report(args.output, args.root, args.ray_dir))
