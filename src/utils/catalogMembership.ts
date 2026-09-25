import { invoke } from '@tauri-apps/api/core';
import { Album, AlbumGroup, AlbumItem, Invokes } from '../components/ui/AppProperties';

/** Reserved collection for imported photos that were not filed into a named collection. */
export const UNCATEGORIZED_ALBUM_ID = 'uncategorized';
export const UNCATEGORIZED_ALBUM_NAME = 'Sans collection';

export function findAlbumById(items: AlbumItem[] | undefined, id: string): Album | null {
  if (!items) return null;
  for (const item of items) {
    if (item.type === 'album' && item.id === id) return item;
    if (item.type === 'group') {
      const found = findAlbumById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

let cachedTreeRef: AlbumItem[] | undefined;
let cachedImported: Set<string> = new Set();

/** Same as collectImportedPaths, cached on albumTree identity (zustand reference). */
export function importedPathSet(items: AlbumItem[] | undefined): Set<string> {
  if (items === cachedTreeRef) return cachedImported;
  cachedTreeRef = items;
  cachedImported = collectImportedPaths(items);
  return cachedImported;
}

/** Catalog membership: a photo is imported iff it lives in at least one collection. */
export function collectImportedPaths(items: AlbumItem[] | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: AlbumItem[] | undefined) => {
    if (!nodes) return;
    for (const item of nodes) {
      if (item.type === 'album') {
        for (const p of item.images || []) out.add(p);
      } else {
        walk(item.children);
      }
    }
  };
  walk(items);
  return out;
}

export function isPathImported(path: string | null | undefined, items: AlbumItem[] | undefined): boolean {
  if (!path) return false;
  return importedPathSet(items).has(path);
}

export function albumDisplayName(album: { id: string; name: string } | null | undefined): string {
  if (!album) return UNCATEGORIZED_ALBUM_NAME;
  if (album.id === UNCATEGORIZED_ALBUM_ID) return UNCATEGORIZED_ALBUM_NAME;
  return album.name;
}

export function pickDevelopPath(
  albumTree: AlbumItem[] | undefined,
  candidates: Array<string | null | undefined>,
): string | null {
  const imported = importedPathSet(albumTree);
  for (const p of candidates) {
    if (p && imported.has(p)) return p;
  }
  return null;
}

export function flattenGroups(items: AlbumItem[] | undefined, prefix = ''): Array<{ id: string; label: string }> {
  return (items || []).flatMap((item) => {
    if (item.type === 'group') {
      const label = prefix + item.name;
      return [{ id: item.id, label }, ...flattenGroups(item.children, `${label} / `)];
    }
    return [];
  });
}

const REMOVED_FROM_CATALOG_KEY = 'rustroom.removedFromCatalog.v1';

export function loadRemovedFromCatalog(): Set<string> {
  try {
    const raw = localStorage.getItem(REMOVED_FROM_CATALOG_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((p: unknown) => typeof p === 'string') : []);
  } catch {
    return new Set();
  }
}

export function persistRemovedFromCatalog(paths: string[]) {
  const next = loadRemovedFromCatalog();
  for (const p of paths) next.add(p);
  try {
    localStorage.setItem(REMOVED_FROM_CATALOG_KEY, JSON.stringify(Array.from(next).slice(-20000)));
  } catch {
    /* quota */
  }
}

export function filterRemovedFromCatalog<T extends { path: string }>(files: T[]): T[] {
  const removed = loadRemovedFromCatalog();
  if (removed.size === 0) return files;
  return files.filter((f) => !removed.has(f.path));
}

export function albumsContainingPath(items: AlbumItem[] | undefined, path: string): Album[] {
  const out: Album[] = [];
  const walk = (nodes: AlbumItem[] | undefined) => {
    if (!nodes) return;
    for (const item of nodes) {
      if (item.type === 'album' && (item.images || []).includes(path)) out.push(item);
      else if (item.type === 'group') walk(item.children);
    }
  };
  walk(items);
  return out;
}

export function removePathsFromAlbumTree(items: AlbumItem[], paths: string[]): AlbumItem[] {
  const drop = new Set(paths);
  const walk = (nodes: AlbumItem[]): AlbumItem[] =>
    nodes.map((item) => {
      if (item.type === 'album') {
        return { ...item, images: (item.images || []).filter((p) => !drop.has(p)) };
      }
      return { ...item, children: walk(item.children || []) };
    });
  return walk(items);
}

export function flattenNamedAlbums(
  items: AlbumItem[] | undefined,
  prefix = '',
): Array<{ id: string; label: string }> {
  return (items || []).flatMap((item) => {
    if (item.type === 'album') {
      if (item.id === UNCATEGORIZED_ALBUM_ID) return [];
      return [{ id: item.id, label: prefix + albumDisplayName(item) }];
    }
    return flattenNamedAlbums(item.children, `${prefix}${item.name} / `);
  });
}

/** Insert a new album at root, or as a child of an existing group. */
export function insertAlbumInTree(tree: AlbumItem[], album: Album, parentGroupId: string | null): AlbumItem[] {
  const next = structuredClone(tree);
  if (!parentGroupId) {
    next.push(album);
    return next;
  }
  const insert = (nodes: AlbumItem[]): boolean => {
    for (const n of nodes) {
      if (n.type === 'group' && n.id === parentGroupId) {
        n.children = [...(n.children || []), album];
        return true;
      }
      if (n.type === 'group' && insert(n.children || [])) return true;
    }
    return false;
  };
  if (!insert(next)) next.push(album);
  return next;
}

/**
 * Nest `child` inside an existing album by wrapping that album in a collection set
 * of the same name: Group(parentName) → [original album, child].
 */
export function nestAlbumInAlbum(tree: AlbumItem[], parentAlbumId: string, child: Album): AlbumItem[] {
  const next = structuredClone(tree);
  const replace = (nodes: AlbumItem[]): boolean => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 'album' && n.id === parentAlbumId) {
        const group: AlbumGroup = {
          type: 'group',
          id: crypto.randomUUID(),
          name: n.name,
          children: [n, child],
        };
        nodes[i] = group;
        return true;
      }
      if (n.type === 'group' && replace(n.children || [])) return true;
    }
    return false;
  };
  if (!replace(next)) next.push(child);
  return next;
}

export async function ensureUncategorizedAlbum(tree: AlbumItem[] | undefined): Promise<AlbumItem[]> {
  const current = tree || [];
  if (findAlbumById(current, UNCATEGORIZED_ALBUM_ID)) return current;
  const album: Album = {
    type: 'album',
    id: UNCATEGORIZED_ALBUM_ID,
    name: UNCATEGORIZED_ALBUM_NAME,
    images: [],
  };
  const next = [album, ...current];
  await invoke(Invokes.SaveAlbums, { tree: next });
  return invoke<AlbumItem[]>(Invokes.GetAlbums);
}
