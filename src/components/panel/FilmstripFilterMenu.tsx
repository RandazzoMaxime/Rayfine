import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export type FilmstripFilterScope =
  | 'all'
  | 'selected'
  | 'picks'
  | 'rejects'
  | 'edited'
  | 'unflagged'
  | 'rated'
  | 'unrated'
  | 'location';

export interface FilmstripFilterPreset {
  id: string;
  name: string;
  scope: FilmstripFilterScope;
  builtin?: boolean;
}

const STORAGE_KEY = 'rustroom.filmstripFilter.v1';

export const BUILTIN_FILTER_PRESETS: FilmstripFilterPreset[] = [
  { id: 'location-columns', name: 'locationColumns', scope: 'location', builtin: true },
  { id: 'default-columns', name: 'defaultColumns', scope: 'all', builtin: true },
  { id: 'filters-off', name: 'filtersOff', scope: 'all', builtin: true },
  { id: 'exposure-info', name: 'exposureInfo', scope: 'all', builtin: true },
  { id: 'camera-info', name: 'cameraInfo', scope: 'all', builtin: true },
  { id: 'flagged', name: 'flagged', scope: 'picks', builtin: true },
  { id: 'rated', name: 'rated', scope: 'rated', builtin: true },
  { id: 'unrated', name: 'unrated', scope: 'unrated', builtin: true },
];

interface StoredFilterState {
  activeId: string;
  custom: FilmstripFilterPreset[];
  hiddenIds: string[];
  renamed: Record<string, string>;
}

function loadStored(): StoredFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { activeId: 'filters-off', custom: [], hiddenIds: [], renamed: {} };
    const p = JSON.parse(raw);
    return {
      activeId: typeof p.activeId === 'string' ? p.activeId : 'filters-off',
      custom: Array.isArray(p.custom) ? p.custom : [],
      hiddenIds: Array.isArray(p.hiddenIds) ? p.hiddenIds : [],
      renamed: p.renamed && typeof p.renamed === 'object' ? p.renamed : {},
    };
  } catch {
    return { activeId: 'filters-off', custom: [], hiddenIds: [], renamed: {} };
  }
}

