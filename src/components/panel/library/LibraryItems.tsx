import { useLibraryStore } from '../../../store/useLibraryStore';
import { useUIStore } from '../../../store/useUIStore';
import { invoke } from '@tauri-apps/api/core';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Image as ImageIcon, Folder, FolderOpen, Star as StarIcon, SlidersHorizontal, CloudOff, Layers, Tag, MapPin, Check } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { COLOR_LABELS, Color } from '../../../utils/adjustments';
import { findVirtualCopyStack, findGroupVariants, effectiveGroupId, stackIdFromTags, findManualStack } from '../../../utils/imageGrouping';
import { ThumbnailAspectRatio, ImageFile, ExifOverlay, Invokes } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights, TEXT_COLOR_KEYS } from '../../../types/typography';
import { ColumnWidths } from '../MainLibrary';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { IconAperture, IconFocalLength, IconIso, IconShutter } from '../editor/ExifIcons';
import CheckBox from '../../ui/CheckBox';
import { importedPathSet } from '../../../utils/catalogMembership';

function toggleChecked(path: string, checked: boolean) {
  const { multiSelectedPaths, setLibrary } = useLibraryStore.getState();
  const next = checked
    ? Array.from(new Set([...multiSelectedPaths, path]))
    : multiSelectedPaths.filter((p) => p !== path);
  setLibrary({ multiSelectedPaths: next });
}

function RatingStars({
  rating,
  onRate,
  path,
  size = 11,
  emptyClass = 'text-white/35 hover:text-amber-200/80',
}: {
  rating: number;
  onRate?: (n: number, paths: string[]) => void;
  path: string;
  size?: number;
  emptyClass?: string;
}) {
  return (
    <div
      className="flex items-center gap-px shrink-0 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={clsx(
            'p-0 leading-none flex items-center justify-center',
            onRate ? 'cursor-pointer' : 'cursor-default',
          )}
          disabled={!onRate}
          onClick={(e) => {
            e.stopPropagation();
            onRate?.(n, [path]);
          }}
          aria-label={`Rate ${n}`}
        >
          <StarIcon
            size={size}
            strokeWidth={2}
            className={n <= rating ? 'text-amber-300 fill-amber-300' : emptyClass}
          />
        </button>
      ))}
    </div>
  );
}

interface ImageLayer {
  id: string;
  url: string;
  opacity: number;
}


/** Cycle master ↔ virtual copies for a library thumbnail badge click. */

/** LR Library Painter: spray keyword / rating / color / flag onto a photo. Alt = remove/clear. */
async function tryLibraryPaint(path: string, event: any): Promise<boolean> {
  const st = useLibraryStore.getState();
  const painter = st.libraryPainter
    || (st.keywordPaintTag
      ? { kind: 'keyword' as const, value: st.keywordPaintTag }
      : null);
  if (!painter) return false;
  event?.stopPropagation?.();
  event?.preventDefault?.();
  const remove = !!event?.altKey;
  try {
    if (painter.kind === 'keyword') {
      const bare = String(painter.value || '')
        .trim()
        .toLowerCase()
        .replace(/^user:/, '');
      if (!bare) return true;
      const parts = bare.split('/').filter(Boolean);
      const segments: string[] = [];
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        segments.push(acc);
      }
      const tags = segments.map((s) => `user:${s}`);
      if (remove) {
        for (const tag of tags) {
          await invoke(Invokes.RemoveTagForPaths, { paths: [path], tag });
        }
        useLibraryStore.getState().setLibrary((state) => ({
          imageList: state.imageList.map((img) => {
            if (img.path !== path) return img;
            const next = (img.tags || []).filter(
              (tg) => !tags.includes(tg) && !tags.includes(`user:${tg}`),
            );
            return { ...img, tags: next };
          }),
        }));
      } else {
        for (const tag of tags) {
          await invoke(Invokes.AddTagForPaths, { paths: [path], tag });
        }
        useLibraryStore.getState().setLibrary((state) => ({
          imageList: state.imageList.map((img) => {
            if (img.path !== path) return img;
            const next = [...(img.tags || [])];
            for (const tag of tags) {
              const leaf = tag.replace(/^user:/, '');
              if (!next.includes(tag) && !next.includes(leaf)) next.push(tag);
            }
            return { ...img, tags: next };
          }),
        }));
      }
      return true;
    }

    if (painter.kind === 'rating') {
      const rating = remove ? 0 : Math.max(0, Math.min(5, Number(painter.value) || 0));
      await invoke(Invokes.SetRatingForPaths, { paths: [path], rating });
      useLibraryStore.getState().setLibrary((state) => ({
        imageRatings: { ...state.imageRatings, [path]: rating },
        imageList: state.imageList.map((img) =>
          img.path === path ? { ...img, rating } : img,
        ),
      }));
      return true;
    }

    if (painter.kind === 'color') {
      const color = remove ? null : (painter.value as string | null);
      await invoke(Invokes.SetColorLabelForPaths, { paths: [path], color });
      useLibraryStore.getState().setLibrary((state) => ({
        imageList: state.imageList.map((i) => {
          if (i.path !== path) return i;
          const other = (i.tags || []).filter((tg) => !tg.startsWith('color:'));
          const tags = color ? [...other, `color:${String(color).toLowerCase()}`] : other;
          return { ...i, tags: tags.length ? tags : null };
        }),
      }));
      return true;
    }

    if (painter.kind === 'flag') {
      const flag = remove ? null : (painter.value as 'pick' | 'reject' | null);
      await invoke(Invokes.SetFlagForPaths, { paths: [path], flag });
      useLibraryStore.getState().setLibrary((state) => ({
        imageList: state.imageList.map((i) => {
          if (i.path !== path) return i;
          const other = (i.tags || []).filter((tg) => !tg.startsWith('flag:'));
          const tags = flag ? [...other, `flag:${flag}`] : other;
          return { ...i, tags: tags.length ? tags : null };
        }),
      }));
      return true;
    }
  } catch (err) {
    console.error('library paint failed', err);
  }
  return true;
}

