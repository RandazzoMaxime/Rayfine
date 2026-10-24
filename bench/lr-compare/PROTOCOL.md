# Protocole d’exports mono-réglage (Maxime)

Le banc IR n’a qu’un JPEG fini par photo. Pour recaler Shadows / Blacks /
Highlights / Whites sur le modèle PV2012, il faut **3–4 exports Lightroom**
où **un seul curseur change**. Pas besoin d’une grille complète.

## Photo et curseurs

Garder le reste du Develop **identique à l’XMP IR** (Adobe Standard +
Adobe Landscape, WB As Shot, Exp / H / S / W / B / Clarity du sidecar,
process 11.0, sRGB JPEG, long edge natif, pas de recadrage).

| # | Photo IR | Curseur | Valeur A (neutre) | Valeur B (IR) | Pourquoi |
|---|---|---|---:|---:|---|
| 1 | `z6ii-0086` | Shadows | **0** | **+67** | Shadows remonte trop le plancher vs les milieux. |
| 2 | `a6600-0089` | Blacks | **0** | **−35** | Blacks −35 casse cette frame (ΔE couleur 9 → H/S 21). |
| 3 | `z6ii-0086` | Highlights | **0** | **−12** | Look Landscape porte H −12 ; isolé du Shadows. |
| 4 *(optionnel)* | `a6600-0046` | Whites | **0** | **+40** | Pôle haut, même modèle de masque. |

Les +12 Shadows / −12 Highlights du Look restent dans le profil ; les
valeurs du tableau sont le **total affiché** du curseur (Look + Develop).
Pour A, mettre le curseur à 0 **y compris** l’apport du Look (décocher /
compenser). Pour B, le total IR (Shadows +67 = +55 Develop + +12 Look).

## Export

- Lightroom Classic, même Process Version que l’XMP (`11.0`).
- JPEG sRGB, qualité 12, métadonnées « tout », **sans** recadrage.
- Désactiver les outils locaux. Laisser NR / sharpening IR
  (Color 25, Sharpness 40 ; Lum 14 sur z6ii-0086).

## Nommage (le banc les consomme tout seul)

Déposer les JPEG ici (dossiers déjà gitignorés) :

```text
bench/lr-compare/datasets/ir/<id>/mono/<slider><signe><valeur>.jpg
```

Exemples :

```text
datasets/ir/z6ii-0086/mono/shadows+0.jpg
datasets/ir/z6ii-0086/mono/shadows+67.jpg
datasets/ir/z6ii-0086/mono/highlights+0.jpg
datasets/ir/z6ii-0086/mono/highlights-12.jpg
datasets/ir/a6600-0089/mono/blacks+0.jpg
datasets/ir/a6600-0089/mono/blacks-35.jpg
datasets/ir/a6600-0046/mono/whites+0.jpg
datasets/ir/a6600-0046/mono/whites+40.jpg
```

`slider` ∈ `shadows|blacks|highlights|whites` (minuscule). Signe `+` ou `-`.

## Banc

```text
python bench/lr-compare/compare_mono_sliders.py \
  --datasets bench/lr-compare/datasets/ir \
  --out bench/lr-compare/out/mono
```

Sans dossier `mono/`, le script s’arrête proprement (0 paire). Dès qu’un
JPEG est là, il relit l’XMP, force les **autres** curseurs aux valeurs IR,
applique **uniquement** la valeur du nom de fichier, et écrit ΔE plein /
réduit + planche LR | Rayfine | carte ΔE.
