import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Paintbrush, X } from 'lucide-react';

import CommunityPage from '../panel/CommunityPage';
import MainLibrary from '../panel/MainLibrary';
import LibraryBottomBar from '../panel/library/LibraryBottomBar';

import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';

import { ImageFile, LibraryDisplayMode, LibraryViewMode, ThumbnailAspectRatio, ThumbnailSize } from '../ui/AppProperties';
import { GroupBadgeInfo, GroupId } from '../../utils/imageGrouping';

interface LibraryViewProps {
  sortedImageList: ImageFile[];
  groupBadgeInfo: Map<GroupId, GroupBadgeInfo> | null;
  thumbnailSize: ThumbnailSize;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  libraryViewMode: LibraryViewMode;
  isAndroid: boolean;
  setThumbnailSize: (size: ThumbnailSize) => void;
  setThumbnailAspectRatio: (ratio: ThumbnailAspectRatio) => void;
  setLibraryViewMode: (mode: LibraryViewMode) => void;
  handleClearSelection: () => void;
  handleLibraryImageSingleClick: (...args: any) => void;
  handleImageSelect: (...args: any) => void;
  handleRate: (...args: any) => void;
  handleSetColorLabel: (...args: any) => void;
  handleSetFlag: (...args: any) => void;
  handleThumbnailContextMenu: (...args: any) => void;
  handleMainLibraryContextMenu: (...args: any) => void;
  handleContinueSession: (...args: any) => void;
  handleGoHome: (...args: any) => void;
  handleOpenFolder: (...args: any) => void;
  handleImportClick: (path: string) => void;
  handleLibraryRefresh: () => Promise<void>;
  handleCopyAdjustments: () => void;
  handlePasteAdjustments: () => void;
  handleMatchPrevious?: () => void;
  handleSyncSettings?: () => void;
  handleResetAdjustments: () => void;
  requestThumbnails: any;
}

