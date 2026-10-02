"""Capture real Lightroom develop renders on a dedicated virtual copy.

Never modifies the master photo. Saves settings read back from Lightroom for
every case, along with a manifest for the production Rayfine GPU test renderer.
"""
import asyncio
import argparse
import json
from pathlib import Path
from lightroom import LightroomClient

RAW = "F:/Photographie et Video/2026-08-28-AVION_TEST_FMS/PHOTOS/A7S02588.ARW"
COPY = "3455A4F2-A203-429D-942C-D41245F8435A"
MASTER = "9C38CAC4-0166-4C0B-A464-6C923C0FFAC1"
OUT = Path(__file__).parent / "out" / "A7S02588"
PAIRS = {
    "exposure": "Exposure2012", "contrast": "Contrast2012",
    "highlights": "Highlights2012", "shadows": "Shadows2012",
    "whites": "Whites2012", "blacks": "Blacks2012",
    "clarity": "Clarity2012", "dehaze": "Dehaze",
    "structure": "Texture", "vibrance": "Vibrance", "saturation": "Saturation",
}

async def main(args):
    global RAW,COPY,MASTER,OUT
    RAW,COPY,MASTER=args.raw,args.copy,args.master
    OUT=Path(args.out) if args.out else Path(__file__).parent/'out'/Path(RAW).stem
    assert COPY != MASTER, 'Calibration requires a separate virtual copy'
    OUT.mkdir(parents=True, exist_ok=True)
    async with LightroomClient.connect() as lr:
        original = await lr.develop.get_settings(MASTER)
        (OUT / "master-settings.json").write_text(json.dumps(original, indent=2))
        # Controller reset can run before Lightroom finishes selecting the copy.
        # Use a previously verified capture as the baseline and apply it directly
        # to the explicit virtual-copy UUID instead of driving the active photo.
        template = Path(args.neutral_template) if args.neutral_template else OUT/'lightroom'/'neutral'/'settings.json'
        if not template.exists():
            raise ValueError('A verified neutral-template settings.json is required before capture')
        requested = json.loads(template.read_text())
        requested.update({key:0 for key in PAIRS.values()})
        requested.update({"CameraProfile": "Adobe Standard", "Look": {}, "Sharpness": 0, "ColorNoiseReduction": 0,
            "ToneCurveName2012":"Linear", **{key:[0,0,255,255] for key in ['ToneCurvePV2012','ToneCurvePV2012Red','ToneCurvePV2012Green','ToneCurvePV2012Blue']}})
        correction_keys = ['MaskGroupBasedCorrections','PaintBasedCorrections','GradientBasedCorrections',
            'CircularGradientBasedCorrections','RetouchAreas','RedEyeInfo']
        requested.update({key:[] for key in correction_keys})
        await lr.develop.apply_settings(requested, photo_uuids=[COPY])
        neutral = await lr.develop.get_settings(COPY)
        for key in PAIRS.values():
            assert neutral.get(key) == 0, f'Neutral reset did not apply: {key}={neutral.get(key)}'
        for key in correction_keys:
            assert not neutral.get(key), f'Neutral reference still contains local corrections: {key}'
        (OUT / "neutral-settings.json").write_text(json.dumps(neutral, indent=2))
        cases = [{"name": "neutral", "adjustments": {}, "settings": {}}]
        for ray, adobe in PAIRS.items():
            values = [-1, 1] if ray == "exposure" else [-50, 50]
            for value in values:
                cases.append({"name": f"{ray}_{'minus' if value < 0 else 'plus'}", "adjustments": {ray: value}, "settings": {adobe: value}})
        curve = [0, 0, 64, 45, 128, 140, 192, 215, 255, 255]
        cases.append({"name": "curve_rgb", "adjustments": {"curves": {"luma": [{"x": x, "y": y} for x,y in zip(curve[::2], curve[1::2])]}}, "settings": {"ToneCurvePV2012": curve}})
        red_curve = [0,10,64,90,128,150,192,215,255,245]
        cases.append({"name":"curve_asymmetric","adjustments":{"curves":{
            "luma":[{"x":x,"y":y} for x,y in zip(curve[::2],curve[1::2])],
            "red":[{"x":x,"y":y} for x,y in zip(red_curve[::2],red_curve[1::2])]}},
            "settings":{"ToneCurvePV2012":curve,"ToneCurvePV2012Red":red_curve}})
        mixed = {"exposure": .5, "contrast": 20, "highlights": -75, "shadows": 60, "whites": 20, "blacks": -30}
        cases.append({"name": "mixed", "adjustments": mixed, "settings": {PAIRS[k]: v for k,v in mixed.items()}})
        for ray, adobe in PAIRS.items():
            if ray == 'exposure':
                continue
            for value in [-100,100]:
                cases.append({"name":f"{ray}_{value}","adjustments":{ray:value},"settings":{adobe:value}})
        for channel, key in [('red','ToneCurvePV2012Red'),('green','ToneCurvePV2012Green'),('blue','ToneCurvePV2012Blue')]:
            cases.append({"name":f"curve_{channel}","adjustments":{"curves":{channel:[{"x":x,"y":y} for x,y in zip(curve[::2],curve[1::2])]}},"settings":{key:curve}})
        cases.append({"name":"curve_combined","adjustments":{"curves":{k:[{"x":x,"y":y} for x,y in zip(curve[::2],curve[1::2])] for k in ['luma','red','blue']}},"settings":{k:curve for k in ['ToneCurvePV2012','ToneCurvePV2012Red','ToneCurvePV2012Blue']}})
        for k in [4000,8000]:
            relative=-(1e6/k-1e6/neutral['Temperature'])/150*100
            cases.append({"name":f"temperature_{k}","adjustments":{"temperature":relative},"settings":{"WhiteBalance":"Custom","Temperature":k}})
        for tint in [-40,40]:
            cases.append({"name":f"tint_{tint}","adjustments":{"tint":tint},"settings":{"WhiteBalance":"Custom","Tint":neutral['Tint']+tint}})
        for name,band in [('reds','Red'),('oranges','Orange'),('yellows','Yellow'),('greens','Green'),('aquas','Aqua'),('blues','Blue'),('purples','Purple'),('magentas','Magenta')]:
            cases.append({"name":f"hsl_{name}","adjustments":{"hsl":{name:{"hue":20,"saturation":-30,"luminance":20}}},"settings":{f"HueAdjustment{band}":20,f"SaturationAdjustment{band}":-30,f"LuminanceAdjustment{band}":20}})
        for name, keys in [('shadows',('SplitToningShadowHue','SplitToningShadowSaturation','ColorGradeShadowLum')),('midtones',('ColorGradeMidtoneHue','ColorGradeMidtoneSat','ColorGradeMidtoneLum')),('highlights',('SplitToningHighlightHue','SplitToningHighlightSaturation','ColorGradeHighlightLum')),('global',('ColorGradeGlobalHue','ColorGradeGlobalSat','ColorGradeGlobalLum'))]:
            cases.append({"name":f"grading_{name}","adjustments":{"colorGrading":{name:{"hue":220,"saturation":20,"luminance":10}}},"settings":dict(zip(keys,[220,20,10]))})
        # Include the transition region when checking a continuous black response.
        for value in [1, 10, 25, 26, 75]:
            cases.append({"name":f"blacks_{value}","adjustments":{"blacks":value},"settings":{"Blacks2012":value}})
        for masking in [0,25,50,100]:
            adjustments = {"sharpness":75}
            if masking: adjustments["sharpenMasking"] = masking
            cases.append({"name":f"sharpen_mask_{masking}","adjustments":adjustments,
                "settings":{"Sharpness":75,"SharpenRadius":1.0,"SharpenDetail":25,"SharpenEdgeMasking":masking}})
        if args.only:
            wanted=set(args.only.split(','))|{'neutral'}
            cases=[c for c in cases if c['name'] in wanted]
        manifest = [{"raw": RAW, "name": c["name"], "adjustments": c["adjustments"]} for c in cases]
        (OUT / "cases.json").write_text(json.dumps(manifest, indent=2))
        for case in cases:
            dest = OUT / "lightroom" / case["name"]
            expected = neutral | case['settings']
            if list(dest.glob("*.tif")):
                recorded = json.loads((dest/'settings.json').read_text())
                # Lightroom infers the curve name after applying point curves.
                matches = all(recorded.get(k) == v for k,v in expected.items()
                    if k != 'ToneCurveName2012')
                if matches and case['name'] not in (args.force or '').split(','):
                    print("Validated cached capture", case["name"], flush=True)
                    continue
                export_path = dest / (Path(RAW).stem + '.tif')
                assert OUT.resolve() in export_path.resolve().parents
                export_path.unlink(missing_ok=True)
                print('Refreshing stale capture', case['name'], flush=True)
            await lr.develop.apply_settings(expected, photo_uuids=[COPY])
            settings = await lr.develop.get_settings(COPY)
            for key in PAIRS.values():
                assert settings.get(key) == expected[key], f'Capture setting mismatch: {key}'
            for key,value in case['settings'].items():
                if key != 'ToneCurveName2012':
                    assert settings.get(key) == value, f'Case readback mismatch: {key}'
            # Catalog writes complete before Camera Raw's render-state update.
            # Yield before exporting, otherwise consecutive color edits may reuse
            # the preceding rendition despite correct settings readback.
            await asyncio.sleep(1.0)
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "settings.json").write_text(json.dumps(settings, indent=2))
            export_result = await lr._core.call('edit_in.export', {
                'uuids':[COPY], 'out_dir':str(dest.resolve()), 'format':'TIFF',
                'quality':95, 'color_space':'sRGB', 'resize_long_edge':1600,
            }, timeout=180)
            after_export = await lr.develop.get_settings(COPY)
            for key in list(PAIRS.values()) + list(case['settings']):
                if key != 'ToneCurveName2012':
                    assert after_export.get(key) == settings.get(key), f'Reference changed during export: {key}'
            for key in correction_keys:
                assert not after_export.get(key), f'Local correction appeared during export: {key}'
            exported = list(export_result.get('exported') or [])
            assert len(exported) == 1, f'Expected one completed export for {case["name"]}'
            print(case["name"], exported, flush=True)
        await lr.develop.apply_settings(neutral, photo_uuids=[COPY])
        assert await lr.develop.get_settings(MASTER) == original, "Master settings changed"

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument('--raw',default=RAW)
    p.add_argument('--master',default=MASTER)
    p.add_argument('--copy',default=COPY)
    p.add_argument('--out')
    p.add_argument('--only')
    p.add_argument('--neutral-template',help='Verified baseline settings snapshot; tone/presence/curves are explicitly neutralized')
    p.add_argument('--force',help='Comma-separated captures to refresh even if their settings match')
    asyncio.run(main(p.parse_args()))
