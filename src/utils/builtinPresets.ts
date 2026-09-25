import { Preset } from '../components/ui/AppProperties';

/**
 * Small set of built-in starter presets shown in the Preset Browser (original RustROOM looks,
 * not copies of any vendor preset). Values use the app's slider scales (-100..100, exposure -5..5).
 */
const def = (id: string, name: string, group: string, adjustments: Record<string, any>): Preset => ({
  id: `builtin:${id}`,
  name,
  group,
  adjustments,
  presetType: 'tool',
});

export const BUILTIN_PRESETS: Preset[] = [
  def('bw-neutral', 'B&W Neutral', 'Black & White', { saturation: -100, contrast: 10 }),
  def('bw-high-contrast', 'B&W High Contrast', 'Black & White', {
    saturation: -100,
    contrast: 45,
    whites: 20,
    blacks: -25,
    clarity: 15,
  }),
  def('bw-soft', 'B&W Soft Matte', 'Black & White', { saturation: -100, contrast: -20, blacks: 25, highlights: -20 }),
  def('vivid', 'Vivid', 'Color', { vibrance: 35, saturation: 8, contrast: 15, clarity: 8 }),
  def('muted', 'Muted', 'Color', { vibrance: -25, saturation: -10, contrast: -8 }),
  def('warm', 'Warm', 'Color', { temperature: 18, tint: 4, vibrance: 8 }),
  def('cool', 'Cool', 'Color', { temperature: -18, tint: -3 }),
  def('matte', 'Matte Fade', 'Creative', { contrast: -15, blacks: 30, highlights: -15, saturation: -10 }),
  def('film-grain', 'Film Grain', 'Creative', { grainAmount: 25, vignetteAmount: -15, contrast: 8, saturation: -8 }),
  def('punchy', 'Punchy Contrast', 'Tone', { contrast: 35, highlights: -20, shadows: 15, whites: 10, blacks: -15 }),
  def('lift-shadows', 'Open Shadows', 'Tone', { shadows: 40, highlights: -30, blacks: 10 }),
  def('clean-portrait', 'Clean Portrait', 'Tone', { clarity: -10, structure: -8, vibrance: 10, highlights: -10 }),
  def('landscape', 'Landscape Pop', 'Tone', { dehaze: 12, clarity: 18, vibrance: 25, highlights: -25, shadows: 20 }),
];
