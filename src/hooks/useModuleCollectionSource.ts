import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../store/useLibraryStore';
import { AlbumItem, ImageFile, Invokes } from '../components/ui/AppProperties';
import { findAlbumById } from '../utils/catalogMembership';
import {
  collectionOnlyImages,
  initialModuleAlbumId,
} from '../utils/moduleCollectionSource';

/** Shared collection source for Map / Border / Web. Folder contents are never included. */
export function useModuleCollectionSource() {
  const { albumTree, setLibrary } = useLibraryStore(
    useShallow((s) => ({
      albumTree: s.albumTree,
      setLibrary: s.setLibrary,
    })),
  );
  const [albumId, setAlbumId] = useState<string | null>(() =>
    initialModuleAlbumId(useLibraryStore.getState().activeAlbumId),
  );
  const [albumImages, setAlbumImages] = useState<ImageFile[] | null>(null);
  const [albumLoading, setAlbumLoading] = useState(false);

  useEffect(() => {
    invoke(Invokes.GetAlbums)
      .then((res: any) => setLibrary({ albumTree: res as AlbumItem[] }))
      .catch(() => {});
  }, [setLibrary]);

  const activeAlbum = useMemo(
    () => (albumId ? findAlbumById(albumTree, albumId) : null),
    [albumTree, albumId],
  );

  useEffect(() => {
    if (albumId && !activeAlbum) setAlbumId(null);
  }, [albumId, activeAlbum]);

  const albumPathsKey = activeAlbum ? (activeAlbum.images || []).join('\n') : '';
  useEffect(() => {
    if (!activeAlbum) {
      setAlbumImages(null);
      setAlbumLoading(false);
      return;
    }
    let cancelled = false;
    setAlbumImages(null);
    setAlbumLoading(true);
    invoke<ImageFile[]>(Invokes.GetAlbumImages, { paths: activeAlbum.images || [] })
      .then((files) => {
        if (!cancelled) setAlbumImages(files || []);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`Failed to load album: ${err}`);
        setAlbumImages([]);
      })
      .finally(() => {
        if (!cancelled) setAlbumLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAlbum?.id, albumPathsKey]);

  const images = useMemo(
    () => collectionOnlyImages({ albumId, albumImages }),
    [albumId, albumImages],
  );

  return {
    albumId,
    setAlbumId,
    images,
    albumLoading,
    albumTree: albumTree || [],
    activeAlbum,
  };
}