/** @deprecated alias */
async function tryKeywordPaint(path: string, event: any): Promise<boolean> {
  return tryLibraryPaint(path, event);
}

function cycleVirtualCopyStack(path: string, onImageClick?: (path: string, event: any) => void, e?: any) {
  try {
    const list = useLibraryStore.getState().imageList || [];
    const stack = findVirtualCopyStack(list, path);
    if (stack.length < 2) return;
    const idx = stack.findIndex((img) => img.path === path);
    const next = stack[(idx < 0 ? 0 : idx + 1) % stack.length];
    onImageClick?.(next.path, e || { shiftKey: false, metaKey: false, ctrlKey: false });
  } catch {
    /* ignore */
  }
}

function virtualCopyStackCount(path: string): number {
  try {
    const list = useLibraryStore.getState().imageList || [];
    return findVirtualCopyStack(list, path).length;
  } catch {
    return 0;
  }
}


/** Cycle RAW+JPEG (or other) group variants for a library group badge click. */
function cycleGroupStack(
  groupId: string | null | undefined,
  currentPath: string,
  onImageClick?: (path: string, event: any) => void,
  e?: any,
) {
  if (!groupId) return;
  try {
    const list = useLibraryStore.getState().imageList || [];
    const stack = findGroupVariants(list, groupId);
    if (stack.length < 2) return;
    const idx = stack.findIndex((img) => img.path === currentPath);
    const next = stack[(idx < 0 ? 0 : idx + 1) % stack.length];
    onImageClick?.(next.path, e || { shiftKey: false, metaKey: false, ctrlKey: false });
  } catch {
    /* ignore */
  }
}

