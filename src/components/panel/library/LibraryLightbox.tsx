import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useProcessStore } from '../../../store/useProcessStore';
import { ImageFile } from '../../ui/AppProperties';
import { generateLibraryPreview } from '../../../utils/libraryPreview';

/**
 * Library lightbox: one photo in the center pane (sidebars stay).
 * Wheel zoom, drag pan, ←/→ via parent active path.
 */
export default function LibraryLightbox({
  path,
  imageList,
  onNavigate,
}: {
  path: string;
  imageList: ImageFile[];
  onNavigate: (path: string) => void;
}) {
  const thumbUrl = useProcessStore((s) => s.thumbnails[path]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const index = imageList.findIndex((img) => img.path === path);
  const prev = index > 0 ? imageList[index - 1] : null;
  const next = index >= 0 && index < imageList.length - 1 ? imageList[index + 1] : null;

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [path]);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    generateLibraryPreview(path).then((url) => {
      if (active && url) setPreviewUrl(url);
    });
    return () => {
      active = false;
    };
  }, [path]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      setZoom((z) => {
        const nextZ = Math.min(6, Math.max(1, Math.round((z + delta) * 100) / 100));
        if (nextZ <= 1) setPan({ x: 0, y: 0 });
        return nextZ;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1 || e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...pan };
    const onMove = (ev: MouseEvent) => {
      setPan({ x: origin.x + (ev.clientX - startX), y: origin.y + (ev.clientY - startY) });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const src = previewUrl || thumbUrl;
  const name = path.split(/[\\/]/).pop()?.split('?')[0];

  return (
    <div
      ref={stageRef}
      className="flex-1 min-h-0 relative flex items-center justify-center bg-[#121212] overflow-hidden"
    >
      {src && (
        <img
          src={src}
          alt={name}
          draggable={false}
          className="select-none will-change-transform max-w-full max-h-full object-contain"
          style={
            zoom > 1
              ? {
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  cursor: 'grab',
                }
              : { cursor: 'default' }
          }
          onMouseDown={onMouseDown}
          onDoubleClick={() => {
            setZoom((z) => (z > 1 ? 1 : 2));
            setPan({ x: 0, y: 0 });
          }}
        />
      )}
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onNavigate(prev.path)}
        className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 text-white/80 hover:bg-black/70 disabled:opacity-20 flex items-center justify-center"
        aria-label="Previous"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onNavigate(next.path)}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 text-white/80 hover:bg-black/70 disabled:opacity-20 flex items-center justify-center"
        aria-label="Next"
      >
        <ChevronRight size={18} />
      </button>
      {zoom > 1 && (
        <div className="absolute bottom-2 right-3 text-[10px] tabular-nums text-white/50 pointer-events-none">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
}
