import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { denormalizeColorRangeSamples } from './maskRange.ts';

describe('denormalizeColorRangeSamples', () => {
  it('converts Lightroom normalized sample points to image pixels', () => {
    assert.deepEqual(
      denormalizeColorRangeSamples([{ x: 0.25, y: 0.75, model: 'point' }], 4000, 2000),
      [{ x: 1000, y: 1500, model: 'point' }],
    );
  });

  it('preserves already pixel-based sample points', () => {
    assert.deepEqual(
      denormalizeColorRangeSamples([{ x: 900, y: 600 }], 4000, 2000),
      [{ x: 900, y: 600 }],
    );
  });
});
