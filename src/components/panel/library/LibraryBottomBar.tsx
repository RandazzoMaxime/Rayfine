import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, Check, CheckSquare, ChevronDown, Square } from 'lucide-react';
import clsx from 'clsx';

import { useLibraryStore } from '../../../store/useLibraryStore';
import { ImageFile, SortDirection } from '../../ui/AppProperties';

const SORT_OPTIONS = [
  { key: 'date_taken', label: 'Date de capture' },
  { key: 'name', label: 'Nom' },
  { key: 'city', label: 'Localisation' },
  { key: 'rating', label: 'Note' },
  { key: 'file_type', label: 'Type de fichier' },
];

/** Library bottom bar: select-all and sort. View modes live in the header. */
export default function LibraryBottomBar({
  imageList,
}: {
  imageList: ImageFile[];
}) {
  const { t } = useTranslation();
  const sortCriteria = useLibraryStore((s) => s.sortCriteria);
  const setSortCriteria = useLibraryStore((s) => s.setSortCriteria);
  const selectedCount = useLibraryStore((s) => s.multiSelectedPaths.length);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selectAll = () => {
    const paths = imageList.map((img) => img.path);
    useLibraryStore.getState().setLibrary({
      multiSelectedPaths: paths,
      libraryActivePath: paths[0] ?? null,
      selectionAnchorPath: paths[0] ?? null,
    });
  };

  const selectNone = () => {
    useLibraryStore.getState().setLibrary({ multiSelectedPaths: [], selectionAnchorPath: null });
  };

  const current = SORT_OPTIONS.find((o) => o.key === sortCriteria.key);
  const ascending = sortCriteria.order === SortDirection.Ascending;
  const btn =
    'h-7 px-2.5 flex items-center gap-1.5 rounded text-[11px] bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary hover:bg-card-active disabled:opacity-40';

  return (
    <div className="shrink-0 h-10 px-2 flex items-center gap-2 bg-bg-secondary border-t border-border-color/40 rounded-lg">
      <button type="button" className={btn} onClick={selectAll} disabled={imageList.length === 0}>
        <CheckSquare size={13} />
        {t('library.bottomBar.selectAll' as any, { defaultValue: 'Tout cocher' })}
      </button>
      <button type="button" className={btn} onClick={selectNone} disabled={selectedCount === 0}>
        <Square size={13} />
        {t('library.bottomBar.selectNone' as any, { defaultValue: 'Tout décocher' })}
      </button>
      <span className="text-[10px] text-text-secondary/60 tabular-nums">
        {selectedCount} / {imageList.length}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-[11px] text-text-secondary">
          {t('library.bottomBar.sortBy' as any, { defaultValue: 'Trier par' })}
        </span>
        <div className="relative" ref={menuRef}>
          <button type="button" className={clsx(btn, 'min-w-[140px] justify-between')} onClick={() => setOpen((v) => !v)}>
            <span className="text-text-primary">{current?.label ?? sortCriteria.key}</span>
            <ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} />
          </button>
          {open && (
            <div className="absolute bottom-full right-0 mb-1 w-full min-w-[160px] z-30 p-1 rounded-lg bg-surface/95 backdrop-blur-md shadow-xl border border-border-color/40">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    setSortCriteria((prev) => ({ ...prev, key: o.key }));
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-[11px] text-text-primary hover:bg-card-active"
                >
                  {o.label}
                  {o.key === sortCriteria.key && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={clsx(btn, 'px-1.5')}
          onClick={() =>
            setSortCriteria((prev) => ({
              ...prev,
              order: prev.order === SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending,
            }))
          }
          data-tooltip={ascending ? 'Croissant' : 'Décroissant'}
          aria-label={ascending ? 'Croissant' : 'Décroissant'}
        >
          {ascending ? <ArrowUpNarrowWide size={14} /> : <ArrowDownNarrowWide size={14} />}
        </button>
      </div>
    </div>
  );
}
