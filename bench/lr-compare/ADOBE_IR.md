# IR ACR ablation (PV 11.0) — Landscape Look + mesure réduite + recale H/S

Oracle: Imaging Resource RAW + `crs:` XMP + sRGB JPEG. FiveK is not used.
Long edge 640 **and** ~512 px + Gaussian. ΔE2000 in Lab D65 on encoded sRGB.
Train ≠ val.

Profile: Adobe Standard `.dcp` ([DCP.md](DCP.md)) + Adobe Landscape Look XMP
([LOOK.md](LOOK.md), UUID `0B3BFB5CFB7DBF7FF175E98F24D316B0`). DNG Converter
16.3 stores that blob as a **36×16×16 HSV** `dng_big_table` (Sat/Val/Hue in
the file, swizzled to DNG H/S/V). Not a type-1 RGB 3D LUT. Copyright Adobe —
script only, not committed.

Target: mean ΔE2000 < 5 (aim < 3) on the **reduced** pair. **Not reached.**

## Ablation (train / val means)

| Étape | Train color | Train H/S | Val color | Val H/S |
|---|---:|---:|---:|---:|
| Avant (DCP Standard seul, curseurs anciens) | 16.29 | 17.97 | 18.74 | 20.56 |
| + Landscape Look (stage couleur, plein 640) | 16.49 | — | 19.34 | — |
| Mesure réduite (~512 + flou) | **15.37** | 15.67 | **16.94** | 18.38 |
| + recale Shadows/Blacks/H/W (H/S plein) | — | 16.90 | — | 20.63 |
| + recale, réduit | — | **15.67** | — | 18.38 |

Best reduced colour: `z6ii-0086` 11.24, `a6600-0089` 12.32, `a6600-0046` 14.56.
Still ~3× the < 5 bar.

## Develop (plein 640)

| Split | Image | WB | +profil | +expo | +courbe | +couleur | +H/S | H/S forts |
|---|---|---:|---:|---:|---:|---:|---:|:---|
| train | `a6600-0046` | 17.48 | 16.71 | 14.43 | 14.94 | 14.94 | 13.94 | oui |
| train | `a6600-0089` | 11.47 | 8.88 | 12.13 | 12.78 | 13.01 | 19.50 | oui |
| train | `g95-0192` | 21.75 | 19.30 | 19.11 | 19.49 | 19.49 | 17.96 | oui |
| train | `g95-0314` | 22.87 | 21.58 | 19.89 | 20.91 | 21.17 | 19.71 | oui |
| train | `z6ii-0086` | 14.82 | 14.55 | 13.75 | 13.85 | 13.85 | 13.38 | oui |
| val | `a6600-0156` | 21.02 | 19.99 | 16.38 | 16.90 | 16.90 | 22.42 | oui |
| val | `a7riv-1852` | 32.93 | 26.43 | 21.72 | 22.81 | 22.84 | 22.36 | oui |
| val | `g95-0273` | 12.35 | 17.58 | 17.58 | 17.30 | 17.70 | 18.03 | non |
| val | `g95-1146` | 21.34 | 19.51 | 19.51 | 19.89 | 19.94 | 19.70 | oui |

## Profile layers

| Split | Image | matrice | +HueSatMap | +BE | +Look Landscape | +tone | +curseurs |
|---|---|---:|---:|---:|---:|---:|---:|
| train | `a6600-0046` | 17.56 | 18.05 | 18.05 | 18.39 | 16.71 | 13.94 |
| train | `a6600-0089` | 11.78 | 10.89 | 10.89 | 10.67 | 8.88 | 19.50 |
| train | `g95-0192` | 21.70 | 20.51 | 20.51 | 20.28 | 19.30 | 17.96 |
| train | `g95-0314` | 22.97 | 23.17 | 23.17 | 23.57 | 21.58 | 19.71 |
| train | `z6ii-0086` | 14.89 | 14.92 | 14.92 | 14.96 | 14.55 | 13.38 |
| val | `a6600-0156` | 21.17 | 21.42 | 21.42 | 21.60 | 19.99 | 22.42 |
| val | `a7riv-1852` | 32.94 | 29.19 | 29.19 | 29.14 | 26.43 | 22.36 |
| val | `g95-0273` | 12.65 | 15.46 | 15.46 | 16.79 | 17.58 | 18.03 |
| val | `g95-1146` | 21.33 | 20.53 | 20.53 | 20.48 | 19.51 | 19.70 |

Landscape vs the DCP 36×8×16 look is a small move (often ±0.3 ΔE). The 16.3
table is a mild HSV grade, not a dramatic 3D LUT.

