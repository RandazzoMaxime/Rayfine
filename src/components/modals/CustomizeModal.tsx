import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { FolderOpen, RotateCcw, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { Invokes, Theme } from '../ui/AppProperties';
import RayfineLogo from '../ui/RayfineLogo';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  AppearanceId,
  AppearanceState,
  ColorSeeds,
  DEFAULT_SEEDS,
  applyAppearance,
  defaultAppearanceState,
  loadAppearance,
  normalizeHex,
  saveAppearance,
} from '../../utils/appearance';

interface CustomizeModalProps {
  isOpen: boolean;
  onClose(): void;
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(hex: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex) onChange(hex);
    else setDraft(value);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-text-secondary">{label}</span>
      <label className="relative w-9 h-9 shrink-0 rounded-md overflow-hidden border border-border-color/70 cursor-pointer shadow-inner">
        <span className="absolute inset-0" style={{ backgroundColor: value }} />
        <input
          type="color"
          className="absolute inset-[-20%] w-[140%] h-[140%] cursor-pointer opacity-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <input
        type="text"
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="h-9 flex-1 min-w-0 px-2 rounded-md bg-bg-primary border border-border-color/50 text-[12px] font-mono text-text-primary outline-none focus:border-accent/60"
      />
    </div>
  );
}

function AppearanceTile({
  id,
  label,
  active,
  seeds,
  onSelect,
}: {
  id: AppearanceId;
  label: string;
  active: boolean;
  seeds: ColorSeeds;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'flex-1 rounded-lg border p-2 text-left transition-colors',
        active ? 'border-accent bg-card-active' : 'border-border-color/50 hover:border-border-color hover:bg-card-active/40',
      )}
    >
      <div
        className="h-16 rounded-md overflow-hidden border border-black/20 mb-2 flex items-center justify-center"
        style={{ backgroundColor: seeds.canvas }}
      >
        <RayfineLogo variant={id} className="h-14 w-14 rounded-sm" />
      </div>
      <div className="text-[12px] font-medium text-text-primary">{label}</div>
    </button>
  );
}

type CatalogLoc = { directory: string; file: string; isDefault: boolean };

