import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import clsx from 'clsx';
import { Grid, useGridCallbackRef } from 'react-window';
import { ImageFile, SelectedImage, ThumbnailAspectRatio, GroupingMode } from '../ui/AppProperties';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLibraryStore } from '../../store/useLibraryStore';

const HORIZONTAL_PADDING = 2;
const ITEM_GAP = 2;
/** Fixed filmstrip cell (LR / Border): same slot size for every photo. */
const CELL_ASPECT = 4 / 3;

interface ImageLayer {
  id: string;
  url: string;
  opacity: number;
}

interface ItemData {
  imageList: ImageFile[];
  imageRatings: any;
  selectedPath: string | undefined;
  multiSelectedPaths: string[];
  thumbnailAspectRatio: ThumbnailAspectRatio;
  onRequestThumbnails?: (paths: string[]) => void;
  onContextMenu?: (event: any, path: string) => void;
  onImageSelect?: (path: string, event: any) => void;
  onImageDoubleClick?: (path: string) => void;
  onRate?: (rate: number, paths?: string[]) => void;
  onSetColorLabel?: (color: string | null, paths?: string[]) => void;
  itemHeight: number;
  setRatio: (index: number, ratio: number) => void;
}

const FilmstripThumbnail = memo(
  ({
    imageFile,
    isActive,
    isSelected,
    multiSelectedPaths,
    onContextMenu,
    onImageSelect,
    onImageDoubleClick,
    itemHeight: _itemHeight,
    index,
    setRatio,
  }: {
    imageFile: ImageFile;
    imageRatings: any;
    isActive: boolean;
    isSelected: boolean;
    multiSelectedPaths: string[];
    onContextMenu?: (event: any, path: string) => void;
    onImageSelect?: (path: string, event: any) => void;
    onImageDoubleClick?: (path: string) => void;
    onRate?: (rate: number, paths?: string[]) => void;
    onSetColorLabel?: (color: string | null, paths?: string[]) => void;
    thumbnailAspectRatio: ThumbnailAspectRatio;
    itemHeight: number;
    index: number;
    setRatio: (index: number, ratio: number) => void;
  }) => {
    const thumbData = useProcessStore((s) => s.thumbnails[imageFile.path]);

    const [layers, setLayers] = useState<ImageLayer[]>([]);

    const [currentPath, setCurrentPath] = useState(imageFile.path);
    if (currentPath !== imageFile.path) {
      setCurrentPath(imageFile.path);
      setLayers([]);
    }

    const pathRef = useRef(imageFile.path);
    const hadDataOnPathChange = useRef(!!thumbData);

    if (pathRef.current !== imageFile.path) {
      pathRef.current = imageFile.path;
      hadDataOnPathChange.current = !!thumbData;
    }

    const isInitialLoad = useRef(true);

    const { path, tags } = imageFile;
    const flagTag = tags?.find((t: string) => t.startsWith('flag:'))?.substring(5);
    const isReject = flagTag === 'reject';

    const cleanPath = path.split('?')[0];
    const filename = cleanPath.split(/[\\/]/).pop() || '';

    useEffect(() => {
      const w = imageFile.width;
      const h = imageFile.height;
      if (w && h && w > 0 && h > 0) {
        setRatio(index, w / h);
      }
    }, [imageFile.width, imageFile.height, index, setRatio]);

    useEffect(() => {
      if (!thumbData) return;
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setRatio(index, img.naturalWidth / img.naturalHeight);
        }
        if (isInitialLoad.current) {
          setTimeout(() => {
            isInitialLoad.current = false;
          }, 50);
        }
      };
      img.src = thumbData;
    }, [thumbData, index, setRatio]);

    useEffect(() => {
      if (!thumbData) {
        setLayers([]);
        return;
      }

      setLayers((prev) => {
        if (prev.some((l) => l.id === thumbData)) return prev;

        if (prev.length === 0) {
          if (hadDataOnPathChange.current) {
            return [{ id: thumbData, url: thumbData, opacity: 1 }];
          } else {
            return [{ id: thumbData, url: thumbData, opacity: 0 }];
          }
        }

        return [...prev, { id: thumbData, url: thumbData, opacity: 0 }];
      });
    }, [thumbData, imageFile.path]);

    useEffect(() => {
      const layerToFadeIn = layers.find((l) => l.opacity === 0);
      if (layerToFadeIn) {
        const frame = requestAnimationFrame(() => {
          setLayers((prev) => prev.map((l) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)));
        });
        return () => cancelAnimationFrame(frame);
      }
    }, [layers]);

    const handleTransitionEnd = useCallback((finishedId: string) => {
      setLayers((prev) => {
        const finishedIndex = prev.findIndex((l) => l.id === finishedId);
        if (finishedIndex < 0 || prev.length <= 1) return prev;
        return prev.slice(finishedIndex);
      });
    }, []);

    const imageClasses = clsx('max-w-full max-h-full w-auto h-auto object-contain', isReject && 'grayscale');

    return (
      <div
        className={clsx(
          'h-full w-full cursor-pointer shrink-0 relative box-border p-[2px] group',
          isReject && 'opacity-45',
        )}
        draggable
        onDragStart={(e) => {
          const paths =
            isSelected && multiSelectedPaths.length > 1 ? multiSelectedPaths : [path];
          e.dataTransfer.setData('application/x-rustroom-paths', JSON.stringify(paths));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={(e: any) => {
          e.stopPropagation();
          onImageSelect?.(path, e);
        }}
        onDoubleClick={(e: any) => {
          e.stopPropagation();
          onImageDoubleClick?.(path);
        }}
        onContextMenu={(e: any) => onContextMenu?.(e, path)}
        style={{ zIndex: isActive ? 2 : isSelected ? 1 : 'auto' }}
        data-tooltip={filename}
      >
        <div
          className={clsx(
            'relative h-full w-full overflow-hidden border flex items-center justify-center bg-bg-secondary',
            isActive || isSelected
              ? 'border-accent'
              : 'border-border-color/50 group-hover:border-text-primary/45',
          )}
        >
          {isActive && (
            <div
              className="filmstrip-active-edge absolute left-0 right-0 bottom-0 h-[3px] bg-accent z-20 pointer-events-none"
              aria-hidden
            />
          )}
          {layers.length > 0 ? (
            <div className="absolute inset-0 w-full h-full flex items-center justify-center">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className="absolute inset-0 w-full h-full flex items-center justify-center"
                  style={{
                    opacity: layer.opacity,
                    transition: 'opacity 150ms ease-in-out',
                    willChange: 'opacity',
                  }}
                  onTransitionEnd={() => handleTransitionEnd(layer.id)}
                >
                  <img
                    alt=""
                    className={imageClasses}
                    loading="lazy"
                    decoding="async"
                    src={layer.url}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon size={20} className="text-text-secondary animate-pulse" />
            </div>
          )}
        </div>
      </div>
    );
  },
);

