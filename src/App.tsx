import { type PointerEvent as ReactPointerEvent, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ClerkProvider } from '@clerk/react';
import { ToastContainer, toast, Slide } from 'react-toastify';
import clsx from 'clsx';

import ModuleBar from './components/panel/ModuleBar';
import FolderTree from './components/panel/FolderTree';
import SettingsPanel from './components/panel/SettingsPanel';
import ExportPanel from './components/panel/right/ExportPanel';
import LibraryRightPanel from './components/panel/library/LibraryRightPanel';
import Resizer from './components/ui/Resizer';
import GlobalTooltip from './components/ui/GlobalTooltip';
import AppModals from './components/modals/AppModals';
import ExportModal from './components/modals/ExportModal';
import ImageInfoModal from './components/modals/ImageInfoModal';
import ExportProgressBar from './components/ui/ExportProgressBar';

import EditorView from './components/views/EditorView';
import LibraryView from './components/views/LibraryView';
import MapModuleView from './components/views/MapModuleView';
import BorderModuleView from './components/views/BorderModuleView';
import WebModuleView from './components/views/WebModuleView';
import ModuleFilmstrip from './components/views/ModuleFilmstrip';
import { STUB_MODULES } from './components/panel/ModuleBar';


import { ContextMenuProvider } from './context/ContextMenuContext';
import { useSettingsStore } from './store/useSettingsStore';
import { useUIStore } from './store/useUIStore';
import { useLibraryStore } from './store/useLibraryStore';
import { useEditorStore } from './store/useEditorStore';
import { useProcessStore } from './store/useProcessStore';
import { useShallow } from 'zustand/react/shallow';

import { useThumbnails } from './hooks/useThumbnails';
import { ImageDimensions } from './hooks/useImageRenderSize';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTauriListeners } from './hooks/useTauriListeners';
import { useFileOperations } from './hooks/useFileOperations';
import { useAppContextMenus } from './hooks/useAppContextMenus';
import { useSortedLibrary } from './hooks/useSortedLibrary';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useExternalEditSession } from './hooks/useExternalEditSession';
import ExternalEditBar from './components/ui/ExternalEditBar';
import { Status } from './components/ui/ExportImportProperties';
import i18n from './i18n';
import { pickDevelopPath } from './utils/catalogMembership';

import { useEditorActions } from './hooks/useEditorActions';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useProductivityActions } from './hooks/useProductivityActions';

import { useAppInitialization } from './hooks/useAppInitialization';
import { useAndroidBackHandler } from './hooks/useAndroidBackHandler';
import './i18n';

import {
  Invokes,
  ImageFile,
  LibraryViewMode,
  Panel,
  Theme,
  Orientation,
  ThumbnailSize,
  ThumbnailAspectRatio,
} from './components/ui/AppProperties';

import ImageProcessingManager from './components/managers/ImageProcessingManager';
import ImageLoaderManager from './components/managers/ImageLoaderManager';

const CLERK_PUBLISHABLE_KEY = 'pk_test_YnJpZWYtc2Vhc25haWwtMTIuY2xlcmsuYWNjb3VudHMuZGV2JA'; // local dev key

const insertChildrenIntoTree = (node: any, targetPath: string, newChildren: any[]): any => {
  if (!node) return null;

  if (node.path === targetPath) {
    const mergedChildren = newChildren.map((newChild: any) => {
      const existingChild = node.children?.find((c: any) => c.path === newChild.path);
      if (existingChild && existingChild.children && existingChild.children.length > 0) {
        return { ...newChild, children: existingChild.children };
      }
      return newChild;
    });
    return { ...node, children: mergedChildren };
  }

  if (node.children && node.children.length > 0) {
    return {
      ...node,
      children: node.children.map((child: any) => insertChildrenIntoTree(child, targetPath, newChildren)),
    };
  }

  return node;
};

