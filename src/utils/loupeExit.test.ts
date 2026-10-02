import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeReturnsLoupeToGrid, isLoupeLetterboxClick } from './loupeExit.ts';

describe('isLoupeLetterboxClick', () => {
  const stage = { id: 'stage' };
  const photo = { id: 'photo' };

  it('is true when the click hits the stage at fit zoom', () => {
    assert.equal(isLoupeLetterboxClick({ target: stage, stage, zoom: 1 }), true);
  });

  it('is false when the click hits the photo', () => {
    assert.equal(isLoupeLetterboxClick({ target: photo, stage, zoom: 1 }), false);
  });

  it('is false while zoomed so a pan does not leave loupe', () => {
    assert.equal(isLoupeLetterboxClick({ target: stage, stage, zoom: 2 }), false);
  });
});

describe('escapeReturnsLoupeToGrid', () => {
  it('is true in library loupe', () => {
    assert.equal(
      escapeReturnsLoupeToGrid({ selectedImage: null, libraryDisplayMode: 'loupe' }),
      true,
    );
  });

  it('is false in grid so Escape can still clear the selection', () => {
    assert.equal(
      escapeReturnsLoupeToGrid({ selectedImage: null, libraryDisplayMode: 'grid' }),
      false,
    );
  });

  it('is false in Develop', () => {
    assert.equal(
      escapeReturnsLoupeToGrid({ selectedImage: { path: 'a.dng' }, libraryDisplayMode: 'loupe' }),
      false,
    );
  });
});
