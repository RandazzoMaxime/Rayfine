import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { Download, Frame, Loader2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import BorderTemplatesPanel, { BorderTemplatesRail } from '../panel/BorderTemplatesPanel';
import Slider from '../ui/Slider';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useUIStore } from '../../store/useUIStore';
import { ImageFile, Invokes } from '../ui/AppProperties';
import {
  BORDER_ASPECTS,
  BORDER_MAX_PHOTOS,
  canvasSize,
  computeCellRects,
  containRect,
  getBorderLayout,
  type TemplateRef,
} from '../../utils/borderLayout';

interface Props {
  onBackToLibrary(): void;
  /** Current folder in Library display order. */
  imageList: ImageFile[];
  onRequestThumbnails?(paths: string[]): void;
}

type DragSource = { kind: 'slot'; index: number; path: string } | { kind: 'strip'; path: string };
type DropTarget = number | 'strip' | null;

const SWATCHES = [
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'lightGray', label: 'Light gray', color: '#d4d4d4' },
  { id: 'darkGray', label: 'Dark gray', color: '#333333' },
];
const EXPORT_SIZES = [1080, 2160, 4096];
const DEFAULT_MARGIN = 5;
const DRAG_THRESHOLD_PX = 5;
/** Developed previews are full-resolution: keep only a few unplaced ones cached. */
const PREVIEW_CACHE_LIMIT = 8;

const baseName = (p: string) => p.split(/[\\/]/).pop()?.split('?')[0] || p;

function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Asset-protocol thumbnails are cross-origin: request CORS so the export canvas stays untainted.
    if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Border module — social-media borders and multi-photo layouts. Photos are contain-fitted into
 * template cells over a solid border colour and exported as JPEG.
 */
