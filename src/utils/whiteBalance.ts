/** Default as-shot white balance used when EXIF / XMP does not provide Kelvin. */
export const AS_SHOT_DEFAULT_K = 5500;
/** Matches Camera Raw IncrementalTemperature ↔ Kelvin conversion in preset_converter.rs. */
const MAX_MIRED_SHIFT = 150;

export function relativeTempToKelvin(relative: number, asShotK: number = AS_SHOT_DEFAULT_K): number {
  const miredAsShot = 1_000_000 / Math.max(asShotK, 1);
  const miredDelta = -(relative / 100) * MAX_MIRED_SHIFT;
  const kelvin = 1_000_000 / Math.max(miredAsShot + miredDelta, 1);
  return Math.round(Math.min(50000, Math.max(2000, kelvin)));
}

export function kelvinToRelativeTemp(kelvin: number, asShotK: number = AS_SHOT_DEFAULT_K): number {
  const miredAdj = 1_000_000 / Math.max(kelvin, 1);
  const miredAsShot = 1_000_000 / Math.max(asShotK, 1);
  const relative = (-(miredAdj - miredAsShot) / MAX_MIRED_SHIFT) * 100;
  return Math.max(-100, Math.min(100, relative));
}

export function asShotKelvinFrom(adjustments: { asShotTemperature?: number } | null | undefined): number {
  const k = Number(adjustments?.asShotTemperature);
  return Number.isFinite(k) && k > 0 ? k : AS_SHOT_DEFAULT_K;
}
