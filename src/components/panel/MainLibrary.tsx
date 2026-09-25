import React, { useState, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import {
  AlertTriangle,
  Check,
  Folder,
  FolderInput,
  Home,
  Loader2,
  RefreshCw,
  Settings,
  Search,
  Users,
  LayoutGrid,
  Expand,
  SlidersHorizontal,
  Rows3,
  Star,
} from 'lucide-react';
import CullingView from './library/CullingView';
import CompareView from './library/CompareView';
import SurveyView from './library/SurveyView';
import LoupeView from './library/LoupeView';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { ThemeProps, THEMES, DEFAULT_THEME_ID } from '../../utils/themes';
import {
  AppSettings,
  ImageFile,
  LibraryViewMode,
  Progress,
  ThumbnailSize,
  ThumbnailAspectRatio,
  RawStatus,
  EditedStatus,
  FlagStatus,
  LibraryDisplayMode,
} from '../ui/AppProperties';
import { GroupBadgeInfo, GroupId } from '../../utils/imageGrouping';
import { COLOR_LABELS } from '../../utils/adjustments';
import { ImportState, Status } from '../ui/ExportImportProperties';
import Text from '../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import SettingsPanel from './SettingsPanel';

import LibraryGrid from './library/LibraryGrid';
import { SearchInput, ViewOptionsDropdown } from './library/LibraryHeader';

export interface ColumnWidths {
  thumbnail: number;
  name: number;
  date: number;
  rating: number;
  flag: number;
  edited: number;
  fileType: number;
  gps: number;
  urgency: number;
  creator: number;
  credit: number;
  city: number;
  country: number;
  state: number;
  headline: number;
  color: number;
  shutter: number;
  aperture: number;
  iso: number;
  focal: number;
  camera: number;
  lens: number;
}

interface MainLibraryProps {
  activePath: string | null;
  aiModelDownloadStatus: string | null;
  appSettings: AppSettings | null;
  currentFolderPath: string | null;
  groupBadgeInfo: Map<GroupId, GroupBadgeInfo> | null;
  imageList: Array<ImageFile>;
  imageRatings: Record<string, number>;
  importState: ImportState;
  indexingProgress: Progress;
  isLoading: boolean;
  isIndexing: boolean;
  isAndroid: boolean;
  isTreeLoading: boolean;
  libraryViewMode: LibraryViewMode;
  multiSelectedPaths: Array<string>;
  onClearSelection(): void;
  onContextMenu(event: any, path: string): void;
  onContinueSession(): void;
  onEmptyAreaContextMenu(event: any): void;
  onGoHome(): void;
  onImageClick(path: string, event: any): void;
  onImageDoubleClick(path: string): void;
  onImportClick(): void;
  onLibraryRefresh(): void;
  onOpenFolder(): void;
  onSettingsChange(settings: AppSettings): Promise<void>;
  onThumbnailAspectRatioChange(aspectRatio: ThumbnailAspectRatio): void;
  onThumbnailSizeChange(size: ThumbnailSize): void;
  onRequestThumbnails?(paths: string[]): void;
  rootPaths: string[];
  setLibraryViewMode(mode: LibraryViewMode): void;
  theme: string;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  thumbnailProgress: Progress;
  thumbnailSize: ThumbnailSize;
  onNavigateToCommunity(): void;
  onRate?(rate: number, paths?: string[]): void;
  onSetColorLabel?(color: string | null, paths?: string[]): void;
  onSetFlag?(flag: 'pick' | 'reject' | null, paths?: string[]): void;
}

interface DisplayModeSwitchProps {
  displayMode: LibraryDisplayMode;
  setDisplayMode: (mode: LibraryDisplayMode) => void;
  t: any;
}

function DisplayModeSwitch({ displayMode, setDisplayMode, t }: DisplayModeSwitchProps) {
  const options = useMemo(
    () => [
      {
        id: LibraryDisplayMode.Grid,
        Icon: LayoutGrid,
        tooltip: t('library.viewMode.grid', { defaultValue: 'Grid View' }),
      },
      {
        id: LibraryDisplayMode.List,
        Icon: Rows3,
        tooltip: t('library.viewMode.list', { defaultValue: 'List View' }),
      },
      {
        id: LibraryDisplayMode.Loupe,
        Icon: Expand,
        tooltip: t('library.viewMode.loupe', { defaultValue: 'Loupe View' }),
      },
    ],
    [t],
  );

  const selectedIndex = options.findIndex((opt) => opt.id === displayMode);
  const safeIndex = selectedIndex >= 0 ? selectedIndex : 0;

  return (
    <div className="flex items-center bg-surface/80 p-0.5 rounded-md border border-border-color/25 h-9 w-32 select-none">
      <div className="relative flex w-full h-full">
        <motion.div
          className="absolute top-0 bottom-0 z-0 bg-bg-primary rounded-md shadow-sm"
          initial={false}
          animate={{
            x: `${safeIndex * 100}%`,
            width: `${100 / options.length}%`,
          }}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
        />
        {options.map((opt) => {
          const Icon = opt.Icon;
          const isActive = displayMode === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setDisplayMode(opt.id)}
              className={`relative z-10 flex-1 h-full flex items-center justify-center rounded-md transition-colors duration-200 outline-none focus:outline-none ${
                isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
              data-tooltip={opt.tooltip}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MainLibrary(props: MainLibraryProps) {
  const { t } = useTranslation();
  const setUI = useUIStore((state) => state.setUI);
  const [appVersion, setAppVersion] = useState('');
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState('');
  const [isBusyDelayed, setIsBusyDelayed] = useState(false);
  const [isBusyLoaderMounted, setIsBusyLoaderMounted] = useState(false);
  const [isProgressHovered, setIsProgressHovered] = useState(false);
  const isSettingsOpen = useUIStore((state) => state.isSettingsOpen);
  const dualDisplayActive = useUIStore((state) => state.dualDisplayActive);

  const rawDisplayMode = props.appSettings?.libraryDisplayMode || LibraryDisplayMode.Grid;
  const libraryDisplayMode =
    rawDisplayMode === LibraryDisplayMode.List || rawDisplayMode === LibraryDisplayMode.Loupe
      ? rawDisplayMode
      : LibraryDisplayMode.Grid;

  const setLibraryDisplayMode = (mode: LibraryDisplayMode) => {
    if (props.appSettings) {
      props.onSettingsChange({
        ...props.appSettings,
        libraryDisplayMode: mode,
      });
    }
  };

  const searchCriteria = useLibraryStore((state) => state.searchCriteria);
  const filterCriteria = useLibraryStore((state) => state.filterCriteria);
  const showSelectedOnly = useLibraryStore((state) => state.showSelectedOnly);
  const setLibrary = useLibraryStore((state) => state.setLibrary);
  const setFilterCriteria = useLibraryStore((state) => state.setFilterCriteria);

  const translatedRatingFilterOptions = useMemo(
    () => [
      { value: 0, label: t('library.filters.rating.all') },
      { value: -1, label: t('library.filters.rating.unrated') },
      { value: 1, label: t('library.filters.rating.oneAndUp') },
      { value: 2, label: t('library.filters.rating.twoAndUp') },
      { value: 3, label: t('library.filters.rating.threeAndUp') },
      { value: 4, label: t('library.filters.rating.fourAndUp') },
      { value: 5, label: t('library.filters.rating.fiveOnly') },
    ],
    [t],
  );

  const translatedRawStatusOptions = useMemo(
    () => [
      { key: RawStatus.All, label: t('library.filters.raw.all') },
      { key: RawStatus.RawOnly, label: t('library.filters.raw.rawOnly') },
      { key: RawStatus.NonRawOnly, label: t('library.filters.raw.nonRawOnly') },
    ],
    [t],
  );

  const translatedEditedStatusOptions = useMemo(
    () => [
      { key: EditedStatus.All, label: t('library.filters.edited.all') },
      { key: EditedStatus.EditedOnly, label: t('library.filters.edited.editedOnly') },
      { key: EditedStatus.UneditedOnly, label: t('library.filters.edited.uneditedOnly') },
    ],
    [t],
  );

  const translatedThumbnailSizeOptions = useMemo(
    () => [
      { id: ThumbnailSize.Small, label: t('library.thumbnailSize.small'), size: 160 },
      { id: ThumbnailSize.Medium, label: t('library.thumbnailSize.medium'), size: 240 },
      { id: ThumbnailSize.Large, label: t('library.thumbnailSize.large'), size: 320 },
    ],
    [t],
  );

  const translatedThumbnailAspectRatioOptions = useMemo(
    () => [
      { id: ThumbnailAspectRatio.Cover, label: t('library.thumbnailFit.fillSquare') },
      { id: ThumbnailAspectRatio.Contain, label: t('library.thumbnailFit.originalRatio') },
    ],
    [t],
  );

  const translatedSortOptions = useMemo(
    () => [
      { key: 'name', label: t('library.sort.fileName') },
      { key: 'date', label: t('library.sort.dateModified') },
      { key: 'date_taken', label: t('library.sort.dateTaken') },
      { key: 'rating', label: t('library.sort.rating') },
      { key: 'edited', label: t('library.sort.editedStatus') },
      { key: 'color', label: t('library.sort.colorLabel' as any, { defaultValue: 'Color label' }) },
      { key: 'flag', label: t('library.sort.flag' as any, { defaultValue: 'Flag' }) },
      { key: 'camera', label: t('library.sort.camera' as any, { defaultValue: 'Camera' }) },
      { key: 'lens', label: t('library.sort.lens' as any, { defaultValue: 'Lens' }) },
      { key: 'focal_length', label: t('library.sort.focalLength') },
      { key: 'iso', label: t('library.sort.iso') },
      { key: 'shutter_speed', label: t('library.sort.shutterSpeed') },
      { key: 'aperture', label: t('library.sort.aperture') },
    ],
    [t],
  );

  const isBusy =
    props.isLoading ||
    ((props.thumbnailProgress?.total ?? 0) > 0 &&
      (props.thumbnailProgress?.current ?? 0) < (props.thumbnailProgress?.total ?? 0));

  useEffect(() => {
    let timer: number | undefined;

    if (isBusy) {
      timer = window.setTimeout(() => setIsBusyDelayed(true), 1000);
    } else {
      timer = window.setTimeout(() => setIsBusyDelayed(false), 500);
    }

    return () => clearTimeout(timer);
  }, [isBusy]);

  useEffect(() => {
    if (isBusyDelayed) {
      setIsBusyLoaderMounted(true);
    }
  }, [isBusyDelayed]);

  useEffect(() => {
    const compareVersions = (v1: string, v2: string) => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      const len = Math.max(parts1.length, parts2.length);
      for (let i = 0; i < len; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 < p2) return -1;
        if (p1 > p2) return 1;
      }
      return 0;
    };

    const checkVersion = async () => {
      try {
        const currentVersion = await getVersion();
        setAppVersion(currentVersion);

        const response = await fetch('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest');
        if (!response.ok) {
          console.error('Failed to fetch latest release info from GitHub.');
          return;
        }
        const data = await response.json();
        const latestTag = data.tag_name;
        if (!latestTag) return;

        const latestVersionStr = latestTag.startsWith('v') ? latestTag.substring(1) : latestTag;
        setLatestVersion(latestVersionStr);

        if (compareVersions(currentVersion, latestVersionStr) < 0) {
          setIsUpdateAvailable(true);
        }
      } catch (error) {
        console.error('Error checking for updates:', error);
      }
    };

    checkVersion();
  }, []);

  if (!props.rootPaths || props.rootPaths.length === 0) {
    if (!props.appSettings) {
      return null;
    }
    const hasLastPath = !!props.appSettings.lastRootPath || !!props.appSettings.rootFolders?.length;
    // Session is restored automatically on launch; with no folder yet, point to Import.
    return (
      <div className="flex-1 flex items-center justify-center h-full p-2">
        {!hasLastPath && (
          <div className="text-center space-y-3">
            <Text as="div" className="text-text-secondary">
              {t('library.empty.noFolder' as any, {
                defaultValue: 'Ajoutez un dossier pour parcourir vos photos. Cochez celles à garder, puis Importer.',
              })}
            </Text>
            <button
              type="button"
              onClick={props.onOpenFolder}
              className="h-8 px-3 rounded bg-surface border border-border-color/40 text-xs text-text-primary hover:bg-card-active"
            >
              {t('library.folders.addFolder')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-bg-secondary rounded-lg overflow-hidden">
      <header
        className="px-3 py-1.5 shrink-0 flex justify-between items-center border-b border-border-color/40 gap-3 bg-bg-secondary/95"
        onMouseEnter={() => setIsProgressHovered(true)}
        onMouseLeave={() => setIsProgressHovered(false)}
      >
        <div className="min-w-0">
          <Text variant={TextVariants.heading} weight={TextWeights.semibold} className="uppercase tracking-wider text-[11px]">
            {t('library.header.title')}
          </Text>
          {!props.isAndroid && (
            <div
              className={`flex items-center gap-2 overflow-hidden transition-all duration-300 whitespace-nowrap ${
                isBusyDelayed ? 'max-w-xs opacity-100' : 'max-w-0 opacity-0'
              }`}
              onTransitionEnd={(e) => {
                if (e.propertyName === 'opacity' && !isBusyDelayed) {
                  setIsBusyLoaderMounted(false);
                }
              }}
            >
              {isBusyLoaderMounted && (
                <Loader2 size={14} className="animate-spin text-text-secondary shrink-0" />
              )}
              <div
                className={`flex items-center transition-all duration-300 ease-out overflow-hidden ${
                  isProgressHovered && isBusyDelayed && (props.thumbnailProgress?.total ?? 0) > 0
                    ? 'max-w-xs opacity-100'
                    : 'max-w-0 opacity-0'
                }`}
              >
                <Text variant={TextVariants.small} color={TextColors.secondary} className="whitespace-nowrap">
                  ({props.thumbnailProgress?.current ?? 0}/{props.thumbnailProgress?.total ?? 0})
                </Text>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 max-w-[70%]">
          {props.importState.status === Status.Importing && (
            <Text as="div" color={TextColors.accent} className="flex items-center gap-2 animate-pulse">
              <FolderInput size={16} />
              <span>
                {t('library.import.progress', {
                  current: props.importState.progress?.current,
                  total: props.importState.progress?.total,
                })}
              </span>
            </Text>
          )}
          {props.importState.status === Status.Success && (
            <Text as="div" color={TextColors.success} className="flex items-center gap-2">
              <Check size={16} />
              <span>{t('library.import.complete')}</span>
            </Text>
          )}
          {props.importState.status === Status.Error && (
            <Text as="div" color={TextColors.error} className="flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{t('library.import.failed')}</span>
            </Text>
          )}
          <span
            className="hidden sm:inline-flex items-center h-8 px-2 rounded-md text-[10px] tabular-nums text-text-secondary/80 bg-surface/50 border border-border-color/20"
            data-tooltip={t('library.filters.photoCountTip' as any, {
              defaultValue: 'Photos in current view (after filters)',
            })}
          >
            {t('library.filters.photoCount' as any, {
              defaultValue: '{{count}} photos',
              count: props.imageList?.length ?? 0,
            })}
          </span>
          <button
            type="button"
            disabled={(props.multiSelectedPaths?.length || 0) === 0 && !props.activePath}
            onClick={() =>
              setLibrary({
                showSelectedOnly: !showSelectedOnly,
                showPreviousImportOnly: false,
                showQuickCollectionOnly: false,
              })
            }
            className={clsx(
              'hidden sm:inline-flex items-center h-8 px-2 rounded-md text-[10px] uppercase tracking-wide border transition-colors',
              showSelectedOnly
                ? 'bg-card-active text-text-primary border-border-color/40'
                : 'text-text-secondary hover:text-text-primary bg-surface/80 border-border-color/25',
              (props.multiSelectedPaths?.length || 0) === 0 && !props.activePath && 'opacity-40 cursor-not-allowed',
            )}
            data-tooltip={t('library.filters.selectedOnlyTip' as any, {
              defaultValue: 'Show only selected photos',
            })}
          >
            {t('library.filters.selectedOnly' as any, { defaultValue: 'Selected' })}
            {(props.multiSelectedPaths?.length || 0) > 0 && (
              <span className="ml-1 min-w-[1.1rem] h-4 px-1 rounded bg-black/25 text-text-primary flex items-center justify-center text-[9px] tabular-nums">
                {props.multiSelectedPaths.length}
              </span>
            )}
          </button>
          <DisplayModeSwitch displayMode={libraryDisplayMode} setDisplayMode={setLibraryDisplayMode} t={t} />

          <div className="flex items-center bg-surface/80 p-0.5 rounded-md gap-0.5 border border-border-color/25">
            <SearchInput indexingProgress={props.indexingProgress} isIndexing={props.isIndexing} />
            <ViewOptionsDropdown
              advancedFilters={
                <>
          <div className="hidden xl:flex items-center gap-1 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[9rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={filterCriteria?.camera || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  camera: e.target.value || undefined,
                }))
              }
              data-tooltip={t('library.filters.camera' as any, { defaultValue: 'Camera' })}
            >
              <option value="">{t('library.filters.cameraAll' as any, { defaultValue: 'All cameras' })}</option>
              {Array.from(
                new Set(
                  (props.imageList || [])
                    .map((img: any) => {
                      const make = img.exif?.Make || '';
                      const model = img.exif?.Model || '';
                      return `${make} ${model}`.trim();
                    })
                    .filter(Boolean),
                ),
              )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((cam: string) => (
                  <option key={cam} value={cam}>
                    {cam}
                  </option>
                ))}
            </select>
          </div>
          <div className="hidden xl:flex items-center gap-1 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[8rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={filterCriteria?.city || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  city: e.target.value || undefined,
                }))
              }
              data-tooltip={t('library.filters.city' as any, { defaultValue: 'City' })}
            >
              <option value="">{t('library.filters.cityAll' as any, { defaultValue: 'All cities' })}</option>
              {Array.from(
                new Set(
                  (props.imageList || [])
                    .map((img: any) => String(img.exif?.City || '').trim())
                    .filter(Boolean),
                ),
              )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((city: string) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
            </select>
          </div>
          <div className="hidden xl:flex items-center gap-1 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[8rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={filterCriteria?.country || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  country: e.target.value || undefined,
                }))
              }
              data-tooltip={t('library.filters.country' as any, { defaultValue: 'Country' })}
            >
              <option value="">{t('library.filters.countryAll' as any, { defaultValue: 'All countries' })}</option>
              {Array.from(
                new Set(
                  (props.imageList || [])
                    .map((img: any) => String(img.exif?.Country || '').trim())
                    .filter(Boolean),
                ),
              )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((country: string) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
            </select>
          </div>
          <div className="hidden xl:flex items-center gap-1 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[9rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={filterCriteria?.lens || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  lens: e.target.value || undefined,
                }))
              }
              data-tooltip={t('library.filters.lens' as any, { defaultValue: 'Lens' })}
            >
              <option value="">{t('library.filters.lensAll' as any, { defaultValue: 'All lenses' })}</option>
              {Array.from(
                new Set(
                  (props.imageList || [])
                    .map((img: any) => String(img.exif?.LensModel || img.exif?.Lens || '').trim())
                    .filter(Boolean),
                ),
              )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((lens: string) => (
                  <option key={lens} value={lens}>
                    {lens}
                  </option>
                ))}
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25">
            <select
              value={filterCriteria?.fileExt || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  fileExt: e.target.value || undefined,
                }))
              }
              className="h-6 max-w-[5.5rem] bg-transparent text-[10px] text-text-secondary outline-none"
              data-tooltip={t('library.filters.fileExt' as any, { defaultValue: 'File type' })}
            >
              <option value="">{t('library.filters.fileExtAll' as any, { defaultValue: 'All types' })}</option>
              {Array.from(
                new Set(
                  (props.imageList || []).map((img: any) => {
                    const p = String(img.path || '');
                    const d = p.lastIndexOf('.');
                    return d >= 0 ? p.slice(d + 1).toLowerCase() : '';
                  }).filter(Boolean),
                ),
              )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((ext: string) => (
                  <option key={ext} value={ext}>
                    {ext.toUpperCase()}
                  </option>
                ))}
            </select>
          </div>

          <div className="hidden lg:flex items-center gap-1 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25">
            <input
              list="keyword-filter-list"
              type="search"
              placeholder={t('library.filters.keywordPlaceholder' as any, { defaultValue: 'Keyword…' })}
              value={filterCriteria?.keyword || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  keyword: e.target.value || undefined,
                }))
              }
              className="h-6 w-24 xl:w-28 bg-transparent text-[10px] text-text-secondary placeholder:text-text-secondary/50 outline-none px-1"
            />
            <datalist id="keyword-filter-list">
              {Array.from(
                new Set(
                  (props.imageList || []).flatMap((img: any) =>
                    (img.tags || [])
                      .filter((tg: string) => tg.startsWith('user:'))
                      .map((tg: string) => tg.replace(/^user:/, '')),
                  ),
                ),
              )
                .filter(Boolean)
                .sort((a: string, b: string) => a.localeCompare(b))
                .slice(0, 80)
                .map((kw: string) => (
                  <option key={kw} value={kw} />
                ))}
            </datalist>

          </div>
          <div className="hidden xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25">
            <input
              type="search"
              placeholder={t('library.filters.captionPlaceholder' as any, { defaultValue: 'Caption…' })}
              value={filterCriteria?.caption || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  caption: e.target.value || undefined,
                }))
              }
              className="h-6 w-24 xl:w-28 bg-transparent text-[10px] text-text-secondary placeholder:text-text-secondary/50 outline-none px-1"
              data-tooltip={t('library.filters.caption' as any, { defaultValue: 'Caption / title' })}
            />
          </div>

          <div className="hidden xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px] text-text-secondary">
            <select
              className="h-6 max-w-[5.5rem] bg-transparent text-[10px] outline-none"
              value={filterCriteria?.dateField === 'modified' ? 'modified' : 'capture'}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  dateField: e.target.value === 'modified' ? 'modified' : 'capture',
                }))
              }
              data-tooltip={t('library.filters.dateField' as any, {
                defaultValue: 'Date field for range filter',
              })}
            >
              <option value="capture">{t('library.filters.dateCapture' as any, { defaultValue: 'Capture' })}</option>
              <option value="modified">{t('library.filters.dateModified' as any, { defaultValue: 'Modified' })}</option>
            </select>
            <input
              type="date"
              value={filterCriteria?.dateFrom || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  dateFrom: e.target.value || undefined,
                }))
              }
              className="h-6 bg-transparent text-[10px] outline-none max-w-[7.5rem]"
              data-tooltip={t('library.filters.dateFrom' as any, { defaultValue: 'From date' })}
            />
            <span className="opacity-40">–</span>
            <input
              type="date"
              value={filterCriteria?.dateTo || ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  dateTo: e.target.value || undefined,
                }))
              }
              className="h-6 bg-transparent text-[10px] outline-none max-w-[7.5rem]"
              data-tooltip={t('library.filters.dateTo' as any, { defaultValue: 'To date' })}
            />
          </div>
          <div className="hidden xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px] text-text-secondary">
            <span className="opacity-50 px-0.5">ISO</span>
            <input
              type="number"
              min={0}
              placeholder={t('library.filters.isoMin' as any, { defaultValue: 'min' })}
              value={filterCriteria?.isoMin ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  isoMin: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-12 bg-transparent text-[10px] outline-none"
            />
            <span className="opacity-40">–</span>
            <input
              type="number"
              min={0}
              placeholder={t('library.filters.isoMax' as any, { defaultValue: 'max' })}
              value={filterCriteria?.isoMax ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  isoMax: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-12 bg-transparent text-[10px] outline-none"
            />
          </div>
          <div className="hidden 2xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px] text-text-secondary">
            <span className="opacity-50 px-0.5">f/</span>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder={t('library.filters.apertureMin' as any, { defaultValue: 'min' })}
              value={filterCriteria?.apertureMin ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  apertureMin: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-11 bg-transparent text-[10px] outline-none"
            />
            <span className="opacity-40">–</span>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder={t('library.filters.apertureMax' as any, { defaultValue: 'max' })}
              value={filterCriteria?.apertureMax ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  apertureMax: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-11 bg-transparent text-[10px] outline-none"
            />
          </div>
          <div className="hidden 2xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px] text-text-secondary">
            <span className="opacity-50 px-0.5">mm</span>
            <input
              type="number"
              min={0}
              placeholder={t('library.filters.focalMin' as any, { defaultValue: 'min' })}
              value={filterCriteria?.focalMin ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  focalMin: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-11 bg-transparent text-[10px] outline-none"
            />
            <span className="opacity-40">–</span>
            <input
              type="number"
              min={0}
              placeholder={t('library.filters.focalMax' as any, { defaultValue: 'max' })}
              value={filterCriteria?.focalMax ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  focalMax: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-11 bg-transparent text-[10px] outline-none"
            />
          </div>
          <div className="hidden 2xl:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px] text-text-secondary" title={t('library.filters.shutterHint' as any, { defaultValue: 'Shutter range in seconds (e.g. 0.004 = 1/250)' })}>
            <span className="opacity-50 px-0.5">s</span>
            <input
              type="number"
              min={0}
              step="any"
              placeholder={t('library.filters.shutterMin' as any, { defaultValue: 'min' })}
              value={filterCriteria?.shutterMin ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  shutterMin: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-14 bg-transparent text-[10px] outline-none"
            />
            <span className="opacity-40">–</span>
            <input
              type="number"
              min={0}
              step="any"
              placeholder={t('library.filters.shutterMax' as any, { defaultValue: 'max' })}
              value={filterCriteria?.shutterMax ?? ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  shutterMax: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              className="h-6 w-14 bg-transparent text-[10px] outline-none"
            />
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[5.5rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={filterCriteria?.hasGps && filterCriteria.hasGps !== 'all' ? filterCriteria.hasGps : ''}
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  hasGps: e.target.value ? (e.target.value as 'yes' | 'no') : undefined,
                }))
              }
              data-tooltip={t('library.filters.hasGps' as any, { defaultValue: 'GPS' })}
            >
              <option value="">{t('library.filters.gpsAll' as any, { defaultValue: 'GPS: all' })}</option>
              <option value="yes">{t('library.filters.gpsYes' as any, { defaultValue: 'Has GPS' })}</option>
              <option value="no">{t('library.filters.gpsNo' as any, { defaultValue: 'No GPS' })}</option>
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[6.5rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={
                filterCriteria?.hasKeywords && filterCriteria.hasKeywords !== 'all'
                  ? filterCriteria.hasKeywords
                  : ''
              }
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  hasKeywords: e.target.value ? (e.target.value as 'yes' | 'no') : undefined,
                }))
              }
              data-tooltip={t('library.filters.hasKeywords' as any, { defaultValue: 'Keywords' })}
            >
              <option value="">{t('library.filters.keywordsAll' as any, { defaultValue: 'Keywords: all' })}</option>
              <option value="yes">{t('library.filters.keywordsYes' as any, { defaultValue: 'Has keywords' })}</option>
              <option value="no">{t('library.filters.keywordsNo' as any, { defaultValue: 'No keywords' })}</option>
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[6.5rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={
                filterCriteria?.virtualCopies && filterCriteria.virtualCopies !== 'all'
                  ? filterCriteria.virtualCopies
                  : ''
              }
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  virtualCopies: e.target.value ? (e.target.value as 'yes' | 'no') : undefined,
                }))
              }
              data-tooltip={t('library.filters.virtualCopies' as any, { defaultValue: 'Virtual copies' })}
            >
              <option value="">{t('library.filters.vcAll' as any, { defaultValue: 'VC: all' })}</option>
              <option value="yes">{t('library.filters.vcYes' as any, { defaultValue: 'Virtual copies' })}</option>
              <option value="no">{t('library.filters.vcNo' as any, { defaultValue: 'Masters only' })}</option>
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[6.5rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={
                filterCriteria?.hasCaption && filterCriteria.hasCaption !== 'all'
                  ? filterCriteria.hasCaption
                  : ''
              }
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  hasCaption: e.target.value ? (e.target.value as 'yes' | 'no') : undefined,
                }))
              }
              data-tooltip={t('library.filters.hasCaption' as any, { defaultValue: 'Caption' })}
            >
              <option value="">{t('library.filters.captionAll' as any, { defaultValue: 'Caption: all' })}</option>
              <option value="yes">{t('library.filters.captionYes' as any, { defaultValue: 'Has caption' })}</option>
              <option value="no">{t('library.filters.captionNo' as any, { defaultValue: 'No caption' })}</option>
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[7rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={
                filterCriteria?.hasLocation && filterCriteria.hasLocation !== 'all'
                  ? filterCriteria.hasLocation
                  : ''
              }
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  hasLocation: e.target.value ? (e.target.value as 'yes' | 'no') : undefined,
                }))
              }
              data-tooltip={t('library.filters.hasLocation' as any, { defaultValue: 'Location' })}
            >
              <option value="">{t('library.filters.locationAll' as any, { defaultValue: 'Loc: all' })}</option>
              <option value="yes">{t('library.filters.locationYes' as any, { defaultValue: 'Has location' })}</option>
              <option value="no">{t('library.filters.locationNo' as any, { defaultValue: 'No location' })}</option>
            </select>
          </div>
          <div className="hidden lg:flex items-center gap-0.5 px-1 h-8 rounded-md bg-surface/80 border border-border-color/25 text-[10px]">
            <select
              className="h-6 max-w-[7rem] bg-transparent text-text-secondary text-[10px] outline-none"
              value={
                filterCriteria?.orientation && filterCriteria.orientation !== 'all'
                  ? filterCriteria.orientation
                  : ''
              }
              onChange={(e) =>
                setFilterCriteria((prev: any) => ({
                  ...prev,
                  orientation: e.target.value
                    ? (e.target.value as 'landscape' | 'portrait' | 'square')
                    : undefined,
                }))
              }
              data-tooltip={t('library.filters.orientation' as any, { defaultValue: 'Orientation' })}
            >
              <option value="">{t('library.filters.orientationAll' as any, { defaultValue: 'Orient: all' })}</option>
              <option value="landscape">{t('library.filters.landscape' as any, { defaultValue: 'Landscape' })}</option>
              <option value="portrait">{t('library.filters.portrait' as any, { defaultValue: 'Portrait' })}</option>
              <option value="square">{t('library.filters.square' as any, { defaultValue: 'Square' })}</option>
            </select>
          </div>
                </>
              }
              resetFilters={
                <>
          {((filterCriteria?.rating ?? 0) !== 0 ||
            (filterCriteria?.colors || []).length > 0 ||
            (filterCriteria?.rawStatus && filterCriteria.rawStatus !== RawStatus.All) ||
            (filterCriteria?.editedStatus && filterCriteria.editedStatus !== EditedStatus.All) ||
            (filterCriteria?.flagStatus && filterCriteria.flagStatus !== FlagStatus.All) ||
            !!(filterCriteria?.camera && String(filterCriteria.camera).trim()) ||
            !!(filterCriteria?.city && String(filterCriteria.city).trim()) ||
            !!(filterCriteria?.country && String(filterCriteria.country).trim()) ||
            !!(filterCriteria?.keyword && String(filterCriteria.keyword).trim()) ||
            !!(filterCriteria?.dateFrom || filterCriteria?.dateTo) ||
            !!(filterCriteria?.lens && String(filterCriteria.lens).trim()) ||
            filterCriteria?.isoMin != null ||
            filterCriteria?.isoMax != null ||
            !!(filterCriteria?.hasGps && filterCriteria.hasGps !== 'all') ||
            filterCriteria?.apertureMin != null ||
            filterCriteria?.apertureMax != null ||
            filterCriteria?.focalMin != null ||
            filterCriteria?.focalMax != null ||
            filterCriteria?.shutterMin != null ||
            filterCriteria?.shutterMax != null ||
            !!(filterCriteria?.fileExt && String(filterCriteria.fileExt).trim()) ||
            !!(filterCriteria?.caption && String(filterCriteria.caption).trim()) ||
            !!(filterCriteria?.hasKeywords && filterCriteria.hasKeywords !== 'all') ||
            !!(filterCriteria?.virtualCopies && filterCriteria.virtualCopies !== 'all') ||
            !!(filterCriteria?.hasCaption && filterCriteria.hasCaption !== 'all') ||
            !!(filterCriteria?.hasLocation && filterCriteria.hasLocation !== 'all') ||
            !!(filterCriteria?.orientation && filterCriteria.orientation !== 'all')) && (
            <button
              type="button"
              className="hidden sm:flex items-center h-8 px-2 rounded-md text-[10px] uppercase tracking-wide text-text-secondary hover:text-text-primary bg-surface/80 border border-border-color/25 gap-1"
              onClick={() =>
                setFilterCriteria({
                  colors: [],
                  rating: 0,
                  rawStatus: RawStatus.All,
                  editedStatus: EditedStatus.All,
                  flagStatus: FlagStatus.All,
                  camera: undefined,
                  city: undefined,
                  country: undefined,
                  keyword: undefined,
                  dateFrom: undefined,
                  dateTo: undefined,
                  dateField: undefined,
                  lens: undefined,
                  isoMin: undefined,
                  isoMax: undefined,
                  hasGps: undefined,
                  apertureMin: undefined,
                  apertureMax: undefined,
                  focalMin: undefined,
                  focalMax: undefined,
                  shutterMin: undefined,
                  shutterMax: undefined,
                  fileExt: undefined,
                  caption: undefined,
                  hasKeywords: undefined,
                  virtualCopies: undefined,
                  hasCaption: undefined,
                  hasLocation: undefined,
                  orientation: undefined,
                })
              }
            >
              {t('library.filters.reset')}
              <span className="min-w-[1.1rem] h-4 px-1 rounded bg-card-active text-text-primary flex items-center justify-center text-[9px]">
                {Number((filterCriteria?.rating ?? 0) !== 0) +
                  Number((filterCriteria?.colors || []).length > 0) +
                  Number(!!(filterCriteria?.rawStatus && filterCriteria.rawStatus !== RawStatus.All)) +
                  Number(!!(filterCriteria?.editedStatus && filterCriteria.editedStatus !== EditedStatus.All)) +
                  Number(!!(filterCriteria?.flagStatus && filterCriteria.flagStatus !== FlagStatus.All)) +
                  Number(!!(filterCriteria?.camera && String(filterCriteria.camera).trim())) +
                  Number(!!(filterCriteria?.city && String(filterCriteria.city).trim())) +
                  Number(!!(filterCriteria?.country && String(filterCriteria.country).trim())) +
                  Number(!!(filterCriteria?.keyword && String(filterCriteria.keyword).trim())) +
                  Number(!!(filterCriteria?.dateFrom || filterCriteria?.dateTo)) +
                  Number(!!(filterCriteria?.lens && String(filterCriteria.lens).trim())) +
                  Number(filterCriteria?.isoMin != null || filterCriteria?.isoMax != null) +
                  Number(!!(filterCriteria?.hasGps && filterCriteria.hasGps !== 'all')) +
                  Number(filterCriteria?.apertureMin != null || filterCriteria?.apertureMax != null) +
                  Number(filterCriteria?.focalMin != null || filterCriteria?.focalMax != null) +
                  Number(filterCriteria?.shutterMin != null || filterCriteria?.shutterMax != null) +
                  Number(!!(filterCriteria?.fileExt && String(filterCriteria.fileExt).trim())) +
                  Number(!!(filterCriteria?.caption && String(filterCriteria.caption).trim())) +
                  Number(!!(filterCriteria?.hasKeywords && filterCriteria.hasKeywords !== 'all')) +
                  Number(!!(filterCriteria?.virtualCopies && filterCriteria.virtualCopies !== 'all')) +
                  Number(!!(filterCriteria?.hasCaption && filterCriteria.hasCaption !== 'all')) +
                  Number(!!(filterCriteria?.hasLocation && filterCriteria.hasLocation !== 'all')) +
                  Number(!!(filterCriteria?.hasStack && filterCriteria.hasStack !== 'all')) +
                  Number(!!(filterCriteria?.orientation && filterCriteria.orientation !== 'all'))}
              </span>
            </button>
          )}
                </>
              }
              libraryViewMode={props.libraryViewMode}
              onSelectSize={props.onThumbnailSizeChange}
              onSelectAspectRatio={props.onThumbnailAspectRatioChange}
              onLibraryRefresh={props.onLibraryRefresh}
              setLibraryViewMode={props.setLibraryViewMode}
              thumbnailSize={props.thumbnailSize}
              thumbnailAspectRatio={props.thumbnailAspectRatio}
              thumbnailSizeOptions={translatedThumbnailSizeOptions}
              thumbnailAspectRatioOptions={translatedThumbnailAspectRatioOptions}
              ratingFilterOptions={translatedRatingFilterOptions}
              rawStatusOptions={translatedRawStatusOptions}
              editedStatusOptions={translatedEditedStatusOptions}
              sortOptions={translatedSortOptions}
            />
            {!props.isAndroid && (
              <Button
                className="h-9 w-9 bg-transparent text-text-primary shadow-none p-0 flex items-center justify-center"
                onClick={props.onNavigateToCommunity}
                data-tooltip={t('library.tooltips.communityPresets')}
              >
                <Users className="w-4 h-4" />
              </Button>
            )}
            <Button
              className="h-9 w-9 bg-transparent text-text-primary shadow-none p-0 flex items-center justify-center"
              onClick={props.onGoHome}
              data-tooltip={t('library.tooltips.goHome')}
            >
              <Home className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {props.imageList.length > 0 ? (
        libraryDisplayMode === LibraryDisplayMode.Cull ? (
          <CullingView {...props} />
        ) : libraryDisplayMode === LibraryDisplayMode.Compare ? (
          <CompareView
            imageList={props.imageList}
            multiSelectedPaths={props.multiSelectedPaths}
            activePath={props.activePath}
            imageRatings={props.imageRatings}
            onImageClick={props.onImageClick}
            onImageDoubleClick={props.onImageDoubleClick}
            onContextMenu={props.onContextMenu}
            onRequestThumbnails={props.onRequestThumbnails}
            onRate={props.onRate}
          />
        ) : libraryDisplayMode === LibraryDisplayMode.Survey ? (
          <SurveyView
            imageList={props.imageList}
            multiSelectedPaths={props.multiSelectedPaths}
            activePath={props.activePath}
            imageRatings={props.imageRatings}
            onImageClick={props.onImageClick}
            onImageDoubleClick={props.onImageDoubleClick}
            onContextMenu={props.onContextMenu}
            onRequestThumbnails={props.onRequestThumbnails}
            onRate={props.onRate}
          />
        ) : libraryDisplayMode === LibraryDisplayMode.Loupe && !dualDisplayActive ? (
          <LoupeView
            imageList={props.imageList}
            multiSelectedPaths={props.multiSelectedPaths}
            activePath={props.activePath}
            imageRatings={props.imageRatings}
            onImageClick={props.onImageClick}
            onImageDoubleClick={props.onImageDoubleClick}
            onContextMenu={props.onContextMenu}
            onRequestThumbnails={props.onRequestThumbnails}
            onRate={props.onRate}
            onSetColorLabel={props.onSetColorLabel}
            onSetFlag={props.onSetFlag}
          />
        ) : (
          <LibraryGrid
            {...props}
            libraryDisplayMode={libraryDisplayMode}
            thumbnailSizeOptions={translatedThumbnailSizeOptions}
          />
        )
      ) : props.isIndexing || props.aiModelDownloadStatus || props.importState.status === Status.Importing ? (
        <div className="flex-1 flex flex-col items-center justify-center" onContextMenu={props.onEmptyAreaContextMenu}>
          <Loader2 className="h-12 w-12 text-secondary animate-spin mb-4" />
          <Text variant={TextVariants.heading} color={TextColors.secondary}>
            {props.aiModelDownloadStatus
              ? t('library.status.downloading', { status: props.aiModelDownloadStatus })
              : props.isIndexing && props.indexingProgress.total > 0
                ? t('library.status.indexing', {
                    current: props.indexingProgress.current,
                    total: props.indexingProgress.total,
                  })
                : props.importState.status === Status.Importing &&
                    props.importState?.progress?.total &&
                    props.importState.progress.total > 0
                  ? t('library.status.importing', {
                      current: props.importState.progress?.current,
                      total: props.importState.progress?.total,
                    })
                  : t('library.status.processing')}
          </Text>
          <Text className="mt-2">{t('library.status.moment')}</Text>
        </div>
      ) : searchCriteria.tags.length > 0 || searchCriteria.text ? (
        <div
          className="flex-1 flex flex-col items-center justify-center text-text-secondary text-center"
          onContextMenu={props.onEmptyAreaContextMenu}
        >
          <Search className="h-12 w-12 text-secondary mb-4" />
          <Text variant={TextVariants.heading} color={TextColors.secondary}>
            {t('library.search.noResults')}
          </Text>
          <Text className="mt-2 max-w-sm">
            {t('library.search.noResultsDesc')}
            {!props.appSettings?.enableAiTagging && t('library.search.noResultsAiHint')}
          </Text>
        </div>
      ) : (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3"
          onContextMenu={props.onEmptyAreaContextMenu}
        >
          <SlidersHorizontal className="h-12 w-12 text-text-secondary" />
          <Text>{t('library.filters.noMatch')}</Text>
          <Text variant={TextVariants.small} color={TextColors.secondary} className="max-w-sm text-center">
            {t('library.filters.noMatchHint' as any, {
              defaultValue: 'No photos match the current filters or catalog scope. Clear filters or pick another folder.',
            })}
          </Text>
          <button
            type="button"
            className="mt-1 h-8 px-3 rounded-md text-[11px] font-semibold uppercase bg-surface border border-border-color/40 text-text-secondary hover:text-text-primary hover:bg-card-active"
            onClick={() => {
              useLibraryStore.getState().setLibrary({
                filterCriteria: {
                  colors: [],
                  rating: 0,
                  rawStatus: RawStatus.All,
                  editedStatus: EditedStatus.All,
                  flagStatus: FlagStatus.All,
                  hasGps: 'all',
                  hasCaption: 'all',
                  hasLocation: 'all',
                  orientation: 'all',
                  hasStack: 'all',
                  hasKeywords: 'all',
                  virtualCopies: 'all',
                },
                showPreviousImportOnly: false,
                showQuickCollectionOnly: false,
                showSelectedOnly: false,
              });
            }}
          >
            {t('library.filters.clearFilters' as any, { defaultValue: 'Clear filters' })}
          </button>
        </div>
      )}
      {props.isAndroid && (
        <Button
          className="absolute bottom-18 right-8 h-12 w-12 bg-accent text-button-text shadow-lg p-0 flex items-center justify-center z-50 border border-border-color/50"
          onClick={(e) => {
            e.stopPropagation();
            props.onImportClick();
          }}
          data-tooltip={t('library.tooltips.importImages')}
        >
          <FolderInput className="w-6 h-6" />
        </Button>
      )}
    </div>
  );
}
