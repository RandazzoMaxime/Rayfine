export interface ColorRangeSample {
  x: number;
  y: number;
  [key: string]: unknown;
}

export function denormalizeColorRangeSamples(
  samples: unknown,
  width: number,
  height: number,
): ColorRangeSample[] {
  if (!Array.isArray(samples)) return [];
  return samples.map((sample: any) => ({
    ...sample,
    x: typeof sample?.x === 'number' && sample.x <= 1.5 ? sample.x * width : sample?.x,
    y: typeof sample?.y === 'number' && sample.y <= 1.5 ? sample.y * height : sample?.y,
  }));
}
