import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { FileUp, ImageOff, Loader2, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';
import { usePresetStore, pickAndParseLegacyPresets } from '../../store/usePresetStore';
import { Invokes, Preset } from '../ui/AppProperties';
import { BUILTIN_PRESETS } from '../../utils/builtinPresets';
import { DEFAULT_PRESET_GROUP, addPresetsToGroup, ensureGroup, flattenPresets, getGroups } from '../../utils/presetTree';

type Source = 'builtin' | 'community' | 'imported';

interface BrowserItem {
  key: string;
  source: Source;
  preset: Preset;
  /** Category / Lightroom group / creator shown under the name; also used by "Group from source". */
  subtitle: string | null;
  sourceGroup: string;
}

interface CommunityPreset {
  name: string;
  creator: string;
  adjustments: Record<string, any>;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
}

// Session cache: the community manifest is fetched once per app run.
let communityCache: CommunityPreset[] | null = null;
let communityPromise: Promise<CommunityPreset[]> | null = null;
function fetchCommunity(): Promise<CommunityPreset[]> {
  if (communityCache) return Promise.resolve(communityCache);
  if (!communityPromise) {
    communityPromise = invoke<CommunityPreset[]>(Invokes.FetchCommunityPresets)
      .then((list) => {
        communityCache = Array.isArray(list) ? list : [];
        return communityCache;
      })
      .finally(() => {
        communityPromise = null;
      });
  }
  return communityPromise;
}

const TARGET_DEFAULT = '__default__';
const TARGET_SOURCE = '__source__';
const TARGET_NEW = '__new__';

/** Preset Browser: grid of presets (built-in, community, imported Lightroom) not yet in the user's list. */
export default function PresetBrowserModal() {
  const isOpen = useUIStore((s) => s.isPresetBrowserOpen);
  if (!isOpen) return null;
  return <PresetBrowserContent />;
}

function PresetBrowserContent() {
  const { t } = useTranslation();
  const setUI = useUIStore((s) => s.setUI);
  const close = useCallback(() => setUI({ isPresetBrowserOpen: false }), [setUI]);

  const selectedImage = useEditorStore((s) => s.selectedImage);
  const presets = usePresetStore((s) => s.presets);
  const loaded = usePresetStore((s) => s.loaded);
  const stagedImports = usePresetStore((s) => s.stagedImports);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | Source>('all');
  const [target, setTarget] = useState<string>(TARGET_DEFAULT);
  const [newGroupName, setNewGroupName] = useState('');
  const [community, setCommunity] = useState<CommunityPreset[] | null>(communityCache);
  const [communityState, setCommunityState] = useState<'idle' | 'loading' | 'error'>(
    communityCache ? 'idle' : 'loading',
  );
  const [previews, setPreviews] = useState<Record<string, string>>({});

  // -------------------------------------------------------------- lifecycle
  useEffect(() => {
    if (!loaded) usePresetStore.getState().load();
  }, [loaded]);

  useEffect(() => {
    if (communityCache) return;
    let alive = true;
    fetchCommunity()
      .then((list) => {
        if (!alive) return;
        setCommunity(list);
        setCommunityState('idle');
      })
      .catch((err) => {
        console.error('Failed to fetch community presets:', err);
        if (alive) setCommunityState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  // Esc closes even when focus left the dialog (global shortcut handler → customEscapeHandler)
  useEffect(() => {
    const { customEscapeHandler: previous, setCustomEscapeHandler } = useUIStore.getState();
    setCustomEscapeHandler(close);
    return () => setCustomEscapeHandler(previous);
  }, [close]);

  // -------------------------------------------------------------- items
  const ownedNames = useMemo(
    () => new Set(flattenPresets(presets).map((p) => p.preset.name.trim().toLowerCase())),
    [presets],
  );

  const allItems: BrowserItem[] = useMemo(() => {
    const items: BrowserItem[] = [];
    for (const p of BUILTIN_PRESETS) {
      items.push({ key: p.id, source: 'builtin', preset: p, subtitle: p.group || null, sourceGroup: p.group || 'Built-in' });
    }
    for (const c of community || []) {
      items.push({
        key: `community:${c.name}`,
        source: 'community',
        preset: {
          id: `community:${c.name}`,
          name: c.name,
          adjustments: c.adjustments || {},
          includeMasks: c.includeMasks,
          includeCropTransform: c.includeCropTransform,
          presetType: c.presetType || 'style',
        },
        subtitle: c.creator ? `by ${c.creator}` : null,
        sourceGroup: 'Community',
      });
    }
    for (const p of stagedImports) {
      items.push({
        key: p.id,
        source: 'imported',
        preset: p,
        subtitle: p.group || null,
        sourceGroup: p.group || 'Imported',
      });
    }
    return items.filter((i) => !ownedNames.has(i.preset.name.trim().toLowerCase()));
  }, [community, stagedImports, ownedNames]);

  const counts = useMemo(() => {
    const c = { all: allItems.length, builtin: 0, community: 0, imported: 0 };
    for (const i of allItems) c[i.source]++;
    return c;
  }, [allItems]);

  const q = query.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      allItems.filter(
        (i) =>
          (sourceFilter === 'all' || i.source === sourceFilter) &&
          (!q || i.preset.name.toLowerCase().includes(q) || (i.subtitle || '').toLowerCase().includes(q)),
      ),
    [allItems, sourceFilter, q],
  );

  // -------------------------------------------------------------- lazy, sequential previews
  const itemsRef = useRef(new Map<string, BrowserItem>());
  itemsRef.current = new Map(allItems.map((i) => [i.key, i]));
  const urls = useRef(new Map<string, string>());
  const visible = useRef(new Set<string>());
  const running = useRef(false);
  const cancelled = useRef(false);
  const baseAdjustments = useRef<any>(useEditorStore.getState().adjustments);
  const imagePath = selectedImage?.path ?? null;
  const imageReady = !!selectedImage?.isReady;

  const revokeAll = useCallback(() => {
    urls.current.forEach((u) => u && URL.revokeObjectURL(u));
    urls.current.clear();
    setPreviews({});
  }, []);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      urls.current.forEach((u) => u && URL.revokeObjectURL(u));
      urls.current.clear();
    };
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const pathAtStart = useEditorStore.getState().selectedImage?.path;
    const pathChanged = () => useEditorStore.getState().selectedImage?.path !== pathAtStart;
    let restart = false;
    try {
      while (!cancelled.current) {
        const st = useEditorStore.getState();
        if (!st.selectedImage?.isReady) break;
        if (pathChanged()) {
          restart = true;
          break;
        }
        const key = Array.from(visible.current).find((k) => !urls.current.has(k) && itemsRef.current.has(k));
        if (!key) break;
        const item = itemsRef.current.get(key)!;
        try {
          const bytes: ArrayBuffer | number[] = await invoke(Invokes.GeneratePresetPreview, {
            jsAdjustments: { ...baseAdjustments.current, ...item.preset.adjustments },
          });
          if (cancelled.current) break;
          if (pathChanged()) {
            restart = true;
            break;
          }
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes as any)], { type: 'image/jpeg' }));
          urls.current.set(key, url);
          setPreviews((prev) => ({ ...prev, [key]: url }));
        } catch (err) {
          console.error(`Preset preview failed for ${item.preset.name}:`, err);
          urls.current.set(key, '');
          setPreviews((prev) => ({ ...prev, [key]: '' }));
        }
      }
    } finally {
      running.current = false;
    }
    // The photo changed mid-run: start over for the new image (the reset effect already cleared the cache).
    if (restart && !cancelled.current) setTimeout(() => pumpRef.current(), 0);
  }, []);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // New image (or image became ready) → drop cached previews and render again
  useEffect(() => {
    baseAdjustments.current = useEditorStore.getState().adjustments;
    revokeAll();
    if (imageReady) pump();
  }, [imagePath, imageReady, revokeAll, pump]);

  const onTileVisibility = useCallback(
    (key: string, isVisible: boolean) => {
      if (isVisible) visible.current.add(key);
      else visible.current.delete(key);
      if (isVisible) pump();
    },
    [pump],
  );

  // -------------------------------------------------------------- actions
  const groups = useMemo(() => getGroups(presets), [presets]);

  const addItem = (item: BrowserItem) => {
    let tree = usePresetStore.getState().presets;
    let groupId: string;
    if (target === TARGET_NEW) {
      if (!newGroupName.trim()) {
        toast.info(t('ui.presetBrowser.enterGroupName' as any, { defaultValue: 'Enter a name for the new group' }));
        return;
      }
      [tree, groupId] = ensureGroup(tree, newGroupName);
    } else if (target === TARGET_SOURCE) {
      [tree, groupId] = ensureGroup(tree, item.sourceGroup);
    } else if (target !== TARGET_DEFAULT && tree.some((i) => i.folder?.id === target)) {
      groupId = target;
    } else {
      [tree, groupId] = ensureGroup(tree, DEFAULT_PRESET_GROUP);
    }
    usePresetStore.getState().commit(addPresetsToGroup(tree, groupId, [item.preset]));
    if (item.source === 'imported') {
      usePresetStore.getState().setStagedImports((prev) => prev.filter((p) => p.id !== item.preset.id));
    }
    const groupName = tree.find((i) => i.folder?.id === groupId)?.folder?.name ?? DEFAULT_PRESET_GROUP;
    toast.success(
      t('ui.presetBrowser.added' as any, {
        defaultValue: '“{{name}}” added to {{group}}',
        name: item.preset.name,
        group: groupName,
      }),
    );
  };

  const importLightroom = async () => {
    try {
      const res = await pickAndParseLegacyPresets(
        t('ui.developLeft.importLrTitle' as any, { defaultValue: 'Import Lightroom presets' }),
      );
      if (!res) return;
      const staged = res.presets.map((p) => ({ ...p, id: `import:${crypto.randomUUID()}` }));
      usePresetStore.getState().setStagedImports((prev) => [...prev, ...staged]);
      setSourceFilter('imported');
      if (staged.length > 0)
        toast.success(
          t('ui.presetBrowser.importedStaged' as any, {
            defaultValue: '{{count}} Lightroom presets ready to add',
            count: staged.length,
          }),
        );
      if (res.errors.length > 0) {
        console.warn('Preset import errors:', res.errors);
        toast.warn(
          t('ui.developLeft.importErrors' as any, {
            defaultValue: '{{count}} files could not be imported',
            count: res.errors.length,
          }),
        );
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  // -------------------------------------------------------------- render
  const tabs: Array<{ id: 'all' | Source; label: string }> = [
    { id: 'all', label: t('ui.presetBrowser.all' as any, { defaultValue: 'All' }) },
    { id: 'builtin', label: t('ui.presetBrowser.builtin' as any, { defaultValue: 'Built-in' }) },
    { id: 'community', label: t('ui.presetBrowser.community' as any, { defaultValue: 'Community' }) },
    { id: 'imported', label: t('ui.presetBrowser.imported' as any, { defaultValue: 'Imported' }) },
  ];

  return (
    <div
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          close();
        }
      }}
    >
      <div
        className="bg-bg-secondary border border-border-color/40 rounded-lg shadow-2xl flex flex-col w-[min(1100px,94vw)] h-[min(820px,88vh)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border-color/40 shrink-0">
          <span className="text-sm font-semibold text-text-primary">
            {t('ui.developLeft.presetBrowser' as any, { defaultValue: 'Preset Browser' })}
          </span>
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ui.developLeft.searchPresets' as any, { defaultValue: 'Search presets…' })}
              className="w-full h-7 pl-7 pr-2 rounded bg-bg-primary border border-border-color/40 text-[12px] text-text-primary placeholder:text-text-secondary/60 outline-none focus:border-white/25"
            />
          </div>
          <button
            type="button"
            onClick={importLightroom}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded bg-surface hover:bg-card-active text-[12px] text-text-primary"
          >
            <FileUp size={13} />
            {t('ui.presetBrowser.importLr' as any, { defaultValue: 'Import Lightroom presets…' })}
          </button>
          <button
            type="button"
            onClick={close}
            className="ml-auto p-1.5 rounded hover:bg-card-active text-text-secondary hover:text-text-primary"
            data-tooltip={t('ui.presetBrowser.close' as any, { defaultValue: 'Close (Esc)' })}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-color/30 shrink-0 flex-wrap">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSourceFilter(tab.id)}
                className={clsx(
                  'px-2.5 h-6 rounded text-[11px]',
                  sourceFilter === tab.id
                    ? 'bg-card-active text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface',
                )}
              >
                {tab.label} <span className="opacity-50 tabular-nums">{counts[tab.id]}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-text-secondary">
            <span>{t('ui.presetBrowser.addTo' as any, { defaultValue: 'Add to' })}</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-6 max-w-[220px] bg-bg-primary text-text-primary border border-border-color/40 rounded px-1.5 text-[11px]"
            >
              <option value={TARGET_DEFAULT}>{DEFAULT_PRESET_GROUP}</option>
              {groups
                .filter((g) => g.name !== DEFAULT_PRESET_GROUP)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              <option value={TARGET_SOURCE}>
                {t('ui.presetBrowser.groupFromSource' as any, { defaultValue: 'Group from source (LR group / category)' })}
              </option>
              <option value={TARGET_NEW}>{t('ui.developLeft.newGroupOption' as any, { defaultValue: 'New group…' })}</option>
            </select>
            {target === TARGET_NEW && (
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder={t('ui.developLeft.groupName' as any, { defaultValue: 'Group name' })}
                className="h-6 w-36 bg-bg-primary text-text-primary border border-border-color/40 rounded px-1.5 text-[11px] outline-none focus:border-white/25"
              />
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
          {!selectedImage && (
            <div className="mb-3 text-[11px] text-text-secondary">
              {t('ui.presetBrowser.noImage' as any, { defaultValue: 'Open a photo in Develop to see previews.' })}
            </div>
          )}
          {(sourceFilter === 'all' || sourceFilter === 'community') && communityState !== 'idle' && (
            <div className="mb-3 text-[11px] text-text-secondary flex items-center gap-1.5">
              {communityState === 'loading' ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  {t('ui.presetBrowser.loadingCommunity' as any, { defaultValue: 'Loading community presets…' })}
                </>
              ) : (
                t('ui.presetBrowser.communityError' as any, {
                  defaultValue: 'Community presets are unavailable (offline?).',
                })
              )}
            </div>
          )}
          {visibleItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[12px] text-text-secondary gap-2">
              <p>
                {sourceFilter === 'imported' && !q
                  ? t('ui.presetBrowser.emptyImported' as any, {
                      defaultValue: 'Import Lightroom .xmp / .lrtemplate presets to preview them here.',
                    })
                  : t('ui.presetBrowser.empty' as any, { defaultValue: 'No presets to show.' })}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
              {visibleItems.map((item) => (
                <PresetTile
                  key={item.key}
                  item={item}
                  previewUrl={previews[item.key]}
                  canPreview={!!selectedImage?.isReady}
                  onVisibility={onTileVisibility}
                  onAdd={() => addItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PresetTile({
  item,
  previewUrl,
  canPreview,
  onVisibility,
  onAdd,
}: {
  item: BrowserItem;
  previewUrl: string | undefined;
  canPreview: boolean;
  onVisibility(key: string, visible: boolean): void;
  onAdd(): void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => onVisibility(item.key, entries[0]?.isIntersecting ?? false), {
      rootMargin: '150px',
    });
    io.observe(el);
    return () => {
      io.disconnect();
      onVisibility(item.key, false);
    };
  }, [item.key, onVisibility]);

  const sourceLabel =
    item.source === 'builtin'
      ? t('ui.presetBrowser.builtin' as any, { defaultValue: 'Built-in' })
      : item.source === 'community'
        ? t('ui.presetBrowser.community' as any, { defaultValue: 'Community' })
        : t('ui.presetBrowser.imported' as any, { defaultValue: 'Imported' });

  return (
    <div ref={ref} className="group flex flex-col rounded-md overflow-hidden bg-surface border border-border-color/30">
      <div className="relative aspect-[3/2] bg-bg-primary flex items-center justify-center">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : previewUrl === '' || !canPreview ? (
          <ImageOff size={18} className="text-text-secondary/50" />
        ) : (
          <Loader2 size={18} className="animate-spin text-text-secondary/60" />
        )}
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/55 text-[9px] uppercase tracking-wide text-white/85">
          {sourceLabel}
        </span>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-text-primary truncate" title={item.preset.name}>
            {item.preset.name}
          </div>
          {item.subtitle && <div className="text-[10px] text-text-secondary truncate">{item.subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 flex items-center gap-1 h-6 px-2 rounded bg-accent text-button-text text-[11px] font-medium hover:bg-accent-hover"
          data-tooltip={t('ui.presetBrowser.addTooltip' as any, { defaultValue: 'Add to your presets' })}
        >
          <Plus size={12} />
          {t('ui.presetBrowser.add' as any, { defaultValue: 'Add' })}
        </button>
      </div>
    </div>
  );
}
