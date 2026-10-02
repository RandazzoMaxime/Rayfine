"""Compare developed sRGB pixels without exposure fitting or hidden exclusions."""
import json
import argparse
from pathlib import Path
import numpy as np
import tifffile
try:
    from PIL import Image, ImageDraw
except ImportError:
    import sys
    sys.path.insert(0, str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/Lib/site-packages'))
    for name in list(sys.modules):
        if name == 'PIL' or name.startswith('PIL.'):
            del sys.modules[name]
    from PIL import Image, ImageDraw

ROOT = Path(__file__).parent / "out" / "A7S02588"

def load_lr(name):
    files = list((ROOT / "lightroom" / name).glob("*.tif"))
    if not files:
        return None
    a = tifffile.imread(files[0])[..., :3]
    return a.astype(np.float32) / np.iinfo(a.dtype).max

def load_ray(name):
    return np.asarray(Image.open(ROOT / RAY_DIR / f"{name}.png").convert("RGB"), dtype=np.float32) / 255

def metrics(a,b):
    if a.shape != b.shape:
        raise ValueError(f"Geometry mismatch: {a.shape} vs {b.shape}")
    error = np.abs(a-b)
    def lab(rgb):
        linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        xyz=linear @ np.array([[.4124564,.2126729,.0193339],[.3575761,.7151522,.1191920],[.1804375,.0721750,.9503041]])
        xyz=xyz/np.array([.95047,1,1.08883])
        f=np.where(xyz>(6/29)**3,np.cbrt(xyz),xyz/(3*(6/29)**2)+4/29)
        return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],-1)
    la,lb=lab(a),lab(b)
    lightness=np.abs(la[...,0]-lb[...,0])
    chroma=np.linalg.norm(la[...,1:]-lb[...,1:],axis=-1)
    tiles=[]
    for ys in np.array_split(np.arange(a.shape[0]),8):
        for xs in np.array_split(np.arange(a.shape[1]),8):
            tiles.append(float(error[ys[:,None],xs].mean()*100))
    return {"mae_srgb_pct": float(error.mean()*100), "p95_srgb_pct": float(np.percentile(error,95)*100), "rmse_srgb_pct": float(np.sqrt(np.mean(error**2))*100), "within_5pct_mae": bool(error.mean() <= .05),
        "lightness_mae_pct":float(lightness.mean()),"lightness_p95_pct":float(np.percentile(lightness,95)),
        "chroma_delta_ab_mean":float(chroma.mean()),"chroma_delta_ab_p95":float(np.percentile(chroma,95)),
        "worst_region_mae_pct":max(tiles)}

def main():
    global RAY_DIR,ROOT
    p=argparse.ArgumentParser()
    p.add_argument('--ray-dir',default='rayfine')
    p.add_argument('--require',action='store_true',help='Fail if any captured case exceeds 5% MAE')
    p.add_argument('--only',help='Comma-separated case names')
    p.add_argument('--root',type=Path,default=ROOT)
    args=p.parse_args()
    RAY_DIR=args.ray_dir
    ROOT=args.root
    results = []
    missing = []
    neutral_lr, neutral_ray = load_lr("neutral"), load_ray("neutral")
    tiles=[]
    for case in json.loads((ROOT / "cases.json").read_text()):
        name=case["name"]
        if args.only and name not in args.only.split(','):
            continue
        lr=load_lr(name)
        if lr is None:
            missing.append(name)
            continue
        ray=load_ray(name)
        m=metrics(ray,lr)
        if name != "neutral":
            m["slider_delta_mae_pct"]=float(np.abs((ray-neutral_ray)-(lr-neutral_lr)).mean()*100)
        results.append({"case": name, **m})
        print(name, json.dumps(m), flush=True)
        if name in ["neutral", "highlights_minus", "shadows_plus", "whites_plus", "blacks_minus", "curve_rgb", "mixed"]:
            tile=Image.new("RGB",(800,300),'#181818')
            for x,a in [(0,lr),(400,ray)]:
                tile.paste(Image.fromarray((a.clip(0,1)*255).astype('uint8')).resize((400,267)),(x,30))
            ImageDraw.Draw(tile).text((8,8),f"{name}: Lightroom | Rayfine, MAE {m['mae_srgb_pct']:.2f}%",fill='white')
            tiles.append(tile)
    (ROOT / "measurements.json").write_text(json.dumps(results,indent=2))
    # Keep the offline inventory synchronized with the measurements just saved.
    from build_settings_report import build_report
    build_report(ray_dir=RAY_DIR)
    if tiles:
        sheet=Image.new("RGB",(800,300*len(tiles)))
        for i,tile in enumerate(tiles): sheet.paste(tile,(0,i*300))
        sheet.save(ROOT / "comparison.jpg")
    if missing:
        print('Missing Lightroom captures:', ', '.join(missing))
    if args.require and (missing or not results or any(not r['within_5pct_mae'] for r in results)):
        raise SystemExit(2)

RAY_DIR='rayfine'

if __name__ == "__main__":main()
