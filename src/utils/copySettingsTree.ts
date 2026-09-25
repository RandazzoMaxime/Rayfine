/** Lightroom Classic Copy Settings tree → adjustment keys. */

export interface CopySettingsNode {
  id: string;
  labelKey: string;
  keys?: string[];
  children?: CopySettingsNode[];
  disabled?: boolean;
}

export const COPY_SETTINGS_COLUMNS: CopySettingsNode[][] = [
  [
    {
      id: 'treatment',
      labelKey: 'modals.copyPaste.tree.treatment',
      keys: ['cameraProfile', 'cameraProfileDigest', 'convertToGrayscale', 'lookName', 'lookTable', 'processVersion'],
    },
    {
      id: 'basic',
      labelKey: 'modals.copyPaste.tree.basic',
      children: [
        { id: 'wb', labelKey: 'modals.copyPaste.tree.whiteBalance', keys: ['temperature', 'tint', 'whiteBalance'] },
        { id: 'exposure', labelKey: 'modals.copyPaste.tree.exposure', keys: ['exposure', 'toneMapper'] },
        { id: 'contrast', labelKey: 'modals.copyPaste.tree.contrast', keys: ['contrast', 'brightness'] },
        { id: 'highlights', labelKey: 'modals.copyPaste.tree.highlights', keys: ['highlights'] },
        { id: 'shadows', labelKey: 'modals.copyPaste.tree.shadows', keys: ['shadows'] },
        { id: 'whites', labelKey: 'modals.copyPaste.tree.whites', keys: ['whites'] },
        { id: 'blacks', labelKey: 'modals.copyPaste.tree.blacks', keys: ['blacks'] },
        { id: 'texture', labelKey: 'modals.copyPaste.tree.texture', keys: ['structure'] },
        { id: 'clarity', labelKey: 'modals.copyPaste.tree.clarity', keys: ['clarity'] },
        { id: 'dehaze', labelKey: 'modals.copyPaste.tree.dehaze', keys: ['dehaze', 'centré'] },
        { id: 'vibrance', labelKey: 'modals.copyPaste.tree.vibrance', keys: ['vibrance'] },
        { id: 'saturation', labelKey: 'modals.copyPaste.tree.saturation', keys: ['saturation'] },
      ],
    },
    {
      id: 'curve',
      labelKey: 'modals.copyPaste.tree.curve',
      children: [
        { id: 'parametric', labelKey: 'modals.copyPaste.tree.parametricCurve', keys: ['parametricCurve'] },
        { id: 'point', labelKey: 'modals.copyPaste.tree.pointCurve', keys: ['curves', 'pointCurves', 'curveMode'] },
      ],
    },
  ],
  [
    {
      id: 'mixer',
      labelKey: 'modals.copyPaste.tree.mixer',
      children: [
        { id: 'hsl', labelKey: 'modals.copyPaste.tree.hsl', keys: ['hsl', 'hue'] },
        { id: 'pointColor', labelKey: 'modals.copyPaste.tree.pointColor', keys: ['pointColors', 'colorVariance'] },
      ],
    },
    { id: 'colorGrading', labelKey: 'modals.copyPaste.tree.colorGrading', keys: ['colorGrading'] },
    {
      id: 'detail',
      labelKey: 'modals.copyPaste.tree.detail',
      children: [
        {
          id: 'sharpen',
          labelKey: 'modals.copyPaste.tree.sharpening',
          keys: ['sharpness', 'sharpnessThreshold'],
        },
        { id: 'lumaNr', labelKey: 'modals.copyPaste.tree.lumaNr', keys: ['lumaNoiseReduction'] },
        { id: 'colorNr', labelKey: 'modals.copyPaste.tree.colorNr', keys: ['colorNoiseReduction'] },
      ],
    },
    {
      id: 'optics',
      labelKey: 'modals.copyPaste.tree.optics',
      children: [
        {
          id: 'ca',
          labelKey: 'modals.copyPaste.tree.ca',
          keys: ['chromaticAberrationRedCyan', 'chromaticAberrationBlueYellow'],
        },
        {
          id: 'lensProfile',
          labelKey: 'modals.copyPaste.tree.lensProfile',
          keys: [
            'lensCorrectionMode',
            'lensMaker',
            'lensModel',
            'lensDistortionEnabled',
            'lensTcaEnabled',
            'lensVignetteEnabled',
            'lensDistortionParams',
          ],
        },
        { id: 'manualDistortion', labelKey: 'modals.copyPaste.tree.manualDistortion', keys: ['lensDistortionAmount'] },
        {
          id: 'manualVignette',
          labelKey: 'modals.copyPaste.tree.manualVignette',
          keys: ['lensVignetteAmount', 'lensTcaAmount'],
        },
      ],
    },
    {
      id: 'transform',
      labelKey: 'modals.copyPaste.tree.transform',
      children: [
        { id: 'uprightMode', labelKey: 'modals.copyPaste.tree.uprightMode', keys: ['perspectiveUpright'] },
        { id: 'uprightLines', labelKey: 'modals.copyPaste.tree.uprightTransforms', keys: ['guidedUprightLines'] },
        {
          id: 'manualTransform',
          labelKey: 'modals.copyPaste.tree.manualTransform',
          keys: [
            'transformDistortion',
            'transformVertical',
            'transformHorizontal',
            'transformRotate',
            'transformAspect',
            'transformScale',
            'transformXOffset',
            'transformYOffset',
          ],
        },
      ],
    },
  ],
  [
    {
      id: 'lensBlur',
      labelKey: 'modals.copyPaste.tree.lensBlur',
      children: [
        {
          id: 'subjectFocus',
          labelKey: 'modals.copyPaste.tree.subjectFocus',
          keys: [
            'lensBlurEnabled',
            'lensBlurAmount',
            'lensBlurDiffusion',
            'lensBlurShape',
            'lensBlurMinDepth',
            'lensBlurMaxDepth',
            'lensBlurMinFade',
            'lensBlurMaxFade',
          ],
        },
      ],
    },
    {
      id: 'effects',
      labelKey: 'modals.copyPaste.tree.effects',
      children: [
        {
          id: 'vignette',
          labelKey: 'modals.copyPaste.tree.postCropVignette',
          keys: ['vignetteAmount', 'vignetteFeather', 'vignetteMidpoint', 'vignetteRoundness'],
        },
        { id: 'grain', labelKey: 'modals.copyPaste.tree.grain', keys: ['grainAmount', 'grainRoughness', 'grainSize'] },
      ],
    },
    {
      id: 'spot',
      labelKey: 'modals.copyPaste.tree.spot',
      children: [{ id: 'heal', labelKey: 'modals.copyPaste.tree.spotManual', keys: ['aiPatches'] }],
    },
    {
      id: 'crop',
      labelKey: 'modals.copyPaste.tree.crop',
      children: [
        {
          id: 'straighten',
          labelKey: 'modals.copyPaste.tree.straighten',
          keys: ['rotation', 'orientationSteps', 'flipHorizontal', 'flipVertical'],
        },
        { id: 'aspect', labelKey: 'modals.copyPaste.tree.aspect', keys: ['crop', 'aspectRatio'] },
      ],
    },
    { id: 'processVersion', labelKey: 'modals.copyPaste.tree.processVersion', keys: [], disabled: true },
    { id: 'calibration', labelKey: 'modals.copyPaste.tree.calibration', keys: ['colorCalibration'] },
    {
      id: 'hdr',
      labelKey: 'modals.copyPaste.tree.hdr',
      children: [{ id: 'hdrMode', labelKey: 'modals.copyPaste.tree.hdrMode', keys: ['hdrEditMode'] }],
    },
    { id: 'masks', labelKey: 'modals.copyPaste.tree.masks', keys: ['masks'] },
  ],
];

export function collectNodeKeys(node: CopySettingsNode): string[] {
  const own = node.keys || [];
  const nested = (node.children || []).flatMap(collectNodeKeys);
  return [...own, ...nested];
}

export function allCopySettingKeys(): string[] {
  return COPY_SETTINGS_COLUMNS.flat().flatMap(collectNodeKeys);
}

/** Factory “Par défaut” subset: develop tone/color, not crop/transform/spots/masks. */
export const DEFAULT_COPY_KEYS: string[] = [
  'cameraProfile',
  'cameraProfileDigest',
  'convertToGrayscale',
  'lookName',
  'temperature',
  'tint',
  'whiteBalance',
  'exposure',
  'toneMapper',
  'contrast',
  'brightness',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'structure',
  'clarity',
  'dehaze',
  'vibrance',
  'saturation',
  'parametricCurve',
  'curves',
  'pointCurves',
  'curveMode',
  'hsl',
  'hue',
  'pointColors',
  'colorVariance',
  'colorGrading',
];
