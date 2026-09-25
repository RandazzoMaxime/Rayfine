import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { List, useListCallbackRef } from 'react-window';
import { ChevronUp, ChevronDown } from 'lucide-react';
import debounce from 'lodash.debounce';
import { useTranslation } from 'react-i18next';
import { Row } from './LibraryItems';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { LibraryViewMode, SortDirection, LibraryDisplayMode, ImageFile } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights, TEXT_COLOR_KEYS } from '../../../types/typography';
import { useProcessStore } from '../../../store/useProcessStore';
import { ExifOverlay } from '../../ui/AppProperties';
import { useSettingsStore } from '../../../store/useSettingsStore';


function ListHeader({ widths, setWidths, containerRef, sortCriteria, onSortChange }: any) {
  const { t } = useTranslation();
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const showExifCols = exifOverlay !== ExifOverlay.Off;
  const totalRawWidth =
    widths.thumbnail +
    widths.name +
    widths.date +
    widths.rating +
    (widths.flag || 0) +
    (widths.edited || 0) +
    (widths.fileType || 0) +
    (widths.gps || 0) +
    (widths.urgency || 0) +
    (widths.creator || 0) +
    (widths.credit || 0) +
    (widths.city || 0) +
    (widths.country || 0) +
    (widths.state || 0) +
    (widths.headline || 0) +
    widths.color +
    (showExifCols
      ? widths.shutter +
        widths.aperture +
        widths.iso +
        widths.focal +
        (widths.camera || 0) +
        (widths.lens || 0)
      : 0);

  const handleResize = (e: React.MouseEvent, leftCol: string, rightCol: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startLeftWidth = widths[leftCol];
    const startRightWidth = widths[rightCol];
    const containerWidth = containerRef.current?.clientWidth || 1000;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;

      let newLeft = startLeftWidth + deltaPercent;
      let newRight = startRightWidth - deltaPercent;

      if (newLeft < 1) {
        newRight -= 1 - newLeft;
        newLeft = 1;
      }
      if (newRight < 1) {
        newLeft -= 1 - newRight;
        newRight = 1;
      }

      setWidths((prev: any) => ({
        ...prev,
        [leftCol]: newLeft,
        [rightCol]: newRight,
      }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const Column = ({ title, widthKey, nextKey, sortKey }: any) => {
    const isSorted = sortCriteria.key === sortKey;
    const isAsc = sortCriteria.order === SortDirection.Ascending;
    const actualWidth = `${(widths[widthKey] / totalRawWidth) * 100}%`;

    return (
      <div
        style={{ width: actualWidth }}
        className={`relative flex items-center px-3 h-full select-none ${
          sortKey ? 'cursor-pointer hover:bg-bg-primary/50 transition-colors' : ''
        }`}
        onClick={() => sortKey && onSortChange(sortKey)}
      >
        <Text
          variant={TextVariants.small}
          weight={TextWeights.semibold}
          color={isSorted ? TextColors.primary : TextColors.secondary}
          className="uppercase tracking-wider text-[11px]"
        >
          {title}
        </Text>
        {isSorted && (
          <span className={`ml-1 flex items-center ${TEXT_COLOR_KEYS[TextColors.primary]}`}>
            {isAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
        {nextKey && (
          <div
            className="absolute right-[-3px] top-1.5 bottom-1.5 w-[6px] cursor-col-resize z-10 group flex items-center justify-center"
            onMouseDown={(e) => handleResize(e, widthKey, nextKey)}
          >
            <div className="w-px h-full bg-border-color/40 group-hover:bg-accent transition-colors" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex items-center w-full h-8 bg-bg-secondary/80 backdrop-blur-sm border-b border-border-color/50 shrink-0">
      <Column title="" widthKey="thumbnail" nextKey="name" />
      <Column title={t('library.grid.columns.name')} widthKey="name" nextKey="date" sortKey="name" />
      <Column
        title={t('library.grid.columns.captureTime' as any, { defaultValue: 'Capture Time' })}
        widthKey="date"
        nextKey="rating"
        sortKey="date_taken"
      />
      <Column title={t('library.grid.columns.rating')} widthKey="rating" nextKey="flag" sortKey="rating" />
      <Column
        title={t('library.grid.columns.flag' as any, { defaultValue: 'Flag' })}
        widthKey="flag"
        nextKey="edited"
        sortKey="flag"
      />
      <Column
        title={t('library.grid.columns.edited' as any, { defaultValue: 'Edit' })}
        widthKey="edited"
        nextKey="fileType"
        sortKey="edited"
      />
      <Column
        title={t('library.grid.columns.fileType' as any, { defaultValue: 'Type' })}
        widthKey="fileType"
        nextKey="gps"
        sortKey="file_type"
      />
      <Column
        title={t('library.grid.columns.gps' as any, { defaultValue: 'GPS' })}
        widthKey="gps"
        nextKey="urgency"
        sortKey="has_gps"
      />
      <Column
        title={t('library.grid.columns.urgency' as any, { defaultValue: 'Urg' })}
        widthKey="urgency"
        nextKey="creator"
        sortKey="urgency"
      />
      <Column
        title={t('library.grid.columns.creator' as any, { defaultValue: 'Creator' })}
        widthKey="creator"
        nextKey="credit"
        sortKey="creator"
      />
      <Column
        title={t('library.grid.columns.credit' as any, { defaultValue: 'Credit' })}
        widthKey="credit"
        nextKey="city"
        sortKey="credit"
      />
      <Column
        title={t('library.grid.columns.city' as any, { defaultValue: 'City' })}
        widthKey="city"
        nextKey="country"
        sortKey="city"
      />
      <Column
        title={t('library.grid.columns.country' as any, { defaultValue: 'Country' })}
        widthKey="country"
        nextKey="state"
        sortKey="country"
      />
      <Column
        title={t('library.grid.columns.state' as any, { defaultValue: 'State' })}
        widthKey="state"
        nextKey="headline"
        sortKey="state"
      />
      <Column
        title={t('library.grid.columns.headline' as any, { defaultValue: 'Headline' })}
        widthKey="headline"
        nextKey="color"
        sortKey="headline"
      />
      {showExifCols ? (
        <>
          <Column
            title={t('library.grid.columns.label')}
            widthKey="color"
            nextKey="shutter"
            sortKey="color"
          />
          <Column
            title={t('library.grid.columns.shutter')}
            widthKey="shutter"
            nextKey="aperture"
            sortKey="shutter_speed"
          />
          <Column title={t('library.grid.columns.aperture')} widthKey="aperture" nextKey="iso" sortKey="aperture" />
          <Column title={t('library.grid.columns.iso')} widthKey="iso" nextKey="focal" sortKey="iso" />
          <Column title={t('library.grid.columns.focal')} widthKey="focal" nextKey="camera" sortKey="focal_length" />
          <Column
            title={t('library.grid.columns.camera' as any, { defaultValue: 'Camera' })}
            widthKey="camera"
            nextKey="lens"
            sortKey="camera"
          />
          <Column
            title={t('library.grid.columns.lens' as any, { defaultValue: 'Lens' })}
            widthKey="lens"
            sortKey="lens"
          />
        </>
      ) : (
        <Column title={t('library.grid.columns.label')} widthKey="color" sortKey="color" />
      )}
    </div>
  );
}

const groupImagesByFolder = (images: any[], baseFolderPath: string | null) => {
  const groups: Record<string, any[]> = {};

  images.forEach((img) => {
    const physicalPath = img.path.split('?vc=')[0];
    const separator = physicalPath.includes('/') ? '/' : '\\';
    const lastSep = physicalPath.lastIndexOf(separator);
    const dir = lastSep > -1 ? physicalPath.substring(0, lastSep) : physicalPath;

    if (!groups[dir]) {
      groups[dir] = [];
    }
    groups[dir].push(img);
  });

  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === baseFolderPath) return -1;
    if (b === baseFolderPath) return 1;
    return a.localeCompare(b);
  });

  return sortedKeys.map((dir) => ({
    path: dir,
    images: groups[dir],
  }));
};

function imageAspect(img: ImageFile): number {
  const w =
    Number(img.width) ||
    parseFloat(String(img.exif?.ImageWidth || img.exif?.PixelXDimension || img.exif?.ExifImageWidth || '0'));
  const h =
    Number(img.height) ||
    parseFloat(String(img.exif?.ImageHeight || img.exif?.PixelYDimension || img.exif?.ExifImageHeight || '0'));
  if (w > 0 && h > 0) return w / h;
  return 1.5;
}

function packJustifiedRows(images: ImageFile[], containerWidth: number, targetH: number, gap: number) {
  const rows: { type: 'images'; images: ImageFile[]; widths: number[]; height: number; startIndex: number }[] = [];
  let cur: ImageFile[] = [];
  let curAr = 0;
  let startIndex = 0;

  const flush = (justify: boolean) => {
    if (!cur.length) return;
    const n = cur.length;
    const gaps = gap * Math.max(0, n - 1);
    let h = targetH;
    if (justify && curAr > 0) {
      h = Math.min(targetH * 1.2, Math.max(targetH * 0.72, (containerWidth - gaps) / curAr));
    }
    rows.push({
      type: 'images',
      images: [...cur],
      widths: cur.map((img) => imageAspect(img) * h),
      height: h,
      startIndex,
    });
    startIndex += cur.length;
    cur = [];
    curAr = 0;
  };

  for (const img of images) {
    const ar = imageAspect(img);
    const nextW = (curAr + ar) * targetH + gap * cur.length;
    if (cur.length > 0 && nextW > containerWidth) flush(true);
    cur.push(img);
    curAr += ar;
  }
  flush(false);
  return rows;
}

export default function LibraryGrid(props: any) {
  const {
    imageList,
    libraryViewMode,
    thumbnailSize,
    libraryDisplayMode,
    currentFolderPath,
    activePath,
    multiSelectedPaths,
    onContextMenu,
    onImageClick,
    onImageDoubleClick,
    thumbnailAspectRatio,
    imageRatings,
    onRequestThumbnails,
    thumbnailSizeOptions,
    onThumbnailSizeChange,
    groupBadgeInfo,
    onRate,
  } = props;
  const { listColumnWidths, setLibrary, sortCriteria, setSortCriteria } = useLibraryStore(
    useShallow((state) => ({
      listColumnWidths: state.listColumnWidths,
      setLibrary: state.setLibrary,
      sortCriteria: state.sortCriteria,
      setSortCriteria: state.setSortCriteria,
    })),
  );

  const [gridSize, setGridSize] = useState({ height: 0, width: 0 });
  const [listHandle, setListHandle] = useListCallbackRef();
  const [collapsedRecursiveFolders, setCollapsedRecursiveFolders] = useState<Set<string>>(new Set());
  const libraryContainerRef = useRef<HTMLDivElement>(null);
  const gridObserverRef = useRef<ResizeObserver | null>(null);
  const loadedThumbnailsRef = useRef(new Set<string>());
  const requestQueueRef = useRef<Set<string>>(new Set());
  const requestTimeoutRef = useRef<any>(null);
  const exifOverlay = useSettingsStore((s) => s.appSettings?.exifOverlay || ExifOverlay.Off);
  const showExifCols = exifOverlay !== ExifOverlay.Off;

  useEffect(() => {
    const el = libraryContainerRef.current;
    if (gridObserverRef.current) {
      gridObserverRef.current.disconnect();
      gridObserverRef.current = null;
    }
    if (el) {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const { height, width } = entry.contentRect;
          setGridSize((prev) => (prev.height === height && prev.width === width ? prev : { height, width }));
        }
      });
      ro.observe(el);
      gridObserverRef.current = ro;
    }
    return () => gridObserverRef.current?.disconnect();
  }, [libraryContainerRef]);

  useEffect(() => {
    const handleWheel = (event: any) => {
      const container = libraryContainerRef.current;
      if (!container || !container.contains(event.target)) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const currentIndex = thumbnailSizeOptions.findIndex((o: any) => o.id === thumbnailSize);
        if (currentIndex === -1) {
          return;
        }

        const nextIndex =
          event.deltaY < 0
            ? Math.min(currentIndex + 1, thumbnailSizeOptions.length - 1)
            : Math.max(currentIndex - 1, 0);
        if (nextIndex !== currentIndex) {
          onThumbnailSizeChange(thumbnailSizeOptions[nextIndex].id);
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [thumbnailSize, onThumbnailSizeChange, thumbnailSizeOptions]);

  const handleScroll = useMemo(
    () =>
      debounce((top: number) => {
        setLibrary({ libraryScrollTop: top });
      }, 200),
    [setLibrary],
  );

  useEffect(() => () => handleScroll.cancel(), [handleScroll]);

  const queueThumbnailRequest = useCallback(
    (path: string) => {
      if (!onRequestThumbnails) return;
      if (useProcessStore.getState().thumbnails[path]) return;
      requestQueueRef.current.add(path);
      if (!requestTimeoutRef.current) {
        requestTimeoutRef.current = setTimeout(() => {
          const paths = Array.from(requestQueueRef.current);
          if (paths.length > 0) {
            onRequestThumbnails(paths);
            requestQueueRef.current.clear();
          }
          requestTimeoutRef.current = null;
        }, 50);
      }
    },
    [onRequestThumbnails],
  );

  const handleToggleRecursiveFolder = useCallback((path: string) => {
    setCollapsedRecursiveFolders((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const handleImageLoad = useCallback((path: string) => {
    loadedThumbnailsRef.current.add(path);
  }, []);

  const gridData = useMemo(() => {
    if (gridSize.width === 0 || imageList.length === 0) return null;

    const isListView = libraryDisplayMode === LibraryDisplayMode.List;
    // Tighter grid spacing (closer to classic dense photo-library grids)
    const OUTER_PADDING = isListView ? 0 : 8;
    const ITEM_GAP = isListView ? 0 : 4;
    const minThumbWidth = thumbnailSizeOptions.find((o: any) => o.id === thumbnailSize)?.size || 240;

    const availableWidth = gridSize.width - OUTER_PADDING * 2;
    const columnCount = isListView
      ? 1
      : Math.max(1, Math.floor((availableWidth + ITEM_GAP) / (minThumbWidth + ITEM_GAP)));
    const itemWidth = isListView ? availableWidth : (availableWidth - ITEM_GAP * (columnCount - 1)) / columnCount;

    const totalBase =
      listColumnWidths.thumbnail +
      listColumnWidths.name +
      listColumnWidths.date +
      listColumnWidths.rating +
      (listColumnWidths.flag || 0) +
      (listColumnWidths.edited || 0) +
      (listColumnWidths.fileType || 0) +
      (listColumnWidths.gps || 0) +
      (listColumnWidths.urgency || 0) +
      (listColumnWidths.creator || 0) +
      (listColumnWidths.credit || 0) +
      (listColumnWidths.city || 0) +
      (listColumnWidths.country || 0) +
      (listColumnWidths.state || 0) +
      (listColumnWidths.headline || 0) +
      listColumnWidths.color +
      (showExifCols
        ? listColumnWidths.shutter +
          listColumnWidths.aperture +
          listColumnWidths.iso +
          listColumnWidths.focal +
          (listColumnWidths.camera || 0) +
          (listColumnWidths.lens || 0)
        : 0);

    const listRowHeight = Math.max(32, Math.min(300, (availableWidth * listColumnWidths.thumbnail) / totalBase));
    const rowHeight = isListView ? listRowHeight : itemWidth + ITEM_GAP;
    const headerHeight = 40;

    const rows: any[] = [];

    if (libraryViewMode === LibraryViewMode.Recursive) {
      const groups = groupImagesByFolder(imageList, currentFolderPath);
      groups.forEach((group) => {
        if (group.images.length === 0) return;

        const isExpanded = !collapsedRecursiveFolders.has(group.path);
        rows.push({ type: 'header', path: group.path, count: group.images.length, isExpanded });

        if (isExpanded) {
          if (isListView) {
            for (let i = 0; i < group.images.length; i += columnCount) {
              rows.push({
                type: 'images',
                images: group.images.slice(i, i + columnCount),
                startIndex: i,
              });
            }
          } else {
            rows.push(...packJustifiedRows(group.images, availableWidth, minThumbWidth, ITEM_GAP));
          }
        }
      });
    } else if (isListView) {
      for (let i = 0; i < imageList.length; i += columnCount) {
        rows.push({
          type: 'images',
          images: imageList.slice(i, i + columnCount),
          startIndex: i,
        });
      }
    } else {
      rows.push(...packJustifiedRows(imageList, availableWidth, minThumbWidth, ITEM_GAP));
    }

    rows.push({ type: 'footer' });

    return {
      rows,
      itemWidth,
      rowHeight,
      listRowHeight,
      OUTER_PADDING,
      ITEM_GAP,
      columnCount,
      isListView,
      headerHeight,
    };
  }, [
    gridSize.width,
    imageList,
    libraryViewMode,
    libraryDisplayMode,
    collapsedRecursiveFolders,
    thumbnailSize,
    listColumnWidths.thumbnail,
    currentFolderPath,
    thumbnailSizeOptions,
  ]);

  useEffect(() => {
    if (!listHandle?.element || !gridData) return;

    const savedTop = useLibraryStore.getState().libraryScrollTop;
    const element = listHandle.element as HTMLElement;

    if (savedTop > 0) {
      element.scrollTop = savedTop;
    }
  }, [listHandle, currentFolderPath]);

  const prevActivePath = useRef<string | null>(null);

  useEffect(() => {
    if (!listHandle?.element || !gridData || multiSelectedPaths.length > 1) {
      prevActivePath.current = activePath;
      return;
    }

    if (activePath === prevActivePath.current) return;
    prevActivePath.current = activePath;

    const element = listHandle.element as HTMLElement;
    const { rows, ITEM_GAP, headerHeight, isListView, listRowHeight, OUTER_PADDING } = gridData;

    let targetTop = 0;
    let found = false;
    let foundHeight = isListView ? listRowHeight : 0;

    for (const row of rows) {
      if (row.type === 'footer') break;
      const h =
        row.type === 'header'
          ? headerHeight
          : typeof row.height === 'number'
            ? row.height + ITEM_GAP
            : isListView
              ? listRowHeight
              : gridData.rowHeight;
      if (row.type === 'images' && row.images.some((img: ImageFile) => img.path === activePath)) {
        found = true;
        foundHeight = h;
        break;
      }
      targetTop += h;
    }

    if (found) {
      const clientHeight = element.clientHeight;
      const scrollTop = element.scrollTop;
      const itemBottom = targetTop + foundHeight;
      const SCROLL_OFFSET = 120;

      if (itemBottom > scrollTop + clientHeight) {
        element.scrollTo({
          top: itemBottom - clientHeight + SCROLL_OFFSET,
          behavior: 'smooth',
        });
      } else if (targetTop < scrollTop) {
        element.scrollTo({
          top: Math.max(0, targetTop - SCROLL_OFFSET),
          behavior: 'smooth',
        });
      }
    }
  }, [activePath, gridData, multiSelectedPaths.length, listHandle, currentFolderPath, imageList, libraryViewMode]);

  const memoizedRowProps = useMemo(() => {
    if (!gridData) return {};

    return {
      rows: gridData.rows,
      activePath,
      multiSelectedSet: new Set(multiSelectedPaths),
      onContextMenu,
      onImageClick,
      onImageDoubleClick,
      thumbnailAspectRatio,
      onImageLoad: handleImageLoad,
      imageRatings,
      baseFolderPath: currentFolderPath,
      itemWidth: gridData.itemWidth,
      itemHeight: gridData.isListView ? gridData.listRowHeight : gridData.itemWidth,
      outerPadding: gridData.OUTER_PADDING,
      gap: gridData.ITEM_GAP,
      isListView: gridData.isListView,
      columnWidths: listColumnWidths,
      queueThumbnailRequest,
      onToggleRecursiveFolder: handleToggleRecursiveFolder,
      groupBadgeInfo,
      onRate,
    };
  }, [
    gridData,
    activePath,
    multiSelectedPaths,
    onContextMenu,
    onImageClick,
    onImageDoubleClick,
    thumbnailAspectRatio,
    handleImageLoad,
    imageRatings,
    currentFolderPath,
    listColumnWidths,
    queueThumbnailRequest,
    handleToggleRecursiveFolder,
    groupBadgeInfo,
    onRate,
  ]);

  const getItemSize = useCallback(
    (index: number) => {
      if (!gridData) return 0;
      if (gridData.rows[index].type === 'footer') return gridData.isListView ? 24 : gridData.OUTER_PADDING;
      if (gridData.rows[index].type === 'header') return gridData.headerHeight;
      const h = gridData.rows[index].height;
      if (typeof h === 'number') return h + gridData.ITEM_GAP;
      return gridData.rowHeight;
    },
    [gridData],
  );

  if (!gridData) {
    return (
      <div
        ref={libraryContainerRef}
        className="flex-1 w-full h-full"
        onClick={props.onClearSelection}
        onContextMenu={props.onEmptyAreaContextMenu}
      />
    );
  }

  const handleHeaderSort = (key: string) => {
    props.onClearSelection();
    setSortCriteria((prev: any) => {
      if (prev.key === key) {
        if (prev.order === SortDirection.Ascending) {
          return { ...prev, order: SortDirection.Descending };
        } else {
          return { key: 'name', order: SortDirection.Ascending };
        }
      }
      return { key, order: SortDirection.Ascending };
    });
  };

  return (
    <div
      ref={libraryContainerRef}
      className="flex-1 w-full h-full"
      onClick={props.onClearSelection}
      onContextMenu={props.onEmptyAreaContextMenu}
    >
      <div className="flex flex-col w-full h-full">
        {gridData.isListView && (
          <ListHeader
            widths={listColumnWidths}
            setWidths={(w: any) => setLibrary({ listColumnWidths: typeof w === 'function' ? w(listColumnWidths) : w })}
            containerRef={libraryContainerRef}
            sortCriteria={sortCriteria}
            onSortChange={handleHeaderSort}
          />
        )}
        <div
          key={`${gridSize.width}-${thumbnailSize}-${libraryViewMode}-${sortCriteria.key}-${sortCriteria.order}-${thumbnailAspectRatio}`}
          style={{ height: gridData.isListView ? gridSize.height - 36 : gridSize.height, width: gridSize.width }}
        >
          <List
            listRef={setListHandle}
            rowCount={gridData.rows.length}
            rowHeight={getItemSize}
            onScroll={(e: React.UIEvent<HTMLElement>) => handleScroll(e.currentTarget.scrollTop)}
            className="custom-scrollbar"
            rowComponent={Row}
            rowProps={memoizedRowProps}
          />
        </div>
      </div>
    </div>
  );
}
