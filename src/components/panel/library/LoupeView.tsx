import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Star as StarIcon,
  Maximize2,
  Flag,
  FlagOff,
} from 'lucide-react';
import { useProcessStore } from '../../../store/useProcessStore';
import { ImageFile } from '../../ui/AppProperties';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';
import { generateLibraryPreview } from '../../../utils/libraryPreview';
import { loupeImageSrc } from '../../../utils/loupeDisplay';
import CheckBox from '../../ui/CheckBox';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { isLoupeLetterboxClick } from '../../../utils/loupeExit';

/**
 * Lightroom Classic–style Loupe (single-image) library view.
 * Fit default, wheel zoom + pan, rating, flags, color labels, EXIF strip, prev/next.
 * Original RustROOM chrome — public LR layout structure only.
 */
interface LoupeViewProps {
  imageList: ImageFile[];
  multiSelectedPaths: string[];
  activePath: string | null;
  imageRatings: Record<string, number>;
  onImageClick(path: string, event: any): void;
  onImageDoubleClick(path: string): void;
  onContextMenu(event: any, path: string): void;
  onRequestThumbnails?(paths: string[]): void;
  onRate?(rate: number, paths?: string[]): void;
  onSetColorLabel?(color: string | null, paths?: string[]): void;
  onSetFlag?(flag: 'pick' | 'reject' | null, paths?: string[]): void;
  onExitToGrid?(): void;
}

