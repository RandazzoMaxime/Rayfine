import { GroupPreference, ImageFile } from '../components/ui/AppProperties';

export type GroupId = string;

export interface GroupBadgeInfo {
  count: number;
  label: string;
}

export interface GroupingResult {
  displayList: ImageFile[];
  badges: Map<GroupId, GroupBadgeInfo>;
}

export function buildImageGroups(
  images: ImageFile[],
  preference: GroupPreference,
  groupEditedFiles = true,
): GroupingResult {
  const buckets = new Map<GroupId, ImageFile[]>();

  for (const image of images) {
    if (!image.group_id || image.is_virtual_copy) continue;
    if (!groupEditedFiles && image.is_edited) continue;

    let bucket = buckets.get(image.group_id);
    if (!bucket) {
      bucket = [];
      buckets.set(image.group_id, bucket);
    }
    bucket.push(image);
  }

  const groupedPaths = new Set<string>();
  const badges = new Map<GroupId, GroupBadgeInfo>();

  for (const [groupId, files] of buckets) {
    if (files.length < 2) continue;

    const primary = pickPrimary(files, preference);
    for (const file of files) {
      if (file.path !== primary.path) {
        groupedPaths.add(file.path);
      }
    }

    const extensions = new Set(files.map((f) => getVariantLabel(f.path)));
    badges.set(groupId, {
      count: files.length,
      label: Array.from(extensions).sort().join('+'),
    });
  }

  const displayList = images.filter((img) => !groupedPaths.has(img.path));
  return { displayList, badges };
}

function pickPrimary(files: ImageFile[], preference: GroupPreference): ImageFile {
  const raw = files.find((f) => f.is_raw);
  const nonRaw = files.find((f) => !f.is_raw);

  switch (preference) {
    case 'raw':
      return raw ?? nonRaw ?? files[0];
    case 'jpeg':
      return nonRaw ?? raw ?? files[0];
    default:
      return files[0];
  }
}

