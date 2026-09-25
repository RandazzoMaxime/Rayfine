import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import CheckBox from '../ui/CheckBox';
import {
  COPY_SETTINGS_COLUMNS,
  CopySettingsNode,
  DEFAULT_COPY_KEYS,
  allCopySettingKeys,
  collectNodeKeys,
} from '../../utils/copySettingsTree';

const SUBSET_STORAGE = 'rustroom.copySettingsSubsets.v1';

interface SavedSubset {
  id: string;
  name: string;
  keys: string[];
}

interface CopyPasteSettingsModalProps {
  isOpen: boolean;
  onClose(): void;
  onCopy(keys: string[]): void;
  initialKeys?: string[];
}

function loadSubsets(): SavedSubset[] {
  try {
    const raw = localStorage.getItem(SUBSET_STORAGE);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function saveSubsets(list: SavedSubset[]) {
  try {
    localStorage.setItem(SUBSET_STORAGE, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

function nodeState(node: CopySettingsNode, selected: Set<string>) {
  const keys = collectNodeKeys(node);
  if (keys.length === 0) return { checked: false, indeterminate: false, keys };
  const n = keys.filter((k) => selected.has(k)).length;
  return { checked: n === keys.length, indeterminate: n > 0 && n < keys.length, keys };
}

function TreeRow({
  node,
  selected,
  onToggle,
  depth,
}: {
  node: CopySettingsNode;
  selected: Set<string>;
  onToggle: (keys: string[], checked: boolean) => void;
  depth: number;
}) {
  const { t } = useTranslation();
  const { checked, indeterminate, keys } = nodeState(node, selected);
  const label = t(node.labelKey as any, { defaultValue: node.id });

  return (
    <div className={clsx(depth === 0 ? 'mt-1.5 first:mt-0' : 'mt-0.5')}>
      <label
        className={clsx(
          'flex items-center gap-1.5 cursor-pointer select-none',
          node.disabled && 'opacity-40 cursor-not-allowed',
          depth === 0 ? 'font-medium text-[12px] text-text-primary' : 'text-[12px] text-text-primary/90',
        )}
        style={{ paddingLeft: depth * 16 }}
        onClick={(e) => {
          e.preventDefault();
          if (node.disabled || keys.length === 0) return;
          onToggle(keys, !checked);
        }}
      >
        <CheckBox
          checked={checked}
          indeterminate={indeterminate}
          disabled={node.disabled || keys.length === 0}
          label={label}
          onChange={(next) => {
            if (node.disabled || keys.length === 0) return;
            onToggle(keys, next);
          }}
        />
        <span className="leading-4">{label}</span>
      </label>
      {node.children?.map((child) => (
        <TreeRow key={child.id} node={child} selected={selected} onToggle={onToggle} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function CopyPasteSettingsModal({
  isOpen,
  onClose,
  onCopy,
  initialKeys,
}: CopyPasteSettingsModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_COPY_KEYS));
  const [subsets, setSubsets] = useState<SavedSubset[]>(loadSubsets);
  const [subsetId, setSubsetId] = useState('default');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const start = initialKeys && initialKeys.length > 0 ? initialKeys : DEFAULT_COPY_KEYS;
      setSelected(new Set(start));
      setSubsetId(initialKeys && initialKeys.length > 0 ? 'previous' : 'default');
      setSubsets(loadSubsets());
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 200);
    return () => clearTimeout(timer);
  }, [isOpen, initialKeys]);

  const toggleKeys = useCallback((keys: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    setSubsetId('custom');
  }, []);

  const selectAll = () => {
    setSelected(new Set(allCopySettingKeys()));
    setSubsetId('all');
  };

  const selectNone = () => {
    setSelected(new Set());
    setSubsetId('custom');
  };

  const applySubset = (id: string) => {
    if (id === 'save') {
      const name = window.prompt(
        t('modals.copyPaste.saveSubsetPrompt' as any, { defaultValue: 'Subset name' }) || '',
        t('modals.copyPaste.saveSubsetDefault' as any, { defaultValue: 'My subset' }) || '',
      );
      if (!name?.trim()) return;
      const item: SavedSubset = {
        id: `cs_${Date.now().toString(36)}`,
        name: name.trim(),
        keys: Array.from(selected),
      };
      const next = [...subsets, item];
      setSubsets(next);
      saveSubsets(next);
      setSubsetId(item.id);
      return;
    }
    setSubsetId(id);
    if (id === 'default') setSelected(new Set(DEFAULT_COPY_KEYS));
    else if (id === 'all') setSelected(new Set(allCopySettingKeys()));
    else if (id === 'previous' && initialKeys?.length) setSelected(new Set(initialKeys));
    else {
      const found = subsets.find((s) => s.id === id);
      if (found) setSelected(new Set(found.keys));
    }
  };

  const confirm = useCallback(() => {
    onCopy(Array.from(selected));
  }, [onCopy, selected]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, confirm]);

  if (!isMounted) return null;

  const footerBtn =
    'h-7 px-3 rounded-sm text-[12px] bg-surface border border-border-color/50 text-text-primary hover:bg-card-active';

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/40 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogRef}
        className={`bg-bg-secondary border border-border-color/50 shadow-2xl w-[min(56rem,94vw)] flex flex-col transform transition-all duration-200 ${
          show ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-9 px-3 flex items-center justify-between border-b border-border-color/40">
          <span className="text-[13px] text-text-primary">
            {t('modals.copyPaste.titleCopy' as any, { defaultValue: 'Copy Settings' })}
          </span>
          <button
            type="button"
            className="w-7 h-7 text-text-secondary hover:text-text-primary"
            onClick={onClose}
            aria-label={t('modals.copyPaste.cancel')}
          >
            ×
          </button>
        </div>

        <div className="px-3 py-2 grid grid-cols-3 gap-x-6 gap-y-1 max-h-[min(70vh,32rem)] overflow-y-auto custom-scrollbar">
          {COPY_SETTINGS_COLUMNS.map((col, i) => (
            <div key={`col-${i}`}>
              {col.map((node) => (
                <TreeRow key={node.id} node={node} selected={selected} onToggle={toggleKeys} depth={0} />
              ))}
            </div>
          ))}
        </div>

        <div className="px-3 py-2 border-t border-border-color/40 flex items-center gap-2 flex-wrap">
          <button type="button" className={footerBtn} onClick={selectAll}>
            {t('modals.copyPaste.selectAll')}
          </button>
          <button type="button" className={footerBtn} onClick={selectNone}>
            {t('modals.copyPaste.selectNone')}
          </button>
          <div className="flex items-center gap-1.5 ml-2 text-[12px] text-text-secondary">
            <span>{t('modals.copyPaste.subset' as any, { defaultValue: 'Subset:' })}</span>
            <select
              className="h-7 px-1.5 rounded-sm bg-bg-primary border border-border-color/50 text-text-primary text-[12px] min-w-[10rem]"
              value={subsetId}
              onChange={(e) => applySubset(e.target.value)}
            >
              <option value="default">{t('modals.copyPaste.subsetDefault' as any, { defaultValue: 'Default' })}</option>
              <option value="all">{t('modals.copyPaste.subsetAll' as any, { defaultValue: 'Everything' })}</option>
              {initialKeys && initialKeys.length > 0 && (
                <option value="previous">
                  {t('modals.copyPaste.subsetPrevious' as any, { defaultValue: 'Previous' })}
                </option>
              )}
              {subsets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="save">
                {t('modals.copyPaste.saveSubset' as any, { defaultValue: 'Save current subset…' })}
              </option>
            </select>
          </div>
          <div className="grow" />
          <button
            type="button"
            className="h-7 px-4 rounded-sm text-[12px] bg-accent text-button-text hover:opacity-90 disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={confirm}
          >
            {t('modals.copyPaste.copy' as any, { defaultValue: 'Copy' })}
          </button>
          <button type="button" className={footerBtn} onClick={onClose}>
            {t('modals.copyPaste.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
