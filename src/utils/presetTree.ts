import { Preset } from '../components/ui/AppProperties';
import type { UserPreset } from '../hooks/usePresets';

/** Name of the default Lightroom-style group that receives presets without a folder. */
export const DEFAULT_PRESET_GROUP = 'User Presets';

export interface PresetGroup {
  id: string;
  name: string;
  children: Preset[];
}

/** Groups (folders) in display order. Root-level presets are expected to have been normalized away. */
export function getGroups(tree: UserPreset[]): PresetGroup[] {
  return tree.filter((i) => i.folder).map((i) => i.folder as unknown as PresetGroup);
}

export function flattenPresets(tree: UserPreset[]): Array<{ preset: Preset; groupId: string | null; groupName: string | null }> {
  const out: Array<{ preset: Preset; groupId: string | null; groupName: string | null }> = [];
  for (const item of tree) {
    if (item.preset) out.push({ preset: item.preset, groupId: null, groupName: null });
    else if (item.folder) {
      for (const child of item.folder.children || []) {
        out.push({ preset: child, groupId: item.folder.id ?? null, groupName: item.folder.name ?? null });
      }
    }
  }
  return out;
}

export function findPreset(tree: UserPreset[], id: string) {
  return flattenPresets(tree).find((p) => p.preset.id === id) || null;
}

/** Move root-level presets into the default group so every preset lives in a group. */
export function normalizePresetTree(tree: UserPreset[]): { tree: UserPreset[]; changed: boolean } {
  const roots = tree.filter((i) => i.preset).map((i) => i.preset as Preset);
  if (roots.length === 0) return { tree, changed: false };
  let next = tree.filter((i) => !i.preset);
  const existing = next.find((i) => i.folder?.name === DEFAULT_PRESET_GROUP);
  if (existing?.folder) {
    next = next.map((i) =>
      i === existing ? { folder: { ...i.folder!, children: [...i.folder!.children, ...roots] } } : i,
    );
  } else {
    next = [{ folder: { id: crypto.randomUUID(), name: DEFAULT_PRESET_GROUP, children: roots } } as UserPreset, ...next];
  }
  return { tree: next, changed: true };
}

/** Returns [tree, groupId] — creates the group (by name) when missing. */
export function ensureGroup(tree: UserPreset[], name: string): [UserPreset[], string] {
  const trimmed = name.trim() || DEFAULT_PRESET_GROUP;
  const found = tree.find((i) => i.folder && (i.folder.name || '').toLowerCase() === trimmed.toLowerCase());
  if (found?.folder?.id) return [tree, found.folder.id];
  const id = crypto.randomUUID();
  return [[...tree, { folder: { id, name: trimmed, children: [] } } as UserPreset], id];
}

function uniqueName(used: Set<string>, base: string): string {
  const clean = base.trim() || 'Preset';
  let name = clean;
  let n = 1;
  while (used.has(name.toLowerCase())) name = `${clean} (${n++})`;
  used.add(name.toLowerCase());
  return name;
}

/** Copies presets (new ids, unique names within the group) into `groupId`. */
export function addPresetsToGroup(tree: UserPreset[], groupId: string, presets: Preset[]): UserPreset[] {
  return tree.map((i) => {
    if (i.folder?.id !== groupId) return i;
    const used = new Set<string>(i.folder.children.map((c: Preset) => c.name.toLowerCase()));
    const added = presets.map((p) => {
      const { group: _group, ...rest } = p;
      return { ...rest, id: crypto.randomUUID(), name: uniqueName(used, p.name) } as Preset;
    });
    return { folder: { ...i.folder, children: [...i.folder.children, ...added] } };
  });
}

export function updatePreset(tree: UserPreset[], id: string, patch: Partial<Preset>): UserPreset[] {
  return tree.map((i) => {
    if (i.preset?.id === id) return { preset: { ...i.preset, ...patch } };
    if (i.folder && i.folder.children.some((c: Preset) => c.id === id)) {
      return {
        folder: { ...i.folder, children: i.folder.children.map((c: Preset) => (c.id === id ? { ...c, ...patch } : c)) },
      };
    }
    return i;
  });
}

