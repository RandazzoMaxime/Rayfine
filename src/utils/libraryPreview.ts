import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../components/ui/AppProperties';
import { useProcessStore } from '../store/useProcessStore';

const inflight = new Map<string, Promise<string | null>>();

/** GPU-developed still for Library loupe / lightbox (same pipeline as Develop, max 4096). */
export async function generateLibraryPreview(path: string): Promise<string | null> {
  if (!path) return null;
  const cached = useProcessStore.getState().previews[path];
  if (cached?.url) return cached.url;
  const pending = inflight.get(path);
  if (pending) return pending;
  const job = generateLibraryPreviewUncached(path).finally(() => {
    inflight.delete(path);
  });
  inflight.set(path, job);
  return job;
}

async function generateLibraryPreviewUncached(path: string): Promise<string | null> {
  try {
    const metadata: any = await invoke(Invokes.LoadMetadata, { path });
    const adjustments =
      metadata?.adjustments && !metadata.adjustments.is_null ? metadata.adjustments : {};
    const bytes = await invoke<Uint8Array>(Invokes.GeneratePreviewForPath, {
      path,
      jsAdjustments: adjustments,
    });
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    useProcessStore.getState().setPreview(path, url, 'gpu-preview');
    return url;
  } catch (err) {
    console.error('Library GPU preview failed:', err);
    return null;
  }
}
