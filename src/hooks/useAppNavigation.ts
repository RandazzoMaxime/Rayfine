import { useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { toast } from 'react-toastify';
import { useLibraryStore } from '../store/useLibraryStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes, LibraryViewMode, ImageFile, Panel } from '../components/ui/AppProperties';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import { denormalizeMaskCoordinates } from '../utils/maskUtils';
import { globalImageCache } from '../utils/ImageLRUCache';
import { debouncedSave, debouncedSetHistory } from './useEditorActions';
import i18n from '../i18n';
import { isPathImported, filterRemovedFromCatalog } from '../utils/catalogMembership';
import { dedupeLibraryRoots, isLibraryPathInside, libraryRootCoveredBy, sameLibraryPath } from '../utils/libraryRoots';

export interface AppNavigationProps {
  clearThumbnailQueue: () => void;
  refs: {
    transformWrapperRef: React.RefObject<any>;
    preloadedDataRef: React.RefObject<any>;
    cachedEditStateRef: React.RefObject<any>;
    selectedImagePathRef: React.RefObject<string | null>;
    isBackendReadyRef: React.RefObject<boolean>;
    latestRenderedJobIdRef: React.RefObject<number>;
    previewJobIdRef: React.RefObject<number>;
    currentResRef: React.RefObject<number>;
    prevAdjustmentsRef: React.RefObject<any>;
  };
}

export function useAppNavigation({ clearThumbnailQueue, refs }: AppNavigationProps) {
  const {
    transformWrapperRef,
    preloadedDataRef,
    cachedEditStateRef,
    selectedImagePathRef,
    isBackendReadyRef,
    latestRenderedJobIdRef,
    previewJobIdRef,
    currentResRef,
    prevAdjustmentsRef,
  } = refs;

  const handleGoHome = useCallback(() => {
    useLibraryStore.getState().setLibrary({
      rootPaths: [],
      currentFolderPath: null,
      activeAlbumId: null,
      imageList: [],
      imageRatings: {},
      folderTrees: [],
      multiSelectedPaths: [],
      libraryActivePath: null,
      expandedFolders: new Set(),
    });
    useUIStore.getState().setUI({ isLibraryExportPanelVisible: false });
  }, []);

  const handleBackToLibrary = useCallback(() => {
    const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
    const { setLibrary } = useLibraryStore.getState();
    const { setUI } = useUIStore.getState();

    if (selectedImage?.path && cachedEditStateRef.current) {
      globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
    }
    if (transformWrapperRef.current) {
      transformWrapperRef.current.resetTransform(0);
    }
    setEditor({ zoom: 1 });

    debouncedSave.flush();
    debouncedSetHistory.cancel();
    // Free the editor's GPU textures (hundreds of MB to GBs for large RAWs); recreated on next open.
    invoke('release_gpu_resources').catch(() => {});

    const lastActivePath = selectedImage?.path ?? null;

    // Keep LR "Previous" when leaving Develop to Library
    if (selectedImage?.path) {
      const ed = useEditorStore.getState();
      useEditorStore.getState().setEditor({
        previousDevelopAdjustments: structuredClone(ed.adjustments),
        previousDevelopPath: selectedImage.path,
      });
    }

    setEditor({
      hasRenderedFirstFrame: false,
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      histogram: null,
      waveform: null,
      activeMaskId: null,
      activeMaskContainerId: null,
      activeAiPatchContainerId: null,
      isWbPickerActive: false,
      isPointColorPickerActive: false,
      activeAiSubMaskId: null,
      transformedOriginalUrl: null,
    });

    selectedImagePathRef.current = null;

    setLibrary({ libraryActivePath: lastActivePath });
    setUI({ slideDirection: 1, activeView: 'library' });

    setEditor({ adjustments: INITIAL_ADJUSTMENTS });
    resetHistory(INITIAL_ADJUSTMENTS);
    useEditorStore.getState().patchesSentToBackend.clear();

    isBackendReadyRef.current = true;
    setEditor((state) => {
      if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
      return { interactivePatch: null };
    });
  }, [refs]);

  const handleImageSelect = useCallback(
    async (path: string) => {
      const { selectedImage, isSliderDragging, resetHistory, setEditor } = useEditorStore.getState();
      const { setLibrary, multiSelectedPaths, albumTree } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      const ui = useUIStore.getState();

      const enterDevelop = () => {
        if (ui.activeView === 'develop') return;
        setUI({
          activeView: 'develop',
          ...(selectedImage
            ? {}
            : {
                activeRightPanel: Panel.Adjustments,
                renderedRightPanel: Panel.Adjustments,
              }),
          uiVisibility: {
            ...ui.uiVisibility,
            developLeft: true,
            filmstrip: ui.uiVisibility?.filmstrip ?? true,
          },
        });
      };

      if (selectedImage?.path === path) {
        enterDevelop();
        return;
      }

      if (!isPathImported(path, albumTree)) {
        toast.info(
          i18n.t('library.rightPanel.developNotImported' as any, {
            defaultValue: 'Importez cette photo pour l’ouvrir dans Develop.',
          }),
        );
        return;
      }

      enterDevelop();

      // LR "Previous": remember develop settings from the photo we are leaving
      if (selectedImage?.path) {
        const ed = useEditorStore.getState();
        const snap = structuredClone(ed.adjustments);
        useEditorStore.getState().setEditor({
          previousDevelopAdjustments: snap,
          previousDevelopPath: selectedImage.path,
        });
      }

      if (!selectedImage) {
        useEditorStore.getState().setEditor({ isWaveformVisible: true });
      }

      useEditorStore.getState().patchesSentToBackend.clear();
      debouncedSave.flush();
      debouncedSetHistory.cancel();

      if (selectedImage?.path && cachedEditStateRef.current) {
        globalImageCache.set(selectedImage.path, cachedEditStateRef.current);
      }

      const cached = globalImageCache.get(path);
      const isFrontendCached = Boolean(cached && cached.selectedImage?.isReady);

      setEditor({ hasRenderedFirstFrame: false });

      selectedImagePathRef.current = path;

      const newMultiSelectedPaths = multiSelectedPaths.includes(path) ? multiSelectedPaths : [path];

      setLibrary({
        multiSelectedPaths: newMultiSelectedPaths,
        libraryActivePath: null,
        selectionAnchorPath: path,
      });

      setEditor({
        showOriginal: false,
        beforeAfterSplit: false,
        softProofing: false,
        softProofShowGamutWarning: false,
        activeMaskId: null,
        activeMaskContainerId: null,
        activeAiPatchContainerId: null,
        activeAiSubMaskId: null,
        isWbPickerActive: false,
        isPointColorPickerActive: false,
        transformedOriginalUrl: null,
      });

      setUI({
        isLibraryExportPanelVisible: false,
        compactEditorPanelHeightOverride: null,
      });

      if (isFrontendCached) {
        setEditor({
          selectedImage: {
            ...cached.selectedImage,
            thumbnailUrl: useProcessStore.getState().thumbnails[path] || cached.selectedImage.thumbnailUrl,
          },
          originalSize: cached.originalSize,
          previewSize: cached.previewSize,
          histogram: cached.histogram,
          waveform: cached.waveform,
          finalPreviewUrl: cached.finalPreviewUrl,
          uncroppedAdjustedPreviewUrl: cached.uncroppedPreviewUrl,
        });

        setEditor({ adjustments: cached.adjustments });
        resetHistory(cached.adjustments);
        prevAdjustmentsRef.current = { path, adjustments: cached.adjustments };

        setLibrary({ isViewLoading: false });

        latestRenderedJobIdRef.current = previewJobIdRef.current;
        isBackendReadyRef.current = false;
        currentResRef.current = Infinity;

        invoke(Invokes.LoadImage, { path })
          .then((_result: any) => {
            if (selectedImagePathRef.current !== path) return;
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
            setEditor((state) => {
              const w = _result.width;
              const h = _result.height;
              const adj = denormalizeMaskCoordinates(state.adjustments as any, w, h);
              return {
                originalSize: { width: w, height: h },
                adjustments: adj,
              };
            });
          })
          .catch((err: any) => {
            if (String(err).includes('cancelled')) return;
            console.error('Background load_image failed on cache hit:', err);
            isBackendReadyRef.current = true;
            currentResRef.current = 0;
          });

        invoke(Invokes.LoadMetadata, { path })
          .then((metadata: any) => {
            if (selectedImagePathRef.current !== path) return;
            let freshAdjustments: any;
            if (metadata.adjustments && !metadata.adjustments.is_null) {
              freshAdjustments = normalizeLoadedAdjustments(metadata.adjustments);
              const sz = useEditorStore.getState().originalSize;
              if (sz?.width && sz?.height) {
                freshAdjustments = denormalizeMaskCoordinates(freshAdjustments, sz.width, sz.height);
              }
            } else {
              freshAdjustments = { ...INITIAL_ADJUSTMENTS };
            }
            if (!isSliderDragging && JSON.stringify(cached.adjustments) !== JSON.stringify(freshAdjustments)) {
              setEditor({ adjustments: freshAdjustments });
              resetHistory(freshAdjustments);
              prevAdjustmentsRef.current = { path, adjustments: freshAdjustments };
              globalImageCache.set(path, { ...cached, adjustments: freshAdjustments });
            }
          })
          .catch((err) => console.error('Failed background metadata sync on cache hit:', err));

        return;
      }

      isBackendReadyRef.current = true;

      const imageFile = useLibraryStore.getState().imageList.find((img) => img.path === path);
      setEditor({
        selectedImage: {
          exif: null,
          group_id: imageFile?.group_id ?? null,
          height: 0,
          isRaw: false,
          isReady: false,
          metadata: null,
          originalUrl: null,
          path,
          thumbnailUrl: useProcessStore.getState().thumbnails[path],
          width: 0,
        },
        originalSize: { width: 0, height: 0 },
        previewSize: { width: 0, height: 0 },
        histogram: null,
        waveform: null,
        uncroppedAdjustedPreviewUrl: null,
      });

      setLibrary({ isViewLoading: true });

      setEditor((state) => {
        const prev = state.finalPreviewUrl;
        if (prev?.startsWith('blob:') && !globalImageCache.isProtected(prev)) {
          setTimeout(() => {
            if (!globalImageCache.isProtected(prev)) {
              URL.revokeObjectURL(prev);
            }
          }, 250);
        }
        return { finalPreviewUrl: null };
      });

      setEditor((state) => {
        if (state.interactivePatch?.url) URL.revokeObjectURL(state.interactivePatch.url);
        return { interactivePatch: null };
      });
    },
    [refs],
  );

  const handleSelectSubfolder = useCallback(
    async (
      path: string | null,
      isNewRoot = false,
      preloadedImages?: ImageFile[],
      expandParents = true,
      preserveEditor = false,
    ) => {
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { pinnedFolders } = appSettings || { pinnedFolders: [] };
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();
      const { setProcess } = useProcessStore.getState();
      const { selectedImage, resetHistory, setEditor } = useEditorStore.getState();
      const libraryViewMode = appSettings?.libraryViewMode;

      if (!preserveEditor) {
        await invoke('cancel_thumbnail_generation');
        clearThumbnailQueue();
        setLibrary({ isViewLoading: true, activeAlbumId: null, libraryScrollTop: 0 });
        useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        setProcess({ thumbnails: {} });
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      } else {
        setLibrary({ isViewLoading: true });
      }

      try {
        const { rootPaths, expandedFolders: currentExpandedFolders } = useLibraryStore.getState();
        let newExpandedFolders = new Set(currentExpandedFolders);

        if (isNewRoot && path) {
          newExpandedFolders = new Set([path]);
          if (appSettings) {
            handleSettingsChange({ ...appSettings, lastRootPath: path } as any);
          }
        } else if (path && expandParents) {
          const allRoots = [...(rootPaths || []), ...(pinnedFolders || [])].filter(Boolean) as string[];
          const relevantRoot = allRoots.find((r) => path.startsWith(r));

          if (relevantRoot) {
            const separator = path.includes('/') ? '/' : '\\';
            const parentSeparatorIndex = path.lastIndexOf(separator);

            if (parentSeparatorIndex > -1 && path.length > relevantRoot.length) {
              let current = path.substring(0, parentSeparatorIndex);
              while (current && current.length >= relevantRoot.length) {
                newExpandedFolders.add(current);
                const nextParentIndex = current.lastIndexOf(separator);
                if (nextParentIndex === -1 || current === relevantRoot) break;
                current = current.substring(0, nextParentIndex);
              }
            }
            newExpandedFolders.add(relevantRoot);
          }
        }

        // Folder history (skip albums / preserveEditor restores / history back-forward)
        let historyPatch: { folderHistory?: string[]; folderHistoryIndex?: number } = {};
        if (
          path &&
          !preserveEditor &&
          !String(path).startsWith('Album:') &&
          !(window as any).__rustroomSkipFolderHistory
        ) {
          const { folderHistory, folderHistoryIndex } = useLibraryStore.getState();
          const hist = Array.isArray(folderHistory) ? [...folderHistory] : [];
          let idx = typeof folderHistoryIndex === 'number' ? folderHistoryIndex : -1;
          // Navigating from middle of history: drop forward entries
          if (idx >= 0 && idx < hist.length - 1) {
            hist.splice(idx + 1);
          }
          // Don't push duplicate consecutive
          if (hist[hist.length - 1] !== path) {
            hist.push(path);
            // cap
            if (hist.length > 50) hist.splice(0, hist.length - 50);
          }
          idx = hist.length - 1;
          historyPatch = { folderHistory: hist, folderHistoryIndex: idx };
        }

        setLibrary({
          currentFolderPath: path,
          expandedFolders: newExpandedFolders,
          ...historyPatch,
          ...(preserveEditor ? {} : { imageList: [], multiSelectedPaths: [], libraryActivePath: null }),
        });

        // Track recent folders (LR-style Catalog → recent)
        if (path && appSettings) {
          const prev = Array.isArray(appSettings.recentFolders) ? appSettings.recentFolders : [];
          const next = [path, ...prev.filter((p: string) => p !== path)].slice(0, 12);
          if (JSON.stringify(next) !== JSON.stringify(prev)) {
            handleSettingsChange({ ...appSettings, recentFolders: next } as any);
          }
        }

        if (!preserveEditor && selectedImage) {
          debouncedSave.flush();
          debouncedSetHistory.cancel();
          setEditor({ selectedImage: null, finalPreviewUrl: null, uncroppedAdjustedPreviewUrl: null, histogram: null });
          setEditor({ adjustments: INITIAL_ADJUSTMENTS });
          resetHistory(INITIAL_ADJUSTMENTS);
          useEditorStore.getState().patchesSentToBackend.clear();
        }

        const command =
          libraryViewMode === LibraryViewMode.Recursive ? Invokes.ListImagesRecursive : Invokes.ListImagesInDir;

        let files: ImageFile[];
        if (preloadedImages) {
          files = preloadedImages;
        } else {
          files = await invoke(command, { path });
        }
        files = filterRemovedFromCatalog(files);

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) {
            initialRatings[f.path] = f.rating;
          }
        });
        setLibrary({ imageRatings: initialRatings });

        if (files.length > 0) {
          const paths = files.map((f: ImageFile) => f.path);

          // Show the grid immediately (thumbnails load progressively); EXIF fills in afterwards
          // and exif-based sorts (capture date, ISO…) re-sort once it arrives.
          setLibrary({ imageList: files });
          invoke(Invokes.ReadExifForPaths, { paths })
            .then((exifDataMap: any) => {
              if (useLibraryStore.getState().currentFolderPath !== path) return;
              setLibrary((state) => ({
                imageList: state.imageList.map((image) => ({
                  ...image,
                  exif: exifDataMap[image.path] || image.exif || null,
                })),
              }));
            })
            .catch((err) => {
              console.error('Failed to read EXIF data in background:', err);
            });
        } else {
          setLibrary({ imageList: files });
        }

        if (!preserveEditor) {
          invoke(Invokes.StartBackgroundIndexing, { folderPath: path }).catch((err) => {
            console.error('Failed to start background indexing:', err);
          });
        }
      } catch (err) {
        console.error('Failed to load folder contents:', err);
        toast.error('Failed to load images from the selected folder.');
      } finally {
        useLibraryStore.getState().setLibrary({ isViewLoading: false });
      }
    },
    [clearThumbnailQueue, refs],
  );

  const handleSelectAlbum = useCallback(
    async (albumId: string, albumName: string, imagePaths: string[], preserveEditor = false) => {
      const { setLibrary } = useLibraryStore.getState();
      const { setUI } = useUIStore.getState();

      if (!preserveEditor) {
        await invoke('cancel_thumbnail_generation');
        clearThumbnailQueue();
        useLibraryStore.getState().setSearchCriteria({ tags: [], text: '', mode: 'OR' });
        setLibrary({ libraryScrollTop: 0 });
        globalImageCache.clear();
        setUI({ activeView: 'library' });
      }

      setLibrary({
        isViewLoading: true,
        currentFolderPath: `Album: ${albumName}`,
        activeAlbumId: albumId,
      });

      try {
        const files: ImageFile[] = filterRemovedFromCatalog(
          await invoke(Invokes.GetAlbumImages, { paths: imagePaths }),
        );

        const initialRatings: Record<string, number> = {};
        files.forEach((f) => {
          if (f.rating !== undefined) initialRatings[f.path] = f.rating;
        });

        setLibrary({
          imageList: files,
          imageRatings: initialRatings,
          ...(preserveEditor ? {} : { multiSelectedPaths: [], libraryActivePath: null }),
        });
      } catch (err) {
        console.error('Failed to load album images:', err);
        toast.error(`Failed to load album: ${err}`);
      } finally {
        setLibrary({ isViewLoading: false });
      }
    },
    [clearThumbnailQueue],
  );

  const handleOpenFolder = async () => {
    const { osPlatform, appSettings, handleSettingsChange } = useSettingsStore.getState();
    const { rootPaths, folderTrees, setLibrary } = useLibraryStore.getState();
    const isAndroid = osPlatform === 'android';

    try {
      let selectedPath = '';
      if (isAndroid) {
        selectedPath = await invoke<string>(Invokes.GetOrCreateInternalLibraryRoot);
      } else {
        const selected = await open({ directory: true, multiple: false, defaultPath: await homeDir() });
        if (typeof selected === 'string') {
          selectedPath = selected;
        }
      }

      if (selectedPath) {
        if (libraryRootCoveredBy(rootPaths, selectedPath)) return;

        const keptRoots = rootPaths.filter((root) => !isLibraryPathInside(selectedPath, root));
        const newRootPaths = dedupeLibraryRoots([...keptRoots, selectedPath]);
        setLibrary({ rootPaths: newRootPaths });

        if (appSettings) {
          handleSettingsChange({ ...appSettings, rootFolders: newRootPaths } as any);
        }

        setLibrary({ isTreeLoading: true });
        try {
          const newTree = await invoke(Invokes.GetFolderTree, {
            path: selectedPath,
            expandedFolders: [selectedPath],
            showImageCounts:
              appSettings?.enableFolderImageCounts || appSettings?.folderTreeSort?.key === 'imageCount',
          });
          const keptTrees = folderTrees.filter((tree: { path: string }) =>
            keptRoots.some((root) => sameLibraryPath(root, tree.path)),
          );
          setLibrary({ folderTrees: [...keptTrees, newTree] });
        } catch (e) {
          toast.error(`Failed to load folder tree: ${e}`);
        } finally {
          setLibrary({ isTreeLoading: false });
        }
        await handleSelectSubfolder(selectedPath, true);
      }
    } catch (err) {
      console.error(isAndroid ? 'Failed to open Android library root:' : 'Failed to open directory dialog:', err);
      toast.error(isAndroid ? 'Failed to open library.' : 'Failed to open folder selection dialog.');
    }
  };

  const handleContinueSession = () => {
    const restore = async () => {
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { setLibrary } = useLibraryStore.getState();

      const storedRoots = appSettings?.rootFolders?.length
        ? appSettings.rootFolders
        : appSettings?.lastRootPath
          ? [appSettings.lastRootPath]
          : [];
      const rootFolders = dedupeLibraryRoots(storedRoots);

      if (rootFolders.length === 0) return;

      if (appSettings && rootFolders.join('\n') !== storedRoots.join('\n')) {
        handleSettingsChange({ ...appSettings, rootFolders } as any);
      }

      const folderState = appSettings?.lastFolderState;
      const pathToSelect = folderState?.currentFolderPath || rootFolders[0];

      setLibrary({ rootPaths: rootFolders });

      if (folderState?.expandedFolders) {
        const newExpandedFolders = new Set<string>(folderState.expandedFolders);
        setLibrary({ expandedFolders: newExpandedFolders });
      } else {
        setLibrary({ expandedFolders: new Set(rootFolders) });
      }

      setLibrary({ isTreeLoading: true });
      try {
        let treesData;
        if (preloadedDataRef.current?.rootPaths?.join() === rootFolders.join() && preloadedDataRef.current.trees) {
          treesData = await preloadedDataRef.current.trees;
          preloadedDataRef.current.trees = undefined;
        } else {
          const expandedArr = folderState?.expandedFolders
            ? Array.from(new Set(folderState.expandedFolders))
            : rootFolders;
          treesData = await invoke(Invokes.GetPinnedFolderTrees, {
            paths: rootFolders,
            expandedFolders: expandedArr,
            showImageCounts: appSettings?.enableFolderImageCounts || appSettings?.folderTreeSort?.key === 'imageCount',
          });
        }
        setLibrary({ folderTrees: treesData });
      } catch (err) {
        console.error('Failed to restore folder trees:', err);
      } finally {
        setLibrary({ isTreeLoading: false });
      }

      let preloadedImages: ImageFile[] | undefined = undefined;
      if (preloadedDataRef.current?.currentPath === pathToSelect && preloadedDataRef.current.images) {
        try {
          preloadedImages = await preloadedDataRef.current.images;
          preloadedDataRef.current.images = undefined;
        } catch (e) {
          console.error('Failed to retrieve preloaded images', e);
        }
      }

      if (pathToSelect && pathToSelect.startsWith('Album: ')) {
        const activeAlbumId = folderState?.activeAlbumId;
        if (activeAlbumId) {
          try {
            const albumTree: any = await invoke(Invokes.GetAlbums);
            setLibrary({ albumTree });

            const findObj = (nodes: any[]): any => {
              for (const n of nodes) {
                if (n.id === activeAlbumId) return n;
                if (n.type === 'group') {
                  const f = findObj(n.children);
                  if (f) return f;
                }
              }
              return null;
            };

            const album = findObj(albumTree);
            if (album) {
              await handleSelectAlbum(album.id, album.name, album.images);
            } else {
              await handleSelectSubfolder(rootFolders[0], false, undefined, false);
            }
          } catch (e) {
            console.error('Failed to restore album session:', e);
            await handleSelectSubfolder(rootFolders[0], false, undefined, false);
          }
        } else {
          await handleSelectSubfolder(rootFolders[0], false, undefined, false);
        }
      } else {
        await handleSelectSubfolder(pathToSelect, false, preloadedImages, false);
      }
    };

    restore().catch((err) => {
      console.error('Failed to restore session:', err);
      toast.error('Failed to restore session. A folder may have been moved or deleted.');
      handleGoHome();
      useLibraryStore.getState().setLibrary({ isTreeLoading: false });
    });
  };


  // Folder history back/forward (Alt+← / Alt+→)
  useEffect(() => {
    const onNav = (e: Event) => {
      const path = (e as CustomEvent).detail?.path as string | undefined;
      const fromHistory = !!(e as CustomEvent).detail?.fromHistory;
      if (!path) return;
      if (fromHistory) {
        (window as any).__rustroomSkipFolderHistory = true;
      }
      void handleSelectSubfolder(path, false, undefined, false).finally(() => {
        (window as any).__rustroomSkipFolderHistory = false;
      });
    };
    window.addEventListener('rustroom:navigate-folder', onNav as EventListener);
    return () => window.removeEventListener('rustroom:navigate-folder', onNav as EventListener);
  }, [handleSelectSubfolder]);

  return {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleContinueSession,
  };
}