export default function LoupeView({
  imageList,
  multiSelectedPaths,
  activePath,
  imageRatings,
  onImageClick,
  onImageDoubleClick,
  onContextMenu,
  onRequestThumbnails,
  onRate,
  onSetColorLabel,
  onSetFlag,
  onExitToGrid,
}: LoupeViewProps) {
  const { t } = useTranslation();
  const included = !!(activePath && multiSelectedPaths.includes(activePath));
  const setIncluded = (checked: boolean) => {
    if (!activePath) return;
    const current = useLibraryStore.getState().multiSelectedPaths || [];
    const next = checked
      ? current.includes(activePath)
        ? current
        : [...current, activePath]
      : current.filter((p) => p !== activePath);
    useLibraryStore.getState().setLibrary({ multiSelectedPaths: next });
  };
  /** LR Loupe Info: off → basic → full (I key, library loupe only) */
  const [loupeInfoMode, setLoupeInfoMode] = useState<'off' | 'basic' | 'full'>('basic');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;
  const canPan = zoom > 1.01;

  const path = useMemo(() => {
    if (activePath) return activePath;
    if (multiSelectedPaths[0]) return multiSelectedPaths[0];
    return imageList[0]?.path ?? null;
  }, [activePath, multiSelectedPaths, imageList]);

  const index = useMemo(
    () => (path ? imageList.findIndex((i) => i.path === path) : -1),
    [path, imageList],
  );
  const image = index >= 0 ? imageList[index] : null;
  const prev = index > 0 ? imageList[index - 1] : null;
  const next = index >= 0 && index < imageList.length - 1 ? imageList[index + 1] : null;

  const thumbUrl = useProcessStore((s) => (path ? s.thumbnails[path] : undefined));
  const preview = useProcessStore((s) => (path ? s.previews[path] : undefined));
  const src = loupeImageSrc({
    previewUrl: preview?.url,
    thumbUrl,
    isRaw: !!image?.is_raw,
    isEdited: !!image?.is_edited,
  });

  useEffect(() => {
    const paths = [path, prev?.path, next?.path].filter(Boolean) as string[];
    for (const p of paths) generateLibraryPreview(p);
  }, [path, prev?.path, next?.path]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [path]);

  const resetFit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = zoomRef.current;
      const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
      const nextZ = Math.min(8, Math.max(1, Math.round(z * factor * 100) / 100));
      if (nextZ <= 1) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const p = panRef.current;
      const k = nextZ / z;
      setPan({
        x: cx * (1 - k) + p.x * k,
        y: cy * (1 - k) + p.y * k,
      });
      setZoom(nextZ);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const paths = [path, prev?.path, next?.path].filter(Boolean) as string[];
    if (paths.length && onRequestThumbnails) onRequestThumbnails(paths);
  }, [path, prev?.path, next?.path, onRequestThumbnails]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Escape') {
        if (!onExitToGrid) return;
        e.preventDefault();
        e.stopPropagation();
        onExitToGrid();
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        e.stopPropagation();
        setLoupeInfoMode((m) => (m === 'off' ? 'basic' : m === 'basic' ? 'full' : 'off'));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onExitToGrid]);

  const rating = path ? imageRatings[path] || image?.rating || 0 : 0;
  const colorTag = image?.tags?.find((tg) => tg.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const flagTag = image?.tags?.find((tg) => tg.startsWith('flag:'))?.substring(5);
  const name = path?.split(/[\\/]/).pop()?.split('?')[0] || '—';

  const exifLine = useMemo(() => {
    const e = image?.exif || {};
    const parts: string[] = [];
    const shutter = e.ExposureTime ? String(e.ExposureTime) : '';
    let fNum = e.FNumber ? String(e.FNumber) : '';
    if (fNum && !fNum.toLowerCase().startsWith('f')) fNum = `f/${fNum}`;
    const iso = e.PhotographicSensitivity || e.ISOSpeedRatings || '';
    const focal = e.FocalLengthIn35mmFilm || e.FocalLength || '';
    if (shutter) parts.push(shutter.endsWith('s') ? shutter : `${shutter}s`);
    if (fNum) parts.push(fNum);
    if (iso) parts.push(`ISO ${iso}`);
    if (focal) parts.push(String(focal).endsWith('mm') ? String(focal) : `${focal}mm`);
    const cam = `${e.Make || ''} ${e.Model || ''}`.trim();
    return { exposure: parts.join(' · '), camera: cam };
  }, [image?.exif]);

  const go = useCallback(
    (target: ImageFile | null, e?: any) => {
      if (!target) return;
      onImageClick(target.path, e || { shiftKey: false, metaKey: false, ctrlKey: false });
    },
    [onImageClick],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault();
        go(prev);
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault();
        go(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, go]);

  const pathsFor = path ? [path] : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
      <div className="h-7 flex items-center gap-2 px-1 shrink-0">
        <Search size={14} className="text-text-secondary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {t('library.viewMode.loupe', { defaultValue: 'Loupe' })}
        </span>
        <span className="text-[10px] text-text-secondary/60 truncate flex-1">{name}</span>
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
          <span
            className="w-2.5 h-2.5 rounded-full ring-1 ring-black/30"
            style={{ backgroundColor: colorLabel.color }}
          />
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={clsx(
              'h-6 px-1.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5',
              zoom <= 1.01
                ? 'bg-card-active text-text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary',
            )}
            data-tooltip={t('library.loupe.fitTip' as any, { defaultValue: 'Fit' })}
            onClick={resetFit}
          >
            <Maximize2 size={11} />
            <span className="hidden sm:inline">
              {t('library.loupe.fit' as any, { defaultValue: 'Fit' })}
            </span>
          </button>
          {zoom > 1.01 && (
            <span className="text-[10px] tabular-nums text-text-secondary/70 px-1">
              {Math.round(zoom * 100)}%
            </span>
          )}
        </div>
        {path && (
          <span className="text-[10px] tabular-nums text-text-secondary/50">
            {index + 1}/{imageList.length}
          </span>
        )}
      </div>

      <div
        ref={stageRef}
        className="flex-1 min-h-0 relative flex items-center justify-center rounded-md border border-border-color/35 bg-[#121212] overflow-hidden"
        style={{ cursor: canPan ? 'grab' : onExitToGrid ? 'pointer' : 'default' }}
        onClick={(e) => {
          if (
            onExitToGrid &&
            isLoupeLetterboxClick({ target: e.target, stage: e.currentTarget, zoom })
          ) {
            onExitToGrid();
          }
        }}
        onMouseDown={(e) => {
          if (!canPan || e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origin = { ...pan };
          const onMove = (ev: MouseEvent) => {
            setPan({
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
      >
        {src ? (
          <img
            src={src}
            alt={name}
            key={path}
            className="block select-none w-full h-full object-contain will-change-transform cursor-default"
            draggable={false}
            style={
              zoom > 1.01
                ? {
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }
                : undefined
            }
            onDoubleClick={() => path && onImageDoubleClick(path)}
            onContextMenu={(e) => path && onContextMenu(e, path)}
            onClick={(e) => {
              if (path) onImageClick(path, e);
            }}
          />
        ) : (
          <div className="text-[12px] text-white/30 uppercase tracking-wider">
            {path
              ? t('library.loupe.loading', { defaultValue: 'Loading' })
              : t('library.loupe.empty', { defaultValue: 'Select a photo' })}
          </div>
        )}

        <button
          type="button"
          disabled={!prev}
          onClick={(e) => go(prev, e)}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 text-white/80 hover:bg-black/70 disabled:opacity-20 flex items-center justify-center"
          aria-label="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          disabled={!next}
          onClick={(e) => go(next, e)}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/45 text-white/80 hover:bg-black/70 disabled:opacity-20 flex items-center justify-center"
          aria-label="Next"
        >
          <ChevronRight size={18} />
        </button>

        {loupeInfoMode !== 'off' && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-2.5 py-1.5 rounded-md bg-black/55 backdrop-blur-sm border border-white/10 text-white max-w-[90%] text-center pointer-events-none">
            <div className="text-[11px] font-medium truncate">{name}</div>
            {exifLine.exposure && (
              <div className="text-[10px] text-white/85 tabular-nums mt-0.5">{exifLine.exposure}</div>
            )}
            {loupeInfoMode === 'full' && (
              <div className="text-[10px] text-white/70 truncate mt-0.5">
                {[exifLine.camera, image?.exif?.LensModel || image?.exif?.Lens, image?.exif?.DateTimeOriginal]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </div>
            )}
          </div>
        )}

        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 h-8 px-2.5 flex items-center gap-2 bg-black/55 backdrop-blur-sm cursor-pointer',
            !activePath && 'opacity-40 pointer-events-none',
          )}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (activePath) setIncluded(!included);
          }}
        >
          <CheckBox
            checked={included}
            onChange={setIncluded}
            disabled={!activePath}
            label={t('library.bottomBar.includeInImport' as any, { defaultValue: 'Inclure dans l’importation' })}
          />
          <span className="text-[11px] text-white/90 whitespace-nowrap select-none">
            {t('library.bottomBar.includeInImport' as any, { defaultValue: 'Inclure dans l’importation' })}
          </span>
        </div>
      </div>

      <div className="h-8 flex items-center gap-1 px-1 shrink-0">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={!path || !onRate}
            className="p-0.5 disabled:opacity-40"
            onClick={() => path && onRate?.(n, pathsFor)}
          >
            <StarIcon
              size={14}
              className={n <= rating ? 'text-amber-300 fill-amber-300' : 'text-text-secondary/30'}
            />
          </button>
        ))}

        <div className="h-4 w-px bg-border-color/40 mx-1" />

        <button
          type="button"
          disabled={!path || !onSetFlag}
          onClick={() => path && onSetFlag?.(flagTag === 'pick' ? null : 'pick', pathsFor)}
          className={clsx(
            'h-6 px-1.5 rounded text-[9px] font-bold uppercase disabled:opacity-40',
            flagTag === 'pick'
              ? 'bg-emerald-500/90 text-white'
              : 'text-text-secondary hover:bg-surface',
          )}
          data-tooltip={t('settings.keybinds.actions.flag_pick' as any, { defaultValue: 'Pick' })}
        >
          <Flag size={12} className="inline" /> P
        </button>
        <button
          type="button"
          disabled={!path || !onSetFlag}
          onClick={() => path && onSetFlag?.(flagTag === 'reject' ? null : 'reject', pathsFor)}
          className={clsx(
            'h-6 px-1.5 rounded text-[9px] font-bold uppercase disabled:opacity-40',
            flagTag === 'reject'
              ? 'bg-red-500/90 text-white'
              : 'text-text-secondary hover:bg-surface',
          )}
          data-tooltip={t('settings.keybinds.actions.flag_reject' as any, { defaultValue: 'Reject' })}
        >
          <FlagOff size={12} className="inline" /> X
        </button>

        <div className="h-4 w-px bg-border-color/40 mx-1" />

        <div className="flex items-center gap-1">
          {COLOR_LABELS.map((c) => (
            <button
              key={c.name}
              type="button"
              disabled={!path || !onSetColorLabel}
              title={c.name}
              onClick={() =>
                path && onSetColorLabel?.(colorTag === c.name ? null : c.name, pathsFor)
              }
              className={clsx(
                'w-3.5 h-3.5 rounded-full border disabled:opacity-40',
                colorTag === c.name ? 'ring-2 ring-white/80 scale-110' : 'border-black/40 opacity-80 hover:opacity-100',
              )}
              style={{ backgroundColor: c.color }}
            />
          ))}
        </div>

        <span className="ml-auto text-[10px] text-text-secondary/50 hidden md:inline">
          {t('library.loupe.hint' as any, {
            defaultValue: 'Molette : zoom · glisser : déplacer · flèches · double-clic Développer',
          })}
        </span>
      </div>
    </div>
  );
}