const FilmstripCell = ({
  columnIndex,
  style,
  imageList,
  imageRatings,
  selectedPath,
  multiSelectedPaths,
  thumbnailAspectRatio,
  onContextMenu,
  onImageSelect,
  onImageDoubleClick,
  onRate,
  onSetColorLabel,
  itemHeight,
  setRatio,
}: any) => {
  const imageFile = imageList[columnIndex];
  const fullWidth = style.width as number;
  const contentWidth = fullWidth - ITEM_GAP;

  return (
    <div
      style={{
        ...style,
        height: '100%',
        left: (style.left as number) + HORIZONTAL_PADDING,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <div style={{ width: contentWidth, height: itemHeight }}>
        <FilmstripThumbnail
          imageFile={imageFile}
          imageRatings={imageRatings}
          isActive={selectedPath === imageFile.path}
          isSelected={multiSelectedPaths.includes(imageFile.path)}
          multiSelectedPaths={multiSelectedPaths}
          onContextMenu={onContextMenu}
          onImageSelect={onImageSelect}
          onImageDoubleClick={onImageDoubleClick}
          onRate={onRate}
          onSetColorLabel={onSetColorLabel}
          thumbnailAspectRatio={thumbnailAspectRatio}
          itemHeight={itemHeight}
          index={columnIndex}
          setRatio={setRatio}
        />
      </div>
    </div>
  );
};

const FilmstripList = ({
  height,
  width,
  data,
}: {
  height: number;
  width: number;
  data: Omit<ItemData, 'itemHeight' | 'setRatio'> & { clickTriggeredScroll: React.RefObject<boolean> };
}) => {
  const [gridHandle, setGridHandle] = useGridCallbackRef();
  const visibleRange = useRef({ start: 0, stop: 0 });
  const prevSelectedPath = useRef<string | null>(null);
  const isReadyForSmooth = useRef(false);
  const resizeEndTimer = useRef<number | null>(null);
  const currentDataRef = useRef(data);
  currentDataRef.current = data;
  const isAnimatingScroll = useRef(false);
  const scrollAnimationTimeout = useRef<any>(null);
  const pendingScrollTarget = useRef<number | null>(null);
  const hasCompletedInitialScroll = useRef(false);

  const itemHeight = useMemo(() => Math.max(20, height - 8), [height]);

  const getColumnWidth = useCallback(
    () => Math.round(itemHeight * CELL_ASPECT) + ITEM_GAP,
    [itemHeight],
  );

  useEffect(() => {
    isReadyForSmooth.current = false;
    const timer = setTimeout(() => {
      isReadyForSmooth.current = true;
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isReadyForSmooth.current) {
      return;
    }

    if (resizeEndTimer.current) clearTimeout(resizeEndTimer.current);

    resizeEndTimer.current = window.setTimeout(() => {
      const { selectedPath, imageList, multiSelectedPaths } = currentDataRef.current;

      if (selectedPath && gridHandle && multiSelectedPaths.length <= 1) {
        const index = imageList.findIndex((img) => img.path === selectedPath);
        if (index !== -1) {
          gridHandle.scrollToColumn({ index, align: 'center', behavior: 'smooth' });
        }
      }
    }, 500);

    return () => {
      if (resizeEndTimer.current) clearTimeout(resizeEndTimer.current);
    };
  }, [height, gridHandle]);

  useEffect(() => {
    return () => {
      if (scrollAnimationTimeout.current) {
        clearTimeout(scrollAnimationTimeout.current);
      }
    };
  }, []);

  const onCellsRendered = useCallback(
    (
      visibleCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number },
      allCells: { columnStartIndex: number; columnStopIndex: number; rowStartIndex: number; rowStopIndex: number },
    ) => {
      visibleRange.current = {
        start: visibleCells.columnStartIndex,
        stop: visibleCells.columnStopIndex,
      };

      const currentData = currentDataRef.current;
      if (!currentData.onRequestThumbnails) return;

      const cached = useProcessStore.getState().thumbnails;
      const pathsToRequest: string[] = [];

      for (let i = allCells.columnStartIndex; i <= allCells.columnStopIndex; i++) {
        const img = currentData.imageList[i];
        if (img && !cached[img.path]) {
          pathsToRequest.push(img.path);
        }
      }

      if (pathsToRequest.length > 0) {
        currentData.onRequestThumbnails(pathsToRequest);
      }
    },
    [],
  );

  const isItemVisible = useCallback((index: number) => {
    const { start, stop } = visibleRange.current;
    return index > start && index < stop;
  }, []);

  const performSafeScroll = useCallback(
    (index: number, bypassLock = false) => {
      if (!gridHandle) return;

      if (!bypassLock && isAnimatingScroll.current) {
        pendingScrollTarget.current = index;
        return;
      }

      isAnimatingScroll.current = true;
      pendingScrollTarget.current = null;

      gridHandle.scrollToColumn({
        index,
        align: 'center',
        behavior: isReadyForSmooth.current ? 'smooth' : 'instant',
      });

      if (scrollAnimationTimeout.current) clearTimeout(scrollAnimationTimeout.current);

      scrollAnimationTimeout.current = setTimeout(() => {
        isAnimatingScroll.current = false;

        if (pendingScrollTarget.current !== null && pendingScrollTarget.current !== index) {
          const nextTarget = pendingScrollTarget.current;
          if (!isItemVisible(nextTarget)) {
            performSafeScroll(nextTarget);
          } else {
            pendingScrollTarget.current = null;
          }
        }
      }, 250);
    },
    [gridHandle, isItemVisible],
  );

  useEffect(() => {
    const currentPath = data.selectedPath;

    if (currentPath && gridHandle) {
      const index = data.imageList.findIndex((img) => img.path === currentPath);

      if (index !== -1) {
        if (currentPath !== prevSelectedPath.current) {
          const isVisible = isItemVisible(index);

          if (data.clickTriggeredScroll.current) {
            data.clickTriggeredScroll.current = false;
            performSafeScroll(index, true);
          } else if (!isVisible) {
            performSafeScroll(index);
          }
          prevSelectedPath.current = currentPath;
        } else {
          if (!hasCompletedInitialScroll.current && !isItemVisible(index)) {
            performSafeScroll(index, true);
          }
          hasCompletedInitialScroll.current = true;
        }
      }
    }
  }, [data.selectedPath, data.imageList, isItemVisible, data.clickTriggeredScroll, performSafeScroll, gridHandle]);

  const setRatio = useCallback((_index: number, _ratio: number) => {}, []);

  const cellProps = useMemo(
    () => ({
      ...data,
      itemHeight,
      setRatio,
    }),
    [data, itemHeight, setRatio],
  );

  return (
    <div style={{ height, width }}>
      <Grid
        gridRef={setGridHandle}
        defaultWidth={width}
        rowCount={1}
        rowHeight={height}
        columnCount={data.imageList.length}
        columnWidth={getColumnWidth}
        cellComponent={FilmstripCell}
        cellProps={cellProps}
        className="custom-scrollbar"
        style={{ overflowY: 'hidden' }}
        onWheel={(e: React.WheelEvent<HTMLDivElement>) => {
          if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
            e.currentTarget.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }}
        onCellsRendered={onCellsRendered}
        overscanCount={16}
      />
    </div>
  );
};

interface FilmStripProps {
  imageList: Array<ImageFile>;
  imageRatings: any;
  isLoading: boolean;
  multiSelectedPaths: Array<string>;
  onClearSelection?(): void;
  onContextMenu?(event: any, path: string): void;
  onImageSelect?(path: string, event: any): void;
  onImageDoubleClick?(path: string): void;
  onRate?(rate: number, paths?: string[]): void;
  onSetColorLabel?(color: string | null, paths?: string[]): void;
  onRequestThumbnails?(paths: string[]): void;
  selectedImage?: SelectedImage;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
}

export default function Filmstrip({
  imageList,
  imageRatings,
  isLoading: _isLoading,
  multiSelectedPaths,
  onClearSelection,
  onContextMenu,
  onImageSelect,
  onImageDoubleClick,
  onRate,
  onSetColorLabel,
  onRequestThumbnails,
  selectedImage,
  thumbnailAspectRatio,
}: FilmStripProps) {
  const clickTriggeredScroll = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { height, width } = entry.contentRect;
        setSize((prev) => (prev.height === height && prev.width === width ? prev : { height, width }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const groupingMode: GroupingMode = useSettingsStore((s) => s.appSettings?.grouping) ?? 'off';
  const fullImageList = useLibraryStore((s) => s.imageList);

  // Prefer Develop selectedImage; fall back to Library active / multi-select (module filmstrips)
  const libraryActivePath = useLibraryStore((s) => s.libraryActivePath);
  const libraryMulti = useLibraryStore((s) => s.multiSelectedPaths);

  const filmstripActivePath = useMemo(() => {
    const path = selectedImage?.path || libraryActivePath || libraryMulti?.[0] || undefined;
    if (!path || groupingMode === 'off') return path;
    if (path.includes('?vc=')) return path;
    if (imageList.some((img) => img.path === path)) return path;
    const selected = fullImageList.find((img) => img.path === path);
    if (!selected?.group_id) return path;
    const primary = imageList.find(
      (img) => img.group_id === selected.group_id && !img.is_virtual_copy,
    );
    return primary?.path ?? path;
  }, [selectedImage?.path, libraryActivePath, libraryMulti, imageList, fullImageList, groupingMode]);

  const handleImageSelect = (path: string, event: any) => {
    if (path !== selectedImage?.path) {
      clickTriggeredScroll.current = true;
    }
    onImageSelect?.(path, event);
  };

  return (
    <div ref={containerRef} className="h-full w-full" onClick={onClearSelection}>
      {size.height > 0 && size.width > 0 && (
        <FilmstripList
          height={size.height}
          width={size.width}
          data={{
            imageList,
            imageRatings,
            selectedPath: filmstripActivePath,
            multiSelectedPaths,
            thumbnailAspectRatio,
            onContextMenu,
            onRequestThumbnails,
            onImageSelect: handleImageSelect,
            onImageDoubleClick,
            onRate,
            onSetColorLabel,
            clickTriggeredScroll,
          }}
        />
      )}
    </div>
  );
}
