import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeLibraryRoots,
  driveOfPath,
  groupTreesByDrive,
  isDriveRootPath,
  libraryRootCoveredBy,
  mergeImportedBranches,
} from './libraryRoots.ts';

describe('libraryRootCoveredBy', () => {
  it('treats a second import of the same folder as already present', () => {
    assert.equal(libraryRootCoveredBy(['B:\\Photos'], 'B:/photos'), true);
    assert.equal(libraryRootCoveredBy(['B:\\Photos'], 'B:\\Photos\\'), true);
  });

  it('treats a folder inside an imported root as already present', () => {
    assert.equal(libraryRootCoveredBy(['B:\\Photos'], 'B:\\Photos\\2024'), true);
  });

  it('does not treat a sibling as covered', () => {
    assert.equal(libraryRootCoveredBy(['B:\\Photos'], 'B:\\Video'), false);
  });
});

describe('dedupeLibraryRoots', () => {
  it('keeps the parent and drops the nested import', () => {
    assert.deepEqual(dedupeLibraryRoots(['B:\\Photos\\2024', 'B:\\Photos']), ['B:\\Photos']);
  });

  it('keeps folders that live on different disks', () => {
    assert.deepEqual(dedupeLibraryRoots(['C:\\A', 'D:\\B']), ['C:\\A', 'D:\\B']);
  });
});

describe('groupTreesByDrive', () => {
  it('puts each imported folder under its disk', () => {
    const groups = groupTreesByDrive([
      { path: 'D:\\Archive' },
      { path: 'C:\\Photos' },
      { path: 'C:\\Photos\\Trip' },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.letter, g.trees.map((t) => t.path)]),
      [
        ['D', ['D:\\Archive']],
        ['C', ['C:\\Photos']],
      ],
    );
  });

  it('recognizes a disk root', () => {
    assert.equal(isDriveRootPath('C:\\'), true);
    assert.equal(driveOfPath('c:/photos').letter, 'C');
  });
});

describe('mergeImportedBranches', () => {
  it('nests two PHOTOS folders under their real parents', () => {
    const branches = mergeImportedBranches([
      { path: 'F:\\Photographie et Video\\13-10-2025_HELIX BONIFACIO_RELEVE\\J2\\PHOTOS' },
      { path: 'F:\\Photographie et Video\\2026-08-28-AVION_TEST_FMS\\PHOTOS' },
    ]);
    assert.equal(branches.length, 1);
    assert.equal(branches[0].name, 'Photographie et Video');
    assert.equal(branches[0].children.length, 2);
    assert.equal(branches[0].children[0].children[0].children[0].name, 'PHOTOS');
    assert.equal(branches[0].children[1].children[0].name, 'PHOTOS');
  });
});
