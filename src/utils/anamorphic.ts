/** Horizontal unsqueeze factor. 1 = square pixels (off). */

export const ANAMORPHIC_PRESETS = [
  { id: 'off', ratio: 1, label: '1×' },
  { id: '1.33', ratio: 1.33, label: '1.33×' },
  { id: '1.5', ratio: 1.5, label: '1.5×' },
  { id: '2', ratio: 2, label: '2×' },
] as const;

export const ANAMORPHIC_MIN = 1;
export const ANAMORPHIC_MAX = 4;

export function anamorphicSqueezeOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1.01) return 1;
  return Math.min(ANAMORPHIC_MAX, n);
}

export function isAnamorphicPreset(ratio: number): boolean {
  return ANAMORPHIC_PRESETS.some((p) => Math.abs(p.ratio - ratio) < 0.005);
}