function saveStored(state: StoredFilterState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export default function FilmstripFilterMenu({
  scope,
  onScopeChange,
}: {
  scope: FilmstripFilterScope;
  onScopeChange: (scope: FilmstripFilterScope, presetId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<StoredFilterState>(loadStored);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveStored(stored);
  }, [stored]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const labelOf = (preset: FilmstripFilterPreset) => {
    if (stored.renamed[preset.id]) return stored.renamed[preset.id];
    if (preset.builtin) {
      return t(`ui.bottomBar.filterPresets.${preset.name}` as any, { defaultValue: preset.name });
    }
    return preset.name;
  };

  const visibleBuiltins = useMemo(
    () => BUILTIN_FILTER_PRESETS.filter((p) => !stored.hiddenIds.includes(p.id)),
    [stored.hiddenIds],
  );

  const allPresets = useMemo(
    () => [...visibleBuiltins, ...stored.custom],
    [visibleBuiltins, stored.custom],
  );

  const active =
    allPresets.find((p) => p.id === stored.activeId) ||
    visibleBuiltins.find((p) => p.id === 'filters-off') ||
    visibleBuiltins[0];

  const applyPreset = (preset: FilmstripFilterPreset) => {
    setStored((s) => ({ ...s, activeId: preset.id }));
    onScopeChange(preset.scope, preset.id);
    setOpen(false);
  };

  const saveCurrent = () => {
    const name = window.prompt(
      t('ui.bottomBar.filterPresets.savePrompt' as any, {
        defaultValue: 'Name this filter preset',
      }) || '',
      t('ui.bottomBar.filterPresets.saveDefault' as any, { defaultValue: 'My filter' }) || '',
    );
    if (!name?.trim()) return;
    const preset: FilmstripFilterPreset = {
      id: `ff_${Date.now().toString(36)}`,
      name: name.trim(),
      scope,
    };
    setStored((s) => ({
      ...s,
      custom: [...s.custom, preset].slice(-20),
      activeId: preset.id,
    }));
  };

  const restoreDefaults = () => {
    setStored({ activeId: 'filters-off', custom: [], hiddenIds: [], renamed: {} });
    onScopeChange('all', 'filters-off');
    setOpen(false);
  };

  const deleteCurrent = () => {
    if (!active) return;
    if (active.builtin) {
      setStored((s) => ({
        ...s,
        hiddenIds: [...s.hiddenIds, active.id],
        activeId: 'filters-off',
      }));
      onScopeChange('all', 'filters-off');
    } else {
      setStored((s) => ({
        ...s,
        custom: s.custom.filter((p) => p.id !== active.id),
        activeId: 'filters-off',
      }));
      onScopeChange('all', 'filters-off');
    }
    setOpen(false);
  };

  const renameCurrent = () => {
    if (!active) return;
    const next = window.prompt(
      t('ui.bottomBar.filterPresets.renamePrompt' as any, {
        defaultValue: 'Rename filter preset',
      }) || '',
      labelOf(active),
    );
    if (!next?.trim()) return;
    if (active.builtin) {
      setStored((s) => ({ ...s, renamed: { ...s.renamed, [active.id]: next.trim() } }));
    } else {
      setStored((s) => ({
        ...s,
        custom: s.custom.map((p) => (p.id === active.id ? { ...p, name: next.trim() } : p)),
      }));
    }
  };

  const itemClass = 'w-full text-left px-3 py-1 text-[12px] text-text-primary hover:bg-card-active whitespace-nowrap';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="h-5 px-1.5 flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary border border-border-color/50 bg-bg-primary/50 rounded-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t('ui.bottomBar.filterLabel' as any, { defaultValue: 'Filter:' })}</span>
        <span className="text-text-primary">{active ? labelOf(active) : ''}</span>
        <span className="text-[9px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-0.5 min-w-[22rem] py-1 rounded-sm bg-bg-secondary border border-border-color/60 shadow-xl z-50">
          {visibleBuiltins.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={clsx(itemClass, 'flex items-center gap-2')}
              onClick={() => applyPreset(preset)}
            >
              <span className="w-3 shrink-0">
                {stored.activeId === preset.id ? <Check size={12} /> : null}
              </span>
              {labelOf(preset)}
            </button>
          ))}
          {stored.custom.length > 0 && (
            <>
              <div className="my-1 h-px bg-border-color/50" />
              {stored.custom.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={clsx(itemClass, 'flex items-center gap-2')}
                  onClick={() => applyPreset(preset)}
                >
                  <span className="w-3 shrink-0">
                    {stored.activeId === preset.id ? <Check size={12} /> : null}
                  </span>
                  {labelOf(preset)}
                </button>
              ))}
            </>
          )}
          <div className="my-1 h-px bg-border-color/50" />
          <button type="button" className={itemClass} onClick={saveCurrent}>
            {t('ui.bottomBar.filterPresets.save' as any, {
              defaultValue: 'Save current settings as a new preset…',
            })}
          </button>
          <button type="button" className={itemClass} onClick={restoreDefaults}>
            {t('ui.bottomBar.filterPresets.restore' as any, {
              defaultValue: 'Restore default presets',
            })}
          </button>
          <button type="button" className={itemClass} onClick={deleteCurrent} disabled={!active}>
            {t('ui.bottomBar.filterPresets.delete' as any, {
              defaultValue: 'Delete preset "{{name}}"...',
              name: active ? labelOf(active) : '',
            })}
          </button>
          <button type="button" className={itemClass} onClick={renameCurrent} disabled={!active}>
            {t('ui.bottomBar.filterPresets.rename' as any, {
              defaultValue: 'Rename preset "{{name}}"...',
              name: active ? labelOf(active) : '',
            })}
          </button>
        </div>
      )}
    </div>
  );
}