export function renameGroup(tree: UserPreset[], groupId: string, name: string): UserPreset[] {
  return tree.map((i) => (i.folder?.id === groupId ? { folder: { ...i.folder, name } } : i));
}

export function removePreset(tree: UserPreset[], id: string): UserPreset[] {
  return tree
    .filter((i) => i.preset?.id !== id)
    .map((i) =>
      i.folder && i.folder.children.some((c: Preset) => c.id === id)
        ? { folder: { ...i.folder, children: i.folder.children.filter((c: Preset) => c.id !== id) } }
        : i,
    );
}

export function removeGroup(tree: UserPreset[], groupId: string): UserPreset[] {
  return tree.filter((i) => i.folder?.id !== groupId);
}

/**
 * Move a preset into `targetGroupId`, placed before `beforePresetId` when given (else appended).
 * Also handles reordering inside the same group.
 */
export function movePresetTo(
  tree: UserPreset[],
  presetId: string,
  targetGroupId: string,
  beforePresetId: string | null = null,
): UserPreset[] {
  const found = findPreset(tree, presetId);
  if (!found || presetId === beforePresetId) return tree;
  if (!tree.some((i) => i.folder?.id === targetGroupId)) return tree;
  const without = removePreset(tree, presetId);
  return without.map((i) => {
    if (i.folder?.id !== targetGroupId) return i;
    const children = [...i.folder.children];
    const idx = beforePresetId ? children.findIndex((c: Preset) => c.id === beforePresetId) : -1;
    if (idx >= 0) children.splice(idx, 0, found.preset);
    else children.push(found.preset);
    return { folder: { ...i.folder, children } };
  });
}

/** Reorder groups: move `groupId` before `beforeGroupId`. */
export function moveGroupBefore(tree: UserPreset[], groupId: string, beforeGroupId: string): UserPreset[] {
  if (groupId === beforeGroupId) return tree;
  const item = tree.find((i) => i.folder?.id === groupId);
  if (!item) return tree;
  const rest = tree.filter((i) => i !== item);
  const idx = rest.findIndex((i) => i.folder?.id === beforeGroupId);
  if (idx < 0) return tree;
  rest.splice(idx, 0, item);
  return rest;
}

// ---------------------------------------------------------------------------
// Lightroom-style "settings to include" sections for New Preset
// ---------------------------------------------------------------------------

export interface PresetSection {
  id: string;
  label: string;
  defaultOn: boolean;
}

export const PRESET_SECTIONS: PresetSection[] = [
  { id: 'whiteBalance', label: 'White Balance', defaultOn: true },
  { id: 'basicTone', label: 'Basic Tone', defaultOn: true },
  { id: 'presence', label: 'Presence', defaultOn: true },
  { id: 'toneCurve', label: 'Tone Curve', defaultOn: true },
  { id: 'colorMixer', label: 'Color / HSL', defaultOn: true },
  { id: 'colorGrading', label: 'Color Grading', defaultOn: true },
  { id: 'treatment', label: 'Profile & Treatment', defaultOn: true },
  { id: 'detail', label: 'Detail', defaultOn: true },
  { id: 'lens', label: 'Lens Corrections', defaultOn: true },
  { id: 'effects', label: 'Effects', defaultOn: true },
  { id: 'calibration', label: 'Calibration', defaultOn: true },
  { id: 'transform', label: 'Transform', defaultOn: false },
  { id: 'crop', label: 'Crop', defaultOn: false },
  { id: 'masks', label: 'Masking', defaultOn: false },
];

