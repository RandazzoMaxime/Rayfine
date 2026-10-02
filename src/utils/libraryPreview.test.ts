import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loupeImageSrc } from './loupeDisplay.ts';

describe('loupeImageSrc', () => {
  it('uses the GPU preview when it is ready', () => {
    assert.equal(
      loupeImageSrc({
        previewUrl: 'blob:preview',
        thumbUrl: 'asset:thumb',
        isRaw: true,
        isEdited: false,
      }),
      'blob:preview',
    );
  });

  it('does not flash the embedded RAW jpeg while the GPU preview is loading', () => {
    assert.equal(
      loupeImageSrc({
        previewUrl: undefined,
        thumbUrl: 'asset:thumb',
        isRaw: true,
        isEdited: false,
      }),
      undefined,
    );
  });

  it('does not use a RAW thumb even when the photo is edited', () => {
    assert.equal(
      loupeImageSrc({
        previewUrl: undefined,
        thumbUrl: 'asset:thumb',
        isRaw: true,
        isEdited: true,
      }),
      undefined,
    );
  });

  it('can show a non-RAW thumb while the preview loads', () => {
    assert.equal(
      loupeImageSrc({
        previewUrl: undefined,
        thumbUrl: 'asset:thumb',
        isRaw: false,
        isEdited: false,
      }),
      'asset:thumb',
    );
  });
});
