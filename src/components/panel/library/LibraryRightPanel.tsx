import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  Info,
  Tag, Paintbrush,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'react-toastify';
import LibraryImportBar from './LibraryImportBar';
import LibraryImportApply from './LibraryImportApply';

import { useLibraryStore } from '../../../store/useLibraryStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { Invokes } from '../../ui/AppProperties';


/** LR Classic Library right panel structure: Histogram · Quick Develop · Metadata (public layout). */

interface QuickControl {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
}

/** Library Quick Develop keeps only the essentials — full processing lives in Develop. */
const QUICK_CONTROLS: QuickControl[] = [
  { key: 'brightness', label: 'Exposure', min: -5, max: 5, step: 0.01, decimals: 2 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, decimals: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, decimals: 0 },
  { key: 'temperature', label: 'Temp', min: -100, max: 100, step: 1, decimals: 0 },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1, decimals: 0 },
];

function MiniHistogram({ path }: { path: string | null }) {
  const thumbUrl = useProcessStore((s) => (path ? s.thumbnails[path] : undefined));
  const [bins, setBins] = useState<{ r: number[]; g: number[]; b: number[] } | null>(null);

  useEffect(() => {
    if (!thumbUrl) {
      setBins(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const w = 64;
        const h = Math.max(1, Math.round((img.height / img.width) * w));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const r = new Array(64).fill(0);
        const g = new Array(64).fill(0);
        const b = new Array(64).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          r[Math.min(63, data[i] >> 2)]++;
          g[Math.min(63, data[i + 1] >> 2)]++;
          b[Math.min(63, data[i + 2] >> 2)]++;
        }
        if (!cancelled) setBins({ r, g, b });
      } catch {
        if (!cancelled) setBins(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setBins(null);
    };
    img.src = thumbUrl;
    return () => {
      cancelled = true;
    };
  }, [thumbUrl]);

  const max = useMemo(() => {
    if (!bins) return 1;
    return Math.max(1, ...bins.r, ...bins.g, ...bins.b);
  }, [bins]);

  if (!path) {
    return (
      <div className="h-24 rounded bg-black/40 border border-border-color/30 flex items-center justify-center text-[10px] text-text-secondary/60 uppercase tracking-wider">
        No photo
      </div>
    );
  }

  if (!bins) {
    return (
      <div className="h-24 rounded bg-black/40 border border-border-color/30 flex items-center justify-center text-[10px] text-text-secondary/50">
        …
      </div>
    );
  }

  const pathD = (arr: number[]) => {
    const n = arr.length;
    let d = `M 0 ${100 - (arr[0] / max) * 100}`;
    for (let i = 1; i < n; i++) {
      const x = (i / (n - 1)) * 100;
      const y = 100 - (arr[i] / max) * 100;
      d += ` L ${x} ${y}`;
    }
    d += ' L 100 100 L 0 100 Z';
    return d;
  };

  return (
    <div className="h-24 rounded bg-black/50 border border-border-color/30 overflow-hidden relative">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <path d={pathD(bins.r)} fill="#FF6B6B" opacity={0.45} />
        <path d={pathD(bins.g)} fill="#6BCB77" opacity={0.45} />
        <path d={pathD(bins.b)} fill="#4D96FF" opacity={0.45} />
      </svg>
    </div>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
  icon: Icon,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: typeof SlidersHorizontal;
}) {
  return (
    <div className="border-b border-border-color/25">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-surface/50"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {Icon && <Icon size={12} className="opacity-60" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 space-y-2">{children}</div>}
    </div>
  );
}

function QuickSliderRow({
  control,
  label,
  value,
  disabled,
  onCommit,
}: {
  control: QuickControl;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const { min, max, step, decimals } = control;
  const [local, setLocal] = useState(value);
  const [text, setText] = useState(value.toFixed(decimals));

  useEffect(() => {
    setLocal(value);
    setText(value.toFixed(decimals));
  }, [value, decimals]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const commit = (n: number) => {
    const v = Number(clamp(n).toFixed(decimals));
    setLocal(v);
    setText(v.toFixed(decimals));
    if (v !== value) onCommit(v);
  };

  const commitText = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n)) commit(n);
    else setText(local.toFixed(decimals));
  };

  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-text-secondary truncate">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={local}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            setLocal(n);
            setText(n.toFixed(decimals));
          }}
          onPointerUp={() => commit(local)}
          onKeyUp={() => commit(local)}
          onDoubleClick={() => commit(0)}
          className="flex-1 min-w-0 h-1.5 accent-accent cursor-pointer disabled:opacity-40"
          aria-label={label}
        />
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setText(local.toFixed(decimals));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-14 h-6 px-1.5 rounded bg-surface border border-border-color/40 text-[11px] text-right tabular-nums text-text-primary outline-none focus:border-white/30 disabled:opacity-40"
          aria-label={`${label} value`}
        />
      </div>
    </div>
  );
}