export default function CustomizeModal({ isOpen, onClose }: CustomizeModalProps) {
  const { t } = useTranslation();
  const handleSettingsChange = useSettingsStore((s) => s.handleSettingsChange);
  const setAppSettings = useSettingsStore((s) => s.setAppSettings);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const [state, setState] = useState<AppearanceState>(() => loadAppearance() || defaultAppearanceState());
  const [catalog, setCatalog] = useState<CatalogLoc | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setState(loadAppearance() || defaultAppearanceState());
    invoke<CatalogLoc>(Invokes.GetCatalogLocation)
      .then(setCatalog)
      .catch(() => setCatalog(null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const applyCatalogLoc = (loc: CatalogLoc) => {
    setCatalog(loc);
    if (appSettings) {
      setAppSettings({
        ...appSettings,
        dataDir: loc.isDefault ? null : loc.directory,
        catalogDir: loc.isDefault ? null : loc.directory,
      });
    }
  };

  const chooseCatalogDir = async () => {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: catalog?.directory,
      title: t('ui.customize.catalogPick' as any, { defaultValue: 'Dossier du catalogue' }),
    });
    if (!dir || typeof dir !== 'string') return;
    setCatalogBusy(true);
    try {
      const loc = await invoke<CatalogLoc>(Invokes.SetCatalogLocation, { directory: dir });
      applyCatalogLoc(loc);
      toast.success(
        t('ui.customize.catalogMoved' as any, {
          defaultValue: 'Catalogue déplacé',
        }),
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setCatalogBusy(false);
    }
  };

  const resetCatalogDir = async () => {
    setCatalogBusy(true);
    try {
      const loc = await invoke<CatalogLoc>(Invokes.SetCatalogLocation, { directory: '' });
      applyCatalogLoc(loc);
      toast.success(
        t('ui.customize.catalogReset' as any, { defaultValue: 'Emplacement par défaut rétabli' }),
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setCatalogBusy(false);
    }
  };

  const push = (next: AppearanceState) => {
    setState(next);
    saveAppearance(next);
    applyAppearance(next);
    const theme = next.appearance === 'light' ? Theme.Light : Theme.Dark;
    if (appSettings && appSettings.theme !== theme) {
      handleSettingsChange({ ...appSettings, theme });
    }
  };

  const seeds = state.seeds[state.appearance];

  const setSeed = (key: keyof ColorSeeds, hex: string) => {
    push({
      ...state,
      seeds: {
        ...state.seeds,
        [state.appearance]: { ...seeds, [key]: hex },
      },
    });
  };

  const resetCurrent = () => {
    push({
      ...state,
      seeds: {
        ...state.seeds,
        [state.appearance]: { ...DEFAULT_SEEDS[state.appearance] },
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border-color/50 bg-bg-secondary shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-11 px-4 flex items-center justify-between border-b border-border-color/40">
          <span className="text-[14px] font-medium text-text-primary">
            {t('ui.customize.title' as any, { defaultValue: 'Paramètres' })}
          </span>
          <button
            type="button"
            className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-card-active"
            onClick={onClose}
            aria-label={t('modals.confirm.cancel' as any, { defaultValue: 'Fermer' })}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5 max-h-[min(36rem,calc(100vh-4rem))] overflow-y-auto custom-scrollbar">
          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
              {t('ui.customize.dataFolder' as any, { defaultValue: 'Dossier de données' })}
            </h2>
            <p className="text-[12px] text-text-secondary mb-2">
              {t('ui.customize.dataFolderHint' as any, {
                defaultValue:
                  'Catalogue, filigranes importés et réglages utilisateur. Un changement déplace les fichiers existants et met à jour le lien.',
              })}
            </p>
            <div className="rounded-md border border-border-color/50 bg-bg-primary px-2.5 py-2 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-0.5">
                {catalog?.isDefault
                  ? t('ui.customize.catalogDefault' as any, { defaultValue: 'Emplacement par défaut' })
                  : t('ui.customize.catalogCustom' as any, { defaultValue: 'Emplacement personnalisé' })}
              </div>
              <div className="text-[11px] font-mono text-text-primary break-all leading-snug" title={catalog?.file}>
                {catalog?.directory || '…'}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={catalogBusy}
                onClick={() => void chooseCatalogDir()}
                className="h-8 px-3 rounded-md text-[12px] text-text-primary border border-border-color/50 hover:bg-card-active disabled:opacity-40 flex items-center gap-1.5"
              >
                <FolderOpen size={14} />
                {t('ui.customize.catalogChoose' as any, { defaultValue: 'Choisir un dossier…' })}
              </button>
              {catalog && !catalog.isDefault && (
                <button
                  type="button"
                  disabled={catalogBusy}
                  onClick={() => void resetCatalogDir()}
                  className="h-8 px-3 rounded-md text-[12px] text-text-secondary border border-border-color/50 hover:bg-card-active disabled:opacity-40 flex items-center gap-1.5"
                >
                  <RotateCcw size={13} />
                  {t('ui.customize.catalogUseDefault' as any, { defaultValue: 'Par défaut' })}
                </button>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
              {t('ui.customize.section' as any, { defaultValue: 'Personnaliser' })}
            </h2>
            <p className="text-[12px] text-text-secondary mb-3">
              {t('ui.customize.hint' as any, {
                defaultValue: 'Deux thèmes de base. Les couleurs s’appliquent en direct.',
              })}
            </p>
            <div className="flex gap-2">
              <AppearanceTile
                id="dark"
                label={t('ui.customize.dark' as any, { defaultValue: 'Sombre' })}
                active={state.appearance === 'dark'}
                seeds={state.seeds.dark}
                onSelect={() => push({ ...state, appearance: 'dark' })}
              />
              <AppearanceTile
                id="light"
                label={t('ui.customize.light' as any, { defaultValue: 'Clair' })}
                active={state.appearance === 'light'}
                seeds={state.seeds.light}
                onSelect={() => push({ ...state, appearance: 'light' })}
              />
            </div>
          </section>

          <section className="space-y-2.5">
            <ColorRow
              label={t('ui.customize.canvas' as any, { defaultValue: 'Fond' })}
              value={seeds.canvas}
              onChange={(hex) => setSeed('canvas', hex)}
            />
            <ColorRow
              label={t('ui.customize.text' as any, { defaultValue: 'Texte' })}
              value={seeds.text}
              onChange={(hex) => setSeed('text', hex)}
            />
            <ColorRow
              label={t('ui.customize.accent' as any, { defaultValue: 'Accent' })}
              value={seeds.accent}
              onChange={(hex) => setSeed('accent', hex)}
            />
            <div className="pt-1">
              <button
                type="button"
                className="h-8 px-3 rounded-md text-[12px] text-text-secondary hover:text-text-primary border border-border-color/50 hover:bg-card-active"
                onClick={resetCurrent}
              >
                {t('ui.customize.reset' as any, { defaultValue: 'Réinitialiser ce thème' })}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
