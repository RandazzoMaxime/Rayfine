import { type RefObject, type PointerEvent as ReactPointerEvent, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import Editor from '../panel/Editor';
import BottomBar from '../panel/BottomBar';
import RightPanelSwitcher from '../panel/right/RightPanelSwitcher';
import Resizer from '../ui/Resizer';
import Controls from '../panel/right/ControlsPanel';
import MetadataPanel from '../panel/right/MetadataPanel';
import CropPanel from '../panel/right/CropPanel';
import MasksPanel from '../panel/right/MasksPanel';
import AIPanel from '../panel/right/AIPanel';
import PresetBrowserModal from '../modals/PresetBrowserModal';
import ExportPanel from '../panel/right/ExportPanel';
import DevelopLeftPanel, { DevelopLeftRail } from '../panel/DevelopLeftPanel';
import DevelopToolsBar from '../panel/editor/DevelopToolsBar';
import DevelopHistogram from '../panel/right/DevelopHistogram';
import DevelopFooterBar from '../panel/right/DevelopFooterBar';
import SoftProofBar from '../panel/editor/SoftProofBar';

import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';

import { ImageFile, Orientation, Panel, ThumbnailAspectRatio } from '../ui/AppProperties';
import { importedPathSet } from '../../utils/catalogMembership';

const panelVariants: any = {
  animate: (direction: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: direction === 0 ? 0 : 0.2, ease: 'circOut' },
  }),
  exit: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? -20 : 20,
    transition: { duration: direction === 0 ? 0 : 0.1, ease: 'circIn' },
  }),
  initial: (direction: number) => ({
    opacity: direction === 0 ? 1 : 0.2,
    y: direction === 0 ? 0 : direction > 0 ? 20 : -20,
  }),
};

