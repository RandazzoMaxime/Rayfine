import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

import { useLibraryStore } from '../../../store/useLibraryStore';
import {
  METADATA_PRESET_FIELDS,
  MetadataPreset,
  loadMetadataPresets,
  nonemptyFields,
  saveMetadataPresets,
} from '../../../utils/metadataPresets';

function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  return ref;
}

function MenuSelect({
  label,
  valueLabel,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  valueLabel: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useClickOutside(open, onClose);
  return (
    <div className="flex items-center gap-2 min-h-7">
      <span className="w-[7.5rem] shrink-0 text-[11px] text-text-secondary text-right truncate">{label}</span>
      <div className="relative flex-1 min-w-0" ref={ref}>
        <button
          type="button"
          onClick={onToggle}
          className="w-full h-7 px-1.5 flex items-center justify-between gap-1 rounded bg-surface border border-border-color/40 text-[11px] text-text-primary"
        >
          <span className="truncate">{valueLabel}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        </button>
        {open && (
          <div className="absolute z-40 left-0 right-0 top-full mt-0.5 py-0.5 rounded bg-surface border border-border-color/50 shadow-xl max-h-56 overflow-y-auto custom-scrollbar">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[11px] text-text-primary hover:bg-card-active"
    >
      <span className="w-3.5 shrink-0">{active ? <Check size={11} /> : null}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

/** LR-style "Apply During Import": metadata preset + keywords. */
export default function LibraryImportApply() {
  const { t } = useTranslation();
  const metadataId = useLibraryStore((s) => s.importApplyMetadataPresetId);
  const keywords = useLibraryStore((s) => s.importApplyKeywords);
  const setLibrary = useLibraryStore((s) => s.setLibrary);

  const [metaPresets, setMetaPresets] = useState<MetadataPreset[]>(() =>
    typeof window !== 'undefined' ? loadMetadataPresets() : [],
  );
  const [openMeta, setOpenMeta] = useState(false);
  const [editor, setEditor] = useState<MetadataPreset | null>(null);
  const [manager, setManager] = useState(false);

  const persistMeta = (next: MetadataPreset[]) => {
    setMetaPresets(next);
    saveMetadataPresets(next);
  };

  const metadataLabel =
    metaPresets.find((p) => p.id === metadataId)?.name ||
    t('library.rightPanel.applyNone' as any, { defaultValue: 'Aucun' });

  const saveEditor = () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      toast.info(t('library.rightPanel.presetNeedName' as any, { defaultValue: 'Donnez un nom au préréglage.' }));
      return;
    }
    const nextPreset: MetadataPreset = { ...editor, name, fields: nonemptyFields(editor.fields) };
    const exists = metaPresets.some((p) => p.id === nextPreset.id);
    const next = exists
      ? metaPresets.map((p) => (p.id === nextPreset.id ? nextPreset : p))
      : [...metaPresets, nextPreset];
    persistMeta(next);
    setLibrary({ importApplyMetadataPresetId: nextPreset.id });
    setEditor(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="space-y-1.5">
        <MenuSelect
          label={t('library.rightPanel.metadata' as any, { defaultValue: 'Métadonnées' })}
          valueLabel={metadataLabel}
          open={openMeta}
          onClose={() => setOpenMeta(false)}
          onToggle={() => setOpenMeta((v) => !v)}
        >
          <MenuItem
            active={!metadataId}
            onClick={() => {
              setLibrary({ importApplyMetadataPresetId: null });
              setOpenMeta(false);
            }}
          >
            {t('library.rightPanel.applyNone' as any, { defaultValue: 'Aucun' })}
          </MenuItem>
          {metaPresets.map((p) => (
            <MenuItem
              key={p.id}
              active={metadataId === p.id}
              onClick={() => {
                setLibrary({ importApplyMetadataPresetId: p.id });
                setOpenMeta(false);
              }}
            >
              {p.name}
            </MenuItem>
          ))}
          <div className="h-px my-0.5 bg-border-color/40" />
          <MenuItem
            onClick={() => {
              setOpenMeta(false);
              setEditor({ id: uuidv4(), name: '', fields: {} });
            }}
          >
            {t('library.rightPanel.metadataNew' as any, { defaultValue: 'Nouveau…' })}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpenMeta(false);
              setManager(true);
            }}
          >
            {t('library.rightPanel.metadataEditPresets' as any, {
              defaultValue: 'Modifier les paramètres prédéfinis…',
            })}
          </MenuItem>
        </MenuSelect>
      </div>

      <div>
        <div className="text-[10px] text-text-secondary mb-0.5">
          {t('library.rightPanel.importKeywords' as any, { defaultValue: 'Mots-clés' })}
        </div>
        <textarea
          value={keywords}
          onChange={(e) => setLibrary({ importApplyKeywords: e.target.value })}
          rows={4}
          className="w-full min-h-[4.5rem] px-1.5 py-1 rounded bg-bg-primary/50 border border-border-color/30 text-[11px] text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-white/25 resize-y"
          placeholder={t('library.rightPanel.importKeywordsHint' as any, {
            defaultValue: 'travel/paris, one keyword per line or comma-separated',
          })}
        />
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditor(null)}>
          <div
            className="w-[min(22rem,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto custom-scrollbar rounded-md bg-surface border border-border-color/50 shadow-xl p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold">
                {t('library.rightPanel.metadataPresetTitle' as any, { defaultValue: 'Préréglage de métadonnées' })}
              </div>
              <button type="button" className="p-0.5 text-text-secondary hover:text-text-primary" onClick={() => setEditor(null)}>
                <X size={14} />
              </button>
            </div>
            <label className="block text-[11px] text-text-secondary">
              {t('library.rightPanel.collectionName' as any, { defaultValue: 'Nom' })}
              <input
                autoFocus
                type="text"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                className="mt-0.5 w-full h-7 px-1.5 rounded bg-bg-primary border border-border-color/40 text-[12px] text-text-primary outline-none"
              />
            </label>
            {METADATA_PRESET_FIELDS.map((f) => (
              <label key={f.key} className="block text-[11px] text-text-secondary">
                {f.label}
                <input
                  type="text"
                  value={editor.fields[f.key] || ''}
                  onChange={(e) =>
                    setEditor({ ...editor, fields: { ...editor.fields, [f.key]: e.target.value } })
                  }
                  className="mt-0.5 w-full h-7 px-1.5 rounded bg-bg-primary border border-border-color/40 text-[12px] text-text-primary outline-none"
                />
              </label>
            ))}
            <div className="flex justify-end gap-1.5 pt-1">
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] text-text-secondary hover:bg-card-active"
                onClick={() => setEditor(null)}
              >
                {t('library.rightPanel.cancel' as any, { defaultValue: 'Annuler' })}
              </button>
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] font-semibold bg-accent/80 text-button-text hover:bg-accent"
                onClick={saveEditor}
              >
                {t('library.rightPanel.create' as any, { defaultValue: 'Enregistrer' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {manager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setManager(false)}>
          <div
            className="w-[min(22rem,calc(100vw-2rem))] rounded-md bg-surface border border-border-color/50 shadow-xl p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold">
                {t('library.rightPanel.metadataEditPresets' as any, {
                  defaultValue: 'Modifier les paramètres prédéfinis…',
                })}
              </div>
              <button type="button" className="p-0.5 text-text-secondary hover:text-text-primary" onClick={() => setManager(false)}>
                <X size={14} />
              </button>
            </div>
            {metaPresets.length === 0 ? (
              <p className="text-[11px] text-text-secondary py-2">
                {t('library.rightPanel.noMetadataPresets' as any, { defaultValue: 'Aucun préréglage.' })}
              </p>
            ) : (
              <ul className="space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar">
                {metaPresets.map((p) => (
                  <li
                    key={p.id}
                    className={clsx(
                      'flex items-center gap-1 px-1.5 py-1 rounded text-[11px]',
                      metadataId === p.id ? 'bg-card-active' : 'hover:bg-card-active/70',
                    )}
                  >
                    <span className="truncate flex-1">{p.name}</span>
                    <button
                      type="button"
                      className="p-1 rounded text-text-secondary hover:text-text-primary"
                      onClick={() => {
                        setManager(false);
                        setEditor({ ...p, fields: { ...p.fields } });
                      }}
                      aria-label="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-text-secondary hover:text-red-400"
                      onClick={() => {
                        persistMeta(metaPresets.filter((x) => x.id !== p.id));
                        if (metadataId === p.id) setLibrary({ importApplyMetadataPresetId: null });
                      }}
                      aria-label="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] text-text-secondary hover:bg-card-active"
                onClick={() => setManager(false)}
              >
                {t('library.rightPanel.cancel' as any, { defaultValue: 'Fermer' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