const ThumbnailComponent = ({
  isActive,
  isSelected,
  isForcedHover,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  onRate,
  path,
  rating,
  tags,
  aspectRatio: thumbnailAspectRatio,
  isEdited,
  isRaw,
  exif,
  isCloudPlaceholder,
  groupBadgeLabel,
  groupId,
}: any) => {
  const { t } = useTranslation();
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const displayEditIcon = useSettingsStore((s) => s.appSettings?.displayEditIcon ?? true);
  const showGridFilenames = useSettingsStore((s) => s.appSettings?.showGridFilenames !== false);
  const showEditIcon = isEdited && displayEditIcon;

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);

  const [currentPath, setCurrentPath] = useState(path);
  if (currentPath !== path) {
    setCurrentPath(path);
    setLayers([]);
  }

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  if (pathRef.current !== path) {
    pathRef.current = path;
    hadDataOnPathChange.current = !!data;
  }

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

  const { shutter, fNumber, iso, focal, camera, lens } = useMemo(() => {
    const e = exif || {};
    let fNum = e.FNumber ? String(e.FNumber) : '';
    if (fNum && !fNum.toLowerCase().startsWith('f')) fNum = `f/${fNum}`;
    const make = String(e.Make || '').trim();
    const model = String(e.Model || '').trim();
    let cam = `${make} ${model}`.trim();
    // avoid "Canon Canon EOS..."
    if (make && model.toLowerCase().startsWith(make.toLowerCase())) {
      cam = model;
    }
    const lensStr = String(e.LensModel || e.Lens || '').trim();
    return {
      shutter: e.ExposureTime || '',
      fNumber: fNum,
      iso: e.PhotographicSensitivity || e.ISOSpeedRatings || '',
      focal: e.FocalLengthIn35mmFilm || e.FocalLength || '',
      camera: cam,
      lens: lensStr,
    };
  }, [exif]);

  useEffect(() => {
    if (data) {
      setShowPlaceholder(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setLayers([]);
      return;
    }

    setLayers((prev) => {
      if (prev.some((l) => l.id === data)) return prev;

      if (prev.length === 0) {
        if (hadDataOnPathChange.current) {
          return [{ id: data, url: data, opacity: 1 }];
        } else {
          return [{ id: data, url: data, opacity: 0 }];
        }
      }

      return [...prev, { id: data, url: data, opacity: 0 }];
    });
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  // Selection chrome aligned with filmstrip (light edge + bottom bar when active)
  // Two highlight levels: checked (selected) = strong accent ring; active = thin white ring + bottom edge.
  const ringClass = isSelected
    ? 'ring-2 ring-inset ring-accent'
    : isActive
      ? 'ring-1 ring-inset ring-white/70'
      : isForcedHover
        ? 'ring-1 ring-inset ring-white/30'
        : 'group-hover:ring-1 group-hover:ring-inset group-hover:ring-white/25';

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);

  const isAlways = exifOverlay === ExifOverlay.Always;
  const isHover = exifOverlay === ExifOverlay.Hover;

  const hasEditIcon = !!showEditIcon;
  const hasColorLabel = !!colorLabel;
  const hasRating = rating > 0;
  const hasGroupBadge = !!groupBadgeLabel;
  const flagTag = tags?.find((t: string) => t.startsWith('flag:'))?.substring(5);
  const isPick = flagTag === 'pick';
  const isReject = flagTag === 'reject';
  const hasFlag = isPick || isReject;
  const hasGps = (() => {
    const lat = exif?.GPSLatitude ?? exif?.gpsLatitude;
    const lon = exif?.GPSLongitude ?? exif?.gpsLongitude;
    if (lat == null || lon == null || lat === '' || lon === '') return false;
    const la = parseFloat(String(lat));
    const lo = parseFloat(String(lon));
    return Number.isFinite(la) && Number.isFinite(lo);
  })();
  const keywordCount = (tags || []).filter(
    (tg: string) => tg.startsWith('user:') || (!tg.startsWith('color:') && !tg.startsWith('flag:') && !tg.startsWith('stack:') && !!tg),
  ).length;
  const hasKeywords = keywordCount > 0;
  const inQuickCollection = useLibraryStore((s) => (s.quickCollectionPaths || []).includes(path));
  const isImported = useLibraryStore((s) => importedPathSet(s.albumTree).has(path));
  const libraryPainter = useLibraryStore((s) => s.libraryPainter || (s.keywordPaintTag ? { kind: 'keyword' as const, value: s.keywordPaintTag } : null));
  const hasAnyOverlay =
    hasEditIcon || hasColorLabel || hasRating || hasGroupBadge || hasFlag || inQuickCollection || hasKeywords || hasGps || !!isRaw || isImported;

  return (
    <div
      className={clsx(
        'h-full w-full bg-surface rounded-sm overflow-hidden cursor-pointer group relative flex flex-col transition-all duration-100 transform-gpu [-webkit-mask-image:-webkit-radial-gradient(white,black)]',
        // LR dims rejected photos in the grid
        isReject && 'opacity-45',
      )}
      data-bench-id="thumbnail"
      onClick={(e: any) => {
        e.stopPropagation();
        void (async () => {
          if (await tryKeywordPaint(path, e)) return;
          onImageClick(path, e);
        })();
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
      style={libraryPainter ? { cursor: 'cell' } : undefined}
    >
      {isActive && (
        <div
          className="library-active-edge absolute left-0 right-0 bottom-0 h-[3px] bg-white/90 z-20 pointer-events-none"
          aria-hidden
        />
      )}
      <div className="relative w-full flex-1 min-h-0 z-0 bg-surface">
        {layers.length > 0 && (
          <div className="absolute inset-0 w-full h-full">
            {layers.map((layer) => (
              <div
                key={layer.id}
                className="absolute inset-0 w-full h-full"
                style={{
                  opacity: layer.opacity,
                  transition: 'opacity 60ms linear',
                }}
                onTransitionEnd={() => handleTransitionEnd(layer.id)}
              >
                <img
                  alt={path.split(/[\\/]/).pop()}
                  className={clsx(
                    'w-full h-full transition-transform duration-300 will-change-transform relative',
                    'object-contain',
                    isForcedHover ? 'scale-[1.02]' : 'group-hover:scale-[1.02]',
                    isReject && 'grayscale',
                  )}
                  decoding="async"
                  loading="lazy"
                  src={layer.url}
                  onLoad={() => onLoad(path)}
                />
              </div>
            ))}
          </div>
        )}

        {layers.length === 0 &&
          showPlaceholder &&
          (isCloudPlaceholder ? (
            <div
              className="absolute inset-0 w-full h-full flex items-center justify-center bg-surface"
              data-tooltip={t('library.items.cloudPlaceholder')}
            >
              <CloudOff className="text-text-secondary" />
            </div>
          ) : (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-surface">
              <ImageIcon className="text-text-secondary animate-pulse" />
            </div>
          ))}

        {isCloudPlaceholder && layers.length > 0 && (
          <div
            className="absolute top-1.5 left-1.5 z-10 rounded-full h-5 w-5 flex items-center justify-center bg-black/40 shadow-md pointer-events-none"
            data-tooltip={t('library.items.cloudPlaceholder')}
          >
            <CloudOff size={12} className="text-white" />
          </div>
        )}
      </div>

      <div
        className={clsx(
          'absolute top-0 right-0 w-1/2 h-1/2 bg-linear-to-bl from-black/20 via-black/0 to-transparent pointer-events-none z-0 transition-opacity duration-200 ease-in-out',
          hasAnyOverlay ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div className="absolute top-1 left-1 z-40 flex items-center gap-1">
        <CheckBox
          checked={!!isSelected}
          onChange={(checked) => toggleChecked(path, checked)}
          label="Select"
          className={isSelected || isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        />
      {isImported && (
        <div
          className="h-4 w-4 rounded-full flex items-center justify-center bg-accent/90 text-button-text shadow-md pointer-events-none"
          title="Imported"
        >
          <Check size={10} strokeWidth={3} />
        </div>
      )}
      {hasFlag && (
        <div
          className={clsx(
            'px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide pointer-events-none shadow-md',
            isPick ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white',
          )}
        >
          {isPick ? 'P' : 'X'}
        </div>
      )}
      {hasGps && (
        <button
          type="button"
          className={clsx(
            'w-4 h-4 rounded-full bg-sky-500/90 text-white flex items-center justify-center shadow ring-1 ring-black/30 pointer-events-auto hover:scale-110 transition-transform',
          )}
          data-tooltip={t('library.items.gpsTip' as any, {
            defaultValue: 'Has GPS — click to open Map',
          })}
          title="GPS"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            useLibraryStore.getState().setLibrary({
              multiSelectedPaths: [path],
              libraryActivePath: path,
            });
            useUIStore.getState().setUI({ activeView: 'map' });
          }}
        >
          <MapPin size={9} className="fill-white" />
        </button>
      )}
      {inQuickCollection && (
        <div
          className={clsx(
            'w-2.5 h-2.5 rounded-full bg-amber-400 ring-1 ring-black/40 pointer-events-none shadow',
          )}
          title="Quick Collection"
        />
      )}
      </div>
      <div className="absolute top-1 right-1 flex items-center justify-end z-10 pointer-events-none">
        <div
          className={clsx(
            'rounded-full h-4 px-1 flex items-center justify-center gap-0 shadow-md bg-black/35 pointer-events-auto transition-all duration-150 ease-out origin-top-right',
            hasAnyOverlay ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none',
          )}
        >
          <div
            className={clsx(
              'text-white flex items-center transition-all duration-200 ease-out overflow-hidden',
              hasEditIcon ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
            )}
          >
            <SlidersHorizontal size={10} />
          </div>

          <div
            className={clsx(
              'flex items-center justify-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasColorLabel ? 'max-w-3 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasColorLabel && hasEditIcon ? 'ml-1.5' : 'ml-0',
            )}
          >
            <div
              className="w-2.5 h-2.5 rounded-full transition-colors duration-200"
              style={{ backgroundColor: colorLabel ? colorLabel.color : 'transparent' }}
            />
          </div>

          <div
            className={clsx(
              'flex items-center gap-0.5 shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasRating ? 'max-w-7 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasRating && (hasEditIcon || hasColorLabel) ? 'ml-1.5' : 'ml-0',
            )}
          >
            <Text variant={TextVariants.small} color={TextColors.white} className="text-[10px]">
              {rating}
            </Text>
            <StarIcon size={10} className="text-white fill-white" />
          </div>

          <button
            type="button"
            className={clsx(
              'flex items-center shrink-0 transition-all duration-200 ease-out overflow-hidden pointer-events-auto',
              hasGroupBadge ? 'max-w-8 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasGroupBadge && (hasEditIcon || hasColorLabel || hasRating) ? 'ml-1.5' : 'ml-0',
            )}
            data-tooltip={
              groupBadgeLabel
                ? `${groupBadgeLabel} — click cycle · Shift-click expand`
                : t('library.items.groupStackTip' as any, {
                    defaultValue: 'Click cycle · Shift-click expand stack',
                  })
            }
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              // Shift/Alt+click: expand/collapse stack in grid (LR-style)
              if ((e.shiftKey || e.altKey) && groupId) {
                const lib = useLibraryStore.getState();
                const cur = new Set(lib.expandedStackIds || []);
                if (cur.has(groupId)) cur.delete(groupId);
                else cur.add(groupId);
                lib.setLibrary({ expandedStackIds: Array.from(cur) });
                return;
              }
              cycleGroupStack(groupId, path, onImageClick, e);
            }}
          >
            <Layers size={12} className="text-white" />
          </button>

          <div
            className={clsx(
              'flex items-center shrink-0 transition-all duration-200 ease-out overflow-hidden',
              hasKeywords ? 'max-w-4 opacity-100 scale-100' : 'max-w-0 opacity-0 scale-75 pointer-events-none',
              hasKeywords && (hasEditIcon || hasColorLabel || hasRating || hasGroupBadge) ? 'ml-1.5' : 'ml-0',
            )}
            data-tooltip={t('library.items.keywordsTip' as any, {
              defaultValue: '{{count}} keyword(s)',
              count: keywordCount,
            })}
          >
            <Tag size={11} className="text-white" />
          </div>
        </div>
      </div>

      {!showGridFilenames && !isAlways && (hasRating || !!onRate) && (
        <div
          className={clsx(
            'absolute inset-x-1.5 bottom-1.5 z-[25] flex items-center justify-center pointer-events-none',
            isActive || isSelected || hasRating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <div className="pointer-events-auto px-1 py-0.5 rounded bg-black/50 flex items-center gap-0.5">
            {hasColorLabel && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 ring-1 ring-black/30"
                style={{ backgroundColor: colorLabel ? colorLabel.color : 'transparent' }}
              />
            )}
            <RatingStars rating={rating} onRate={onRate} path={path} size={10} />
          </div>
        </div>
      )}

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 h-16 transition-opacity duration-300 pointer-events-none z-10',
          'bg-linear-to-t from-black/70 to-transparent',
          isAlways ? 'opacity-0' : isHover ? 'opacity-100 group-hover:opacity-0' : 'opacity-100',
        )}
      />

      <div
        className={clsx(
          'w-full transition-[grid-template-rows] duration-300 ease-in-out grid shrink-0 z-0',
          isAlways ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        aria-hidden="true"
      >
        <div className="min-h-0 overflow-hidden pointer-events-none invisible">
          <div className="flex flex-col p-2 pb-1.5">
            <div className="flex items-end justify-between shrink-0">
              <Text variant={TextVariants.small} className="truncate pr-2">
                {baseName}
              </Text>
              {isVirtualCopy && (
                <Text variant={TextVariants.small} className="px-1.5 py-0.5 font-bold">
                  VC
                </Text>
              )}
            </div>
            <div className="pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0">
              <div className="flex items-center gap-1">
                <IconShutter className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconAperture className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconIso className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1">
                <IconFocalLength className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : '-'}
                </Text>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx(
          'absolute bottom-0 left-0 right-0 flex flex-col p-2 pb-1.5 min-w-0 overflow-hidden transition-all duration-300 ease-in-out z-20',
          isAlways
            ? 'bg-surface border-t border-border-color/50 pointer-events-auto'
            : isHover
              ? 'bg-transparent group-hover:bg-surface/60 backdrop-blur-none group-hover:backdrop-blur-md border-t border-transparent group-hover:border-border-color/50 pointer-events-none group-hover:pointer-events-auto'
              : showGridFilenames
                ? 'bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none'
                : 'bg-transparent border-t border-transparent pointer-events-none opacity-0',
        )}
      >
        <div
          className={clsx(
            'flex items-center gap-1 min-w-0 w-full',
            !showGridFilenames && !isAlways && !isHover && 'invisible',
            !showGridFilenames && isHover && 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Text
            variant={TextVariants.small}
            className={clsx(
              'min-w-0 flex-1 truncate transition-colors duration-300',
              isAlways ? 'text-white' : 'text-white drop-shadow-sm',
            )}
          >
            {baseName}
          </Text>
          {!!isRaw && (
            <span
              className="shrink-0 px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-wide bg-orange-500/90 text-white"
              title="RAW"
            >
              RAW
            </span>
          )}
          {(isVirtualCopy || virtualCopyStackCount(path) >= 2) && (
            <button
              type="button"
              className={clsx(
                'shrink-0 px-1.5 py-0.5 rounded-full transition-colors duration-300 font-bold pointer-events-auto text-[10px]',
                isAlways
                  ? 'bg-border-color/30 text-text-primary shadow-none'
                  : isHover
                    ? 'bg-black/30 text-white backdrop-blur-xs shadow-md group-hover:bg-border-color/30 group-hover:text-text-primary group-hover:shadow-none group-hover:backdrop-blur-none'
                    : 'bg-black/30 text-white backdrop-blur-xs shadow-md',
              )}
              data-tooltip={t('library.items.tooltipVirtualCopyCycle' as any, {
                defaultValue: isVirtualCopy
                  ? 'Virtual copy — click to cycle stack'
                  : 'Virtual copy stack — click to cycle',
              })}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                cycleVirtualCopyStack(path, onImageClick, e);
              }}
            >
              {isVirtualCopy
                ? 'VC'
                : `×${virtualCopyStackCount(path)}`}
            </button>
          )}
          {(showGridFilenames || isAlways || isHover) && (hasRating || !!onRate) && (
            <RatingStars rating={rating} onRate={onRate} path={path} size={10} />
          )}
        </div>

        <div
          className={clsx(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out shrink-0',
            isAlways
              ? 'grid-rows-[1fr] opacity-100'
              : isHover
                ? 'grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100'
                : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className={clsx(
                'pt-1.5 pb-0.5 flex flex-wrap items-center gap-x-2.5 shrink-0 transition-transform duration-300 ease-in-out',
                isAlways ? 'translate-y-0' : isHover ? 'translate-y-3 group-hover:translate-y-0' : 'translate-y-3',
              )}
            >
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipShutterSpeed')}
              >
                <IconShutter className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {shutter || '-'}
                </Text>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipAperture')}
              >
                <IconAperture className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {fNumber || '-'}
                </Text>
              </div>
              <div className="flex items-center gap-1 text-text-secondary" data-tooltip={t('library.items.tooltipIso')}>
                <IconIso className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {iso || '-'}
                </Text>
              </div>
              <div
                className="flex items-center gap-1 text-text-secondary"
                data-tooltip={t('library.items.tooltipFocalLength')}
              >
                <IconFocalLength className="w-2.5 h-2.5" />
                <Text variant={TextVariants.small} className="text-[9px] font-medium tracking-wide">
                  {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : '-'}
                </Text>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={clsx('absolute inset-0 rounded-md pointer-events-none z-30 transition-all duration-150', ringClass)}
      />
    </div>
  );
};

const ListItemComponent = ({
  isActive,
  isSelected,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  onLoad,
  onRate,
  path,
  rating,
  tags,
  modified,
  aspectRatio: thumbnailAspectRatio,
  columnWidths,
  exif,
  isRaw,
  isEdited,
  isCloudPlaceholder,
  isPrevSelected,
  isNextSelected,
}: any) => {
  const { t } = useTranslation();
  const data = useProcessStore((s) => s.thumbnails[path]);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const isImported = useLibraryStore((s) => importedPathSet(s.albumTree).has(path));

  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [layers, setLayers] = useState<ImageLayer[]>([]);

  const [currentPath, setCurrentPath] = useState(path);
  if (currentPath !== path) {
    setCurrentPath(path);
    setLayers([]);
  }

  const pathRef = useRef(path);
  const hadDataOnPathChange = useRef(!!data);

  if (pathRef.current !== path) {
    pathRef.current = path;
    hadDataOnPathChange.current = !!data;
  }

  const { baseName, isVirtualCopy } = useMemo(() => {
    const fullFileName = path.split(/[\\/]/).pop() || '';
    const parts = fullFileName.split('?vc=');
    return {
      baseName: parts[0],
      isVirtualCopy: parts.length > 1,
    };
  }, [path]);

  const { shutter, fNumber, iso, focal, camera, lens } = useMemo(() => {
    const e = exif || {};
    let fNum = e.FNumber ? String(e.FNumber) : '';
    if (fNum && !fNum.toLowerCase().startsWith('f')) fNum = `f/${fNum}`;
    const make = String(e.Make || '').trim();
    const model = String(e.Model || '').trim();
    let cam = `${make} ${model}`.trim();
    if (make && model.toLowerCase().startsWith(make.toLowerCase())) {
      cam = model;
    }
    const lensStr = String(e.LensModel || e.Lens || '').trim();
    return {
      shutter: e.ExposureTime || '',
      fNumber: fNum,
      iso: e.PhotographicSensitivity || e.ISOSpeedRatings || '',
      focal: e.FocalLengthIn35mmFilm || e.FocalLength || '',
      camera: cam,
      lens: lensStr,
    };
  }, [exif]);

  const showExifCols = exifOverlay !== ExifOverlay.Off;
  const totalBase =
    columnWidths.thumbnail +
    columnWidths.name +
    columnWidths.date +
    columnWidths.rating +
    (columnWidths.flag || 0) +
    (columnWidths.edited || 0) +
    (columnWidths.fileType || 0) +
    (columnWidths.gps || 0) +
    (columnWidths.urgency || 0) +
    (columnWidths.creator || 0) +
    (columnWidths.credit || 0) +
    (columnWidths.city || 0) +
    (columnWidths.country || 0) +
    (columnWidths.state || 0) +
    (columnWidths.headline || 0) +
    columnWidths.color +
    (showExifCols
      ? columnWidths.shutter +
        columnWidths.aperture +
        columnWidths.iso +
        columnWidths.focal +
        (columnWidths.camera || 0) +
        (columnWidths.lens || 0)
      : 0);
  const getW = (key: keyof ColumnWidths) => `${(columnWidths[key] / totalBase) * 100}%`;

  useEffect(() => {
    if (data) {
      setShowPlaceholder(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowPlaceholder(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    if (!data) {
      setLayers([]);
      return;
    }

    setLayers((prev) => {
      if (prev.some((l) => l.id === data)) return prev;

      if (prev.length === 0) {
        if (hadDataOnPathChange.current) {
          return [{ id: data, url: data, opacity: 1 }];
        } else {
          return [{ id: data, url: data, opacity: 0 }];
        }
      }

      return [...prev, { id: data, url: data, opacity: 0 }];
    });
  }, [data, path]);

  useEffect(() => {
    const layerToFadeIn = layers.find((l) => l.opacity === 0);
    if (layerToFadeIn) {
      const frame = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [layers]);

  const handleTransitionEnd = useCallback((finishedId: string) => {
    setLayers((prev) => {
      const finishedIndex = prev.findIndex((l) => l.id === finishedId);
      if (finishedIndex < 0 || prev.length <= 1) return prev;
      return prev.slice(finishedIndex);
    });
  }, []);

  const colorTag = tags?.find((t: string) => t.startsWith('color:'))?.substring(6);
  const colorLabel = COLOR_LABELS.find((c: Color) => c.name === colorTag);
  const flagTag = tags?.find((t: string) => t.startsWith('flag:'))?.substring(5);
  const isPick = flagTag === 'pick';
  const isReject = flagTag === 'reject';
  const hasGpsList = (() => {
    const lat = exif?.GPSLatitude ?? exif?.gpsLatitude;
    const lon = exif?.GPSLongitude ?? exif?.gpsLongitude;
    if (lat == null || lon == null || lat === '' || lon === '') return false;
    const la = parseFloat(String(lat));
    const lo = parseFloat(String(lon));
    return Number.isFinite(la) && Number.isFinite(lo);
  })();

  const dateStr = (() => {
    const raw = String(exif?.DateTimeOriginal || exif?.CreateDate || '').trim();
    // EXIF often "YYYY:MM:DD HH:MM:SS"
    if (raw.length >= 10) {
      const norm = raw.slice(0, 19).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = new Date(norm.replace(' ', 'T'));
      if (!Number.isNaN(parsed.getTime())) {
        return (
          parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
          ' ' +
          parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
      }
      return raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    }
    const dateObj = new Date(modified > 1e11 ? modified : modified * 1000);
    return (
      dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' ' +
      dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  })();

  let roundingClass = 'rounded-md';
  if (isSelected || isActive) {
    if (isPrevSelected && isNextSelected) {
      roundingClass = 'rounded-none';
    } else if (isPrevSelected) {
      roundingClass = 'rounded-b-md';
    } else if (isNextSelected) {
      roundingClass = 'rounded-t-md';
    }
  }

  const borderClass =
    (isSelected || isActive) && isNextSelected ? 'border-b border-transparent' : 'border-b border-border-color/30';

  const stateClass = clsx(
    isSelected
      ? `ring-2 ring-inset ring-accent bg-accent/10 ${roundingClass}`
      : isActive
        ? `ring-1 ring-inset ring-white/60 bg-white/5 ${roundingClass}`
        : 'hover:bg-surface/80 hover:rounded-md',
    isReject && 'opacity-50',
  );

  return (
    <div
      className={`relative flex items-center w-full h-full cursor-pointer transition-all duration-150 ${borderClass} ${roundingClass} ${stateClass}`}
      onClick={(e: any) => {
        e.stopPropagation();
        void (async () => {
          if (await tryKeywordPaint(path, e)) return;
          onImageClick(path, e);
        })();
      }}
      onContextMenu={(e: any) => onContextMenu(e, path)}
      onDoubleClick={() => onImageDoubleClick(path)}
    >
      {isActive && (
        <div
          className="list-active-edge absolute left-0 right-0 bottom-0 h-[2px] bg-white/90 z-20 pointer-events-none"
          aria-hidden
        />
      )}
      <div
        style={{ width: getW('thumbnail') }}
        className="flex items-center justify-center p-1.5 h-full overflow-hidden"
      >
        <div className="w-full h-full relative overflow-hidden rounded-sm bg-surface flex items-center justify-center">
          <CheckBox
            checked={!!isSelected}
            onChange={(checked) => toggleChecked(path, checked)}
            label="Select"
            className="absolute top-0.5 left-0.5 z-20"
          />
          {isImported && (
            <div className="absolute top-0.5 right-0.5 z-20 h-4 w-4 rounded-full flex items-center justify-center bg-accent/90 text-button-text shadow-md pointer-events-none">
              <Check size={10} strokeWidth={3} />
            </div>
          )}
          {layers.length > 0 && (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className="absolute inset-0 w-full h-full"
                  style={{ opacity: layer.opacity, transition: 'opacity 60ms linear' }}
                  onTransitionEnd={() => handleTransitionEnd(layer.id)}
                >
                  <img
                    alt={baseName}
                    className={`w-full h-full relative ${
                      thumbnailAspectRatio === ThumbnailAspectRatio.Contain ? 'object-contain' : 'object-cover'
                    }`}
                    decoding="async"
                    loading="lazy"
                    src={layer.url}
                    onLoad={() => onLoad(path)}
                  />
                </div>
              ))}
            </div>
          )}

          {layers.length === 0 &&
            showPlaceholder &&
            (isCloudPlaceholder ? (
              <div
                className="absolute inset-0 w-full h-full flex items-center justify-center"
                data-tooltip={t('library.items.cloudPlaceholder')}
              >
                <CloudOff size={14} className="text-text-secondary" />
              </div>
            ) : (
              <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                <ImageIcon size={14} className="text-text-secondary animate-pulse" />
              </div>
            ))}

          {isCloudPlaceholder && layers.length > 0 && (
            <div
              className="absolute top-0.5 left-0.5 z-10 rounded-full h-3.5 w-3.5 flex items-center justify-center bg-black/40 pointer-events-none"
              data-tooltip={t('library.items.cloudPlaceholder')}
            >
              <CloudOff size={9} className="text-white" />
            </div>
          )}
        </div>
      </div>

      <div style={{ width: getW('name') }} className="flex items-center gap-2 px-3 h-full overflow-hidden">
        <Text variant={TextVariants.small} className="truncate" weight={TextWeights.medium} color={TextColors.primary}>
          {baseName}
        </Text>
        {(isVirtualCopy || virtualCopyStackCount(path) >= 2) && (
          <button
            type="button"
            className="shrink-0 bg-bg-primary px-1.5 py-0.5 rounded-full leading-none border border-border-color text-[10px] font-bold text-text-secondary hover:text-text-primary hover:border-white/30"
            data-tooltip={t('library.items.tooltipVirtualCopyCycle' as any, {
              defaultValue: isVirtualCopy
                ? 'Virtual copy — click to cycle stack'
                : 'Virtual copy stack — click to cycle',
            })}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              cycleVirtualCopyStack(path, onImageClick, e);
            }}
          >
            {isVirtualCopy ? 'VC' : `×${virtualCopyStackCount(path)}`}
          </button>
        )}
        {(isPick || isReject) && (
          <span
            className={clsx(
              'shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none',
              isPick ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white',
            )}
          >
            {isPick ? 'P' : 'X'}
          </span>
        )}
        {hasGpsList && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30"
            title="GPS"
          >
            <MapPin size={9} />
          </span>
        )}
        {!!isRaw && (
          <span
            className="shrink-0 px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-orange-500/25 text-orange-300 border border-orange-500/30"
            title="RAW"
          >
            RAW
          </span>
        )}
        {(() => {
          const kws = (tags || []).filter(
            (tg: string) =>
              tg.startsWith('user:') || (!tg.startsWith('color:') && !tg.startsWith('flag:') && !tg.startsWith('stack:') && !!tg),
          );
          if (!kws.length) return null;
          return (
            <span
              className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-text-secondary bg-bg-primary border border-border-color/50"
              title={kws.map((k: string) => k.replace(/^user:/, '')).join(', ')}
            >
              <Tag size={10} />
              {kws.length}
            </span>
          );
        })()}
      </div>

      <div style={{ width: getW('date') }} className="flex items-center px-3 h-full overflow-hidden">
        <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
          {dateStr}
        </Text>
      </div>

      <div style={{ width: getW('rating') }} className="flex items-center px-2 h-full overflow-hidden">
        <RatingStars
          rating={rating}
          onRate={onRate}
          path={path}
          size={11}
          emptyClass="text-text-secondary/30 hover:text-amber-200/70"
        />
      </div>

      <div style={{ width: getW('flag') }} className="flex items-center justify-center px-1 h-full overflow-hidden">
        {isPick || isReject ? (
          <span
            className={clsx(
              'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none',
              isPick ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white',
            )}
          >
            {isPick ? 'P' : 'X'}
          </span>
        ) : (
          <span className="text-[9px] text-text-secondary/40">·</span>
        )}
      </div>

      <div style={{ width: getW('edited') }} className="flex items-center justify-center px-1 h-full overflow-hidden">
        {isEdited ? (
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none bg-sky-500/25 text-sky-200 border border-sky-400/30"
            title={t('library.grid.columns.edited' as any, { defaultValue: 'Edited' })}
          >
            E
          </span>
        ) : (
          <span className="text-[9px] text-text-secondary/40">·</span>
        )}
      </div>

      <div style={{ width: getW('fileType') }} className="flex items-center justify-center px-1 h-full overflow-hidden">
        {(() => {
          const physical = String(path || '').split('?')[0];
          const name = physical.split(/[/\\]/).pop() || '';
          const dot = name.lastIndexOf('.');
          const ext = (dot > 0 ? name.slice(dot + 1) : '').toUpperCase();
          const label = isRaw ? 'RAW' : ext || '—';
          return (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded text-[8px] font-bold uppercase leading-none border',
                isRaw
                  ? 'bg-orange-500/25 text-orange-300 border-orange-500/30'
                  : 'bg-bg-primary text-text-secondary border-border-color/40',
              )}
              title={label}
            >
              {label.length > 5 ? label.slice(0, 5) : label}
            </span>
          );
        })()}
      </div>

      <div style={{ width: getW('gps') }} className="flex items-center justify-center px-1 h-full overflow-hidden">
        {hasGpsList ? (
          <span title="GPS" className="inline-flex text-sky-300">
            <MapPin size={12} />
          </span>
        ) : (
          <span className="text-[9px] text-text-secondary/40">·</span>
        )}
      </div>

      <div style={{ width: getW('urgency') }} className="flex items-center justify-center px-1 h-full overflow-hidden">
        {(() => {
          const n = parseInt(String(exif?.Urgency || ''), 10);
          if (!(Number.isFinite(n) && n >= 1 && n <= 8)) {
            return <span className="text-[9px] text-text-secondary/40">·</span>;
          }
          return (
            <span
              className={clsx(
                'px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums leading-none border',
                n <= 2
                  ? 'bg-red-500/30 text-red-100 border-red-400/40'
                  : n <= 5
                    ? 'bg-amber-500/20 text-amber-100 border-amber-400/30'
                    : 'bg-surface text-text-secondary border-border-color/40',
              )}
              title={`Urgency ${n}`}
            >
              {n}
            </span>
          );
        })()}
      </div>

      <div
        style={{ width: getW('creator') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.Artist || exif?.Creator || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.Artist || exif?.Creator || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div
        style={{ width: getW('credit') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.Credit || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.Credit || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div
        style={{ width: getW('city') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.City || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.City || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div
        style={{ width: getW('country') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.Country || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.Country || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div
        style={{ width: getW('state') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.State || exif?.Province || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.State || exif?.Province || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div
        style={{ width: getW('headline') }}
        className="flex items-center px-1.5 h-full overflow-hidden"
        title={String(exif?.Headline || '').trim() || undefined}
      >
        <span className="text-[10px] text-text-secondary truncate">
          {String(exif?.Headline || '').trim() || (
            <span className="text-text-secondary/40">·</span>
          )}
        </span>
      </div>

      <div style={{ width: getW('color') }} className="flex items-center px-3 h-full overflow-hidden">
        {colorLabel && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
              style={{ backgroundColor: colorLabel.color }}
            />
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {t(`contextMenus.colors.${colorLabel.name}`, {
                defaultValue: colorLabel.name.charAt(0).toUpperCase() + colorLabel.name.slice(1),
              })}
            </Text>
          </div>
        )}
      </div>

      {showExifCols && (
        <>
          <div style={{ width: getW('shutter') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {shutter}
            </Text>
          </div>
          <div style={{ width: getW('aperture') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {fNumber}
            </Text>
          </div>
          <div style={{ width: getW('iso') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {iso}
            </Text>
          </div>
          <div style={{ width: getW('focal') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate">
              {focal ? (String(focal).endsWith('mm') ? focal : `${focal}mm`) : ''}
            </Text>
          </div>
          <div style={{ width: getW('camera') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate" title={camera}>
              {camera}
            </Text>
          </div>
          <div style={{ width: getW('lens') }} className="flex items-center px-3 h-full overflow-hidden">
            <Text variant={TextVariants.small} color={TextColors.secondary} className="truncate" title={lens}>
              {lens}
            </Text>
          </div>
        </>
      )}
    </div>
  );
};

export const Thumbnail = React.memo(ThumbnailComponent);
export const ListItem = React.memo(ListItemComponent);

const RowComponent = ({
  index,
  style,
  rows,
  activePath,
  multiSelectedSet,
  onContextMenu,
  onImageClick,
  onImageDoubleClick,
  thumbnailAspectRatio,
  onImageLoad,
  imageRatings,
  baseFolderPath,
  itemWidth,
  itemHeight,
  outerPadding,
  gap,
  isListView,
  columnWidths,
  queueThumbnailRequest,
  onToggleRecursiveFolder,
  groupBadgeInfo,
  onRate,
}: any) => {
  const { t } = useTranslation();
  const row = rows[index];

  useEffect(() => {
    if (!row || row.type !== 'images') return;

    row.images.forEach((img: ImageFile) => {
      queueThumbnailRequest(img.path);
    });

    const cloudPaths = row.images
      .filter((img: ImageFile) => img.is_cloud_placeholder)
      .map((img: ImageFile) => img.path);
    if (cloudPaths.length === 0) return;

    const interval = setInterval(() => {
      cloudPaths.forEach((path: string) => queueThumbnailRequest(path));
    }, 5000);

    return () => clearInterval(interval);
  }, [row, queueThumbnailRequest]);

  if (row.type === 'footer') return null;
  const shiftedStyle = {
    ...style,
    transform: (style.transform as string).replace(
      /translateY\(([^)]+)\)/,
      (_: string, y: string) => `translateY(${parseFloat(y) + outerPadding}px)`,
    ),
  };

  if (row.type === 'header') {
    let displayPath = row.path;
    if (baseFolderPath && row.path.startsWith(baseFolderPath)) {
      displayPath = row.path.substring(baseFolderPath.length);
      if (displayPath.startsWith('/') || displayPath.startsWith('\\')) {
        displayPath = displayPath.substring(1);
      }
    }
    if (!displayPath) displayPath = t('library.items.currentFolder');

    return (
      <div
        style={{
          ...shiftedStyle,
          left: 0,
          width: '100%',
          paddingLeft: outerPadding === 0 ? 12 : outerPadding,
          paddingRight: outerPadding === 0 ? 12 : outerPadding,
          boxSizing: 'border-box',
        }}
        className="flex items-end pb-2 pt-2"
      >
        <div className="flex items-center gap-2 w-full border-b border-border-color/50 pb-1">
          <button
            type="button"
            className={`${TEXT_COLOR_KEYS[TextColors.secondary]} p-0.5 rounded transition-colors hover:bg-surface-hover cursor-pointer`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleRecursiveFolder(row.path);
            }}
            data-tooltip={row.isExpanded ? t('library.items.collapseFolder') : t('library.items.expandFolder')}
          >
            {row.isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </button>
          <Text variant={TextVariants.label} weight={TextWeights.semibold} className="truncate" data-tooltip={row.path}>
            {displayPath}
          </Text>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="ml-auto">
            {t('library.items.imagesCount', { count: row.count })}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...shiftedStyle,
        left: outerPadding,
        right: outerPadding,
        width: isListView ? '100%' : 'auto',
        display: 'flex',
        gap: gap,
        paddingLeft: isListView ? '8px' : '0px',
        paddingRight: isListView ? '8px' : '0px',
        boxSizing: 'border-box',
      }}
    >
      {row.images.map((imageFile: ImageFile, i: number) => {
        let isPrevSelected = false;
        let isNextSelected = false;

        if (isListView) {
          const prevRow = index > 0 ? rows[index - 1] : null;
          const nextRow = index < rows.length - 1 ? rows[index + 1] : null;

          if (prevRow && prevRow.type === 'images' && prevRow.images.length > 0) {
            isPrevSelected = multiSelectedSet.has(prevRow.images[0].path);
          }
          if (nextRow && nextRow.type === 'images' && nextRow.images.length > 0) {
            isNextSelected = multiSelectedSet.has(nextRow.images[0].path);
          }
        }

        return (
          <div
            key={imageFile.path}
            style={{
              width: isListView ? '100%' : row.widths?.[i] ?? itemWidth,
              height: isListView ? itemHeight : row.height ?? itemHeight,
            }}
          >
            {isListView ? (
              <ListItem
                isActive={activePath === imageFile.path}
                isSelected={multiSelectedSet.has(imageFile.path)}
                onContextMenu={onContextMenu}
                onImageClick={onImageClick}
                onImageDoubleClick={onImageDoubleClick}
                onLoad={onImageLoad}
                onRate={onRate}
                path={imageFile.path}
                rating={imageRatings?.[imageFile.path] || 0}
                tags={imageFile.tags}
                exif={imageFile.exif}
                isRaw={imageFile.is_raw}
                isEdited={imageFile.is_edited}
                aspectRatio={thumbnailAspectRatio}
                modified={imageFile.modified}
                columnWidths={columnWidths}
                isCloudPlaceholder={imageFile.is_cloud_placeholder}
                isPrevSelected={isPrevSelected}
                isNextSelected={isNextSelected}
              />
            ) : (
              <Thumbnail
                isActive={activePath === imageFile.path}
                isSelected={multiSelectedSet.has(imageFile.path)}
                onContextMenu={onContextMenu}
                onImageClick={onImageClick}
                onImageDoubleClick={onImageDoubleClick}
                onLoad={onImageLoad}
                onRate={onRate}
                path={imageFile.path}
                rating={imageRatings?.[imageFile.path] || 0}
                tags={imageFile.tags}
                exif={imageFile.exif}
                isEdited={imageFile.is_edited}
                isRaw={imageFile.is_raw}
                aspectRatio={thumbnailAspectRatio}
                isCloudPlaceholder={imageFile.is_cloud_placeholder}
                groupBadgeLabel={(() => { const gid = effectiveGroupId(imageFile); return gid && groupBadgeInfo?.get(gid)?.label; })()}
                groupId={effectiveGroupId(imageFile)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export const Row = React.memo(RowComponent);