interface EditorViewProps {
  transformWrapperRef: RefObject<any>;
  isResizing: boolean;
  isCompactPortrait: boolean;
  isAndroid: boolean;
  compactEditorPanelHeight: number;
  compactEditorPanelCollapsedHeight: number;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  sortedImageList: ImageFile[];
  createResizeHandler: (stateKey: string, startSize: number) => (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleBackToLibrary: () => void;
  handleEditorContextMenu: (...args: any) => void;
  handleThumbnailContextMenu: (...args: any) => void;
  handleImageClick: (...args: any) => void;
  handleClearSelection: () => void;
  handleCopyAdjustments: () => void;
  handlePasteAdjustments: () => void;
  handleMatchPrevious?: () => void;
  handleSyncSettings?: () => void;
  handleRate: (...args: any) => void;
  handleSetColorLabel: (...args: any) => void;
  handleSetFlag: (...args: any) => void;
  handleZoomChange: (zoom: number) => void;
  handleRightPanelSelect: (panelId: Panel) => void;
  requestThumbnails: any;
}

export default function EditorView({
  transformWrapperRef,
  isResizing,
  isCompactPortrait,
  isAndroid,
  compactEditorPanelHeight,
  compactEditorPanelCollapsedHeight,
  thumbnailAspectRatio,
  sortedImageList,
  createResizeHandler,
  handleBackToLibrary,
  handleEditorContextMenu,
  handleThumbnailContextMenu,
  handleImageClick,
  handleClearSelection,
  handleCopyAdjustments,
  handlePasteAdjustments,
  handleMatchPrevious,
  handleSyncSettings,
  handleRate,
  handleSetColorLabel,
  handleSetFlag,
  handleZoomChange,
  handleRightPanelSelect,
  requestThumbnails,
}: EditorViewProps) {
  const { selectedImage } = useEditorStore(
    useShallow((state) => ({
      selectedImage: state.selectedImage,
    })),
  );

  const {
    isFullScreen,
    isInstantTransition,
    uiVisibility,
    bottomPanelHeight,
    rightPanelWidth,
    developLeftPanelWidth,
    activeRightPanel,
    renderedRightPanel,
    slideDirection,
    setUI,
  } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      isInstantTransition: state.isInstantTransition,
      uiVisibility: state.uiVisibility,
      bottomPanelHeight: state.bottomPanelHeight,
      rightPanelWidth: state.rightPanelWidth,
      developLeftPanelWidth: state.developLeftPanelWidth,
      activeRightPanel: state.activeRightPanel,
      renderedRightPanel: state.renderedRightPanel,
      slideDirection: state.slideDirection,
      setUI: state.setUI,
    })),
  );

  const { multiSelectedPaths, imageRatings, isViewLoading, rootPaths, albumTree } = useLibraryStore(
    useShallow((state) => ({
      multiSelectedPaths: state.multiSelectedPaths,
      imageRatings: state.imageRatings,
      isViewLoading: state.isViewLoading,
      rootPaths: state.rootPaths,
      albumTree: state.albumTree,
    })),
  );

  const developImageList = useMemo(
    () => sortedImageList.filter((img) => importedPathSet(albumTree).has(img.path)),
    [sortedImageList, albumTree],
  );

  const { exportState, isCopied, isPasted, setExportState } = useProcessStore(
    useShallow((state) => ({
      exportState: state.exportState,
      isCopied: state.isCopied,
      isPasted: state.isPasted,
      setExportState: state.setExportState,
    })),
  );

  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      handleSettingsChange: state.handleSettingsChange,
    })),
  );

  const editorNode = (
    <Editor
      onBackToLibrary={handleBackToLibrary}
      onContextMenu={handleEditorContextMenu}
      onImageSelect={handleImageClick}
      transformWrapperRef={transformWrapperRef}
    />
  );

  const editorBottomBarComponent = (
    <BottomBar
      filmstripHeight={bottomPanelHeight}
      imageList={developImageList}
      imageRatings={imageRatings}
      isCopied={isCopied}
      isCopyDisabled={!selectedImage}
      isFilmstripVisible={uiVisibility.filmstrip}
      isLoading={isViewLoading}
      isPasted={isPasted}
      isPasteDisabled={useEditorStore.getState().copiedAdjustments === null}
      isRatingDisabled={!selectedImage}
      isResizing={isResizing}
      multiSelectedPaths={multiSelectedPaths}
      onClearSelection={handleClearSelection}
      onContextMenu={handleThumbnailContextMenu}
      onCopy={handleCopyAdjustments}
      onOpenCopyPasteSettings={() => setUI({ isCopyPasteSettingsModalOpen: true })}
      onImageSelect={handleImageClick}
      onImageDoubleClick={(path: string) => handleImageClick(path, { shiftKey: false, metaKey: false, ctrlKey: false })}
      onPaste={() => handlePasteAdjustments()}
      onMatchPrevious={handleMatchPrevious}
      isMatchPreviousDisabled={!useEditorStore.getState().previousDevelopAdjustments}
      onSyncSettings={handleSyncSettings}
      isSyncSettingsDisabled={(multiSelectedPaths?.length || 0) < 2}
      onRate={handleRate}
      onSetColorLabel={handleSetColorLabel}
      onSetFlag={handleSetFlag}
      onRequestThumbnails={requestThumbnails}
      onZoomChange={handleZoomChange}
      rating={imageRatings[selectedImage?.path || ''] || 0}
      selectedImage={selectedImage ?? undefined}
      setIsFilmstripVisible={(value: boolean) =>
        setUI((state) => ({ uiVisibility: { ...state.uiVisibility, filmstrip: value } }))
      }
      showFilmstrip={!isCompactPortrait}
      showZoomControls={!isAndroid}
      thumbnailAspectRatio={thumbnailAspectRatio}
      totalImages={sortedImageList.length}
    />
  );

  const editorBottomBarNode = (
    <div
      className={clsx(
        'flex flex-col w-full overflow-hidden shrink-0',
        !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
      )}
      style={{
        maxHeight: isFullScreen ? '0px' : '500px',
        opacity: isFullScreen ? 0 : 1,
      }}
    >
      {!isCompactPortrait && (
        <Resizer direction={Orientation.Horizontal} onMouseDown={createResizeHandler('bottom', bottomPanelHeight)} />
      )}
      {editorBottomBarComponent}
    </div>
  );

  const editorRightPanelContent = (
    <LayoutGroup id="editor-right-panel">
      <AnimatePresence mode="wait" custom={slideDirection}>
        {activeRightPanel && (
          <motion.div
            animate="animate"
            className="h-full w-full"
            custom={slideDirection}
            exit="exit"
            initial="initial"
            key={renderedRightPanel}
            variants={panelVariants}
          >
            {renderedRightPanel === Panel.Adjustments && <Controls />}
            {renderedRightPanel === Panel.Metadata && <MetadataPanel />}
            {renderedRightPanel === Panel.Crop && <CropPanel />}
            {renderedRightPanel === Panel.Masks && <MasksPanel />}
            {renderedRightPanel === Panel.Export && (
              <ExportPanel
                exportState={exportState}
                multiSelectedPaths={multiSelectedPaths}
                selectedImage={selectedImage}
                setExportState={setExportState}
                appSettings={appSettings}
                onSettingsChange={handleSettingsChange}
                rootPaths={rootPaths}
              />
            )}
            {renderedRightPanel === Panel.Ai && <AIPanel />}
          </motion.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );

  return (
    <div className={clsx('flex grow h-full min-h-0 gap-2', isCompactPortrait ? 'flex-col' : 'flex-row')}>
      {!isCompactPortrait && !isFullScreen && (
        uiVisibility.developLeft !== false ? (
          <DevelopLeftPanel
            isInstantTransition={isInstantTransition}
            width={developLeftPanelWidth || 220}
          />
        ) : (
          <DevelopLeftRail
            onShow={() =>
              setUI((state) => ({
                uiVisibility: { ...state.uiVisibility, developLeft: true },
              }))
            }
          />
        )
      )}
      <div className={clsx('flex-1 flex flex-col min-w-0', isCompactPortrait && 'min-h-0')}>
        {!isFullScreen && (
          <>
            <SoftProofBar />
          </>
        )}
        {editorNode}
        {!isCompactPortrait && editorBottomBarNode}
      </div>
      <div
        className={clsx(
          'flex overflow-hidden shrink-0',
          isCompactPortrait ? 'flex-col bg-bg-secondary rounded-lg' : 'h-full bg-transparent',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
        style={
          isCompactPortrait
            ? {
                height: isFullScreen
                  ? '0px'
                  : `${activeRightPanel ? compactEditorPanelHeight : compactEditorPanelCollapsedHeight}px`,
                opacity: isFullScreen ? 0 : 1,
              }
            : {
                maxWidth: isFullScreen ? '0px' : '1000px',
                opacity: isFullScreen ? 0 : 1,
              }
        }
      >
        {isCompactPortrait ? (
          <>
            {activeRightPanel && !isFullScreen && (
              <Resizer
                direction={Orientation.Horizontal}
                onMouseDown={createResizeHandler('compact', compactEditorPanelHeight)}
              />
            )}
            <div className="min-h-0 flex-1 overflow-hidden">{editorRightPanelContent}</div>
            <div className="shrink-0 border-t border-surface">
              <RightPanelSwitcher
                activePanel={activeRightPanel}
                onPanelSelect={handleRightPanelSelect}
                isInstantTransition={isInstantTransition}
                layout="horizontal"
              />
            </div>
            <div className="shrink-0 border-t border-surface">{editorBottomBarComponent}</div>
          </>
        ) : (
          <>
            {activeRightPanel && (
              <Resizer direction={Orientation.Vertical} onMouseDown={createResizeHandler('right', rightPanelWidth)} />
            )}
            <div className="flex bg-bg-secondary rounded-lg h-full">
              <button
                type="button"
                onClick={() =>
                  activeRightPanel ? setUI({ activeRightPanel: null }) : handleRightPanelSelect(Panel.Adjustments)
                }
                className="h-full w-3 shrink-0 flex items-center justify-center text-text-secondary/50 hover:text-text-primary hover:bg-surface/50 rounded-l-lg"
                aria-label={activeRightPanel ? 'Hide right panel' : 'Show right panel'}
              >
                {activeRightPanel ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
              </button>
              <div
                className={clsx(
                  'h-full overflow-hidden',
                  !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
                )}
                style={{ width: activeRightPanel ? `${rightPanelWidth}px` : '0px' }}
              >
                {/* Lightroom Classic right rail: histogram → tool strip → tool / panels */}
                <div style={{ width: `${rightPanelWidth}px` }} className="h-full flex flex-col">
                  <DevelopHistogram />
                  <DevelopToolsBar
                    onPanelSelect={(id) => {
                      if (id === activeRightPanel) {
                        if (id !== Panel.Adjustments) handleRightPanelSelect(Panel.Adjustments);
                        return;
                      }
                      handleRightPanelSelect(id);
                    }}
                    isInstantTransition={isInstantTransition}
                  />
                  <div className="flex-1 min-h-0">{editorRightPanelContent}</div>
                  <DevelopFooterBar />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <PresetBrowserModal />
    </div>
  );
}