export default function BorderModuleView({ onBackToLibrary, imageList, onRequestThumbnails }: Props) {
  const { t } = useTranslation();
  const thumbs = useProcessStore((s) => s.thumbnails);
  const { developLeftPanelWidth, isInstantTransition } = useUIStore(
    useShallow((s) => ({
      developLeftPanelWidth: s.developLeftPanelWidth,
      isInstantTransition: s.isInstantTransition,
    })),
  );

  // Pre-fill with the Library's checked photos (display order), else the active photo.
  const [initialPlaced] = useState<string[]>(() => {
    const { multiSelectedPaths, libraryActivePath } = useLibraryStore.getState();
    const order = new Map(imageList.map((img, i) => [img.path, i]));
    const rank = (p: string) => order.get(p) ?? Number.MAX_SAFE_INTEGER;
    let paths = Array.from(new Set(multiSelectedPaths || []));
    if (paths.length === 0 && libraryActivePath) paths = [libraryActivePath];
    return paths.sort((a, b) => rank(a) - rank(b)).slice(0, BORDER_MAX_PHOTOS);
  });
  const [placed, setPlaced] = useState<string[]>(initialPlaced);
  const [template, setTemplate] = useState<TemplateRef>({ count: Math.max(1, initialPlaced.length), index: 0 });
  const [aspectId, setAspectId] = useState('4:5');
  const [marginPct, setMarginPct] = useState(DEFAULT_MARGIN);
  const [color, setColor] = useState('#ffffff');
  const [exportSize, setExportSize] = useState(2160);
  const [exporting, setExporting] = useState(false);
  const [showLeft, setShowLeft] = useState(true);

  const aspect = BORDER_ASPECTS.find((a) => a.id === aspectId) ?? BORDER_ASPECTS[1];
  const layout = getBorderLayout(template);
  const cellCount = layout.length;
  const visible = placed.slice(0, cellCount);
  const visibleKey = visible.join('\n');
  const placedKey = placed.join('\n');

  // ---- Developed previews (only for photos in the layout; loaded one at a time) ----
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const previewPromisesRef = useRef(new Map<string, Promise<string | null>>());
  const previewUrlsRef = useRef(new Map<string, string>());
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const genRef = useRef(0);
  const placedRef = useRef(placed);
  placedRef.current = placed;

  useEffect(() => {
    genRef.current += 1;
    setPreviews({});
    const urls = previewUrlsRef.current;
    const promises = previewPromisesRef.current;
    return () => {
      genRef.current += 1;
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
      promises.clear();
    };
  }, []);

  const ensurePreview = useCallback((path: string): Promise<string | null> => {
    const existing = previewPromisesRef.current.get(path);
    if (existing) return existing;
    const gen = genRef.current;
    const job = chainRef.current.then(async () => {
      if (gen !== genRef.current) return null;
      // Removed from the layout while queued → skip the (full-resolution) render.
      if (!placedRef.current.includes(path)) {
        previewPromisesRef.current.delete(path);
        return null;
      }
      try {
        const metadata: any = await invoke(Invokes.LoadMetadata, { path });
        const adjustments = metadata?.adjustments && !metadata.adjustments.is_null ? metadata.adjustments : {};
        const bytes: Uint8Array = await invoke(Invokes.GeneratePreviewForPath, { path, jsAdjustments: adjustments });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
        if (gen !== genRef.current) {
          URL.revokeObjectURL(url);
          return null;
        }
        previewUrlsRef.current.set(path, url);
        setPreviews((prev) => ({ ...prev, [path]: url }));
        return url;
      } catch (err) {
        console.error('Border: preview failed for', path, err);
        if (gen === genRef.current) setPreviews((prev) => ({ ...prev, [path]: null }));
        return null;
      }
    });
    chainRef.current = job;
    previewPromisesRef.current.set(path, job);
    return job;
  }, []);

  useEffect(() => {
    visible.forEach((p) => void ensurePreview(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, ensurePreview]);

  // Evict cached previews of photos no longer in the layout once the cache grows.
  useEffect(() => {
    const urls = previewUrlsRef.current;
    if (urls.size <= PREVIEW_CACHE_LIMIT) return;
    const keep = new Set(placed);
    const evict = Array.from(urls.keys()).filter((p) => !keep.has(p));
    if (!evict.length) return;
    evict.forEach((p) => {
      URL.revokeObjectURL(urls.get(p)!);
      urls.delete(p);
      previewPromisesRef.current.delete(p);
    });
    setPreviews((prev) => {
      const next = { ...prev };
      evict.forEach((p) => delete next[p]);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedKey]);

  // ---- Strip thumbnails ----
  useEffect(() => {
    if (!imageList.length && !placed.length) return;
    const timer = setTimeout(() => {
      const { thumbnails } = useProcessStore.getState();
      const paths = Array.from(new Set([...placed, ...imageList.slice(0, 500).map((i) => i.path)])).filter(
        (p) => !thumbnails[p],
      );
      if (!paths.length) return;
      if (onRequestThumbnails) onRequestThumbnails(paths);
      else invoke('update_thumbnail_queue', { paths }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageList, placedKey, onRequestThumbnails]);

  // ---- Canvas fit ----
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.max(0, Math.min(stage.w / aspect.w, stage.h / aspect.h));
  const dispW = Math.floor(aspect.w * fit);
  const dispH = Math.floor(aspect.h * fit);
  const rects = useMemo(() => computeCellRects(layout, dispW, dispH, marginPct), [layout, dispW, dispH, marginPct]);
  const light = isLightColor(color);

  // ---- Layout editing ----
  const removePath = (path: string) => setPlaced((prev) => prev.filter((p) => p !== path));

  const suppressClickRef = useRef(false);
  const togglePath = (path: string) => {
    if (suppressClickRef.current) return;
    if (placed.includes(path)) {
      removePath(path);
      return;
    }
    if (placed.length >= BORDER_MAX_PHOTOS) {
      toast.info(
        t('ui.border.maxPhotos' as any, {
          defaultValue: 'A layout holds up to {{count}} photos',
          count: BORDER_MAX_PHOTOS,
        }),
      );
      return;
    }
    const next = [...placed, path];
    setPlaced(next);
    // No free cell left → switch to the first template that fits the new count.
    if (next.length > cellCount) setTemplate({ count: next.length, index: 0 });
  };

  const handleDrop = useCallback((source: DragSource, target: DropTarget) => {
    if (target === null) return;
    if (target === 'strip') {
      if (source.kind === 'slot') setPlaced((prev) => prev.filter((p) => p !== source.path));
      return;
    }
    setPlaced((prev) => {
      const next = [...prev];
      const from = next.indexOf(source.path);
      if (target < next.length) {
        if (from === target) return prev;
        if (from >= 0) [next[from], next[target]] = [next[target], next[from]];
        else next[target] = source.path;
        return next;
      }
      // Empty cell → the photo moves to / is added at the next free slot.
      if (from >= 0) next.splice(from, 1);
      else if (next.length >= BORDER_MAX_PHOTOS) return prev;
      next.push(source.path);
      return next;
    });
  }, []);

  // ---- Pointer-based drag & drop (reliable inside the Tauri webview) ----
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const ghostPosRef = useRef({ x: 0, y: 0 });

  const beginDrag = (e: React.PointerEvent, source: DragSource) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let last: DropTarget = null;
    const targetAt = (x: number, y: number): DropTarget => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const cell = el?.closest('[data-border-cell]') as HTMLElement | null;
      if (cell) return Number(cell.dataset.borderCell);
      if (el?.closest('[data-border-strip]')) return 'strip';
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        active = true;
        ghostPosRef.current = { x: ev.clientX, y: ev.clientY };
        setDrag(source);
      }
      ghostPosRef.current = { x: ev.clientX, y: ev.clientY };
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
      }
      const target = targetAt(ev.clientX, ev.clientY);
      if (target !== last) {
        last = target;
        setDropTarget(target);
      }
    };
    const finish = (ev: PointerEvent, drop: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!active) return;
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      setDrag(null);
      setDropTarget(null);
      if (drop) handleDrop(source, targetAt(ev.clientX, ev.clientY));
    };
    const onUp = (ev: PointerEvent) => finish(ev, true);
    const onCancel = (ev: PointerEvent) => finish(ev, false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // ---- Export ----
  const exportDims = canvasSize(aspect, exportSize);

  const handleExport = async () => {
    const photos = placed.slice(0, cellCount);
    if (!photos.length) {
      toast.info(t('ui.border.nothingToExport' as any, { defaultValue: 'Add at least one photo to the layout' }));
      return;
    }
    setExporting(true);
    try {
      const filePath = await saveDialog({
        defaultPath: `border-${timestamp()}.jpg`,
        filters: [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }],
        title: t('ui.border.exportTitle' as any, { defaultValue: 'Export border image' }),
      });
      if (!filePath) return;

      const { width, height } = exportDims;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const cells = computeCellRects(layout, width, height, marginPct);
      const missing: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = photos[i];
        const previewUrl = await ensurePreview(path);
        const url = previewUrl || useProcessStore.getState().thumbnails[path];
        if (!previewUrl) missing.push(baseName(path));
        if (!url) continue;
        try {
          const img = await loadImage(url);
          const d = containRect(img.naturalWidth, img.naturalHeight, cells[i]);
          ctx.drawImage(img, d.x, d.y, d.w, d.h);
        } catch (err) {
          console.error('Border: could not draw', path, err);
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('JPEG encoding failed');
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const tempPath: string = await invoke(Invokes.SaveTempFile, { bytes });
      await invoke(Invokes.CopyFileTo, { sourcePath: tempPath, destinationPath: filePath });

      if (missing.length) {
        toast.warn(
          t('ui.border.exportFallback' as any, {
            defaultValue: 'Developed preview unavailable for {{names}} — used the thumbnail instead',
            names: missing.join(', '),
          }),
        );
      }
      toast.success(
        t('ui.border.exportDone' as any, {
          defaultValue: 'Saved {{name}} ({{width}}×{{height}})',
          name: baseName(filePath),
          width,
          height,
        }),
      );
    } catch (err) {
      console.error('Border export failed:', err);
      toast.error(
        t('ui.border.exportFailed' as any, { defaultValue: 'Export failed: {{error}}', error: String(err) }),
      );
    } finally {
      setExporting(false);
    }
  };

  // ---- Render ----
  const sectionTitle = 'text-[10px] uppercase tracking-wider text-white/35';
  const choiceClass = (active: boolean) =>
    clsx(
      'h-8 rounded border px-2 flex items-center justify-center text-[11px] tabular-nums',
      active ? 'bg-white/10 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80',
    );

  const ghostSrc = drag ? previews[drag.path] || thumbs[drag.path] : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full gap-2">
      <ModuleShell
        moduleId="border"
        title={t('ui.moduleBar.border' as any, { defaultValue: 'Border' })}
        subtitle={t('ui.moduleShell.borderSubtitle' as any, {
          defaultValue: 'Social-media borders and multi-photo layouts.',
        })}
        icon={Frame}
        onBackToLibrary={onBackToLibrary}
        leftPanel={
          showLeft ? (
            <BorderTemplatesPanel
              width={developLeftPanelWidth || 220}
              isInstantTransition={isInstantTransition}
              aspect={aspect}
              active={template}
              onSelect={setTemplate}
              onHide={() => setShowLeft(false)}
            />
          ) : (
            <BorderTemplatesRail onShow={() => setShowLeft(true)} />
          )
        }
        right={
          <>
            <section className="space-y-1.5">
              <div className={sectionTitle}>{t('ui.border.aspectRatio' as any, { defaultValue: 'Aspect ratio' })}</div>
              <div className="grid grid-cols-4 gap-1">
                {BORDER_ASPECTS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAspectId(a.id)} className={choiceClass(a.id === aspectId)}>
                    {a.id}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2 mt-3">
              <div className={sectionTitle}>{t('ui.border.border' as any, { defaultValue: 'Border' })}</div>
              <Slider
                label={t('ui.border.margin' as any, { defaultValue: 'Margin' })}
                min={0}
                max={25}
                step={0.5}
                defaultValue={DEFAULT_MARGIN}
                value={marginPct}
                suffix="%"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setMarginPct(Math.min(25, Math.max(0, v)));
                }}
              />
              <div className="flex items-center gap-1.5">
                {SWATCHES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setColor(s.color)}
                    data-tooltip={t(`ui.border.color.${s.id}` as any, { defaultValue: s.label })}
                    aria-label={t(`ui.border.color.${s.id}` as any, { defaultValue: s.label })}
                    aria-pressed={color.toLowerCase() === s.color}
                    className={clsx(
                      'w-7 h-7 rounded border',
                      color.toLowerCase() === s.color
                        ? 'border-white ring-1 ring-white/70'
                        : 'border-white/20 hover:border-white/50',
                    )}
                    style={{ background: s.color }}
                  />
                ))}
                <label
                  className="relative w-7 h-7 rounded border border-white/20 hover:border-white/50 overflow-hidden cursor-pointer"
                  data-tooltip={t('ui.border.customColor' as any, { defaultValue: 'Custom color' })}
                  style={{
                    background: SWATCHES.some((s) => s.color === color.toLowerCase())
                      ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'
                      : color,
                  }}
                >
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <span className="ml-auto text-[10px] font-mono text-white/45 uppercase">{color}</span>
              </div>
            </section>

            <section className="space-y-1.5 mt-3">
              <div className={sectionTitle}>{t('ui.border.layout' as any, { defaultValue: 'Layout' })}</div>
              <div className="text-[11px] text-white/55">
                {t('ui.border.filled' as any, {
                  defaultValue: '{{filled}} of {{cells}} cells filled',
                  filled: visible.length,
                  cells: cellCount,
                })}
                {placed.length > cellCount &&
                  ` · ${t('ui.border.hiddenCount' as any, {
                    defaultValue: '{{count}} hidden by this template',
                    count: placed.length - cellCount,
                  })}`}
              </div>
              <button
                type="button"
                disabled={!placed.length}
                onClick={() => setPlaced([])}
                className="w-full h-8 rounded bg-white/5 border border-white/10 px-2 flex items-center gap-2 text-[11px] text-white/75 hover:bg-white/10 disabled:opacity-40"
              >
                <Trash2 size={12} />
                {t('ui.border.clear' as any, { defaultValue: 'Clear layout' })}
              </button>
            </section>

            <section className="space-y-1.5 mt-3">
              <div className={sectionTitle}>{t('ui.border.export' as any, { defaultValue: 'Export' })}</div>
              <div className="grid grid-cols-3 gap-1">
                {EXPORT_SIZES.map((size) => (
                  <button key={size} type="button" onClick={() => setExportSize(size)} className={choiceClass(size === exportSize)}>
                    {size}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-white/40 tabular-nums">
                {t('ui.border.exportDims' as any, {
                  defaultValue: 'Long edge {{size}} px · {{width}} × {{height}} px · JPEG',
                  size: exportSize,
                  width: exportDims.width,
                  height: exportDims.height,
                })}
              </div>
              <button
                type="button"
                disabled={exporting || !visible.length}
                onClick={handleExport}
                className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 text-button-text text-[11px] font-semibold uppercase tracking-wide flex items-center justify-center gap-2"
              >
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {exporting
                  ? t('ui.border.exporting' as any, { defaultValue: 'Exporting…' })
                  : t('ui.border.exportJpeg' as any, { defaultValue: 'Export JPEG…' })}
              </button>
            </section>

            <section className="mt-4 text-[10px] text-white/35 leading-relaxed">
              {t('ui.border.note' as any, {
                defaultValue:
                  'Click a thumbnail to add or remove it. Drag photos between cells to swap them, drag a thumbnail onto a cell to place it, or drag a cell back to the strip to remove it.',
              })}
            </section>
          </>
        }
      >
        <div ref={stageRef} className="relative w-full h-full self-stretch min-h-0">
          {dispW > 0 && dispH > 0 && (
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl ring-1 ring-white/10 select-none"
              style={{ width: dispW, height: dispH, background: color }}
            >
              {rects.map((r, i) => {
                const path = placed[i];
                const src = path ? previews[path] || thumbs[path] : undefined;
                const loading = !!path && previews[path] === undefined;
                const isTarget = drag !== null && dropTarget === i;
                return (
                  <div
                    key={i}
                    data-border-cell={i}
                    className={clsx('absolute group', path && 'cursor-grab', drag?.kind === 'slot' && drag.index === i && 'opacity-40')}
                    style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                    onPointerDown={path ? (e) => beginDrag(e, { kind: 'slot', index: i, path }) : undefined}
                  >
                    {path ? (
                      <>
                        {src && (
                          <img
                            src={src}
                            alt={baseName(path)}
                            draggable={false}
                            className="w-full h-full object-contain pointer-events-none"
                          />
                        )}
                        {loading && (
                          <Loader2
                            size={14}
                            className={clsx('absolute top-1.5 left-1.5 animate-spin', light ? 'text-black/50' : 'text-white/60')}
                          />
                        )}
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => removePath(path)}
                          data-tooltip={t('ui.border.remove' as any, { defaultValue: 'Remove from layout' })}
                          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white/90 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center border border-dashed text-[11px] text-center px-1"
                        style={{
                          borderColor: light ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.2)',
                          color: light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)',
                        }}
                      >
                        {t('ui.border.dropPhoto' as any, { defaultValue: 'Drop a photo' })}
                      </div>
                    )}
                    {isTarget && <div className="absolute inset-0 ring-2 ring-accent pointer-events-none" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ModuleShell>

      {/* Bottom strip — current folder in Library order */}
      <div
        data-border-strip
        className={clsx(
          'h-[92px] shrink-0 bg-bg-secondary rounded-lg border border-border-color/30 flex items-center gap-1.5 px-2 overflow-x-auto overflow-y-hidden custom-scrollbar select-none',
          drag?.kind === 'slot' && dropTarget === 'strip' && 'ring-1 ring-accent',
        )}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {imageList.length === 0 ? (
          <div className="px-2 text-[11px] text-text-secondary">
            {t('ui.border.noPhotos' as any, { defaultValue: 'No photos in the current folder.' })}
          </div>
        ) : (
          imageList.map((img) => {
            const idx = placed.indexOf(img.path);
            const isPlaced = idx >= 0;
            const hidden = isPlaced && idx >= cellCount;
            const thumb = thumbs[img.path];
            return (
              <button
                key={img.path}
                type="button"
                onPointerDown={(e) => beginDrag(e, { kind: 'strip', path: img.path })}
                onClick={() => togglePath(img.path)}
                title={baseName(img.path)}
                className={clsx(
                  'relative shrink-0 w-[88px] h-[70px] rounded overflow-hidden bg-black/30 border-2 transition-colors',
                  isPlaced ? 'border-accent' : 'border-transparent hover:border-white/30',
                )}
              >
                {thumb ? (
                  <img src={thumb} alt="" draggable={false} loading="lazy" className="w-full h-full object-cover pointer-events-none" />
                ) : (
                  <div className="w-full h-full bg-white/5" />
                )}
                {isPlaced && (
                  <span
                    className={clsx(
                      'absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center tabular-nums',
                      hidden ? 'bg-black/70 text-white/60' : 'bg-accent text-button-text',
                    )}
                    data-tooltip={
                      hidden
                        ? t('ui.border.hiddenSlot' as any, { defaultValue: 'Not shown by this template' })
                        : undefined
                    }
                  >
                    {idx + 1}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {drag && ghostSrc && (
        <div
          ref={ghostRef}
          className="fixed left-0 top-0 z-[1000] pointer-events-none w-[88px] h-[70px] rounded overflow-hidden shadow-2xl ring-2 ring-accent opacity-90"
          style={{ transform: `translate(${ghostPosRef.current.x + 12}px, ${ghostPosRef.current.y + 12}px)` }}
        >
          <img src={ghostSrc} alt="" draggable={false} className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  );
}
