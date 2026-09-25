import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Columns2, Star as StarIcon, ArrowLeftRight } from 'lucide-react';
import { useProcessStore } from '../../../store/useProcessStore';
import { ImageFile } from '../../ui/AppProperties';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';

/**
 * Lightroom Classic–style Compare (2-up) layout shell.
 * Select 1 photo = Select vs Candidate (same path until second pick).
 * Select 2+ = first two paths side by side.
 * Original RustROOM chrome — public LR layout structure only.
 */
interface CompareViewProps {
  imageList: ImageFile[];
  multiSelectedPaths: string[];
  activePath: string | null;
  imageRatings: Record<string, number>;
  onImageClick(path: string, event: any): void;
  onImageDoubleClick(path: string): void;
  onContextMenu(event: any, path: string): void;
  onRequestThumbnails?(paths: string[]): void;
  onRate?(rate: number, paths?: string[]): void;
}

function ComparePane({
  label,
  image,
  rating,
  isActive,
  onClick,
  onDoubleClick,
  onContextMenu,
  onRate,
  zoom,
  onZoomChange,
  pan,
  onPanChange,
  lockZoom,
}: {
  label: string;
  image: ImageFile | null;
  rating: number;
  isActive: boolean;
  onClick(e: any): void;
  onDoubleClick(): void;
  onContextMenu(e: any): void;
  onRate?(n: number): void;
  zoom: number;
  onZoomChange?(z: number): void;
  pan: { x: number; y: number };
  onPanChange?(p: { x: number; y: number }): void;
  lockZoom: boolean;
}) {
  const thumbUrl = useProcessStore((s) => (image ? s.thumbnails[image.path] : undefined));
  const preview = useProcessStore((s) => (image ? s.previews[image.path] : undefined));
  const src = preview?.url || thumbUrl;
  const colorTag = image?.tags?.find((t) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const flagTag = image?.tags?.find((t) => t.startsWith('flag:'))?.substring(5);
  const name = image?.path.split(/[\\/]/).pop()?.split('?')[0] || '—';

  return (
    <div
      className={clsx(
        'flex-1 min-w-0 flex flex-col rounded-md border overflow-hidden bg-[#1a1a1a]',
        isActive ? 'border-white/50 ring-1 ring-white/30' : 'border-border-color/40',
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="h-7 px-2 flex items-center gap-2 border-b border-white/10 shrink-0 bg-[#2a2a2a]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
        <span className="text-[11px] text-white/80 truncate flex-1">{name}</span>
        {flagTag && (
          <span
            className={clsx(
              'px-1 py-0.5 rounded text-[8px] font-bold uppercase',
              flagTag === 'pick' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white',
            )}
          >
            {flagTag === 'pick' ? 'P' : 'X'}
          </span>
        )}
        {colorLabel && (
          <span className="w-2.5 h-2.5 rounded-full ring-1 ring-black/30" style={{ backgroundColor: colorLabel.color }} />
        )}
      </div>
      <div
        className="flex-1 min-h-0 relative flex items-center justify-center p-2 bg-[#121212] overflow-hidden"
        onWheel={(e) => {
          if (!onZoomChange) return;
          e.preventDefault();
          e.stopPropagation();
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          onZoomChange(Math.min(4, Math.max(1, Math.round((zoom + delta) * 10) / 10)));
        }}
        onMouseDown={(e) => {
          if (zoom <= 1 || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const origin = { ...pan };
          const onMove = (ev: MouseEvent) => {
            onPanChange?.({
              x: origin.x + (ev.clientX - startX),
              y: origin.y + (ev.clientY - startY),
            });
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
      >
        {src ? (
          <img
            src={src}
            alt={name}
            className="max-w-full max-h-full object-contain select-none will-change-transform"
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          />
        ) : (
          <div className="text-[11px] text-white/30 uppercase tracking-wider">
            {image ? '…' : 'Select a photo'}
          </div>
        )}
        {zoom > 1 && (
          <span className="absolute bottom-1 right-1 text-[9px] tabular-nums px-1 py-0.5 rounded bg-black/55 text-white/70">
            {Math.round(zoom * 100)}%{lockZoom ? ' · lock' : ''}
          </span>
        )}
      </div>
      <div
        className="h-8 px-2 flex items-center gap-0.5 border-t border-white/10 bg-[#2a2a2a] shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={!image || !onRate}
            className="p-0.5 disabled:opacity-40"
            onClick={() => image && onRate?.(n)}
          >
            <StarIcon
              size={12}
              className={n <= rating ? 'text-amber-300 fill-amber-300' : 'text-white/25'}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CompareView({
  imageList,
  multiSelectedPaths,
  activePath,
  imageRatings,
  onImageClick,
  onImageDoubleClick,
  onContextMenu,
  onRequestThumbnails,
  onRate,
}: CompareViewProps) {
  const { t } = useTranslation();

  const { selectPath, candidatePath } = useMemo(() => {
    const selected = multiSelectedPaths.length > 0 ? multiSelectedPaths : activePath ? [activePath] : [];
    if (selected.length >= 2) {
      return { selectPath: selected[0], candidatePath: selected[1] };
    }
    if (selected.length === 1) {
      // LR: Select is primary; Candidate can be navigated — use next image as candidate hint
      const idx = imageList.findIndex((i) => i.path === selected[0]);
      const next = idx >= 0 && idx + 1 < imageList.length ? imageList[idx + 1].path : selected[0];
      return { selectPath: selected[0], candidatePath: next };
    }
    return { selectPath: null as string | null, candidatePath: null as string | null };
  }, [multiSelectedPaths, activePath, imageList]);

  const selectImg = imageList.find((i) => i.path === selectPath) || null;
  const candImg = imageList.find((i) => i.path === candidatePath) || null;

  useEffect(() => {
    const paths = [selectPath, candidatePath].filter(Boolean) as string[];
    if (paths.length && onRequestThumbnails) onRequestThumbnails(paths);
  }, [selectPath, candidatePath, onRequestThumbnails]);

  const [focus, setFocus] = useState<'select' | 'candidate'>('select');
  const [lockZoom, setLockZoom] = useState(true);
  const [zoomSelect, setZoomSelect] = useState(1);
  const [zoomCand, setZoomCand] = useState(1);
  const [panSelect, setPanSelect] = useState({ x: 0, y: 0 });
  const [panCand, setPanCand] = useState({ x: 0, y: 0 });

  const setSharedZoom = (z: number) => {
    setZoomSelect(z);
    setZoomCand(z);
    if (z <= 1) {
      setPanSelect({ x: 0, y: 0 });
      setPanCand({ x: 0, y: 0 });
    }
  };
  const setSharedPan = (p: { x: number; y: number }) => {
    setPanSelect(p);
    setPanCand(p);
  };

  // LR Compare: ↑/↓ step Candidate; Enter = Make Select; Tab = focus Select/Candidate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Tab: toggle focus label (Select ↔ Candidate)
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        setFocus((f) => (f === 'select' ? 'candidate' : 'select'));
        return;
      }

      // Enter: promote Candidate → Select (Make Select)
      if (e.key === 'Enter') {
        if (!candidatePath || candidatePath === selectPath) return;
        e.preventDefault();
        const lib = useLibraryStore.getState();
        const multi = [candidatePath, selectPath || candidatePath].filter(
          (p, i, a) => p && a.indexOf(p) === i,
        ) as string[];
        lib.setLibrary({
          multiSelectedPaths: multi,
          libraryActivePath: candidatePath,
          selectionAnchorPath: candidatePath,
        });
        setFocus('select');
        setZoomSelect(1);
        setZoomCand(1);
        setPanSelect({ x: 0, y: 0 });
        setPanCand({ x: 0, y: 0 });
        return;
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!imageList.length) return;
      e.preventDefault();
      const lib = useLibraryStore.getState();
      const multi = [...(lib.multiSelectedPaths || [])];
      let sel = multi.length >= 1 ? multi[0] : activePath;
      if (!sel) sel = imageList[0].path;
      let cand = multi.length >= 2 ? multi[1] : candidatePath;
      if (!cand) cand = sel;
      const idx = imageList.findIndex((i) => i.path === cand);
      if (idx < 0) return;
      let nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(imageList.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (nextIdx === idx) return;
      let finalCand = imageList[nextIdx].path;
      if (finalCand === sel && imageList.length > 1) {
        const skip =
          e.key === 'ArrowDown'
            ? Math.min(imageList.length - 1, nextIdx + 1)
            : Math.max(0, nextIdx - 1);
        finalCand = imageList[skip].path;
      }
      lib.setLibrary({
        multiSelectedPaths: [sel, finalCand],
        libraryActivePath: finalCand,
        selectionAnchorPath: finalCand,
      });
      setFocus('candidate');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageList, activePath, candidatePath, selectPath]);

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
      <div className="h-7 flex items-center gap-2 px-1 shrink-0">
        <Columns2 size={14} className="text-text-secondary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {t('library.viewMode.compare', { defaultValue: 'Compare' })}
        </span>
        <span className="text-[10px] text-text-secondary/60 flex-1 truncate">
          {t('library.compare.hint', {
            defaultValue: '↑/↓ Candidate · Enter Make Select · Tab focus · Shift+S swap · scroll zoom · double-click Develop.',
          })}
        </span>
        <button
          type="button"
          onClick={() => {
            setLockZoom((v) => !v);
          }}
          className={clsx(
            'h-6 px-2 rounded text-[10px] uppercase tracking-wide border border-border-color/30',
            lockZoom
              ? 'bg-accent/20 text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface',
          )}
          data-tooltip={t('library.compare.lockZoomTip' as any, {
            defaultValue: 'Lock zoom & pan between Select and Candidate',
          })}
        >
          {t('library.compare.lockZoom' as any, { defaultValue: lockZoom ? 'Zoom lock' : 'Zoom free' })}
        </button>
        <button
          type="button"
          disabled={!candidatePath || candidatePath === selectPath}
          onClick={() => {
            if (!candidatePath) return;
            const lib = useLibraryStore.getState();
            // Promote Candidate to Select (LR: make select)
            const multi = [candidatePath, selectPath || candidatePath].filter(
              (p, i, a) => p && a.indexOf(p) === i,
            ) as string[];
            lib.setLibrary({
              multiSelectedPaths: multi,
              libraryActivePath: candidatePath,
              selectionAnchorPath: candidatePath,
            });
            setFocus('select');
            setZoomSelect(1);
            setZoomCand(1);
            setPanSelect({ x: 0, y: 0 });
            setPanCand({ x: 0, y: 0 });
          }}
          className="h-6 px-2 rounded text-[10px] uppercase tracking-wide text-text-secondary hover:text-text-primary hover:bg-surface border border-border-color/30 disabled:opacity-40"
          data-tooltip={t('library.compare.makeSelectTip' as any, {
            defaultValue: 'Make Candidate the Select photo',
          })}
        >
          {t('library.compare.makeSelect' as any, { defaultValue: 'Make Select' })}
        </button>
        <button
          type="button"
          disabled={!selectPath || !candidatePath || selectPath === candidatePath}
          onClick={() => {
            if (!selectPath || !candidatePath || selectPath === candidatePath) return;
            const lib = useLibraryStore.getState();
            const multi = [...(lib.multiSelectedPaths || [])];
            if (multi.length >= 2) {
              // swap first two selection slots (Select / Candidate)
              const i0 = multi.indexOf(selectPath);
              const i1 = multi.indexOf(candidatePath);
              if (i0 >= 0 && i1 >= 0) {
                const tmp = multi[i0];
                multi[i0] = multi[i1];
                multi[i1] = tmp;
              } else {
                multi[0] = candidatePath;
                multi[1] = selectPath;
              }
              lib.setLibrary({
                multiSelectedPaths: multi,
                libraryActivePath: candidatePath,
              });
            } else {
              // single selection: promote candidate to select and keep old select as multi pair
              lib.setLibrary({
                multiSelectedPaths: [candidatePath, selectPath],
                libraryActivePath: candidatePath,
              });
            }
            setFocus('select');
          }}
          className="h-6 px-2 rounded text-[10px] uppercase tracking-wide flex items-center gap-1 text-text-secondary hover:text-text-primary hover:bg-surface border border-border-color/30 disabled:opacity-40"
          data-tooltip={t('library.compare.swapTip' as any, {
            defaultValue: 'Swap Select and Candidate',
          })}
        >
          <ArrowLeftRight size={12} />
          <span className="hidden sm:inline">
            {t('library.compare.swap' as any, { defaultValue: 'Swap' })}
          </span>
        </button>
      </div>
      <div className="flex-1 min-h-0 flex gap-2">
        <ComparePane
          label={t('library.compare.select', { defaultValue: 'Select' })}
          image={selectImg}
          rating={selectPath ? imageRatings[selectPath] || selectImg?.rating || 0 : 0}
          isActive={focus === 'select'}
          onClick={(e) => {
            setFocus('select');
            if (selectPath) onImageClick(selectPath, e);
          }}
          onDoubleClick={() => selectPath && onImageDoubleClick(selectPath)}
          onContextMenu={(e) => selectPath && onContextMenu(e, selectPath)}
          onRate={onRate && selectPath ? (n) => onRate(n, [selectPath]) : undefined}
          zoom={zoomSelect}
          pan={panSelect}
          lockZoom={lockZoom}
          onZoomChange={(z) => {
            if (lockZoom) setSharedZoom(z);
            else setZoomSelect(z);
          }}
          onPanChange={(p) => {
            if (lockZoom) setSharedPan(p);
            else setPanSelect(p);
          }}
        />
        <ComparePane
          label={t('library.compare.candidate', { defaultValue: 'Candidate' })}
          image={candImg}
          rating={candidatePath ? imageRatings[candidatePath] || candImg?.rating || 0 : 0}
          isActive={focus === 'candidate'}
          onClick={(e) => {
            setFocus('candidate');
            if (candidatePath) onImageClick(candidatePath, e);
          }}
          onDoubleClick={() => candidatePath && onImageDoubleClick(candidatePath)}
          onContextMenu={(e) => candidatePath && onContextMenu(e, candidatePath)}
          onRate={onRate && candidatePath ? (n) => onRate(n, [candidatePath]) : undefined}
          zoom={lockZoom ? zoomSelect : zoomCand}
          pan={lockZoom ? panSelect : panCand}
          lockZoom={lockZoom}
          onZoomChange={(z) => {
            if (lockZoom) setSharedZoom(z);
            else setZoomCand(z);
          }}
          onPanChange={(p) => {
            if (lockZoom) setSharedPan(p);
            else setPanCand(p);
          }}
        />
      </div>
    </div>
  );
}