const EXPLICIT_SECTION: Record<string, string> = {
  temperature: 'whiteBalance',
  tint: 'whiteBalance',
  whiteBalance: 'whiteBalance',
  asShotTemperature: 'whiteBalance',
  asShotTint: 'whiteBalance',
  exposure: 'basicTone',
  toneMapper: 'basicTone',
  brightness: 'basicTone',
  contrast: 'basicTone',
  highlights: 'basicTone',
  shadows: 'basicTone',
  whites: 'basicTone',
  blacks: 'basicTone',
  autoTone: 'basicTone',
  autoExposure: 'basicTone',
  hdrEditMode: 'basicTone',
  highlightsBoost: 'basicTone',
  highlightsThreshold: 'basicTone',
  structure: 'presence',
  texture: 'presence',
  clarity: 'presence',
  dehaze: 'presence',
  centré: 'presence',
  vibrance: 'presence',
  saturation: 'presence',
  curves: 'toneCurve',
  pointCurves: 'toneCurve',
  parametricCurve: 'toneCurve',
  curveMode: 'toneCurve',
  toneCurveName: 'toneCurve',
  curveRefineSaturation: 'toneCurve',
  hsl: 'colorMixer',
  hue: 'colorMixer',
  pointColors: 'colorMixer',
  colorVariance: 'colorMixer',
  grayMixer: 'colorMixer',
  colorGrading: 'colorGrading',
  cameraProfile: 'treatment',
  cameraProfileDigest: 'treatment',
  lookName: 'treatment',
  lookTable: 'treatment',
  rgbTables: 'treatment',
  convertToGrayscale: 'treatment',
  processVersion: 'treatment',
  sharpness: 'detail',
  sharpnessThreshold: 'detail',
  luminanceSeparation: 'detail',
  chromaticAberrationRedCyan: 'lens',
  chromaticAberrationBlueYellow: 'lens',
  lensCorrectionMode: 'lens',
  glowAmount: 'effects',
  halationAmount: 'effects',
  flareAmount: 'effects',
  sphericalAberration: 'effects',
  overrideLookVignette: 'effects',
  lutIntensity: 'effects',
  lutName: 'effects',
  lutPath: 'effects',
  lutSize: 'effects',
  lutData: 'effects',
  colorCalibration: 'calibration',
  rotation: 'transform',
  flipHorizontal: 'transform',
  flipVertical: 'transform',
  orientationSteps: 'transform',
  perspectiveUpright: 'transform',
  guidedUprightLines: 'transform',
  cropConstrainToWarp: 'transform',
  anamorphicSqueeze: 'transform',
  crop: 'crop',
  aspectRatio: 'crop',
  cropConstrainToUnitSquare: 'crop',
  masks: 'masks',
};

/** Keys that are image-specific or UI state and never belong in a preset. */
const NEVER_IN_PRESET = new Set([
  'aiPatches',
  'sectionVisibility',
  'showClipping',
  'lensBlurDepthMap',
  'lensDistortionParams',
  'lensMaker',
  'lensModel',
  'rating',
  'colorLabel',
  'flag',
]);

export function sectionOfKey(key: string): string | null {
  if (NEVER_IN_PRESET.has(key)) return null;
  if (EXPLICIT_SECTION[key]) return EXPLICIT_SECTION[key];
  if (/^parametric/.test(key)) return 'toneCurve';
  if (/^(sharpen|lumaNoise|colorNoise)/.test(key)) return 'detail';
  if (/^(lensBlur|bokeh|catEye|vignette|grain)/.test(key)) return 'effects';
  if (/^(lens|defringe)/.test(key)) return 'lens';
  if (/^transform/.test(key)) return 'transform';
  return null;
}

/** Build a preset's adjustments from the current develop settings, keeping only the chosen sections. */
export function buildPresetAdjustments(current: Record<string, any>, sectionIds: Set<string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(current || {})) {
    const section = sectionOfKey(key);
    if (section && sectionIds.has(section) && value !== undefined) {
      out[key] = JSON.parse(JSON.stringify(value));
    }
  }
  return out;
}
