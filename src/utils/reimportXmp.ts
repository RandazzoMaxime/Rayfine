import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../components/ui/AppProperties';
import { Adjustments, normalizeLoadedAdjustments } from './adjustments';
import { denormalizeMaskCoordinates } from './maskUtils';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { globalImageCache } from './ImageLRUCache';
import { debouncedSave, debouncedSetHistory } from '../hooks/useEditorActions';
import { invalidateThumbnailPaths } from '../hooks/useThumbnails';

function markLibraryEdited(paths: string[]) {
  if (paths.length === 0) return;
  const { imageList, setLibrary } = useLibraryStore.getState();
  if (!imageList?.length) return;
  const pathSet = new Set(paths);
  let changed = false;
  const next = imageList.map((img: any) => {
    if (!pathSet.has(img.path) || img.is_edited) return img;
    changed = true;
    return { ...img, is_edited: true };
  });
  if (changed) setLibrary({ imageList: next });
}

function clearFrontendCaches(paths: string[]) {
  if (paths.length === 0) return;
  const pathSet = new Set(paths);

  for (const path of pathSet) globalImageCache.delete(path);

  useProcessStore.getState().setProcess((state) => {
    const thumbnails = { ...state.thumbnails };
    const previews = { ...state.previews };
    let changed = false;
    for (const path of pathSet) {
      if (path in thumbnails) {
        delete thumbnails[path];
        changed = true;
      }
      if (path in previews) {
        try {
          URL.revokeObjectURL(previews[path].url);
        } catch {
          /* ignore */
        }
        delete previews[path];
        changed = true;
      }
    }
    return changed ? { thumbnails, previews } : {};
  });

  const editor = useEditorStore.getState();
  const open = editor.selectedImage?.path;
  if (open && pathSet.has(open)) {
    debouncedSave.cancel();
    debouncedSetHistory.cancel();
    editor.patchesSentToBackend.clear();
    if (editor.uncroppedAdjustedPreviewUrl || editor.finalPreviewUrl) {
      editor.setEditor({
        uncroppedAdjustedPreviewUrl: null,
        finalPreviewUrl: null,
        hasRenderedFirstFrame: false,
      });
    } else {
      editor.setEditor({ hasRenderedFirstFrame: false });
    }
  }
}

function applyNormToOpenEditor(path: string, norm: Adjustments) {
  const editor = useEditorStore.getState();
  if (editor.selectedImage?.path !== path) return;
  debouncedSave.cancel();
  debouncedSetHistory.cancel();
  editor.resetHistory(norm);
  editor.patchesSentToBackend.clear();
  editor.setEditor({
    adjustments: norm,
    hasRenderedFirstFrame: false,
    uncroppedAdjustedPreviewUrl: null,
    finalPreviewUrl: null,
  });
}

function queueThumbnailRefresh(paths: string[]) {
  if (paths.length === 0) return;
  invalidateThumbnailPaths(paths);
  invoke('update_thumbnail_queue', { paths }).catch(() => {
    /* ignore queue errors */
  });
  // Let visible grids re-request immediately (they skip paths still marked generated)
  try {
    window.dispatchEvent(new CustomEvent('rustroom:thumbnails-invalidate', { detail: { paths } }));
  } catch {
    /* ignore non-browser */
  }
}

export async function reimportDevelopFromXmpPath(path: string): Promise<Adjustments> {
  const adjustments = await invoke(Invokes.ReimportDevelopFromXmp, { path });
  let norm = normalizeLoadedAdjustments(adjustments as any);
  {
    const sz = useEditorStore.getState().originalSize;
    if (sz?.width && sz?.height) {
      norm = denormalizeMaskCoordinates(norm, sz.width, sz.height);
    }
  }
  // Clear stale UI caches first, then apply develop so the render pipeline starts clean
  clearFrontendCaches([path]);
  applyNormToOpenEditor(path, norm);
  markLibraryEdited([path]);
  queueThumbnailRefresh([path]);
  return norm;
}

export async function reimportDevelopFromXmpPaths(
  paths: string[],
): Promise<{ ok: number; fail: number; errors?: string[] }> {
  if (paths.length === 0) return { ok: 0, fail: 0 };
  if (paths.length === 1) {
    try {
      await reimportDevelopFromXmpPath(paths[0]);
      return { ok: 1, fail: 0 };
    } catch {
      return { ok: 0, fail: 1 };
    }
  }

  const result = await invoke<{ ok: number; fail: number; okPaths?: string[]; errors?: string[] }>(
    Invokes.ReimportDevelopFromXmpPaths,
    { paths },
  );

  const okPaths = result.okPaths || [];
  clearFrontendCaches(paths);

  const openPath = useEditorStore.getState().selectedImage?.path;
  if (openPath && okPaths.includes(openPath)) {
    try {
      const meta: any = await invoke(Invokes.LoadMetadata, { path: openPath });
      if (meta?.adjustments) {
        let norm = normalizeLoadedAdjustments(meta.adjustments);
        const sz = useEditorStore.getState().originalSize;
        if (sz?.width && sz?.height) {
          norm = denormalizeMaskCoordinates(norm, sz.width, sz.height);
        }
        applyNormToOpenEditor(openPath, norm);
      }
    } catch {
      /* ignore editor refresh errors */
    }
  }

  if (okPaths.length > 0) {
    markLibraryEdited(okPaths);
    queueThumbnailRefresh(okPaths);
  }

  return { ok: result.ok, fail: result.fail, errors: result.errors };
}


/** Force-write RR develop (+ open editor adjustments if matching) into photo `.xmp`. */
export async function exportDevelopToXmpPath(path: string): Promise<void> {
  const editor = useEditorStore.getState();
  const adjustments =
    editor.selectedImage?.path === path ? editor.adjustments : undefined;
  // Flush pending RR sidecar write so rating/tags + develop are current when we don't pass adj
  if (editor.selectedImage?.path === path) {
    debouncedSave.cancel();
    try {
      await invoke(Invokes.SaveMetadataAndUpdateThumbnail, {
        path,
        adjustments: editor.adjustments,
      });
    } catch {
      /* fall through — still try XMP write from RR sidecar */
    }
  }
  await invoke(Invokes.ExportDevelopToXmp, {
    path,
    adjustments: adjustments ?? null,
  });
}

/** Batch-export develop settings to each photo's `.xmp` sidecar (LR multi-select export). */
export async function exportDevelopToXmpPaths(
  paths: string[],
): Promise<{ ok: number; fail: number; errors: string[] }> {
  if (paths.length === 0) return { ok: 0, fail: 0, errors: [] };
  if (paths.length === 1) {
    try {
      await exportDevelopToXmpPath(paths[0]);
      return { ok: 1, fail: 0, errors: [] };
    } catch (e) {
      return { ok: 0, fail: 1, errors: [String(e)] };
    }
  }
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];
  for (const path of paths) {
    try {
      await exportDevelopToXmpPath(path);
      ok += 1;
    } catch (e) {
      fail += 1;
      errors.push(`${path}: ${e}`);
    }
  }
  return { ok, fail, errors };
}