function App() {
  const COMPACT_EDITOR_MAX_WIDTH = 900;

  const { appSettings, theme, osPlatform, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
      osPlatform: state.osPlatform,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const {
    isFullScreen,
    lightsOut,
    isWindowFullScreen,
    isInstantTransition,
    isLayoutReady,
    uiVisibility,
    isLibraryExportPanelVisible,
    leftPanelWidth,
    rightPanelWidth,
    compactEditorPanelHeightOverride,
    activeRightPanel,
    isSettingsOpen,
    activeView,
    dualDisplayActive,
    setUI,
    setRightPanel,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      lightsOut: state.lightsOut,
      isWindowFullScreen: state.isWindowFullScreen,
      isInstantTransition: state.isInstantTransition,
      isLayoutReady: state.isLayoutReady,
      uiVisibility: state.uiVisibility,
      isLibraryExportPanelVisible: state.isLibraryExportPanelVisible,
      leftPanelWidth: state.leftPanelWidth,
      rightPanelWidth: state.rightPanelWidth,
      compactEditorPanelHeightOverride: state.compactEditorPanelHeightOverride,
      activeRightPanel: state.activeRightPanel,
      isSettingsOpen: state.isSettingsOpen,
      activeView: state.activeView,
      dualDisplayActive: state.dualDisplayActive,
      setUI: state.setUI,
      setRightPanel: state.setRightPanel,
    })),
  );
  const mapImageList = useUIStore((state) => state.mapImageList);

  const { rootPaths, currentFolderPath, expandedFolders, multiSelectedPaths, setLibrary } = useLibraryStore(
    useShallow((state) => ({
      rootPaths: state.rootPaths,
      currentFolderPath: state.currentFolderPath,
      expandedFolders: state.expandedFolders,
      multiSelectedPaths: state.multiSelectedPaths,
      setLibrary: state.setLibrary,
    })),
  );

  const { selectedImage, activeMaskContainerId, activeAiPatchContainerId, hasRenderedFirstFrame, setEditor } =
    useEditorStore(
      useShallow((state) => ({
        selectedImage: state.selectedImage,
        activeMaskContainerId: state.activeMaskContainerId,
        activeAiPatchContainerId: state.activeAiPatchContainerId,
        hasRenderedFirstFrame: state.hasRenderedFirstFrame,
        setEditor: state.setEditor,
      })),
    );

  const { exportState, setExportState } = useProcessStore(
    useShallow((state) => ({
      exportState: state.exportState,
      setExportState: state.setExportState,
    })),
  );

  const defaultThumbnailSize = osPlatform === 'android' ? ThumbnailSize.Small : ThumbnailSize.Medium;
  const defaultLibraryViewMode = osPlatform === 'android' ? LibraryViewMode.Recursive : LibraryViewMode.Flat;

  const selectedImagePathRef = useRef<string | null>(null);
  useEffect(() => {
    selectedImagePathRef.current = selectedImage?.path ?? null;
  }, [selectedImage?.path]);

  const prevAdjustmentsRef = useRef<any>(null);

  const [viewportSize, setViewportSize] = useState<ImageDimensions>(() => {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.round(window.visualViewport?.width ?? window.innerWidth),
      height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    };
  });

  const isBackendReadyRef = useRef(true);
  const previewJobIdRef = useRef<number>(0);
  const latestRenderedJobIdRef = useRef<number>(0);
  const currentResRef = useRef<number>(1280);
  const cachedEditStateRef = useRef<any | null>(null);

  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(defaultLibraryViewMode);
  const [isResizing, setIsResizing] = useState(false);
  const [thumbnailSize, setThumbnailSize] = useState(defaultThumbnailSize);
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(ThumbnailAspectRatio.Cover);

  const { requestThumbnails, clearThumbnailQueue, markGenerated } = useThumbnails();

  const transformWrapperRef = useRef<any>(null);
  const preloadedDataRef = useRef<{
    trees?: Promise<any>;
    images?: Promise<ImageFile[]>;
    rootPaths?: string[];
    currentPath?: string;
  }>({});

  useAppInitialization({
    preloadedDataRef,
    thumbnailSize,
    setThumbnailSize,
    thumbnailAspectRatio,
    setThumbnailAspectRatio,
    libraryViewMode,
    setLibraryViewMode,
  });

  const isAndroid = osPlatform === 'android';
  const isPortraitViewport = viewportSize.width > 0 && viewportSize.height > viewportSize.width;
  const isCompactPortrait =
    viewportSize.width > 0 && viewportSize.width <= COMPACT_EDITOR_MAX_WIDTH && isPortraitViewport;

  const compactEditorPanelMinHeight = 220;
  const compactEditorPanelMaxHeight =
    viewportSize.height > 0
      ? Math.max(compactEditorPanelMinHeight, Math.min(Math.round(viewportSize.height * 0.85), 850))
      : 520;

  const getDynamicCompactPanelHeight = () => {
    const { originalSize, adjustments } = useEditorStore.getState();
    const halfScreenHeight = viewportSize.height > 0 ? Math.round(viewportSize.height * 0.5) : 340;

    if (!selectedImage || originalSize.width === 0 || originalSize.height === 0 || viewportSize.width === 0) {
      return halfScreenHeight;
    }
    let effectiveRatio = originalSize.width / originalSize.height;
    const orientationSteps = adjustments?.orientationSteps || 0;
    if (orientationSteps % 2 !== 0) {
      effectiveRatio = originalSize.height / originalSize.width;
    }
    if (adjustments?.aspectRatio && adjustments.aspectRatio > 0) {
      effectiveRatio = adjustments.aspectRatio;
    }
    const squeeze = Number((adjustments as any)?.anamorphicSqueeze);
    if (Number.isFinite(squeeze) && squeeze > 1.01) {
      effectiveRatio *= squeeze;
    }
    const desiredImageHeight = viewportSize.width / effectiveRatio;
    const topUiEstimation = !appSettings?.decorations && !isWindowFullScreen ? 110 : 60;
    const totalDesiredTopHeight = desiredImageHeight + topUiEstimation;
    const calculatedBottomHeight = Math.round(viewportSize.height - totalDesiredTopHeight);
    return Math.max(halfScreenHeight, calculatedBottomHeight);
  };

  const compactEditorPanelDefaultHeight = getDynamicCompactPanelHeight();
  const compactEditorPanelHeight = Math.max(
    compactEditorPanelMinHeight,
    Math.min(compactEditorPanelHeightOverride ?? compactEditorPanelDefaultHeight, compactEditorPanelMaxHeight),
  );
  const compactEditorPanelCollapsedHeight = 96;

  const { handleCopyAdjustments, handlePasteAdjustments, handleMatchPrevious, handleSyncSettings, handleResetAdjustments, handleZoomChange } =
    useEditorActions();

  const navigationRefs = {
    transformWrapperRef,
    preloadedDataRef,
    cachedEditStateRef,
    selectedImagePathRef,
    isBackendReadyRef,
    latestRenderedJobIdRef,
    previewJobIdRef,
    currentResRef,
    prevAdjustmentsRef,
  };

  const {
    handleGoHome,
    handleBackToLibrary,
    handleImageSelect,
    handleSelectSubfolder,
    handleSelectAlbum,
    handleOpenFolder,
    handleContinueSession,
  } = useAppNavigation({
    clearThumbnailQueue,
    refs: navigationRefs,
  });

  const {
    externalEditSession,
    isFinishing: isExternalEditFinishing,
    finishExternalEdit,
  } = useExternalEditSession(handleImageSelect);

  const {
    handleRate,
    handleClearSelection,
    handleLibraryImageSingleClick,
    handleImageClick,
    handleSetColorLabel,
    handleSetFlag,
    refreshAllFolderTrees,
    handleTogglePinFolder,
    handleCreateAlbumItem,
    handleRenameAlbumItem,
  } = useLibraryActions(handleImageSelect);

  const { displayList: sortedImageList, badges: groupBadgeInfo } = useSortedLibrary();
  const libraryActivePath = useLibraryStore((s) => s.libraryActivePath);

  const handleLibraryRefresh = useCallback(async () => {
    if (currentFolderPath) {
      if (currentFolderPath.startsWith('Album: ')) {
        const { activeAlbumId, albumTree } = useLibraryStore.getState();
        if (activeAlbumId) {
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
          if (album) await handleSelectAlbum(album.id, album.name, album.images, true);
        }
      } else {
        await handleSelectSubfolder(currentFolderPath, false, undefined, false, true);
      }
    }
  }, [currentFolderPath, handleSelectSubfolder, handleSelectAlbum]);

  useEffect(() => {
    const onRefresh = () => {
      void handleLibraryRefresh();
    };
    window.addEventListener('rustroom:library-refresh', onRefresh);
    return () => window.removeEventListener('rustroom:library-refresh', onRefresh);
  }, [handleLibraryRefresh]);

  const {
    executeDelete,
    handleDeleteSelected,
    handleCreateFolder,
    handleRenameFolder,
    handleSaveRename,
    handleRenameFiles,
    handleStartImport,
    handleImportClick,
    handlePasteFiles,
  } = useFileOperations(
    handleLibraryRefresh,
    refreshAllFolderTrees,
    handleImageSelect,
    handleBackToLibrary,
    sortedImageList,
  );

  const {
    handleStartPanorama,
    handleSavePanorama,
    handleStartHdr,
    handleSaveHdr,
    handleApplyDenoise,
    handleBatchDenoise,
    handleSaveDenoisedImage,
    handleSaveCollage,
  } = useProductivityActions(handleLibraryRefresh);

  const {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleAlbumTreeContextMenu,
    handleMainLibraryContextMenu,
  } = useAppContextMenus({
    handleImageSelect,
    handleBackToLibrary,
    handleLibraryRefresh,
    handleRenameFiles,
    handleImportClick,
    refreshAllFolderTrees,
    refreshImageList: handleLibraryRefresh,
    executeDelete,
    handleTogglePinFolder,
    handleSelectSubfolder,
    handleSelectAlbum,
  });

  useTauriListeners({
    refreshAllFolderTrees,
    handleSelectSubfolder,
    refreshImageList: handleLibraryRefresh,
    markGenerated,
  });

  useAndroidBackHandler();

  const handleToggleFullScreen = useCallback(() => {
    const { zoom, selectedImage } = useEditorStore.getState();
    const currentlyZoomed = zoom > 1.01;
    setUI({ isInstantTransition: currentlyZoomed });

    if (isFullScreen) {
      setUI({ isFullScreen: false });
    } else {
      if (!selectedImage) return;
      setUI({ isFullScreen: true });
    }

    if (currentlyZoomed) {
      setTimeout(() => setUI({ isInstantTransition: false }), 100);
    }
  }, [isFullScreen, setUI]);


  // Soft proof Create Proof Copy / other modules: open path in Develop
  useEffect(() => {
    const onOpen = (e: Event) => {
      const path = (e as CustomEvent)?.detail?.path as string | undefined;
      if (path) handleImageSelect(path);
    };
    window.addEventListener('rustroom:open-image', onOpen as EventListener);
    return () => window.removeEventListener('rustroom:open-image', onOpen as EventListener);
  }, [handleImageSelect]);

  useEffect(() => {
    const onGo = (e: Event) => {
      const folder = (e as CustomEvent)?.detail?.folder as string | undefined;
      if (folder) handleSelectSubfolder(folder, false, undefined, true, false);
    };
    window.addEventListener('rustroom:go-to-folder', onGo as EventListener);
    return () => window.removeEventListener('rustroom:go-to-folder', onGo as EventListener);
  }, [handleSelectSubfolder]);


  useKeyboardShortcuts({
    sortedImageList,
    handleBackToLibrary,
    handleDeleteSelected,
    handleImageSelect,
    handlePasteFiles,
    handleToggleFullScreen,
    handleZoomChange,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportSize = () => {
      const nextViewportSize = {
        width: Math.round(window.visualViewport?.width ?? window.innerWidth),
        height: Math.round(window.visualViewport?.height ?? window.innerHeight),
      };

      setViewportSize((prev) =>
        prev.width === nextViewportSize.width && prev.height === nextViewportSize.height ? prev : nextViewportSize,
      );
    };

    updateViewportSize();

    window.addEventListener('resize', updateViewportSize);
    window.addEventListener('orientationchange', updateViewportSize);
    window.visualViewport?.addEventListener('resize', updateViewportSize);

    return () => {
      window.removeEventListener('resize', updateViewportSize);
      window.removeEventListener('orientationchange', updateViewportSize);
      window.visualViewport?.removeEventListener('resize', updateViewportSize);
    };
  }, []);

  useEffect(() => {
    const handleGlobalContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu);
  }, []);

  const isLightTheme = useMemo(() => [Theme.Light, Theme.Snow, Theme.Arctic].includes(theme as Theme), [theme]);

  useEffect(() => {
    if (
      (activeRightPanel !== Panel.Masks || !activeMaskContainerId) &&
      (activeRightPanel !== Panel.Ai || !activeAiPatchContainerId)
    ) {
      setEditor({ isMaskControlHovered: false });
    }
  }, [activeRightPanel, activeMaskContainerId, activeAiPatchContainerId, setEditor]);

  useEffect(() => {
    const unlisten = listen('ai-connector-status-update', (event: any) => {
      setEditor({ isAIConnectorConnected: event.payload.connected });
    });
    invoke(Invokes.CheckAIConnectorStatus);
    const interval = setInterval(() => invoke(Invokes.CheckAIConnectorStatus), 10000);
    return () => {
      clearInterval(interval);
      unlisten.then((f) => f());
    };
  }, [setEditor]);

  const createResizeHandler = (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const pointerId = e.pointerId;
    const target = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;

    const previousTouchAction = document.documentElement.style.touchAction;
    const previousUserSelect = document.documentElement.style.userSelect;

    target.setPointerCapture?.(pointerId);
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.userSelect = 'none';

    const doDrag = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();

      if (stateKey === 'left') {
        setUI({ leftPanelWidth: Math.round(Math.max(200, Math.min(startSize + (moveEvent.clientX - startX), 500))) });
      } else if (stateKey === 'right') {
        setUI({ rightPanelWidth: Math.round(Math.max(280, Math.min(startSize - (moveEvent.clientX - startX), 600))) });
      } else if (stateKey === 'bottom') {
        setUI({
          bottomPanelHeight: Math.round(Math.max(64, Math.min(startSize - (moveEvent.clientY - startY), 280))),
        });
      } else if (stateKey === 'compact') {
        setUI({
          compactEditorPanelHeightOverride: Math.round(
            Math.max(
              compactEditorPanelMinHeight,
              Math.min(startSize - (moveEvent.clientY - startY), compactEditorPanelMaxHeight),
            ),
          ),
        });
      }
    };

    const stopDrag = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);

      document.documentElement.style.cursor = '';
      document.documentElement.style.touchAction = previousTouchAction;
      document.documentElement.style.userSelect = previousUserSelect;

      window.removeEventListener('pointermove', doDrag);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      setIsResizing(false);
    };
    document.documentElement.style.cursor =
      stateKey === 'bottom' || stateKey === 'compact' ? 'row-resize' : 'col-resize';

    window.addEventListener('pointermove', doDrag, { passive: false });
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  };

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const checkFullscreen = async () => {
      setUI({ isWindowFullScreen: await appWindow.isFullscreen() });
    };
    checkFullscreen();
    appWindow.setDecorations(true).catch(() => {});
    const unlistenPromise = appWindow.onResized(checkFullscreen);
    const unlistenMenu = listen('menu-export', () => {
      setUI({ isExportModalOpen: true });
    });
    const unlistenDual = listen('dual-display-changed', (event: any) => {
      const enabled = !!event.payload?.enabled;
      setUI({
        dualDisplayActive: enabled,
        dualDisplayPrincipalId: event.payload?.principalId || null,
      });
      if (event.payload?.error) {
        toast.error(event.payload.error);
      }
    });
    const unlistenDualErr = listen('dual-display-error', (event: any) => {
      toast.error(typeof event.payload === 'string' ? event.payload : 'Double écran indisponible');
    });
    const unlistenImportLr = listen('menu-import-lrcat', async () => {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          filters: [{ name: 'Lightroom Catalog', extensions: ['lrcat'] }],
        });
        if (!selected || Array.isArray(selected)) return;
        const result = await invoke<{ collections: number; photos: number; missing: number }>(
          Invokes.ImportLightroomCatalog,
          { path: selected },
        );
        const albums = await invoke(Invokes.GetAlbums);
        useLibraryStore.getState().setLibrary({ albumTree: albums as any });
        toast.success(
          `Catalogue Lightroom importé : ${result.photos} photo(s), ${result.collections} collection(s)` +
            (result.missing ? ` (${result.missing} fichier(s) introuvable(s))` : ''),
        );
      } catch (err) {
        console.error(err);
        toast.error(`Import Lightroom impossible : ${err}`);
      }
    });
    return () => {
      unlistenPromise.then((unlisten: any) => unlisten());
      unlistenMenu.then((unlisten: any) => unlisten());
      unlistenDual.then((unlisten: any) => unlisten());
      unlistenDualErr.then((unlisten: any) => unlisten());
      unlistenImportLr.then((unlisten: any) => unlisten());
    };
  }, [setUI]);

  useEffect(() => {
    if (!dualDisplayActive) return;
    const path =
      activeView === 'develop'
        ? selectedImage?.path || null
        : libraryActivePath || useLibraryStore.getState().multiSelectedPaths[0] || null;
    const name = path ? path.split(/[/\\]/).pop() || '' : '';
    emit('dual-display-show', {
      mode: activeView === 'develop' ? 'develop' : path ? 'library' : 'empty',
      path,
      name,
    }).catch(() => {});
  }, [dualDisplayActive, activeView, selectedImage?.path, libraryActivePath]);

  useEffect(() => {
    const unlisten = listen('dual-display-nav', (event: any) => {
      const dir = Number(event.payload?.dir) || 0;
      if (!dir) return;
      const list = sortedImageList;
      if (!list.length) return;
      const current =
        useEditorStore.getState().selectedImage?.path ||
        useLibraryStore.getState().libraryActivePath ||
        useLibraryStore.getState().multiSelectedPaths[0];
      const idx = Math.max(0, list.findIndex((img) => img.path === current));
      const next = list[(idx + dir + list.length) % list.length];
      if (!next) return;
      if (useUIStore.getState().activeView === 'develop') {
        handleImageSelect(next.path);
      } else {
        handleLibraryImageSingleClick(next.path, { shiftKey: false, metaKey: false, ctrlKey: false });
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [sortedImageList, handleImageSelect, handleLibraryImageSingleClick]);

  const handleRightPanelSelect = useCallback(
    (panelId: Panel) => {
      setRightPanel(panelId);
      setEditor({ activeMaskId: null, activeAiSubMaskId: null, isWbPickerActive: false, isPointColorPickerActive: false });
    },
    [setRightPanel, setEditor],
  );

  const handleToggleFolder = useCallback(
    async (path: string) => {
      const isExpanding = !expandedFolders.has(path);
      setLibrary((state) => {
        const newSet = new Set(state.expandedFolders);
        if (isExpanding) {
          newSet.add(path);
        } else {
          newSet.delete(path);
        }
        return { expandedFolders: newSet };
      });
      if (!isExpanding) return;
      try {
        const showCounts = appSettings?.enableFolderImageCounts ?? false;
        const newChildren: any[] = await invoke(Invokes.GetFolderChildren, {
          path,
          showImageCounts: showCounts,
        });
        setLibrary((state) => ({
          folderTrees: state.folderTrees.map((t: any) => insertChildrenIntoTree(t, path, newChildren)),
        }));
        setLibrary((state) => ({
          pinnedFolderTrees: state.pinnedFolderTrees.map((tree) => insertChildrenIntoTree(tree, path, newChildren)),
        }));
      } catch (err) {
        toast.error(`Failed to load folder: ${err}`);
      }
    },
    [expandedFolders, appSettings?.enableFolderImageCounts, setLibrary],
  );

  const hasRoots = rootPaths && rootPaths.length > 0;
  // No welcome screen: Library (with its panels and Import bar) is always the landing view.
  const hasMainContent = hasRoots || !!selectedImage || activeView === 'library' || activeView === 'develop';

  // Land straight in the last session on launch (replaces the "Continue session" splash).
  const autoContinuedRef = useRef(false);
  useEffect(() => {
    if (autoContinuedRef.current || !appSettings || hasRoots) return;
    autoContinuedRef.current = true;
    if (appSettings.rootFolders?.length || appSettings.lastRootPath) handleContinueSession();
  }, [appSettings, hasRoots, handleContinueSession]);

  const renderFolderTree = () => {

    return (
      <div
        className={clsx(
          'flex h-full overflow-hidden shrink-0',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
        style={{
          maxWidth: isFullScreen ? '0px' : '1000px',
          opacity: isFullScreen ? 0 : 1,
        }}
      >
        <FolderTree
          isResizing={isResizing}
          isVisible={uiVisibility.folderTree}
          onContextMenu={handleFolderTreeContextMenu}
          onAlbumContextMenu={handleAlbumTreeContextMenu}
          onSelectAlbum={handleSelectAlbum}
          onFolderSelect={(path) => handleSelectSubfolder(path, false)}
          onToggleFolder={handleToggleFolder}
          onOpenFolder={handleOpenFolder}
          setIsVisible={(value: boolean) =>
            setUI((state) => ({ uiVisibility: { ...state.uiVisibility, folderTree: value } }))
          }
          style={{ width: uiVisibility.folderTree ? `${leftPanelWidth}px` : '32px' }}
          isInstantTransition={isInstantTransition}
        />
        <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('left', leftPanelWidth)} />
      </div>
    );
  };

  const shouldHideFolderTree =
    isAndroid || !!selectedImage || activeView === 'develop' || STUB_MODULES.includes(activeView as any);
  const isWgpuActive =
    !dualDisplayActive &&
    appSettings?.useWgpuRenderer !== false &&
    selectedImage?.isReady &&
    hasRenderedFirstFrame;
  const useMacWindowShell = osPlatform === 'macos' && !appSettings?.decorations && !isWindowFullScreen && !isFullScreen;

  return (
    <>
      <ImageProcessingManager
        transformWrapperRef={transformWrapperRef}
        prevAdjustmentsRef={prevAdjustmentsRef}
        previewJobIdRef={previewJobIdRef}
        latestRenderedJobIdRef={latestRenderedJobIdRef}
        currentResRef={currentResRef}
      />
      <ImageLoaderManager cachedEditStateRef={cachedEditStateRef} />
      <div
        className={clsx(
          'flex flex-col h-screen font-sans text-text-primary overflow-hidden select-none',
          useMacWindowShell && 'macos-window-shell',
          isWgpuActive
            ? 'bg-transparent'
            : lightsOut === 2
              ? 'bg-black'
              : lightsOut === 1
                ? 'bg-bg-primary brightness-[0.72]'
                : 'bg-bg-primary',
        )}
      >
        <ExportProgressBar />
        {!isFullScreen && hasMainContent && (
          <ModuleBar
            isInstantTransition={isInstantTransition}
            onBackToLibrary={handleBackToLibrary}
            onOpenDevelop={(path) => {
              const { libraryActivePath, multiSelectedPaths, imageList, albumTree } = useLibraryStore.getState();
              const target = pickDevelopPath(albumTree, [
                path,
                libraryActivePath,
                ...(multiSelectedPaths || []),
                ...imageList.map((img) => img.path),
              ]);
              setUI({
                activeView: 'develop',
                activeRightPanel: useUIStore.getState().activeRightPanel || Panel.Adjustments,
                renderedRightPanel: useUIStore.getState().renderedRightPanel || Panel.Adjustments,
                uiVisibility: {
                  ...useUIStore.getState().uiVisibility,
                  developLeft: true,
                  filmstrip: true,
                },
              });
              if (target) handleImageSelect(target);
            }}
          />
        )}
        <div
          className={clsx(
            'flex-1 flex flex-col min-h-0',
            isLayoutReady && hasMainContent && !isInstantTransition && 'transition-all duration-300 ease-in-out',
            [hasMainContent && (isFullScreen ? 'p-0 gap-0' : 'p-2 gap-2')],
          )}
        >
          <div className="flex flex-row grow h-full min-h-0">
            {!shouldHideFolderTree && renderFolderTree()}
            <div className="relative flex-1 flex flex-col min-w-0">
              {selectedImage && externalEditSession && (
                <ExternalEditBar
                  session={externalEditSession}
                  isFinishing={isExternalEditFinishing}
                  errorMessage={exportState.status === Status.Error ? exportState.errorMessage : ''}
                  onDone={finishExternalEdit}
                />
              )}
              {STUB_MODULES.includes(activeView as any) ? (
                <div className="flex flex-col flex-1 min-h-0 w-full">
                  <div className="flex-1 min-h-0 flex flex-col">
                    {activeView === 'map' ? (
                      <MapModuleView
                        onBackToLibrary={() => { setUI({ activeView: 'library' }); handleBackToLibrary(); }}
                        onOpenDevelop={(path) => handleImageSelect(path)}
                      />
                    ) : activeView === 'border' ? (
                      <BorderModuleView
                        onBackToLibrary={() => { setUI({ activeView: 'library' }); handleBackToLibrary(); }}
                        imageList={sortedImageList}
                        onRequestThumbnails={requestThumbnails}
                      />
                    ) : (
                      <WebModuleView onBackToLibrary={() => { setUI({ activeView: 'library' }); handleBackToLibrary(); }} />
                    )}
                  </div>
                  {/* Border renders its own photo strip (click/drag into the layout) */}
                  {activeView !== 'border' && (
                  <ModuleFilmstrip
                    imageList={
                      activeView === 'map' || activeView === 'web'
                        ? mapImageList ?? []
                        : sortedImageList
                    }
                    onImageSelect={(path, e) => handleLibraryImageSingleClick(path, e)}
                    onImageDoubleClick={handleImageSelect}
                    onContextMenu={handleThumbnailContextMenu}
                    onRate={handleRate}
                    onSetColorLabel={handleSetColorLabel}
                    onSetFlag={handleSetFlag}
                    onRequestThumbnails={requestThumbnails}
                    onCopy={handleCopyAdjustments}
                    onPaste={() => handlePasteAdjustments()}
                    onMatchPrevious={handleMatchPrevious}
                    isMatchPreviousDisabled={!useEditorStore.getState().previousDevelopAdjustments}
                    onSyncSettings={handleSyncSettings}
                    isSyncSettingsDisabled={(useLibraryStore.getState().multiSelectedPaths?.length || 0) < 2}
                  />
                  )}
                </div>
              ) : selectedImage || activeView === 'develop' ? (
                <EditorView
                  transformWrapperRef={transformWrapperRef}
                  isResizing={isResizing}
                  isCompactPortrait={isCompactPortrait}
                  isAndroid={isAndroid}
                  compactEditorPanelHeight={compactEditorPanelHeight}
                  compactEditorPanelCollapsedHeight={compactEditorPanelCollapsedHeight}
                  thumbnailAspectRatio={thumbnailAspectRatio}
                  sortedImageList={sortedImageList}
                  createResizeHandler={createResizeHandler}
                  handleBackToLibrary={handleBackToLibrary}
                  handleEditorContextMenu={handleEditorContextMenu}
                  handleThumbnailContextMenu={handleThumbnailContextMenu}
                  handleImageClick={handleImageClick}
                  handleClearSelection={handleClearSelection}
                  handleCopyAdjustments={handleCopyAdjustments}
                  handlePasteAdjustments={handlePasteAdjustments}
                  handleMatchPrevious={handleMatchPrevious}
                  handleSyncSettings={handleSyncSettings}
                  handleSetColorLabel={handleSetColorLabel}
                  handleSetFlag={handleSetFlag}
                  handleRate={handleRate}
                  handleZoomChange={handleZoomChange}
                  handleRightPanelSelect={handleRightPanelSelect}
                  requestThumbnails={requestThumbnails}
                />
              ) : (
                <LibraryView
                  sortedImageList={sortedImageList}
                  groupBadgeInfo={groupBadgeInfo}
                  thumbnailSize={thumbnailSize}
                  thumbnailAspectRatio={thumbnailAspectRatio}
                  libraryViewMode={libraryViewMode}
                  isAndroid={isAndroid}
                  setThumbnailSize={setThumbnailSize}
                  setThumbnailAspectRatio={setThumbnailAspectRatio}
                  setLibraryViewMode={setLibraryViewMode}
                  handleClearSelection={handleClearSelection}
                  handleLibraryImageSingleClick={handleLibraryImageSingleClick}
                  handleImageSelect={handleImageSelect}
                  handleRate={handleRate}
                  handleSetColorLabel={handleSetColorLabel}
                  handleSetFlag={handleSetFlag}
                  handleThumbnailContextMenu={handleThumbnailContextMenu}
                  handleMainLibraryContextMenu={handleMainLibraryContextMenu}
                  handleContinueSession={handleContinueSession}
                  handleGoHome={handleGoHome}
                  handleOpenFolder={handleOpenFolder}
                  handleImportClick={handleImportClick}
                  handleLibraryRefresh={handleLibraryRefresh}
                  handleCopyAdjustments={handleCopyAdjustments}
                  handlePasteAdjustments={handlePasteAdjustments}
                  handleMatchPrevious={handleMatchPrevious}
                  handleSyncSettings={handleSyncSettings}
                  handleResetAdjustments={handleResetAdjustments}
                  requestThumbnails={requestThumbnails}
                />
              )}
              {isSettingsOpen && appSettings && hasRoots && (
                <div className="absolute inset-0 z-50 flex bg-bg-secondary rounded-lg">
                  <div className="w-full h-full flex flex-col p-4 lg:p-8 overflow-y-auto custom-scrollbar">
                    <SettingsPanel
                      appSettings={appSettings}
                      onBack={() => setUI({ isSettingsOpen: false })}
                      onLibraryRefresh={handleLibraryRefresh}
                      onSettingsChange={handleSettingsChange}
                      rootPaths={rootPaths}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Library right rail: Library module only (never Develop / empty Develop). */}
            {activeView === 'library' &&
              !selectedImage &&
              !STUB_MODULES.includes(activeView as any) &&
              !isFullScreen &&
              hasMainContent &&
              uiVisibility.libraryRight !== false && (
              <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('right', rightPanelWidth)} />
            )}
            <div
              className={clsx(
                'shrink-0 overflow-hidden',
                !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
              )}
              style={{
                width:
                  activeView === 'library' &&
                  !selectedImage &&
                  !STUB_MODULES.includes(activeView as any) &&
                  !isFullScreen &&
                  hasMainContent &&
                  uiVisibility.libraryRight !== false
                    ? `${rightPanelWidth}px`
                    : '0px',
              }}
            >
              <div style={{ width: `${rightPanelWidth}px` }} className="h-full">
                {isLibraryExportPanelVisible ? (
                  <ExportPanel
                    exportState={exportState}
                    multiSelectedPaths={multiSelectedPaths}
                    selectedImage={null}
                    setExportState={setExportState}
                    appSettings={appSettings}
                    onSettingsChange={handleSettingsChange}
                    rootPaths={rootPaths}
                    isVisible={isLibraryExportPanelVisible}
                    onClose={() => setUI({ isLibraryExportPanelVisible: false })}
                  />
                ) : (
                  activeView === 'library' &&
                  !selectedImage &&
                  !STUB_MODULES.includes(activeView as any) &&
                  hasMainContent &&
                  uiVisibility.libraryRight !== false && <LibraryRightPanel />
                )}
              </div>
            </div>
          </div>
        </div>
        <ExportModal />
        <ImageInfoModal />
        <AppModals
          handleImageSelect={handleImageSelect}
          handleSavePanorama={handleSavePanorama}
          handleStartPanorama={handleStartPanorama}
          handleSaveHdr={handleSaveHdr}
          handleStartHdr={handleStartHdr}
          refreshImageList={handleLibraryRefresh}
          handleApplyDenoise={handleApplyDenoise}
          handleBatchDenoise={handleBatchDenoise}
          handleSaveDenoisedImage={handleSaveDenoisedImage}
          handleCreateFolder={handleCreateFolder}
          handleRenameFolder={handleRenameFolder}
          handleSaveRename={handleSaveRename}
          handleStartImport={handleStartImport}
          handleSetColorLabel={handleSetColorLabel}
          handleRate={handleRate}
          executeDelete={executeDelete}
          handleSaveCollage={handleSaveCollage}
          handleCreateAlbumItem={handleCreateAlbumItem}
          handleRenameAlbumItem={handleRenameAlbumItem}
        />
        <ToastContainer
          position="bottom-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable={false}
          pauseOnHover
          theme={isLightTheme ? 'light' : 'dark'}
          transition={Slide}
          toastClassName={() =>
            clsx(
              'relative flex min-h-16 p-4 rounded-lg justify-between overflow-hidden cursor-pointer mb-4',
              'bg-surface! text-text-primary! border! border-border-color! shadow-2xl! max-w-[420px]!',
            )
          }
        />
      </div>
    </>
  );
}

const AppWrapper = () => (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} routerPush={(to) => {}} routerReplace={(to) => {}}>
    <ContextMenuProvider>
      <App />
      <GlobalTooltip />
    </ContextMenuProvider>
  </ClerkProvider>
);

export default AppWrapper;