export default function LibraryView({
  sortedImageList,
  groupBadgeInfo,
  thumbnailSize,
  thumbnailAspectRatio,
  libraryViewMode,
  isAndroid,
  setThumbnailSize,
  setThumbnailAspectRatio,
  setLibraryViewMode,
  handleClearSelection,
  handleLibraryImageSingleClick,
  handleImageSelect,
  handleRate,
  handleSetColorLabel,
  handleSetFlag,
  handleThumbnailContextMenu,
  handleMainLibraryContextMenu,
  handleContinueSession,
  handleGoHome,
  handleOpenFolder,
  handleImportClick,
  handleLibraryRefresh,
  handleCopyAdjustments,
  handlePasteAdjustments,
  handleMatchPrevious,
  handleSyncSettings,
  handleResetAdjustments,
  requestThumbnails,
}: LibraryViewProps) {
  const { activeView, setUI } = useUIStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setUI: state.setUI,
    })),
  );

  const {
    rootPaths,
    currentFolderPath,
    libraryActivePath,
    multiSelectedPaths,
    imageList,
    imageRatings,
    isViewLoading,
    isTreeLoading,
    setLibrary,
  } = useLibraryStore(
    useShallow((state) => ({
      rootPaths: state.rootPaths,
      currentFolderPath: state.currentFolderPath,
      libraryActivePath: state.libraryActivePath,
      multiSelectedPaths: state.multiSelectedPaths,
      imageList: state.imageList,
      imageRatings: state.imageRatings,
      isViewLoading: state.isViewLoading,
      isTreeLoading: state.isTreeLoading,
      setLibrary: state.setLibrary,
    })),
  );

  const { appSettings, supportedTypes, theme, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      supportedTypes: state.supportedTypes,
      theme: state.theme,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const { aiModelDownloadStatus, importState, indexingProgress, isIndexing, thumbnailProgress, isCopied, isPasted } =
    useProcessStore(
      useShallow((state) => ({
        aiModelDownloadStatus: state.aiModelDownloadStatus,
        importState: state.importState,
        indexingProgress: state.indexingProgress,
        isIndexing: state.isIndexing,
        thumbnailProgress: state.thumbnailProgress,
        isCopied: state.isCopied,
        isPasted: state.isPasted,
      })),
    );

  const openLoupe = (path: string) => {
    setLibrary({ libraryActivePath: path, selectionAnchorPath: path });
    if (appSettings) {
      handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Loupe });
    }
  };

  const libraryPainter = useLibraryStore((s) => s.libraryPainter);
  const keywordPaintTagLegacy = useLibraryStore((s) => s.keywordPaintTag);
  const keywordPaintTag =
    libraryPainter?.kind === 'keyword'
      ? String(libraryPainter.value ?? '')
      : keywordPaintTagLegacy;
  const painterActive = !!libraryPainter || !!keywordPaintTag;
  const painterLabel = (() => {
    if (libraryPainter?.kind === 'rating') return `★ ${libraryPainter.value}`;
    if (libraryPainter?.kind === 'color') return `Color: ${libraryPainter.value || 'none'}`;
    if (libraryPainter?.kind === 'flag')
      return libraryPainter.value === 'pick'
        ? 'Flag: Pick'
        : libraryPainter.value === 'reject'
          ? 'Flag: Reject'
          : 'Flag: Unflag';
    if (keywordPaintTag)
      return keywordPaintTag.includes('/')
        ? keywordPaintTag.split('/').join(' › ')
        : keywordPaintTag;
    return '';
  })();


  // Background prefetch: once a folder is listed, queue its thumbnails (top first) so scrolling
  // is instant. Visible items requested later by the grid jump ahead (backend queue is LIFO).
  const prefetchKey = `${currentFolderPath}:${sortedImageList.length}`;
  useEffect(() => {
    if (!sortedImageList.length || !requestThumbnails) return;
    const timer = setTimeout(() => {
      const { thumbnails } = useProcessStore.getState();
      const paths = sortedImageList
        .slice(0, 500)
        .map((img) => img.path)
        .filter((p) => !thumbnails[p]);
      if (paths.length) requestThumbnails(paths);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchKey]);

  // LR: + / − cycle library thumbnail size (Small ↔ Medium ↔ Large)
  useEffect(() => {
    const onThumb = (e: Event) => {
      const delta = Number((e as CustomEvent).detail?.delta) || 0;
      if (!delta) return;
      const order = [ThumbnailSize.Small, ThumbnailSize.Medium, ThumbnailSize.Large];
      const idx = order.indexOf(thumbnailSize);
      const next = order[Math.max(0, Math.min(order.length - 1, (idx < 0 ? 1 : idx) + delta))];
      if (next && next !== thumbnailSize) setThumbnailSize(next);
    };
    window.addEventListener('rustroom:library-thumb-size', onThumb as EventListener);
    return () => window.removeEventListener('rustroom:library-thumb-size', onThumb as EventListener);
  }, [thumbnailSize, setThumbnailSize]);


  return (
    <div className="flex flex-row grow h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0 gap-2">
        {activeView === 'community' ? (
          <CommunityPage
            onBackToLibrary={() => setUI({ activeView: 'library' })}
            supportedTypes={supportedTypes}
            imageList={sortedImageList}
            currentFolderPath={currentFolderPath}
          />
        ) : (
          <>
          {painterActive && (
            <div className="mx-2 mt-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-accent/15 border border-accent/35 text-[11px] text-text-primary shrink-0">
              <Paintbrush size={13} className="shrink-0 text-accent" />
              <span className="truncate flex-1">
                Painter: <strong className="font-semibold">{painterLabel}</strong>
                <span className="text-text-secondary"> — click thumbs to apply · Alt-click clear · Esc stop</span>
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-surface/80 hover:bg-card-active border border-border-color/40"
                onClick={() =>
                  useLibraryStore.getState().setLibrary({ libraryPainter: null, keywordPaintTag: null })
                }
              >
                <X size={11} /> Stop
              </button>
            </div>
          )}
          <MainLibrary
            activePath={libraryActivePath}
            aiModelDownloadStatus={aiModelDownloadStatus}
            appSettings={appSettings}
            currentFolderPath={currentFolderPath}
            groupBadgeInfo={groupBadgeInfo}
            imageList={sortedImageList}
            imageRatings={imageRatings}
            importState={importState}
            indexingProgress={indexingProgress}
            isIndexing={isIndexing}
            isLoading={isViewLoading}
            isTreeLoading={isTreeLoading}
            isAndroid={isAndroid}
            libraryViewMode={libraryViewMode}
            multiSelectedPaths={multiSelectedPaths}
            onClearSelection={handleClearSelection}
            onContextMenu={handleThumbnailContextMenu}
            onContinueSession={handleContinueSession}
            onEmptyAreaContextMenu={handleMainLibraryContextMenu}
            onGoHome={handleGoHome}
            onImageClick={handleLibraryImageSingleClick}
            onImageDoubleClick={openLoupe}
            onImportClick={() => handleImportClick(currentFolderPath as string)}
            onLibraryRefresh={handleLibraryRefresh}
            onOpenFolder={handleOpenFolder}
            onSettingsChange={handleSettingsChange}
            onThumbnailAspectRatioChange={setThumbnailAspectRatio}
            onThumbnailSizeChange={setThumbnailSize}
            onRequestThumbnails={requestThumbnails}
            rootPaths={rootPaths}
            setLibraryViewMode={setLibraryViewMode}
            theme={theme}
            thumbnailAspectRatio={thumbnailAspectRatio}
            thumbnailProgress={thumbnailProgress}
            thumbnailSize={thumbnailSize}
            onNavigateToCommunity={() => setUI({ activeView: 'community' })}
            onRate={handleRate}
            onSetColorLabel={handleSetColorLabel}
            onSetFlag={handleSetFlag}
          />
          </>
        )}
        {rootPaths && rootPaths.length > 0 && activeView !== 'community' && (
          <LibraryBottomBar imageList={sortedImageList} />
        )}
      </div>
    </div>
  );
}
