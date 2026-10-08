import { useRef, useCallback, useMemo, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';

/** Shared so reimport/XMP flows can force re-request of thumbs after cache clear. */
const sharedGenerated = new Set<string>();
const sharedPending = new Set<string>();

export function invalidateThumbnailPaths(paths: string[]) {
  for (const p of paths) {
    sharedGenerated.delete(p);
    sharedPending.delete(p);
  }
}

export function useThumbnails() {
  // Keep refs pointing at shared sets so markGenerated/requestThumbnails stay in sync
  const generatedRef = useRef(sharedGenerated);
  const pendingQueueRef = useRef(sharedPending);
  const lastVisibleRef = useRef<string[]>([]);

  const flushQueueToBackend = useMemo(
    () =>
      debounce(
        () => {
          const pathsToSend = Array.from(pendingQueueRef.current);
          if (pathsToSend.length === 0) return;

          // Backend worker pops from the back of its queue (LIFO): send in reverse so the
          // first-requested paths (top of the visible grid) are generated first.
          pathsToSend.reverse();

          invoke('update_thumbnail_queue', { paths: pathsToSend }).catch((err) => {
            console.error('Failed to update thumbnail queue:', err);
          });

          pendingQueueRef.current.clear();
        },
        16,
        { maxWait: 32 },
      ),
    [],
  );

  const requestThumbnails = useCallback(
    (visiblePaths: string[]) => {
      lastVisibleRef.current = visiblePaths;
      let addedToQueue = false;

      visiblePaths.forEach((p) => {
        if (!generatedRef.current.has(p) && !pendingQueueRef.current.has(p)) {
          pendingQueueRef.current.add(p);
          addedToQueue = true;
        }
      });

      if (addedToQueue) {
        flushQueueToBackend();
      }
    },
    [flushQueueToBackend],
  );

  const markGenerated = useCallback((path: string) => {
    generatedRef.current.add(path);
    pendingQueueRef.current.delete(path);
  }, []);

  const clearThumbnailQueue = useCallback(() => {
    generatedRef.current.clear();
    pendingQueueRef.current.clear();
    flushQueueToBackend.cancel();
    invoke('update_thumbnail_queue', { paths: [] }).catch(console.error);
  }, [flushQueueToBackend]);

  useEffect(() => {
    const onInvalidate = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { paths?: string[] } | undefined;
      const paths = detail?.paths || [];
      if (paths.length) invalidateThumbnailPaths(paths);
      // Re-request currently visible items so they refill after XMP reimport
      const visible = lastVisibleRef.current;
      if (visible.length) {
        let added = false;
        for (const p of visible) {
          if (!generatedRef.current.has(p) && !pendingQueueRef.current.has(p)) {
            pendingQueueRef.current.add(p);
            added = true;
          }
        }
        if (added) flushQueueToBackend();
      }
    };
    window.addEventListener('rustroom:thumbnails-invalidate', onInvalidate as EventListener);
    return () => {
      window.removeEventListener('rustroom:thumbnails-invalidate', onInvalidate as EventListener);
      flushQueueToBackend.cancel();
    };
  }, [flushQueueToBackend]);

  return { requestThumbnails, clearThumbnailQueue, markGenerated, invalidateThumbnailPaths };
}
