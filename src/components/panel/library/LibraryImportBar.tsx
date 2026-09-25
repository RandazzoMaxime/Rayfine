import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { useTranslation } from 'react-i18next';
import { Check, Download, Plus, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

import CheckBox from '../../ui/CheckBox';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { Album, AlbumItem, ImageFile, Invokes } from '../../ui/AppProperties';

function flattenAlbums(items: AlbumItem[], prefix = ''): Array<{ id: string; label: string }> {
  return items.flatMap((item) =>
    item.type === 'album'
      ? [{ id: item.id, label: prefix + item.name }]
      : flattenAlbums(item.children || [], `${prefix}${item.name} / `),
  );
}

/**
 * LR-style "Add" import: registers a folder in the catalog by reference (no copy),
 * optionally adding every photo to a collection.
 */
export default function LibraryImportBar() {
  const { t } = useTranslation();
  const albumTree = useLibraryStore((s) => s.albumTree);
  const albums = useMemo(() => flattenAlbums(albumTree || []), [albumTree]);

  const [addToCollection, setAddToCollection] = useState(false);
  const [albumId, setAlbumId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedAlbumId = albums.some((a) => a.id === albumId) ? albumId : albums[0]?.id || '';

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    const album: Album = { type: 'album', id: uuidv4(), name, images: [] };
    try {
      await invoke(Invokes.SaveAlbums, { tree: [...(albumTree || []), album] });
      const tree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
      useLibraryStore.getState().setLibrary({ albumTree: tree });
      setAlbumId(album.id);
      setAddToCollection(true);
      setCreating(false);
      setNewName('');
    } catch (err) {
      toast.error(`Failed to create collection: ${err}`);
    }
  };

  const handleImport = async () => {
    const selected = await open({ directory: true, multiple: false, defaultPath: await homeDir() });
    if (typeof selected !== 'string' || !selected) return;

    setBusy(true);
    try {
      const { rootPaths, folderTrees, setLibrary } = useLibraryStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();

      // Register the folder in the catalog unless it already lives under a known root.
      if (!rootPaths.some((r) => selected === r || selected.startsWith(r + '/') || selected.startsWith(r + '\\'))) {
        const newRootPaths = [...rootPaths, selected];
        setLibrary({ rootPaths: newRootPaths });
        if (appSettings) handleSettingsChange({ ...appSettings, rootFolders: newRootPaths } as any);
        try {
          const tree = await invoke(Invokes.GetFolderTree, {
            path: selected,
            expandedFolders: [selected],
            showImageCounts:
              appSettings?.enableFolderImageCounts || appSettings?.folderTreeSort?.key === 'imageCount',
          });
          setLibrary({ folderTrees: [...folderTrees, tree] as any });
        } catch (e) {
          toast.error(`Failed to load folder tree: ${e}`);
        }
      }

      const files = await invoke<ImageFile[]>(Invokes.ListImagesRecursive, { path: selected });
      const paths = files.map((f) => f.path);

      if (addToCollection && selectedAlbumId && paths.length > 0) {
        await invoke(Invokes.AddToAlbum, { albumId: selectedAlbumId, paths });
        const tree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
        setLibrary({ albumTree: tree });
      }

      setLibrary({ lastImportedPaths: paths, showPreviousImportOnly: false });
      window.dispatchEvent(new CustomEvent('rustroom:navigate-folder', { detail: { path: selected } }));

      const collection = addToCollection ? albums.find((a) => a.id === selectedAlbumId)?.label : null;
      toast.success(
        `${paths.length} photo(s) added to catalog${collection ? ` · collection “${collection}”` : ''}`,
      );
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border-color/40 px-2.5 py-2 space-y-2 bg-bg-secondary">
      <div className="flex items-center gap-2 text-[11px] text-text-secondary select-none">
        <CheckBox checked={addToCollection} onChange={setAddToCollection} label="Add to collection" />
        <button type="button" className="hover:text-text-primary" onClick={() => setAddToCollection((v) => !v)}>
          {t('library.rightPanel.addToCollection' as any, { defaultValue: 'Add to collection' })}
        </button>
      </div>

      {addToCollection && (
        <div className="flex gap-1">
          {creating ? (
            <>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createCollection();
                  if (e.key === 'Escape') setCreating(false);
                }}
                placeholder={t('library.rightPanel.newCollection' as any, { defaultValue: 'New collection name' })}
                className="flex-1 min-w-0 h-7 px-2 rounded bg-surface border border-border-color/40 text-[11px] text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-white/30"
              />
              <button
                type="button"
                disabled={!newName.trim()}
                onClick={createCollection}
                className="h-7 w-7 flex items-center justify-center rounded bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary disabled:opacity-40"
                aria-label="Create collection"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-7 w-7 flex items-center justify-center rounded bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary"
                aria-label="Cancel"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <select
                value={selectedAlbumId}
                disabled={albums.length === 0}
                onChange={(e) => setAlbumId(e.target.value)}
                className="flex-1 min-w-0 h-7 px-1.5 rounded bg-surface border border-border-color/40 text-[11px] text-text-primary outline-none disabled:opacity-50"
              >
                {albums.length === 0 && (
                  <option value="">
                    {t('library.rightPanel.noCollections' as any, { defaultValue: 'No collections — click +' })}
                  </option>
                )}
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="h-7 w-7 flex items-center justify-center rounded bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary hover:bg-card-active"
                data-tooltip={t('library.rightPanel.createCollection' as any, { defaultValue: 'Create collection' })}
                aria-label="Create collection"
              >
                <Plus size={13} />
              </button>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy || (addToCollection && !selectedAlbumId)}
        onClick={handleImport}
        className="w-full h-8 flex items-center justify-center gap-1.5 rounded text-[11px] uppercase tracking-wide font-semibold bg-accent/80 text-button-text hover:bg-accent disabled:opacity-40"
      >
        <Download size={13} />
        {busy
          ? t('library.rightPanel.importing' as any, { defaultValue: 'Importing…' })
          : t('library.rightPanel.import' as any, { defaultValue: 'Import' })}
      </button>
    </div>
  );
}
