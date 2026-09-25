import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Download, Plus, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

import CheckBox from '../../ui/CheckBox';
import PanelSelect from '../../ui/PanelSelect';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { Album, AlbumItem, ImageFile, Invokes } from '../../ui/AppProperties';
import {
  UNCATEGORIZED_ALBUM_ID,
  UNCATEGORIZED_ALBUM_NAME,
  albumDisplayName,
  collectImportedPaths,
  ensureUncategorizedAlbum,
  findAlbumById,
  flattenGroups,
  flattenNamedAlbums,
  insertAlbumInTree,
  nestAlbumInAlbum,
} from '../../../utils/catalogMembership';
import { applyImportSidecars } from '../../../utils/applyImportSidecars';

function flattenAlbums(items: AlbumItem[], prefix = ''): Array<{ id: string; label: string }> {
  return items.flatMap((item) =>
    item.type === 'album'
      ? item.id === UNCATEGORIZED_ALBUM_ID
        ? []
        : [{ id: item.id, label: prefix + albumDisplayName(item) }]
      : flattenAlbums(item.children || [], `${prefix}${item.name} / `),
  );
}

/**
 * Import checked Library photos: Sans collection by default, or a named collection when the box is checked.
 */
export default function LibraryImportBar() {
  const { t } = useTranslation();
  const albumTree = useLibraryStore((s) => s.albumTree);
  const activeAlbumId = useLibraryStore((s) => s.activeAlbumId);
  const multiSelectedPaths = useLibraryStore((s) => s.multiSelectedPaths);
  const albums = useMemo(() => flattenAlbums(albumTree || []), [albumTree]);
  const groups = useMemo(() => flattenGroups(albumTree), [albumTree]);
  const locationOptions = useMemo(() => {
    const named = flattenNamedAlbums(albumTree);
    const groupIds = new Set(groups.map((g) => g.id));
    return [
      ...groups.map((g) => ({ ...g, kind: 'group' as const })),
      ...named.filter((a) => !groupIds.has(a.id)).map((a) => ({ ...a, kind: 'album' as const })),
    ];
  }, [albumTree, groups]);

  const [preventDuplicates, setPreventDuplicates] = useState(() => {
    try {
      return localStorage.getItem('rustroom.preventImportDupes.v1') !== '0';
    } catch {
      return true;
    }
  });
  const [albumId, setAlbumId] = useState(activeAlbumId && activeAlbumId !== UNCATEGORIZED_ALBUM_ID ? activeAlbumId : UNCATEGORIZED_ALBUM_ID);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('Collection');
  const [inSet, setInSet] = useState(false);
  const [parentId, setParentId] = useState('');

  useEffect(() => {
    if (activeAlbumId && activeAlbumId !== UNCATEGORIZED_ALBUM_ID) {
      setAlbumId(activeAlbumId);
    }
  }, [activeAlbumId]);

  const selectedAlbumId =
    albumId === UNCATEGORIZED_ALBUM_ID || albums.some((a) => a.id === albumId)
      ? albumId
      : UNCATEGORIZED_ALBUM_ID;
  const checkedCount = multiSelectedPaths.length;
  const parentOption = locationOptions.find((o) => o.id === parentId) || locationOptions[0];

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    const album: Album = { type: 'album', id: uuidv4(), name, images: [] };
    try {
      let tree = await ensureUncategorizedAlbum(useLibraryStore.getState().albumTree || []);
      if (inSet && parentOption) {
        tree =
          parentOption.kind === 'group'
            ? insertAlbumInTree(tree, album, parentOption.id)
            : nestAlbumInAlbum(tree, parentOption.id, album);
      } else {
        tree = insertAlbumInTree(tree, album, null);
      }
      await invoke(Invokes.SaveAlbums, { tree });
      const next = await invoke<AlbumItem[]>(Invokes.GetAlbums);
      useLibraryStore.getState().setLibrary({ albumTree: next });
      setAlbumId(album.id);
      setCreating(false);
      setNewName('Collection');
      setInSet(false);
    } catch (err) {
      toast.error(`Failed to create collection: ${err}`);
    }
  };

  const handleImport = async () => {
    const paths = [...multiSelectedPaths];
    if (paths.length === 0) {
      toast.info(
        t('library.rightPanel.importNone' as any, {
          defaultValue: 'Cochez des photos dans la bibliothèque pour les importer.',
        }),
      );
      return;
    }

    setBusy(true);
    try {
      let tree = await ensureUncategorizedAlbum(useLibraryStore.getState().albumTree || []);
      let toImport = paths;
      if (preventDuplicates) {
        const already = collectImportedPaths(tree);
        toImport = paths.filter((p) => !already.has(p));
        if (toImport.length === 0) {
          toast.info(
            t('library.rightPanel.importDupesBlocked' as any, {
              defaultValue: 'Ces photos sont déjà dans le catalogue. Décochez « Empêcher les doublons » pour forcer.',
            }),
          );
          return;
        }
      }
      const destId = findAlbumById(tree, selectedAlbumId) ? selectedAlbumId : UNCATEGORIZED_ALBUM_ID;
      if (!findAlbumById(tree, destId)) {
        tree = await ensureUncategorizedAlbum(tree);
      }

      await invoke(Invokes.AddToAlbum, { albumId: destId, paths: toImport });
      try {
        await applyImportSidecars(toImport);
      } catch (e) {
        console.warn('apply during import failed', e);
      }
      tree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
      const dest = findAlbumById(tree, destId);
      const { activeAlbumId: currentAlbum, setLibrary } = useLibraryStore.getState();

      const patch: Record<string, unknown> = {
        albumTree: tree,
        lastImportedPaths: toImport,
        showPreviousImportOnly: false,
        multiSelectedPaths: toImport,
      };

      if (currentAlbum === destId && dest) {
        const files = await invoke<ImageFile[]>(Invokes.GetAlbumImages, { paths: dest.images || [] });
        const ratings: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) ratings[f.path] = f.rating;
        });
        patch.imageList = files;
        patch.imageRatings = ratings;
      }

      setLibrary(patch as any);

      const active = useLibraryStore.getState().libraryActivePath;
      const focus = active && toImport.includes(active) ? active : toImport[toImport.length - 1];
      window.dispatchEvent(new CustomEvent('rustroom:open-image', { detail: { path: focus } }));

      const skipped = paths.length - toImport.length;
      toast.success(
        t('library.rightPanel.importSuccess' as any, {
          defaultValue: '{{count}} photo(s) importée(s) dans « {{collection}} »',
          count: toImport.length,
          collection: albumDisplayName(dest),
        }) +
          (skipped
            ? ` (${skipped} doublon(s) ignoré(s))`
            : ''),
      );
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-0 py-2 space-y-2 border-t border-border-color/30 mt-2">
      <div className="flex items-center gap-2">
        <CheckBox
          checked={preventDuplicates}
          onChange={(v) => {
            setPreventDuplicates(v);
            try {
              localStorage.setItem('rustroom.preventImportDupes.v1', v ? '1' : '0');
            } catch {
              /* ignore */
            }
          }}
          label={t('library.rightPanel.preventDupes' as any, { defaultValue: 'Empêcher les doublons' })}
        />
        <button
          type="button"
          className="flex-1 min-w-0 text-left text-[11px] text-text-primary truncate"
          onClick={() => {
            const v = !preventDuplicates;
            setPreventDuplicates(v);
            try {
              localStorage.setItem('rustroom.preventImportDupes.v1', v ? '1' : '0');
            } catch {
              /* ignore */
            }
          }}
        >
          {t('library.rightPanel.preventDupes' as any, { defaultValue: 'Empêcher les doublons' })}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[11px] text-text-secondary shrink-0">
          {t('library.rightPanel.addToCollection' as any, { defaultValue: 'Ajouter à une collection' })}
        </span>
        <PanelSelect
          className="flex-1 min-w-0"
          value={selectedAlbumId}
          options={[
            { value: UNCATEGORIZED_ALBUM_ID, label: UNCATEGORIZED_ALBUM_NAME },
            ...albums.map((a) => ({ value: a.id, label: a.label })),
          ]}
          onChange={setAlbumId}
        />
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setParentId(locationOptions[0]?.id || '');
          }}
          className="h-6 w-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-card-active"
          data-tooltip={t('library.rightPanel.createCollection' as any, { defaultValue: 'Create collection' })}
          aria-label="Create collection"
        >
          <Plus size={14} />
        </button>
      </div>

      <button
        type="button"
        disabled={busy || checkedCount === 0}
        onClick={handleImport}
        className="w-full h-8 flex items-center justify-center gap-1.5 rounded text-[11px] uppercase tracking-wide font-semibold bg-accent/80 text-button-text hover:bg-accent disabled:opacity-40"
      >
        <Download size={13} />
        {busy
          ? t('library.rightPanel.importing' as any, { defaultValue: 'Importing…' })
          : checkedCount === 0
            ? t('library.rightPanel.import' as any, { defaultValue: 'Import' })
            : t('library.rightPanel.importChecked' as any, {
                defaultValue: 'Importer {{count}}',
                count: checkedCount,
              })}
      </button>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCreating(false)}>
          <div
            className="w-[min(22rem,calc(100vw-2rem))] rounded-md bg-surface border border-border-color/50 shadow-xl p-3 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold text-text-primary">
                {t('library.rightPanel.createCollectionTitle' as any, { defaultValue: 'Créer Collection' })}
              </div>
              <button
                type="button"
                className="p-0.5 rounded text-text-secondary hover:text-text-primary"
                onClick={() => setCreating(false)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <label className="block text-[11px] text-text-secondary">
              {t('library.rightPanel.collectionName' as any, { defaultValue: 'Nom' })}
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createCollection();
                  if (e.key === 'Escape') setCreating(false);
                }}
                className="mt-1 w-full h-8 px-2 rounded bg-bg-primary border border-border-color/40 text-[12px] text-text-primary outline-none focus:border-white/30"
              />
            </label>
            <div className="rounded border border-border-color/30 p-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-text-secondary/70">
                {t('library.rightPanel.location' as any, { defaultValue: 'Emplacement' })}
              </div>
              <div className="flex items-center gap-2">
                <CheckBox checked={inSet} onChange={setInSet} label="Inside a collection set" />
                <button
                  type="button"
                  className="text-[11px] text-text-primary text-left"
                  onClick={() => setInSet((v) => !v)}
                >
                  {t('library.rightPanel.insideSet' as any, {
                    defaultValue: 'Dans un ensemble de collections',
                  })}
                </button>
              </div>
              {inSet && (
                <select
                  value={parentOption?.id || ''}
                  onChange={(e) => setParentId(e.target.value)}
                  disabled={locationOptions.length === 0}
                  className="w-full h-8 px-1.5 rounded bg-bg-primary border border-border-color/40 text-[11px] text-text-primary outline-none disabled:opacity-50"
                >
                  {locationOptions.length === 0 && (
                    <option value="">
                      {t('library.rightPanel.noSets' as any, { defaultValue: 'Aucun ensemble' })}
                    </option>
                  )}
                  {locationOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-card-active"
                onClick={() => setCreating(false)}
              >
                {t('library.rightPanel.cancel' as any, { defaultValue: 'Annuler' })}
              </button>
              <button
                type="button"
                disabled={!newName.trim() || (inSet && !parentOption)}
                className="h-7 px-2.5 rounded text-[11px] font-semibold bg-accent/80 text-button-text hover:bg-accent disabled:opacity-40"
                onClick={createCollection}
              >
                {t('library.rightPanel.create' as any, { defaultValue: 'Créer' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