## Robust + zones (stage couleur)

| Split | Image | ΔE réduit | ciel | milieux | ombres | CNR / Lum / Sh |
|---|---|---:|---:|---:|---:|:---|
| train | `a6600-0046` | 14.56 | 15.85 | 13.44 | 5.65 | 25 / 0 / 40 |
| train | `a6600-0089` | 12.32 | 11.35 | 12.77 | — | 25 / 0 / 40 |
| train | `g95-0192` | 18.48 | 13.52 | 20.56 | 25.65 | 25 / 0 / 40 |
| train | `g95-0314` | 20.27 | 17.98 | 21.05 | 18.55 | 25 / 0 / 40 |
| train | `z6ii-0086` | 11.24 | 15.31 | 12.78 | 6.96 | 25 / 14 / 40 |
| val | `a6600-0156` | 13.80 | 13.86 | 13.46 | 6.30 | 25 / 0 / 40 |
| val | `a7riv-1852` | 22.15 | 23.63 | 20.90 | — | 25 / 0 / 40 |
| val | `g95-0273` | 13.53 | 9.48 | 11.57 | 15.29 | 25 / 26 / 40 |
| val | `g95-1146` | 18.27 | 20.08 | 16.63 | 23.22 | 25 / 0 / 40 |

## z6ii-0086 ciel — orangé LR vs gris-bleu Rayfine

Crépuscule, lac, silhouettes. Le masque « ciel » (tiers haut, Y > 0.16) est
dominé par le bleu du zénith, **bleu des deux côtés** :

| Bande | LR L* a* b* | hue / C* | Rayfine H/S | hue / C* |
|---|---|---|---|---|
| Haut (0–12 %) | 42.4 / +6.0 / −28.2 | 282° / 28.8 | 33.6 / +5.1 / −20.5 | 284° / 21.1 |
| Ciel mid (12–28 %) | 46.4 / +4.7 / −22.0 | 282° / 22.4 | 36.0 / +4.5 / −21.0 | 282° / 21.5 |
| **Horizon (28–42 %)** | **34.5 / +5.3 / −1.8** | **341° / 5.6** | **36.5 / +3.1 / −14.4** | **282° / 14.7** |

L’écart « orangé vs gris-bleu » est **la bande d’horizon** : LR est rose-chaud
(hue 341°, b* ≈ 0), Rayfine reste bleu saturé (hue 282°, b* −14). Le zénith
est trop **sombre** chez nous (L* −9), pas trop froid. Mean Y 0.195 vs LR 0.231
(−0.25 EV) ; médiane 0.185 vs 0.160 (Shadows fill remonte encore le plancher).

## Curseurs (PV2012 public)

- Shadows : fill (rise `smoothstep(−5.6, −3.0)` × fall `1−smoothstep(−2.8, 0.5)`),
  strength 1.55. Plus de bas-milieux, moins de plancher. Identité à 0, monotone.
- Blacks : masque plus étroit, strength 0.20 → 0.11. `a6600-0089` H/S 21.29 → 19.50
  (couleur 8.88). Blacks −35 casse encore la neige.
- Highlights / Whites : masques un peu plus hauts (moins de milieux).

Sans exports mono-réglage on ne peut pas fitter plus loin. Protocole :
[PROTOCOL.md](PROTOCOL.md). Le banc `compare_mono_sliders.py` est prêt (0 JPEG
pour l’instant).

## Cause (cible < 5 non atteinte)

1. **Tone de process** toujours trop faible (Adobe Standard n’a pas de
   ProfileToneCurve). z6ii zénith L* 34 vs 46. +0.28 EV midtone ≠ ~0.8 EV LR.
2. **Look Landscape 16.3 = HSV doux**, pas une LUT RGB 3D. L’horizon chaud
   (hue 341°) n’est pas reproduit. Un installateur Camera Raw plus récent
   pourrait porter un `dng_rgb_table` type 1 — le décodeur est déjà là.
3. **H/S ≠ LR** sur Blacks forts (`a6600-0089`) et Shadows +67 (médiane trop
   haute, moyenne trop basse). Besoin des 3–4 JPEG mono-réglage de Maxime.
4. **Géométrie** : JPEG IR déjà corrigé (distorsion / CA / aspect).
5. Masques locaux (g95-0273), sharpening, NR : lus, pas appliqués.

Sheets: `/opt/cursor/artifacts/lr-compare/ir-look/sheets/{id}_{stage}.png`
(LR | Rayfine | ΔE, bandeau = réglages + `prof=Adobe Standard` +
`look=Adobe Landscape` + UUID + CNR/Lum/Sh + ΔE zones).
