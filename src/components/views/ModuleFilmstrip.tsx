import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import BottomBar from '../panel/BottomBar';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useProcessStore } from '../../store/useProcessStore';
import { ImageFile, ThumbnailAspectRatio } from '../ui/AppProperties';
import { useSettingsStore } from '../../store/useSettingsStore';

/**
 * LR-style filmstrip under Map/Book/Slideshow/Print/Web modules.
 */
export default function ModuleFilmstrip({
  imageList,
  onImageSelect,
  onImageDoubleClick,
  onContextMenu,
  onRate,
  onSetColorLabel,
  onSetFlag,
  onRequestThumbnails,
  onCopy,
  onPaste,
  onMatchPrevious,
  isMatchPreviousDisabled,
  onSyncSettings,
  isSyncSettingsDisabled,
}: {
  imageList: ImageFile[];
  onImageSelect(path: string, event?: any): void;
  /** Double-click opens Develop (LR filmstrip behavior). */
  onImageDoubleClick?(path: string): void;
  onContextMenu?(event: any, path: string): void;
  onRate(rate: number, paths?: string[]): void;
  onSetColorLabel?(color: string | null, paths?: string[]): void;
  onSetFlag?(flag: 'pick' | 'reject' | null, paths?: string[]): void;
  onRequestThumbnails?(paths: string[]): void;
  onCopy(): void;
  onPaste(): void;
  onMatchPrevious?(): void;
  isMatchPreviousDisabled?: boolean;
  onSyncSettings?(): void;
  isSyncSettingsDisabled?: boolean;
}) {
  const { multiSelectedPaths, libraryActivePath, imageRatings } = useLibraryStore(
    useShallow((s) => ({
      multiSelectedPaths: s.multiSelectedPaths,
      libraryActivePath: s.libraryActivePath,
      imageRatings: s.imageRatings,
    })),
  );
  const { isCopied, isPasted } = useProcessStore(
    useShallow((s) => ({ isCopied: s.isCopied, isPasted: s.isPasted })),
  );
  const appSettings = useSettingsStore((s) => s.appSettings);
  const { bottomPanelHeight, uiVisibility, setUI } = useUIStore(
    useShallow((s) => ({
      bottomPanelHeight: s.bottomPanelHeight,
      uiVisibility: s.uiVisibility,
      setUI: s.setUI,
    })),
  );
  const copiedAdjustments = useEditorStore((s) => s.copiedAdjustments);

  const active = libraryActivePath || multiSelectedPaths[0] || '';
  const rating = imageRatings[active] || 0;
  const aspect =
    (appSettings as any)?.thumbnailAspectRatio === ThumbnailAspectRatio.Contain
      ? ThumbnailAspectRatio.Contain
      : ThumbnailAspectRatio.Cover;


  // LR module filmstrip: ←/→ move selection within the strip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!imageList.length) return;
      // Prefer not to fight Book page keys / Slideshow / Map when those handlers also bind arrows —
      // only handle when focus is not in a module-specific control. Modules register their own handlers;
      // use capture:false and stop if another handler already prevented.
      const cur = libraryActivePath || multiSelectedPaths[0] || null;
      let idx = cur ? imageList.findIndex((img) => img.path === cur) : -1;
      if (idx < 0) idx = 0;
      const nextIdx =
        e.key === 'ArrowRight'
          ? Math.min(imageList.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (nextIdx === idx) return;
      e.preventDefault();
      const path = imageList[nextIdx].path;
      onImageSelect(path, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
    };
    // bubble phase so Map/Book/Slideshow can preventDefault first
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageList, libraryActivePath, multiSelectedPaths, onImageSelect]);

  return (
    <div className="shrink-0 w-full border-t border-border-color/30 bg-bg-secondary">
      <BottomBar
        filmstripHeight={Math.min(Math.max(bottomPanelHeight || 112, 96), 148)}
        imageList={imageList}
        imageRatings={imageRatings}
        isCopied={isCopied}
        isCopyDisabled={!active}
        isFilmstripVisible={uiVisibility.filmstrip !== false}
        isLoading={false}
        isPasted={isPasted}
        isPasteDisabled={copiedAdjustments === null}
        isRatingDisabled={!active && multiSelectedPaths.length === 0}
        multiSelectedPaths={multiSelectedPaths}
        selectedImage={
          active
            ? ({
                path: active,
                tags: imageList.find((i) => i.path === active)?.tags || null,
              } as any)
            : undefined
        }
        onClearSelection={() =>
          useLibraryStore.getState().setLibrary({ multiSelectedPaths: [], libraryActivePath: null })
        }
        onContextMenu={onContextMenu}
        onCopy={onCopy}
        onImageSelect={(path, e) => {
          useLibraryStore.getState().setLibrary({ libraryActivePath: path });
          onImageSelect(path, e);
        }}
        onImageDoubleClick={(path) => {
          useLibraryStore.getState().setLibrary({ libraryActivePath: path });
          if (onImageDoubleClick) onImageDoubleClick(path);
          else onImageSelect(path, { shiftKey: false, metaKey: false, ctrlKey: false });
        }}
        onPaste={onPaste}
        onMatchPrevious={onMatchPrevious}
        isMatchPreviousDisabled={isMatchPreviousDisabled}
        onSyncSettings={onSyncSettings}
        isSyncSettingsDisabled={isSyncSettingsDisabled}
        onRate={onRate}
        onSetColorLabel={onSetColorLabel}
        onSetFlag={onSetFlag}
        onRequestThumbnails={onRequestThumbnails}
        rating={rating}
        setIsFilmstripVisible={(value: boolean) =>
          setUI((state) => ({ uiVisibility: { ...state.uiVisibility, filmstrip: value } }))
        }
        showFilmstrip={true}
        showZoomControls={false}
        thumbnailAspectRatio={aspect}
        totalImages={imageList.length}
      />
    </div>
  );
}
