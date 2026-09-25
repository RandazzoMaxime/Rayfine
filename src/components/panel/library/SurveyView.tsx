import { useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Star as StarIcon, X } from 'lucide-react';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { ImageFile } from '../../ui/AppProperties';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';

/**
 * Lightroom Classic–style Survey (N-up) layout.
 * Shows multi-selected photos (or active + neighbors) in a responsive grid for culling.
 * Original RustROOM chrome — public LR layout structure only.
 */
interface SurveyViewProps {
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

function SurveyCell({
  image,
  rating,
  isActive,
  onClick,
  onDoubleClick,
  onContextMenu,
  onRate,
  onRemove,
}: {
  image: ImageFile;
  rating: number;
  isActive: boolean;
  onClick(e: any): void;
  onDoubleClick(): void;
  onContextMenu(e: any): void;
  onRate?(n: number): void;
  onRemove?(): void;
}) {
  const thumbUrl = useProcessStore((s) => s.thumbnails[image.path]);
  const preview = useProcessStore((s) => s.previews[image.path]);
  const src = preview?.url || thumbUrl;
  const colorTag = image.tags?.find((t) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const flagTag = image.tags?.find((t) => t.startsWith('flag:'))?.substring(5);
  const name = image.path.split(/[\\/]/).pop()?.split('?')[0] || '';

  return (
    <div
      className={clsx(
        'group flex flex-col min-w-0 min-h-0 rounded-md border overflow-hidden bg-[#1a1a1a]',
        isActive ? 'border-white/55 ring-1 ring-white/25' : 'border-border-color/35',
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-[#121212] p-1">
        {src ? (
          <img src={src} alt={name} className="max-w-full max-h-full object-contain select-none" draggable={false} />
        ) : (
          <div className="text-[10px] text-white/30">…</div>
        )}
        {onRemove && (
          <button
            type="button"
            className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-black/55 text-white/80 hover:bg-red-600/90 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            data-tooltip="Remove from survey"
            aria-label="Remove from survey"
          >
            <X size={12} />
          </button>
        )}
        {(flagTag || colorLabel) && (
          <div className="absolute top-1 left-1 flex items-center gap-1">
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
                className="w-2 h-2 rounded-full ring-1 ring-black/30"
                style={{ backgroundColor: colorLabel.color }}
              />
            )}
          </div>
        )}
      </div>
      <div
        className="h-7 px-1.5 flex items-center gap-1 border-t border-white/10 bg-[#2a2a2a] shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] text-white/70 truncate flex-1">{name}</span>
        <div className="flex items-center gap-px">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={!onRate}
              className="p-0 disabled:opacity-40"
              onClick={() => onRate?.(n)}
            >
              <StarIcon
                size={10}
                className={n <= rating ? 'text-amber-300 fill-amber-300' : 'text-white/25'}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function gridClass(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  if (n === 4) return 'grid-cols-2';
  if (n <= 6) return 'grid-cols-3';
  if (n <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

export default function SurveyView({
  imageList,
  multiSelectedPaths,
  activePath,
  imageRatings,
  onImageClick,
  onImageDoubleClick,
  onContextMenu,
  onRequestThumbnails,
  onRate,
}: SurveyViewProps) {
  const { t } = useTranslation();

  const surveyImages = useMemo(() => {
    if (multiSelectedPaths.length >= 2) {
      const set = new Set(multiSelectedPaths);
      // preserve selection order
      return multiSelectedPaths
        .map((p) => imageList.find((i) => i.path === p))
        .filter(Boolean) as ImageFile[];
    }
    // Single or none: show active ± neighbors (up to 6) for survey-like browsing
    if (activePath) {
      const idx = imageList.findIndex((i) => i.path === activePath);
      if (idx < 0) return [] as ImageFile[];
      const start = Math.max(0, idx - 2);
      const end = Math.min(imageList.length, start + 6);
      return imageList.slice(start, end);
    }
    return imageList.slice(0, Math.min(6, imageList.length));
  }, [multiSelectedPaths, activePath, imageList]);

  useEffect(() => {
    if (surveyImages.length && onRequestThumbnails) {
      onRequestThumbnails(surveyImages.map((i) => i.path));
    }
  }, [surveyImages, onRequestThumbnails]);

  const n = surveyImages.length;
  const cols = gridClass(n);

  // LR Survey: Delete / Backspace removes focused photo from the survey selection.
  // Keep plain X free for flag reject (P/X/U) while surveying.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const lib = useLibraryStore.getState();
      const multi = lib.multiSelectedPaths || [];
      if (multi.length < 2) return;
      const focus = lib.libraryActivePath || multi[0];
      if (!focus || !multi.includes(focus)) return;
      e.preventDefault();
      const next = multi.filter((p) => p !== focus);
      lib.setLibrary({
        multiSelectedPaths: next,
        libraryActivePath: next[0] || null,
        selectionAnchorPath: next[0] || null,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
      <div className="h-7 flex items-center gap-2 px-1 shrink-0">
        <LayoutGrid size={14} className="text-text-secondary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
          {t('library.viewMode.survey', { defaultValue: 'Survey' })}
        </span>
        <span className="text-[10px] text-text-secondary/60">
          {t('library.survey.hint', {
            defaultValue: 'Multi-select to survey · click focus · Delete remove · P/X/U flags · double-click Develop.',
          })}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-text-secondary/50">{n}</span>
      </div>
      {n === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-text-secondary/50">
          {t('library.survey.empty', { defaultValue: 'Select photos to survey' })}
        </div>
      ) : (
        <div className={clsx('flex-1 min-h-0 grid gap-2 auto-rows-fr', cols)}>
          {surveyImages.map((img) => (
            <SurveyCell
              key={img.path}
              image={img}
              rating={imageRatings[img.path] || img.rating || 0}
              isActive={img.path === activePath || multiSelectedPaths.includes(img.path)}
              onClick={(e) => onImageClick(img.path, e)}
              onDoubleClick={() => onImageDoubleClick(img.path)}
              onContextMenu={(e) => onContextMenu(e, img.path)}
              onRate={onRate ? (r) => onRate(r, [img.path]) : undefined}
              onRemove={() => {
                const lib = useLibraryStore.getState();
                const next = (lib.multiSelectedPaths || []).filter((p) => p !== img.path);
                lib.setLibrary({
                  multiSelectedPaths: next,
                  libraryActivePath:
                    lib.libraryActivePath === img.path
                      ? next[0] || null
                      : lib.libraryActivePath,
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