export default function LibraryRightPanel() {
  const { t } = useTranslation();
  const [openHist, setOpenHist] = useState(true);
  const [openQuick, setOpenQuick] = useState(true);
  const [openMeta, setOpenMeta] = useState(true);
  const [openKeywords, setOpenKeywords] = useState(true);
  const [tagInput, setTagInput] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{
    rating?: number;
    tags?: string[] | null;
    exif?: Record<string, string> | null;
    is_edited?: boolean;
    adjustments?: Record<string, any> | null;
  } | null>(null);

  const { libraryActivePath, multiSelectedPaths, imageList, setLibrary, setFilterCriteria, filterCriteria } =
    useLibraryStore(
      useShallow((s) => ({
        libraryActivePath: s.libraryActivePath,
        multiSelectedPaths: s.multiSelectedPaths,
        imageList: s.imageList,
        setLibrary: s.setLibrary,
        setFilterCriteria: s.setFilterCriteria,
        filterCriteria: s.filterCriteria,
      })),
    );

  const filterByKeyword = useCallback(
    (kw: string) => {
      const pick = kw.trim().toLowerCase();
      if (!pick) return;
      setFilterCriteria((prev) => ({ ...prev, keyword: pick }));
      const paths = imageList
        .filter((img: any) =>
          (img.tags || []).some((tg: string) => {
            const bare = tg.toLowerCase().replace(/^user:/, '');
            return bare === pick || tg.toLowerCase() === `user:${pick}`;
          }),
        )
        .map((img: any) => img.path);
      setLibrary({
        multiSelectedPaths: paths,
        libraryActivePath: paths.length ? paths[paths.length - 1] : libraryActivePath,
        selectionAnchorPath: paths.length ? paths[0] : null,
        showSelectedOnly: false,
      });
    },
    [imageList, libraryActivePath, setFilterCriteria, setLibrary],
  );

  const targetPaths = useMemo(() => {
    if (multiSelectedPaths.length > 0) return multiSelectedPaths;
    if (libraryActivePath) return [libraryActivePath];
    return [] as string[];
  }, [multiSelectedPaths, libraryActivePath]);

  const libraryPainter = useLibraryStore((s) => s.libraryPainter);
  const keywordPaintTagLegacy = useLibraryStore((s) => s.keywordPaintTag);
  const keywordPaintTag =
    libraryPainter?.kind === 'keyword'
      ? String(libraryPainter.value ?? '')
      : keywordPaintTagLegacy;

  // Metadata/histogram follow the active (clicked) photo; edits apply to checked photos.
  const primaryPath = libraryActivePath || targetPaths[0] || null;
  const primaryImage = imageList.find((i) => i.path === primaryPath);

  // Load lightweight metadata for active photo
  useEffect(() => {
    if (!primaryPath) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    invoke(Invokes.LoadMetadata, { path: primaryPath })
      .then((m: any) => {
        if (!cancelled) {
          setMeta({
            rating: m?.rating,
            tags: m?.tags,
            exif: m?.exif,
            is_edited: !!m?.adjustments && m.adjustments !== null && Object.keys(m.adjustments || {}).length > 0,
            adjustments: m?.adjustments || null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primaryPath]);

  const applyValue = useCallback(
    async (key: string, value: number) => {
      if (targetPaths.length === 0) return;
      setBusy(true);
      try {
        await invoke(Invokes.ApplyAdjustmentsToPaths, {
          paths: targetPaths,
          adjustments: { [key]: value },
        });
        setMeta((m) => (m ? { ...m, adjustments: { ...(m.adjustments || {}), [key]: value } } : m));
        setLibrary((state) => ({
          imageList: state.imageList.map((img) =>
            targetPaths.includes(img.path) ? { ...img, is_edited: true } : img,
          ),
        }));
      } catch (err) {
        toast.error(`Quick Develop failed: ${err}`);
      } finally {
        setBusy(false);
      }
    },
    [targetPaths, setLibrary],
  );


  const handleReset = useCallback(async () => {
    if (targetPaths.length === 0) return;
    setBusy(true);
    try {
      await invoke(Invokes.ResetAdjustmentsForPaths, { paths: targetPaths });
      setLibrary((state) => ({
        imageList: state.imageList.map((img) =>
          targetPaths.includes(img.path) ? { ...img, is_edited: false } : img,
        ),
      }));
    } catch (err) {
      toast.error(`Reset failed: ${err}`);
    } finally {
      setBusy(false);
    }
  }, [targetPaths, setLibrary]);

  const userTags = useMemo(() => {
    const tags = primaryImage?.tags || meta?.tags || [];
    return tags
      .filter((t: string) => !t.startsWith('color:') && !t.startsWith('flag:') && !t.startsWith('stack:'))
      .map((t: string) => (t.startsWith('user:') ? t.slice(5) : t));
  }, [primaryImage, meta]);

  /** LR-style keyword set: most common user: tags in the current folder, not already on the selection. */
  const suggestedKeywords = useMemo(() => {
    const counts = new Map<string, number>();
    for (const img of imageList || []) {
      for (const tg of img.tags || []) {
        if (!tg.startsWith('user:')) continue;
        const label = tg.slice(5).trim().toLowerCase();
        if (!label) continue;
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    const onPhoto = new Set(userTags.map((k: string) => k.toLowerCase()));
    return Array.from(counts.entries())
      .filter(([k]) => !onPhoto.has(k))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([k]) => k);
  }, [imageList, userTags]);

  /** Expand "parent/child" or "parent > child" into path segments (LR hierarchical keywords). */
  const expandKeywordHierarchy = (raw: string): string[] => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^user:/, '')
      .replace(/\s*>\s*/g, '/')
      .replace(/\s*\|\s*/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');
    if (!cleaned) return [];
    const parts = cleaned.split('/').map((p) => p.trim()).filter(Boolean);
    const out: string[] = [];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      out.push(acc);
    }
    return out;
  };

  const handleAddKeyword = useCallback(
    async (preset?: string) => {
      const raw = (preset ?? tagInput).trim().toLowerCase();
      if (!raw || targetPaths.length === 0) return;
      // Hierarchical: travel/paris → user:travel + user:travel/paris
      const segments = expandKeywordHierarchy(raw);
      const tagsToAdd = (segments.length ? segments : [raw.replace(/^user:/, '')]).map(
        (s) => (s.startsWith('user:') ? s : `user:${s}`),
      );
      setTagBusy(true);
      try {
        for (const tag of tagsToAdd) {
          await invoke(Invokes.AddTagForPaths, { paths: targetPaths, tag });
        }
        setLibrary((state) => ({
          imageList: state.imageList.map((img) => {
            if (!targetPaths.includes(img.path)) return img;
            const tags = [...(img.tags || [])];
            for (const tag of tagsToAdd) {
              const bare = tag.replace(/^user:/, '');
              if (!tags.includes(tag) && !tags.includes(bare)) tags.push(tag);
            }
            return { ...img, tags };
          }),
        }));
        if (!preset) setTagInput('');
        if (primaryPath) {
          const m: any = await invoke(Invokes.LoadMetadata, { path: primaryPath }).catch(() => null);
          if (m) setMeta({ rating: m?.rating, tags: m?.tags, exif: m?.exif, is_edited: !!m?.adjustments });
        }
        if (segments.length > 1) {
          toast.success(
            t('library.rightPanel.hierarchicalKeywordAdded' as any, {
              defaultValue: 'Added hierarchical keyword ({{path}})',
              path: segments[segments.length - 1].replace(/\//g, ' › '),
            }),
          );
        }
      } catch (err) {
        toast.error(`Keyword failed: ${err}`);
      } finally {
        setTagBusy(false);
      }
    },
    [tagInput, targetPaths, setLibrary, primaryPath, t],
  );

  const handleRemoveKeyword = useCallback(
    async (label: string) => {
      if (targetPaths.length === 0) return;
      const tag = label.startsWith('user:') ? label : `user:${label}`;
      setTagBusy(true);
      try {
        await invoke(Invokes.RemoveTagForPaths, { paths: targetPaths, tag });
        // also try without prefix
        await invoke(Invokes.RemoveTagForPaths, { paths: targetPaths, tag: label }).catch(() => {});
        setLibrary((state) => ({
          imageList: state.imageList.map((img) => {
            if (!targetPaths.includes(img.path)) return img;
            const tags = (img.tags || []).filter(
              (t: string) => t !== tag && t !== label && t !== `user:${label}`,
            );
            return { ...img, tags: tags.length ? tags : null };
          }),
        }));
      } catch (err) {
        toast.error(`Remove keyword failed: ${err}`);
      } finally {
        setTagBusy(false);
      }
    },
    [targetPaths, setLibrary],
  );

  return (
    <div className="h-full flex flex-col bg-bg-secondary border-l border-border-color/40 min-w-0">
      <div className="h-8 px-2.5 flex items-center border-b border-border-color/30 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
          {t('library.rightPanel.title' as any, { defaultValue: 'Library' })}
        </span>
        {targetPaths.length > 1 && (
          <span className="ml-auto text-[10px] text-text-secondary/70 tabular-nums">
            {targetPaths.length} selected
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        <Section
          title={t('library.rightPanel.histogram' as any, { defaultValue: 'Histogram' })}
          open={openHist}
          onToggle={() => setOpenHist((v) => !v)}
          icon={SlidersHorizontal}
        >
          <MiniHistogram path={primaryPath} />
        </Section>

        <Section
          title={t('library.rightPanel.quickDevelop' as any, { defaultValue: 'Quick Develop' })}
          open={openQuick}
          onToggle={() => setOpenQuick((v) => !v)}
          icon={SlidersHorizontal}
        >
          <p className="text-[10px] leading-snug text-text-secondary/70 mb-1.5">
            {t('library.rightPanel.quickDevelopHint' as any, {
              defaultValue: 'Pré-édition : ces réglages s’appliquent par défaut à l’import.',
            })}
          </p>
          <div className="space-y-1.5">
            {QUICK_CONTROLS.map((c) => (
              <QuickSliderRow
                key={`${c.key}-${primaryPath || ''}`}
                control={c}
                label={t(`library.rightPanel.nudge.${c.key}` as any, { defaultValue: c.label })}
                value={Number(meta?.adjustments?.[c.key] ?? 0) || 0}
                disabled={targetPaths.length === 0}
                onCommit={(v) => applyValue(c.key, v)}
              />
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              disabled={busy || targetPaths.length === 0}
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-[10px] uppercase tracking-wide font-semibold bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary hover:bg-card-active disabled:opacity-40"
            >
              <RotateCcw size={12} />
              {t('library.rightPanel.reset' as any, { defaultValue: 'Reset' })}
            </button>
          </div>
        </Section>

        <Section
          title={t('library.rightPanel.keywording' as any, { defaultValue: 'Keywording' })}
          open={openKeywords}
          onToggle={() => setOpenKeywords((v) => !v)}
          icon={Tag}
        >
          <div className="flex gap-1">
            <input
              type="text"
              value={tagInput}
              disabled={tagBusy || targetPaths.length === 0}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddKeyword();
                }
              }}
              placeholder={t('library.rightPanel.keywordPlaceholder' as any, {
                defaultValue: 'Add keyword… (use travel/paris for hierarchy)',
              })}
              className="flex-1 h-7 px-2 rounded bg-surface border border-border-color/40 text-[11px] text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-white/30"
            />
            <button
              type="button"
              disabled={tagBusy || !tagInput.trim() || targetPaths.length === 0}
              onClick={() => handleAddKeyword()}
              className="h-7 px-2 rounded text-[10px] font-semibold uppercase bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary disabled:opacity-40"
            >
              +
            </button>
          </div>

          {keywordPaintTag && (
            <div className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-accent/15 border border-accent/30 text-[10px] text-text-primary">
              <Paintbrush size={11} className="shrink-0 text-accent" />
              <span className="truncate flex-1">
                {t('library.rightPanel.paintingKeyword' as any, {
                  defaultValue: 'Painting: {{kw}} — click thumbs to apply · Alt-click remove',
                  kw: keywordPaintTag.includes('/')
                    ? keywordPaintTag.split('/').join(' › ')
                    : keywordPaintTag,
                })}
              </span>
              <button
                type="button"
                className="px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold hover:bg-card-active"
                onClick={() => useLibraryStore.getState().setLibrary({ libraryPainter: null, keywordPaintTag: null })}
              >
                {t('library.rightPanel.stopPaint' as any, { defaultValue: 'Stop' })}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-1 min-h-[24px]">
            {userTags.length === 0 ? (
              <span className="text-[10px] text-text-secondary/50">
                {t('library.rightPanel.noKeywords' as any, { defaultValue: 'No keywords' })}
              </span>
            ) : (
              userTags.map((kw: string) => (
                <span
                  key={kw}
                  className={`inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded border text-[10px] ${
                    String(filterCriteria?.keyword || '').toLowerCase() === kw.toLowerCase()
                      ? 'bg-accent/25 border-accent/50 text-text-primary'
                      : 'bg-surface border-border-color/30 text-text-primary'
                  }`}
                >
                  <button
                    type="button"
                    disabled={tagBusy}
                    onClick={() => filterByKeyword(kw)}
                    className="hover:underline"
                    data-tooltip={t('library.rightPanel.filterKeywordTip' as any, {
                      defaultValue: 'Filter & select photos with this keyword',
                    })}
                  >
                    {kw.includes('/') ? kw.split('/').join(' › ') : kw}
                  </button>
                  <button
                    type="button"
                    disabled={tagBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur =
                        useLibraryStore.getState().libraryPainter?.kind === 'keyword'
                          ? String(useLibraryStore.getState().libraryPainter?.value || '')
                          : useLibraryStore.getState().keywordPaintTag;
                      const next = cur === kw ? null : kw;
                      useLibraryStore.getState().setLibrary({
                        libraryPainter: next ? { kind: 'keyword', value: next } : null,
                        keywordPaintTag: next,
                      });
                    }}
                    className={`p-0.5 rounded ${
                      (libraryPainter?.kind === 'keyword' && String(libraryPainter.value) === kw) || keywordPaintTag === kw
                        ? 'bg-accent/40 text-text-primary'
                        : 'hover:bg-card-active text-text-secondary'
                    }`}
                    data-tooltip={t('library.rightPanel.paintKeywordTip' as any, {
                      defaultValue: 'Keyword painter: click thumbnails to apply (Alt-click to remove)',
                    })}
                    aria-label={`Paint ${kw}`}
                  >
                    <Paintbrush size={10} />
                  </button>
                  <button
                    type="button"
                    disabled={tagBusy}
                    onClick={() => handleRemoveKeyword(kw)}
                    className="p-0.5 rounded hover:bg-card-active text-text-secondary"
                    aria-label={`Remove ${kw}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))
            )}
          </div>
          {suggestedKeywords.length > 0 && targetPaths.length > 0 && (
            <div className="mt-2">
              <div className="text-[9px] uppercase tracking-wider text-text-secondary/50 mb-1">
                {t('library.rightPanel.keywordSuggestions' as any, {
                  defaultValue: 'Keyword Set',
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {suggestedKeywords.map((kw: string) => (
                  <button
                    key={`sug-${kw}`}
                    type="button"
                    disabled={tagBusy}
                    onClick={() => handleAddKeyword(kw)}
                    className="px-1.5 py-0.5 rounded text-[10px] text-text-secondary border border-dashed border-border-color/40 hover:border-white/30 hover:text-text-primary hover:bg-surface/80 disabled:opacity-40"
                    data-tooltip={t('library.rightPanel.addSuggestedKeyword' as any, {
                      defaultValue: 'Add to selected',
                    })}
                  >
                    + {kw.includes('/') ? kw.split('/').join(' › ') : kw}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Section>

        <div className="px-2.5 pb-2">
          <LibraryImportBar />
        </div>

        <Section
          title={t('library.rightPanel.applyDuringImport' as any, {
            defaultValue: 'Appliquer pendant l’importation',
          })}
          open={openMeta}
          onToggle={() => setOpenMeta((v) => !v)}
          icon={Info}
        >
          <LibraryImportApply />
        </Section>
      </div>
    </div>
  );
}
