import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';

import { useProcessStore } from '../../../store/useProcessStore';
import { Invokes } from '../../ui/AppProperties';

/** Double-click viewer: one photo, larger, nothing else (no Develop, no folder navigation). */
export default function LibraryLightbox({ path, onClose }: { path: string; onClose: () => void }) {
  const thumbUrl = useProcessStore((s) => s.thumbnails[path]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    (async () => {
      try {
        const metadata: any = await invoke(Invokes.LoadMetadata, { path });
        const adjustments = metadata?.adjustments && !metadata.adjustments.is_null ? metadata.adjustments : {};
        const bytes = await invoke<Uint8Array>(Invokes.GeneratePreviewForPath, { path, jsAdjustments: adjustments });
        if (!active) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
        setPreviewUrl(url);
      } catch (err) {
        console.error('Lightbox preview failed:', err);
      }
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const src = previewUrl || thumbUrl;
  const name = path.split(/[\\/]/).pop()?.split('?')[0];

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-8" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10"
        aria-label="Close"
      >
        <X size={20} />
      </button>
      {src && (
        <img
          src={src}
          alt={name}
          className="max-w-full max-h-full object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/60">{name}</div>
    </div>
  );
}