/** Directory + stem (no extension), for pairing IMG_001.CR2 with IMG_001.JPG. */
export function sameNameStemKey(path: string): string {
  const clean = physicalPathOf(path);
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const dir = slash >= 0 ? clean.slice(0, slash) : '';
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}/${stem}`.toLowerCase();
}

/** Hide JPEG/TIFF/HEIC companions when a RAW with the same name exists (Lightroom). */
export function hideNonRawWhenRawSibling(images: ImageFile[]): ImageFile[] {
  const stemsWithRaw = new Set<string>();
  for (const img of images) {
    if (img.is_raw && !img.is_virtual_copy) stemsWithRaw.add(sameNameStemKey(img.path));
  }
  if (stemsWithRaw.size === 0) return images;
  return images.filter((img) => {
    if (img.is_raw || img.is_virtual_copy) return true;
    return !stemsWithRaw.has(sameNameStemKey(img.path));
  });
}

export function getFileExtension(path: string): string {
  const clean = path.split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  return clean.substring(dot + 1).toLowerCase();
}

export function getVariantLabel(path: string): string {
  const ext = getFileExtension(path);
  return ext ? ext.toUpperCase() : 'FILE';
}

export function findGroupVariants(images: ImageFile[], groupId: string | null | undefined): ImageFile[] {
  if (!groupId) return [];
  // Manual stack ids are stored as "stack:<id>" in effectiveGroupId
  if (groupId.startsWith('stack:')) {
    const sid = groupId.slice('stack:'.length);
    return images.filter((img) => stackIdFromTags(img.tags) === sid);
  }
  return images.filter((img) => img.group_id === groupId && !img.is_virtual_copy);
}


/** Physical path without virtual-copy query suffix. */
export function physicalPathOf(path: string): string {
  return String(path || '').split('?vc=')[0];
}

/**
 * Master + all virtual copies that share the same physical file.
 * Order: master first, then VCs by path (stable).
 */
export function findVirtualCopyStack(images: ImageFile[], path: string | null | undefined): ImageFile[] {
  if (!path) return [];
  const physical = physicalPathOf(path);
  if (!physical) return [];
  const stack = images.filter((img) => physicalPathOf(img.path) === physical);
  stack.sort((a, b) => {
    const aVc = a.path.includes('?vc=') || a.is_virtual_copy ? 1 : 0;
    const bVc = b.path.includes('?vc=') || b.is_virtual_copy ? 1 : 0;
    if (aVc !== bVc) return aVc - bVc;
    return a.path.localeCompare(b.path);
  });
  return stack;
}

export function virtualCopyLabel(path: string): string {
  if (!path.includes('?vc=')) return 'Master';
  const id = path.split('?vc=')[1] || '';
  // short id for UI
  const short = id.length > 6 ? id.slice(0, 6) : id;
  return short ? `Copy ${short}` : 'Copy';
}


/** Manual photo stack tag prefix (stored in image.tags, syncs to XMP). */
export const STACK_TAG_PREFIX = 'stack:';

export function stackIdFromTags(tags: string[] | null | undefined): string | null {
  if (!tags || !tags.length) return null;
  for (const tg of tags) {
    if (typeof tg === 'string' && tg.startsWith(STACK_TAG_PREFIX)) {
      const id = tg.slice(STACK_TAG_PREFIX.length).trim();
      if (id) return id;
    }
  }
  return null;
}

export function stackTag(id: string): string {
  return `${STACK_TAG_PREFIX}${id}`;
}

/** Effective group id: manual stack tag takes priority over RAW/JPEG group_id. */
export function effectiveGroupId(img: ImageFile): string | null {
  const manual = stackIdFromTags(img.tags);
  if (manual) return `stack:${manual}`;
  return img.group_id || null;
}

/**
 * Collapse manual stacks + optional RAW/JPEG groups into a display list with badges.
 * Manual stacks always apply; RAW/JPEG groups apply when groupingMode !== 'off'.
 */
export function buildDisplayGroups(
  images: ImageFile[],
  preference: GroupPreference | 'off',
  groupEditedFiles = true,
  expandedStackIds: string[] | Set<string> = [],
): GroupingResult {
  const expanded = expandedStackIds instanceof Set
    ? expandedStackIds
    : new Set(expandedStackIds || []);
  // 1) Manual stacks
  const manualBuckets = new Map<string, ImageFile[]>();
  for (const image of images) {
    const sid = stackIdFromTags(image.tags);
    if (!sid) continue;
    const key = `stack:${sid}`;
    let bucket = manualBuckets.get(key);
    if (!bucket) {
      bucket = [];
      manualBuckets.set(key, bucket);
    }
    bucket.push(image);
  }

  const hidden = new Set<string>();
  const badges = new Map<GroupId, GroupBadgeInfo>();

  for (const [key, files] of manualBuckets) {
    if (files.length < 2) continue;
    // Primary = first by capture date then path
    const sorted = [...files].sort((a, b) => {
      const da = a.exif?.DateTimeOriginal || '';
      const db = b.exif?.DateTimeOriginal || '';
      if (da !== db) return da < db ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    const primary = sorted[0];
    if (!expanded.has(key)) {
      for (const f of sorted) {
        if (f.path !== primary.path) hidden.add(f.path);
      }
    }
    badges.set(key, {
      count: files.length,
      label: expanded.has(key) ? `S${files.length}↓` : `S${files.length}`,
    });
  }

  // 2) RAW/JPEG automatic groups (when enabled)
  if (preference && preference !== 'off') {
    const auto = buildImageGroups(
      images.filter((img) => !stackIdFromTags(img.tags)),
      preference as GroupPreference,
      groupEditedFiles,
    );
    for (const [gid, badge] of auto.badges) {
      if (!badges.has(gid)) badges.set(gid, badge);
    }
    // Hide non-primary auto-group members not already in a manual stack
    const autoBuckets = new Map<string, ImageFile[]>();
    for (const image of images) {
      if (stackIdFromTags(image.tags)) continue;
      if (!image.group_id || image.is_virtual_copy) continue;
      if (!groupEditedFiles && image.is_edited) continue;
      let b = autoBuckets.get(image.group_id);
      if (!b) {
        b = [];
        autoBuckets.set(image.group_id, b);
      }
      b.push(image);
    }
    for (const [gid, files] of autoBuckets) {
      if (files.length < 2) continue;
      const primary = pickPrimary(files, preference as GroupPreference);
      if (!expanded.has(gid)) {
        for (const f of files) {
          if (f.path !== primary.path) hidden.add(f.path);
        }
      }
      if (!badges.has(gid)) {
        const extensions = new Set(files.map((f) => getVariantLabel(f.path)));
        badges.set(gid, {
          count: files.length,
          label: Array.from(extensions).sort().join('+'),
        });
      }
    }
  }

  const displayList = images.filter((img) => !hidden.has(img.path));
  return { displayList, badges };
}

/** All photos sharing the same manual stack id as `path`. */
export function findManualStack(images: ImageFile[], path: string | null | undefined): ImageFile[] {
  if (!path) return [];
  const img = images.find((i) => i.path === path);
  const sid = stackIdFromTags(img?.tags);
  if (!sid) return img ? [img] : [];
  return images.filter((i) => stackIdFromTags(i.tags) === sid);
}

export function newStackId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}


/** Normalize EXIF DateTimeOriginal to a second-precision key for burst stacking. */
export function captureTimeKey(img: ImageFile | null | undefined): string {
  if (!img) return '';
  const raw = String(img.exif?.DateTimeOriginal || img.exif?.CreateDate || img.exif?.DateTime || '').trim();
  if (!raw) return '';
  // "2024:01:15 12:30:45" or "2024-01-15T12:30:45"
  return raw.replace('T', ' ').slice(0, 19);
}

/** Group selected paths by capture second; returns map key → paths. */
export function groupPathsByCaptureTime(images: ImageFile[], paths: string[]): Map<string, string[]> {
  const byPath = new Map(images.map((i) => [i.path, i]));
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const img = byPath.get(p);
    const key = captureTimeKey(img);
    if (!key) continue;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(p);
  }
  return groups;
}
