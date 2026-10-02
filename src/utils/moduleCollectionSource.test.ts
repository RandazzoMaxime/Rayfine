import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionOnlyImages,
  initialModuleAlbumId,
  placedFromCollection,
} from './moduleCollectionSource.ts';

describe('initialModuleAlbumId', () => {
  it('uses the Library collection when one is open', () => {
    assert.equal(initialModuleAlbumId('album-1'), 'album-1');
  });

  it('does not treat the current folder as a collection', () => {
    assert.equal(initialModuleAlbumId(null), null);
    assert.equal(initialModuleAlbumId(undefined), null);
  });
});

describe('collectionOnlyImages', () => {
  const a = { path: 'a.dng' } as any;
  const b = { path: 'b.dng' } as any;

  it('returns nothing until a collection is selected', () => {
    assert.deepEqual(collectionOnlyImages({ albumId: null, albumImages: [a, b] }), []);
  });

  it('returns the collection photos once loaded', () => {
    assert.deepEqual(collectionOnlyImages({ albumId: 'x', albumImages: [a, b] }), [a, b]);
  });

  it('returns nothing while the collection is still loading', () => {
    assert.deepEqual(collectionOnlyImages({ albumId: 'x', albumImages: null }), []);
  });
});

describe('placedFromCollection', () => {
  it('keeps only checked photos that belong to the collection', () => {
    assert.deepEqual(
      placedFromCollection({
        collectionPaths: ['a.dng', 'b.dng'],
        multiSelectedPaths: ['a.dng', 'folder-only.dng'],
        libraryActivePath: 'b.dng',
        max: 8,
      }),
      ['a.dng'],
    );
  });

  it('falls back to the active photo when it is in the collection', () => {
    assert.deepEqual(
      placedFromCollection({
        collectionPaths: ['b.dng'],
        multiSelectedPaths: [],
        libraryActivePath: 'b.dng',
        max: 8,
      }),
      ['b.dng'],
    );
  });

  it('does not place a folder-only active photo', () => {
    assert.deepEqual(
      placedFromCollection({
        collectionPaths: ['a.dng'],
        multiSelectedPaths: [],
        libraryActivePath: 'folder-only.dng',
        max: 8,
      }),
      [],
    );
  });
});
