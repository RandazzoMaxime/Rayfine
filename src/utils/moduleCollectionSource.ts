const EMPTY: never[] = [];

/** Map / Border / Web: never treat the Library folder as a collection. */
export function initialModuleAlbumId(
  libraryActiveAlbumId: string | null | undefined,
): string | null {
  return libraryActiveAlbumId || null;
}

export function collectionOnlyImages<T>(opts: {
  albumId: string | null;
  albumImages: T[] | null | undefined;
}): T[] {
  if (!opts.albumId) return EMPTY as T[];
  return opts.albumImages ?? (EMPTY as T[]);
}

/** Checked / active photos that actually belong to the selected collection. */
export function placedFromCollection(opts: {
  collectionPaths: string[];
  multiSelectedPaths: string[];
  libraryActivePath: string | null;
  max: number;
}): string[] {
  const inCol = new Set(opts.collectionPaths);
  let paths = (opts.multiSelectedPaths || []).filter((p) => inCol.has(p));
  if (paths.length === 0 && opts.libraryActivePath && inCol.has(opts.libraryActivePath)) {
    paths = [opts.libraryActivePath];
  }
  return paths.slice(0, opts.max);
}
