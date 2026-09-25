import { useEffect, useState } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { generateLibraryPreview } from '../../utils/libraryPreview';

type DisplayMode = 'library' | 'develop' | 'empty';

/**
 * Secondary-monitor viewer: fullscreen photo on the chosen principal screen.
 * Develop uses the wgpu surface attached to this window (no duplicate canvas).
 * Library shows the GPU preview JPEG for the active photo.
 */
export default function DisplayWindow() {
  const [mode, setMode] = useState<DisplayMode>('empty');
  const [src, setSrc] = useState<string | null>(null);
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const unlistenShow = listen(
      'dual-display-show',
      async (event: { payload: { mode?: DisplayMode; path?: string | null; name?: string } }) => {
        if (cancelled) return;
        const nextMode = event.payload.mode || 'empty';
        const path = event.payload.path || null;
        setMode(nextMode);
        setLabel(event.payload.name || (path ? path.split(/[/\\]/).pop() || '' : ''));
        if (nextMode === 'library' && path) {
          const url = await generateLibraryPreview(path);
          if (!cancelled) setSrc(url);
        } else {
          setSrc((prev) => {
            if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
            return null;
          });
        }
      },
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        invoke('set_dual_display', { enabled: false, principalId: null }).catch(() => {});
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        emit('dual-display-nav', { dir: 1 }).catch(() => {});
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        emit('dual-display-nav', { dir: -1 }).catch(() => {});
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      unlistenShow.then((u) => u());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-black overflow-hidden select-none relative">
      {mode === 'library' && src ? (
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : null}
      {label ? (
        <div className="absolute bottom-4 left-4 text-white/70 text-sm pointer-events-none drop-shadow">
          {label}
        </div>
      ) : null}
    </div>
  );
}
