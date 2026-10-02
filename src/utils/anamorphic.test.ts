import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { anamorphicSqueezeOf, isAnamorphicPreset } from './anamorphic.ts';

describe('anamorphicSqueezeOf', () => {
  it('treats missing and 1 as off', () => {
    assert.equal(anamorphicSqueezeOf(undefined), 1);
    assert.equal(anamorphicSqueezeOf(1), 1);
    assert.equal(anamorphicSqueezeOf(0), 1);
  });

  it('clamps to 1–4', () => {
    assert.equal(anamorphicSqueezeOf(1.33), 1.33);
    assert.equal(anamorphicSqueezeOf(2), 2);
    assert.equal(anamorphicSqueezeOf(9), 4);
  });
});

describe('isAnamorphicPreset', () => {
  it('recognizes 1.33 / 1.5 / 2', () => {
    assert.equal(isAnamorphicPreset(1.33), true);
    assert.equal(isAnamorphicPreset(1.5), true);
    assert.equal(isAnamorphicPreset(1.8), false);
  });
});
