/** Library folder roots: one path per folder, grouped under its disk. */

export function normalizeLibraryPath(path: string): string {
  let s = path.trim().replace(/\//g, '\\');
  const windows = /^[a-zA-Z]:/.test(s) || s.startsWith('\\\\');
  if (windows) {
    if (/^[a-zA-Z]:$/.test(s)) s += '\\';
    if (!/^[a-zA-Z]:\\$/.test(s)) s = s.replace(/\\+$/, '');
    return s.toLowerCase();
  }
  s = s.replace(/\\/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

export function sameLibraryPath(a: string, b: string): boolean {
  return normalizeLibraryPath(a) === normalizeLibraryPath(b);
}

/** True when `child` is strictly inside `parent`. */
export function isLibraryPathInside(parent: string, child: string): boolean {
  const p = normalizeLibraryPath(parent);
  const c = normalizeLibraryPath(child);
  if (!p || !c || p === c) return false;
  const sep = p.includes('\\') ? '\\' : '/';
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

/** The folder, or a parent of it, is already a library root. */
export function libraryRootCoveredBy(roots: string[], path: string): boolean {
  return roots.some((root) => sameLibraryPath(root, path) || isLibraryPathInside(root, path));
}

/** Drop exact duplicates and roots that sit inside another root. */
export function dedupeLibraryRoots(roots: string[]): string[] {
  const kept: string[] = [];
  for (const path of roots) {
    if (!path) continue;
    if (kept.some((existing) => sameLibraryPath(existing, path) || isLibraryPathInside(existing, path))) {
      continue;
    }
    const withoutNested = kept.filter((existing) => !isLibraryPathInside(path, existing));
    kept.length = 0;
    kept.push(...withoutNested, path);
  }
  return kept;
}

export interface DriveRef {
  id: string;
  letter: string;
}

export function driveOfPath(path: string): DriveRef {
  const slashed = path.trim().replace(/\//g, '\\');
  const win = slashed.match(/^([a-zA-Z]):/);
  if (win) {
    const letter = win[1].toUpperCase();
    return { id: `drive:${letter}:\\`, letter };
  }
  const unc = slashed.match(/^\\\\[^\\]+\\[^\\]+/);
  if (unc) return { id: `drive:${unc[0].toLowerCase()}`, letter: unc[0] };
  const vol = path.match(/^\/Volumes\/([^/]+)/);
  if (vol) return { id: `drive:/Volumes/${vol[1]}`, letter: vol[1] };
  if (path.startsWith('/')) return { id: 'drive:/', letter: '/' };
  return { id: `drive:${normalizeLibraryPath(path)}`, letter: path };
}

export function isDriveRootPath(path: string): boolean {
  const n = normalizeLibraryPath(path);
  return /^[a-z]:\\$/.test(n) || /^\\\\[^\\]+\\[^\\]+$/.test(n);
}

export function groupTreesByDrive<T extends { path: string }>(
  trees: T[],
): Array<{ id: string; letter: string; trees: T[] }> {
  const order: string[] = [];
  const groups = new Map<string, { id: string; letter: string; trees: T[] }>();
  for (const tree of dedupeLibraryRoots(trees.map((t) => t.path))
    .map((path) => trees.find((t) => sameLibraryPath(t.path, path)))
    .filter((t): t is T => !!t)) {
    const drive = driveOfPath(tree.path);
    let group = groups.get(drive.id);
    if (!group) {
      group = { id: drive.id, letter: drive.letter, trees: [] };
      groups.set(drive.id, group);
      order.push(drive.id);
    }
    group.trees.push(tree);
  }
  return order.map((id) => groups.get(id)!);
}

export interface PathBranch<T> {
  path: string;
  name: string;
  /** Set when this node is an imported folder. Its real subfolders live on the tree. */
  imported?: T;
  children: PathBranch<T>[];
}

function pathSegments(path: string): { drive: string; parts: string[] } {
  const slashed = path.trim().replace(/\//g, '\\');
  const win = slashed.match(/^([a-zA-Z]):\\?(.*)$/);
  if (win) {
    const rest = win[2].replace(/\\+$/, '');
    return {
      drive: `${win[1].toUpperCase()}:\\`,
      parts: rest ? rest.split('\\').filter(Boolean) : [],
    };
  }
  const unc = slashed.match(/^(\\\\[^\\]+\\[^\\]+)\\?(.*)$/);
  if (unc) {
    const rest = unc[2].replace(/\\+$/, '');
    return { drive: unc[1], parts: rest ? rest.split('\\').filter(Boolean) : [] };
  }
  const parts = path.split(/[\\/]/).filter(Boolean);
  return { drive: '', parts };
}

/** Share the common directories so two folders named PHOTOS are not siblings. */
export function mergeImportedBranches<T extends { path: string }>(trees: T[]): PathBranch<T>[] {
  const roots: PathBranch<T>[] = [];
  const deduped = dedupeLibraryRoots(trees.map((t) => t.path))
    .map((path) => trees.find((t) => sameLibraryPath(t.path, path)))
    .filter((t): t is T => !!t);

  for (const tree of deduped) {
    const { drive, parts } = pathSegments(tree.path);
    if (parts.length === 0) {
      roots.push({ path: tree.path, name: drive || tree.path, imported: tree, children: [] });
      continue;
    }
    let level = roots;
    let acc = drive;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const sep = acc.endsWith('\\') || acc === '' ? '' : '\\';
      acc = `${acc}${sep}${name}`;
      let node = level.find((item) => sameLibraryPath(item.path, acc));
      if (!node) {
        node = { path: acc, name, children: [] };
        level.push(node);
      }
      if (i === parts.length - 1) node.imported = tree;
      level = node.children;
    }
  }
  return roots;
}
