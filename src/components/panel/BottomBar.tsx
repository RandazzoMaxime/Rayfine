import { useState, useEffect, useRef, useMemo } from 'react';
import { Star, Copy, ClipboardPaste, ChevronUp, ChevronDown, Check, FileInput, Settings, Filter, Undo2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import Filmstrip from './Filmstrip';
import { GLOBAL_KEYS, ImageFile, SelectedImage, ThumbnailAspectRatio, FlagStatus, EditedStatus, RawStatus } from '../ui/AppProperties';
import Text from '../ui/Text';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { COLOR_LABELS } from '../../utils/adjustments';

/** Stable empty array for Zustand selectors — never return `|| []` inline (infinite loop). */
const EMPTY_FILTER_PRESETS: Array<{ id: string; name: string; criteria: any }> = [];
const EMPTY_RATINGS: Record<string, number> = {};

interface BottomBarProps {
  filmstripHeight?: number;
  imageList?: Array<ImageFile>;
  imageRatings?: Record<string, number> | null;
  isCopied: boolean;
  isCopyDisabled: boolean;
  isExportDisabled?: boolean;
  isFilmstripVisible?: boolean;
  isLibraryView?: boolean;
  isLoading?: boolean;
  isPasted: boolean;
  isPasteDisabled: boolean;
  isRatingDisabled?: boolean;
  isResetDisabled?: boolean;
  isResizing?: boolean;
  multiSelectedPaths?: Array<string>;
  onClearSelection?(): void;
  onContextMenu?(event: any, path: string): void;
  onCopy(): void;
  onExportClick?(): void;
  onImageSelect?(path: string, event: any): void;
  onImageDoubleClick?(path: string): void;
  onOpenCopyPasteSettings?(): void;
  onRequestThumbnails?(paths: string[]): void;
  onPaste(): void;
  /** LR "Previous" — apply last photo's develop settings */
  onMatchPrevious?(): void;
  isMatchPreviousDisabled?: boolean;
  /** LR Sync — apply active photo settings to multi-selection */
  onSyncSettings?(): void;
  isSyncSettingsDisabled?: boolean;
  onRate(rate: number, paths?: string[]): void;
  onSetColorLabel?(color: string | null, paths?: string[]): void;
  onSetFlag?(flag: 'pick' | 'reject' | null, paths?: string[]): void;
  onReset?(): void;
  onZoomChange?(zoomValue: number, fitToWindow?: boolean): void;
  rating: number;
  selectedImage?: SelectedImage;
  setIsFilmstripVisible?(isVisible: boolean): void;
  showFilmstrip?: boolean;
  showZoomControls?: boolean;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  totalImages?: number;
}

interface StarRatingProps {
  disabled: boolean;
  onRate(rate: number): void;
  rating: number;
}

const StarRating = ({ rating, onRate, disabled }: StarRatingProps) => {
  const { t } = useTranslation();

  return (
    <div className={clsx('flex items-center gap-0.5', disabled && 'cursor-not-allowed')}>
      {[...Array(5)].map((_, index: number) => {
        const starValue = index + 1;
        return (
          <button
            className="disabled:cursor-not-allowed"
            disabled={disabled}
            key={starValue}
            onClick={() => !disabled && onRate(starValue === rating ? 0 : starValue)}
            data-tooltip={
              disabled
                ? t('ui.bottomBar.tooltips.selectToRate')
                : t('ui.bottomBar.tooltips.rateStars', { count: starValue })
            }
          >
            <Star
              size={16}
              className={clsx(
                'transition-colors duration-150',
                disabled
                  ? 'text-text-secondary opacity-40'
                  : starValue <= rating
                    ? 'fill-accent text-accent'
                    : 'text-text-secondary hover:text-accent',
              )}
            />
          </button>
        );
      })}
    </div>
  );
};

export default function BottomBar({
  filmstripHeight,
  imageList = [],
  imageRatings,
  isCopied,
  isCopyDisabled,
  isExportDisabled,
  isFilmstripVisible,
  isLibraryView = false,
  isLoading = false,
  isPasted,
  isPasteDisabled,
  isRatingDisabled = false,
  isResetDisabled = false,
  isResizing,
  multiSelectedPaths = [],
  onClearSelection,
  onContextMenu,
  onCopy,
  onExportClick,
  onImageSelect,
  onImageDoubleClick,
  onOpenCopyPasteSettings,
  onRequestThumbnails,
  onPaste,
  onMatchPrevious,
  isMatchPreviousDisabled = true,
  onSyncSettings,
  isSyncSettingsDisabled = true,
  onRate,
  onSetColorLabel,
  onSetFlag,
  onReset,
  onZoomChange = () => {},
  rating,
  selectedImage,
  setIsFilmstripVisible,
  showFilmstrip = true,
  showZoomControls = true,
  thumbnailAspectRatio,
  totalImages,
}: BottomBarProps) {
  const { t } = useTranslation();
  const { displaySize, originalSize, previousDevelopAdjustments } = useEditorStore(
    useShallow((state) => ({
      displaySize: state.displaySize,
      originalSize: state.originalSize,
      previousDevelopAdjustments: state.previousDevelopAdjustments,
    })),
  );
  const matchPreviousDisabled =
    isMatchPreviousDisabled || !onMatchPrevious || !previousDevelopAdjustments;

  const [isEditingPercent, setIsEditingPercent] = useState(false);
  const [percentInputValue, setPercentInputValue] = useState('');
  const isDraggingSlider = useRef(false);
  const [isZoomActive, setIsZoomActive] = useState(false);

  const percentInputRef = useRef<HTMLInputElement>(null);
  const [isZoomLabelHovered, setIsZoomLabelHovered] = useState(false);
  const isZoomReady = !isLoading && originalSize && originalSize.width > 0 && displaySize && displaySize.width > 0;

  const currentOriginalPercent = isZoomReady
    ? (displaySize.width * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)) / originalSize.width
    : 1.0;

  const [latchedSliderValue, setLatchedSliderValue] = useState(1.0);
  const [latchedDisplayPercent, setLatchedDisplayPercent] = useState(100);

  const numSelected = multiSelectedPaths.length;
  const total = totalImages ?? 0;
  const showSelectionCounter = numSelected > 0;

  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  /** Develop filmstrip scope: all | selected | picks (LR-style filmstrip filter) */
  const [filmstripScope, setFilmstripScope] = useState<'all' | 'selected' | 'picks' | 'rejects' | 'edited' | 'unflagged' | 'rated' | 'unrated' | 'landscape' | 'portrait' | 'vc' | 'masters' | 'raw' | 'caption' | 'gps' | 'location' | 'keywords' | 'people' | 'event' | 'scene' | 'genre' | 'subject' | 'category' | 'job' | 'urgency' | 'captionwriter' | 'digitalsource' | 'headline' | 'title' | 'credit' | 'source' | 'instructions' | 'creator' | 'rights' | 'jobtitle' | 'city' | 'country' | 'state' | 'sublocation' | 'countrycode' | 'usageterms' | 'stacked' | 'unstacked'>('all');

  useEffect(() => {
    const onToggle = () => setIsFilterExpanded((v) => !v);
    window.addEventListener('rustroom:toggle-quick-filter', onToggle);
    return () => window.removeEventListener('rustroom:toggle-quick-filter', onToggle);
  }, []);

  const FILMSTRIP_SCOPES = [
    'all',
    'selected',
    'picks',
    'rejects',
    'edited',
    'unflagged',
    'rated',
    'unrated',
    'landscape',
    'portrait',
    'vc',
    'masters',
    'raw',
    'caption',
    'gps',
    'location',
    'keywords',
    'people',
    'event',
    'scene',
    'genre',
    'subject',
    'category',
    'job',
    'urgency',
    'captionwriter',
    'digitalsource',
    'headline',
    'title',
    'credit',
    'source',
    'instructions',
    'creator',
    'rights',
    'jobtitle',
    'city',
    'country',
    'state',
    'sublocation',
    'countrycode',
    'usageterms',
    'stacked',
    'unstacked',
  ] as const;

  const FILMSTRIP_SCOPE_LABELS: Record<string, string> = {
    all: 'All',
    selected: 'Selected',
    picks: 'Picks',
    rejects: 'Rejects',
    edited: 'Edited',
    unflagged: 'Unflagged',
    rated: 'Rated',
    unrated: 'Unrated',
    landscape: 'Landscape',
    portrait: 'Portrait',
    vc: 'Virtual copies',
    masters: 'Masters',
    raw: 'RAW',
    caption: 'Caption',
    gps: 'GPS',
    location: 'Location',
    keywords: 'Keywords',
    people: 'People',
    event: 'Event',
    scene: 'Scene',
    genre: 'Genre',
    subject: 'Subject',
    category: 'Category',
    job: 'Job',
    urgency: 'Urgency',
    captionwriter: 'CapWriter',
    digitalsource: 'DigSrc',
    headline: 'Headline',
    title: 'Title',
    credit: 'Credit',
    source: 'Source',
    instructions: 'Instructions',
    creator: 'Creator',
    rights: 'Rights',
    jobtitle: 'JobTitle',
    city: 'City',
    country: 'Country',
    state: 'State',
    sublocation: 'SubLoc',
    countrycode: 'CCode',
    usageterms: 'Usage',
    stacked: 'Stacked',
    unstacked: 'Unstacked',
  };

  useEffect(() => {
    const onCycle = (ev: Event) => {
      const dir = (ev as CustomEvent)?.detail?.dir === -1 ? -1 : 1;
      setFilmstripScope((cur) => {
        const list = FILMSTRIP_SCOPES as readonly string[];
        let idx = list.indexOf(cur);
        if (idx < 0) idx = 0;
        idx = (idx + dir + list.length) % list.length;
        const next = list[idx] as typeof cur;
        toast.info(`Filmstrip: ${FILMSTRIP_SCOPE_LABELS[next] || next}`);
        return next;
      });
    };
    window.addEventListener('rustroom:cycle-filmstrip-scope', onCycle as EventListener);
    return () =>
      window.removeEventListener('rustroom:cycle-filmstrip-scope', onCycle as EventListener);
  }, []);

  const libraryPainter = useLibraryStore((s) => s.libraryPainter);
  const storeImageRatings = useLibraryStore((s) => s.imageRatings);
  const sortCriteria = useLibraryStore((s) => s.sortCriteria);
  const setSortCriteria = useLibraryStore((s) => s.setSortCriteria);

  const ratingsMap = imageRatings || storeImageRatings || EMPTY_RATINGS;

  const { filterCriteria, setFilterCriteria, showSelectedOnly } = useLibraryStore(
    useShallow((state) => ({
      filterCriteria: state.filterCriteria,
      setFilterCriteria: state.setFilterCriteria,
      showSelectedOnly: state.showSelectedOnly,
    })),
  );

  const libraryFilterPresets = useSettingsStore(
    (s) => s.appSettings?.libraryFilterPresets ?? EMPTY_FILTER_PRESETS,
  );
  const appSettingsForFilters = useSettingsStore((s) => s.appSettings);
  const handleSettingsChange = useSettingsStore((s) => s.handleSettingsChange);

  const allColors = [...COLOR_LABELS, { name: 'none', color: '#9ca3af' }];

  useEffect(() => {
    if (isZoomReady && !isDraggingSlider.current) {
      setLatchedSliderValue(currentOriginalPercent);
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  }, [currentOriginalPercent, isZoomReady]);

  useEffect(() => {
    const handleDragEndGlobal = () => {
      if (isZoomActive) {
        setIsZoomActive(false);
        isDraggingSlider.current = false;
        if (isZoomReady) {
          setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
        }
      }
    };

    if (isZoomActive) {
      window.addEventListener('mouseup', handleDragEndGlobal);
      window.addEventListener('touchend', handleDragEndGlobal);
    }

    return () => {
      window.removeEventListener('mouseup', handleDragEndGlobal);
      window.removeEventListener('touchend', handleDragEndGlobal);
    };
  }, [isZoomActive, isZoomReady, currentOriginalPercent]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setLatchedSliderValue(newZoom);
    setLatchedDisplayPercent(Math.round(newZoom * 100));
    onZoomChange(newZoom);
  };

  const handleMouseDown = () => {
    isDraggingSlider.current = true;
    setIsZoomActive(true);
  };

  const handleMouseUp = () => {
    isDraggingSlider.current = false;
    setIsZoomActive(false);
    if (isZoomReady) {
      setLatchedDisplayPercent(Math.round(currentOriginalPercent * 100));
    }
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      (e.target as HTMLElement).blur();
      return;
    }
    if (GLOBAL_KEYS.includes(e.key)) {
      (e.target as HTMLElement).blur();
    }
  };

  const handleResetZoom = () => {
    onZoomChange(0, true);
  };

  const handlePercentClick = () => {
    if (!isZoomReady) return;
    setIsEditingPercent(true);
    setPercentInputValue(latchedDisplayPercent.toString());
    setTimeout(() => {
      percentInputRef.current?.focus();
      percentInputRef.current?.select();
    }, 0);
  };

  const handlePercentSubmit = () => {
    const value = parseFloat(percentInputValue);
    if (!isNaN(value)) {
      const originalPercent = value / 100;
      const clampedPercent = Math.max(0.1, Math.min(2.0, originalPercent));
      onZoomChange(clampedPercent);
    }
    setIsEditingPercent(false);
    setPercentInputValue('');
  };

  const handlePercentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePercentSubmit();
    else if (e.key === 'Escape') {
      setIsEditingPercent(false);
      setPercentInputValue('');
    }
    e.stopPropagation();
  };

  
  const filmstripImageList = useMemo(() => {
    if (isLibraryView || filmstripScope === 'all') return imageList;
    if (filmstripScope === 'selected') {
      const set = new Set(multiSelectedPaths || []);
      if (selectedImage?.path) set.add(selectedImage.path);
      if (set.size === 0) return imageList;
      return imageList.filter((img) => set.has(img.path));
    }
    if (filmstripScope === 'rejects') {
      return imageList.filter((img) =>
        (img.tags || []).some((tg: string) => tg === 'flag:reject' || tg.endsWith(':reject')),
      );
    }
    if (filmstripScope === 'edited') {
      return imageList.filter((img) => !!img.is_edited);
    }
    if (filmstripScope === 'unflagged') {
      return imageList.filter(
        (img) =>
          !(img.tags || []).some(
            (tg: string) => tg.startsWith('flag:') || tg.endsWith(':pick') || tg.endsWith(':reject'),
          ),
      );
    }
    if (filmstripScope === 'rated') {
      return imageList.filter((img) => {
        const r = Number(ratingsMap?.[img.path] ?? img.rating) || 0;
        return r > 0;
      });
    }    
    if (filmstripScope === 'unrated') {
      return imageList.filter((img) => {
        const r = Number(ratingsMap?.[img.path] ?? img.rating) || 0;
        return r <= 0;
      });
    }

    if (filmstripScope === 'landscape' || filmstripScope === 'portrait') {
      const want = filmstripScope;
      return imageList.filter((img) => {
        const e = img.exif || {};
        const w =
          Number(img.width) ||
          parseFloat(String(e.ImageWidth || e.PixelXDimension || e.ExifImageWidth || '0')) ||
          0;
        const h =
          Number(img.height) ||
          parseFloat(String(e.ImageHeight || e.PixelYDimension || e.ExifImageHeight || '0')) ||
          0;
        if (!(w > 0 && h > 0)) return false;
        const ratio = w / h;
        if (want === 'landscape') return ratio > 1.02;
        return ratio < 0.98;
      });
    }
    if (filmstripScope === 'vc') {
      return imageList.filter(
        (img) => !!img.is_virtual_copy || String(img.path || '').includes('?vc='),
      );
    }
    if (filmstripScope === 'masters') {
      return imageList.filter(
        (img) => !img.is_virtual_copy && !String(img.path || '').includes('?vc='),
      );
    }
    if (filmstripScope === 'raw') {
      return imageList.filter((img) => !!img.is_raw);
    }
    if (filmstripScope === 'caption') {
      return imageList.filter((img) => {
        const ex = img.exif || {};
        const hay = [
          ex.ImageDescription,
          ex.XPComment,
          ex.XPTitle,
          ex.Description,
          ex.Caption,
          ex['Caption-Abstract'],
        ]
          .filter(Boolean)
          .join(' ')
          .trim();
        return hay.length > 0;
      });
    }
    if (filmstripScope === 'gps') {
      return imageList.filter((img) => {
        const lat = img.exif?.GPSLatitude;
        const lon = img.exif?.GPSLongitude;
        if (lat == null || lon == null || lat === '' || lon === '') return false;
        return (
          Number.isFinite(parseFloat(String(lat))) &&
          Number.isFinite(parseFloat(String(lon)))
        );
      });
    }
    if (filmstripScope === 'location') {
      return imageList.filter((img) => {
        const ex = img.exif || {};
        return !!(
          (ex.City && String(ex.City).trim()) ||
          (ex.Country && String(ex.Country).trim()) ||
          (ex.Location && String(ex.Location).trim()) ||
          (ex.SubLocation && String(ex.SubLocation).trim()) ||
          (ex.State && String(ex.State).trim()) ||
          (ex.Province && String(ex.Province).trim())
        );
      });
    }
    if (filmstripScope === 'keywords') {
      return imageList.filter((img) =>
        (img.tags || []).some((tg: string) => {
          if (tg.startsWith('user:')) return true;
          if (
            tg.startsWith('flag:') ||
            tg.startsWith('color:') ||
            tg.startsWith('stack:')
          )
            return false;
          return !tg.includes(':') && tg.trim().length > 0;
        }),
      );
    }
    if (filmstripScope === 'people') {
      return imageList.filter((img) => {
        const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
        return !!(pe && String(pe).trim());
      });
    }
    if (filmstripScope === 'event') {
      return imageList.filter((img) => {
        const ev = img.exif?.Event;
        return !!(ev && String(ev).trim());
      });
    }
    if (filmstripScope === 'scene') {
      return imageList.filter((img) => {
        const sc = img.exif?.Scene;
        return !!(sc && String(sc).trim());
      });
    }
    if (filmstripScope === 'genre') {
      return imageList.filter((img) => {
        const g =
          img.exif?.IntellectualGenre || img.exif?.['Intellectual Genre'] || '';
        return !!(g && String(g).trim());
      });
    }
    if (filmstripScope === 'subject') {
      return imageList.filter((img) => {
        const sc = img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
        return !!(sc && String(sc).trim());
      });
    }
    if (filmstripScope === 'category') {
      return imageList.filter((img) => {
        const c = img.exif?.Category;
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'job') {
      return imageList.filter((img) => {
        const j =
          img.exif?.JobIdentifier ||
          img.exif?.JobID ||
          img.exif?.['Job Identifier'] ||
          '';
        return !!(j && String(j).trim());
      });
    }
    if (filmstripScope === 'urgency') {
      return imageList.filter((img) => {
        const n = parseInt(String(img.exif?.Urgency || ''), 10);
        return Number.isFinite(n) && n >= 1 && n <= 8;
      });
    }
    if (filmstripScope === 'captionwriter') {
      return imageList.filter((img) => {
        const w =
          img.exif?.CaptionWriter ||
          img.exif?.['Caption Writer'] ||
          img.exif?.Writer ||
          '';
        return !!(w && String(w).trim());
      });
    }
    if (filmstripScope === 'digitalsource') {
      return imageList.filter((img) => {
        const d =
          img.exif?.DigitalSourceType ||
          img.exif?.['Digital Source Type'] ||
          '';
        return !!(d && String(d).trim());
      });
    }
    if (filmstripScope === 'headline') {
      return imageList.filter((img) => {
        const h = img.exif?.Headline;
        return !!(h && String(h).trim());
      });
    }
    if (filmstripScope === 'title') {
      return imageList.filter((img) => {
        const title = img.exif?.XPTitle || img.exif?.Title || '';
        return !!(title && String(title).trim());
      });
    }
    if (filmstripScope === 'credit') {
      return imageList.filter((img) => {
        const c = img.exif?.Credit;
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'source') {
      return imageList.filter((img) => {
        const s = img.exif?.Source;
        return !!(s && String(s).trim());
      });
    }
    if (filmstripScope === 'instructions') {
      return imageList.filter((img) => {
        const ins = img.exif?.Instructions;
        return !!(ins && String(ins).trim());
      });
    }
    if (filmstripScope === 'creator') {
      return imageList.filter((img) => {
        const c = img.exif?.Artist || img.exif?.Creator || '';
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'rights') {
      return imageList.filter((img) => {
        const r =
          img.exif?.Copyright ||
          img.exif?.Rights ||
          img.exif?.UsageTerms ||
          img.exif?.['Usage Terms'] ||
          '';
        return !!(r && String(r).trim());
      });
    }
    if (filmstripScope === 'jobtitle') {
      return imageList.filter((img) => {
        const j =
          img.exif?.AuthorsPosition || img.exif?.['Authors Position'] || '';
        return !!(j && String(j).trim());
      });
    }
    if (filmstripScope === 'city') {
      return imageList.filter((img) => {
        const c = img.exif?.City;
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'country') {
      return imageList.filter((img) => {
        const c = img.exif?.Country;
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'state') {
      return imageList.filter((img) => {
        const s = img.exif?.State || img.exif?.Province || '';
        return !!(s && String(s).trim());
      });
    }
    if (filmstripScope === 'sublocation') {
      return imageList.filter((img) => {
        const s = img.exif?.Location || img.exif?.SubLocation || '';
        return !!(s && String(s).trim());
      });
    }
    if (filmstripScope === 'countrycode') {
      return imageList.filter((img) => {
        const c = img.exif?.CountryCode || img.exif?.['Country Code'] || '';
        return !!(c && String(c).trim());
      });
    }
    if (filmstripScope === 'usageterms') {
      return imageList.filter((img) => {
        const u = img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
        return !!(u && String(u).trim());
      });
    }
    if (filmstripScope === 'stacked') {
      return imageList.filter((img) =>
        (img.tags || []).some((tg: string) => tg.startsWith('stack:')),
      );
    }
    if (filmstripScope === 'unstacked') {
      return imageList.filter(
        (img) => !(img.tags || []).some((tg: string) => tg.startsWith('stack:')),
      );
    }
    // picks
    return imageList.filter((img) =>
      (img.tags || []).some((tg: string) => tg === 'flag:pick' || tg.endsWith(':pick')),
    );
  }, [imageList, filmstripScope, isLibraryView, multiSelectedPaths, selectedImage?.path, ratingsMap]);

  /** LR-style library status: picks / rejects / edited counts in current filmstrip/list source */
    const libraryStats = useMemo(() => {
    const list = imageList || [];
    let picks = 0;
    let rejects = 0;
    let edited = 0;
    let rated = 0;
    let gps = 0;
    let captions = 0;
    let locations = 0;
    let raw = 0;
    let virtualCopies = 0;
    let people = 0;
    let events = 0;
    let scenes = 0;
    let genres = 0;
    let subjects = 0;
    let categories = 0;
    let jobs = 0;
    let urgencies = 0;
    let highUrgency = 0;
    let stacked = 0;
    let cities = 0;
    let countries = 0;
    let creators = 0;
    let states = 0;
    let sublocations = 0;
    let countryCodes = 0;
    let usageTerms = 0;
    let headlines = 0;
    for (const img of list) {
      const tags = img.tags || [];
      if (tags.some((tg: string) => tg === 'flag:pick' || tg.endsWith(':pick'))) picks += 1;
      if (tags.some((tg: string) => tg === 'flag:reject' || tg.endsWith(':reject'))) rejects += 1;
      if (img.is_edited) edited += 1;
      if (img.is_raw) raw += 1;
      if (img.is_virtual_copy || String(img.path || '').includes('?vc=')) virtualCopies += 1;
      {
        const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
        if (pe && String(pe).trim()) people += 1;
      }
      {
        const ev = img.exif?.Event;
        if (ev && String(ev).trim()) events += 1;
      }
      {
        const sc = img.exif?.Scene;
        if (sc && String(sc).trim()) scenes += 1;
      }
      {
        const g =
          img.exif?.IntellectualGenre || img.exif?.['Intellectual Genre'] || '';
        if (g && String(g).trim()) genres += 1;
      }
      {
        const sc = img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
        if (sc && String(sc).trim()) subjects += 1;
      }
      {
        const c = img.exif?.Category;
        if (c && String(c).trim()) categories += 1;
      }
      {
        const j =
          img.exif?.JobIdentifier ||
          img.exif?.JobID ||
          img.exif?.['Job Identifier'] ||
          '';
        if (j && String(j).trim()) jobs += 1;
      }
      {
        const n = parseInt(String(img.exif?.Urgency || ''), 10);
        if (Number.isFinite(n) && n >= 1 && n <= 8) {
          urgencies += 1;
          if (n <= 2) highUrgency += 1;
        }
      }
      if ((img.tags || []).some((tg: string) => tg.startsWith('stack:'))) stacked += 1;
      {
        const c = img.exif?.City;
        if (c && String(c).trim()) cities += 1;
      }
      {
        const c = img.exif?.Country;
        if (c && String(c).trim()) countries += 1;
      }
      {
        const s = img.exif?.State || img.exif?.Province || '';
        if (s && String(s).trim()) states += 1;
      }
      {
        const sl = img.exif?.Location || img.exif?.SubLocation || '';
        if (sl && String(sl).trim()) sublocations += 1;
      }
      {
        const cc = img.exif?.CountryCode || img.exif?.['Country Code'] || '';
        if (cc && String(cc).trim()) countryCodes += 1;
      }
      {
        const ut = img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
        if (ut && String(ut).trim()) usageTerms += 1;
      }
      {
        const hl = img.exif?.Headline;
        if (hl && String(hl).trim()) headlines += 1;
      }
      {
        const cr = img.exif?.Artist || img.exif?.Creator || '';
        if (cr && String(cr).trim()) creators += 1;
      }
      const r = Number(ratingsMap?.[img.path] ?? img.rating) || 0;
      if (r > 0) rated += 1;
      const ex = img.exif || {};
      const lat = ex.GPSLatitude;
      const lon = ex.GPSLongitude;
      if (
        lat != null &&
        lon != null &&
        lat !== '' &&
        lon !== '' &&
        Number.isFinite(parseFloat(String(lat))) &&
        Number.isFinite(parseFloat(String(lon)))
      ) {
        gps += 1;
      }
      const captionHay = [
        ex.ImageDescription,
        ex.XPComment,
        ex.XPTitle,
        ex.Description,
        ex.Caption,
        ex['Caption-Abstract'],
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (captionHay.length > 0) captions += 1;
      if (
        (ex.City && String(ex.City).trim()) ||
        (ex.Country && String(ex.Country).trim()) ||
        (ex.Location && String(ex.Location).trim()) ||
        (ex.SubLocation && String(ex.SubLocation).trim()) ||
        (ex.State && String(ex.State).trim()) ||
        (ex.Province && String(ex.Province).trim())
      ) {
        locations += 1;
      }
    }
    return { picks, rejects, edited, rated, gps, captions, locations, raw, virtualCopies, stacked, people, events, scenes, genres, subjects, categories, jobs, urgencies, highUrgency, cities, countries, states, sublocations, countryCodes, usageTerms, headlines, creators, total: list.length };
  }, [imageList, ratingsMap]);



return (
    <div className="shrink-0 bg-bg-secondary rounded-md flex flex-col border border-border-color/30">
      {!isLibraryView && showFilmstrip && (
        <div
          className={clsx('overflow-hidden', !isResizing && 'transition-all duration-300 ease-in-out')}
          style={{ height: isFilmstripVisible ? `${filmstripHeight}px` : '0px' }}
        >
          <div className="w-full p-1" style={{ height: `${filmstripHeight}px` }}>
            <Filmstrip
              imageList={filmstripImageList}
              imageRatings={imageRatings}
              isLoading={isLoading}
              multiSelectedPaths={multiSelectedPaths}
              onClearSelection={onClearSelection}
              onContextMenu={onContextMenu}
              onImageSelect={onImageSelect}
              onImageDoubleClick={onImageDoubleClick}
              onRate={onRate}
              onRequestThumbnails={onRequestThumbnails}
              selectedImage={selectedImage}
              thumbnailAspectRatio={thumbnailAspectRatio}
            />
          </div>
        </div>
      )}

      <div
        className={clsx(
          'shrink-0 h-8 flex items-center justify-between px-2',
          !isLibraryView && 'border-t',
          !isLibraryView && showFilmstrip && isFilmstripVisible ? 'border-border-color/40' : 'border-transparent',
        )}
      >
        <div className="flex items-center gap-4">
          <StarRating rating={rating} onRate={onRate} disabled={isRatingDisabled} />
          {/* Color labels — classic Develop filmstrip bar */}
          <div className="flex items-center gap-1 ml-1">
            {COLOR_LABELS.map((color) => {
              const path = selectedImage?.path;
              const imgTags =
                (selectedImage as any)?.tags ||
                (path ? imageList.find((img) => img.path === path)?.tags : null) ||
                [];
              const tag = imgTags.find?.((x: string) => x.startsWith('color:'));
              const activeColor = tag ? tag.substring(6) : null;
              const isActiveColor = activeColor === color.name;
              return (
                <button
                  key={`assign-color-${color.name}`}
                  type="button"
                  disabled={isRatingDisabled || !onSetColorLabel}
                  onClick={() => onSetColorLabel?.(color.name)}
                  className={clsx(
                    'w-3.5 h-3.5 rounded-full transition-transform hover:scale-110 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed',
                    isActiveColor ? 'ring-2 ring-white/90 scale-110' : 'ring-1 ring-black/20',
                  )}
                  style={{ backgroundColor: color.color }}
                  data-tooltip={t(`contextMenus.colors.${color.name}`, {
                    defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                  })}
                />
              );
            })}
            <button
              type="button"
              disabled={isRatingDisabled || !onSetColorLabel}
              onClick={() => onSetColorLabel?.(null)}
              className={clsx(
                'w-3.5 h-3.5 rounded-full border border-dashed border-white/40 transition-transform hover:scale-110',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              data-tooltip={t('library.header.viewOptions.noLabel')}
            />
          </div>
          <div className="flex items-center gap-0.5 ml-0.5">
            <button
              type="button"
              disabled={isRatingDisabled || !onSetFlag}
              onClick={() => onSetFlag?.('pick')}
              className={clsx(
                'px-1.5 h-5 rounded text-[9px] font-bold uppercase tracking-wide disabled:opacity-40',
                'bg-emerald-600/80 text-white hover:bg-emerald-500',
              )}
              data-tooltip={t('settings.keybinds.actions.flag_pick' as any)}
            >
              P
            </button>
            <button
              type="button"
              disabled={isRatingDisabled || !onSetFlag}
              onClick={() => onSetFlag?.('reject')}
              className={clsx(
                'px-1.5 h-5 rounded text-[9px] font-bold uppercase tracking-wide disabled:opacity-40',
                'bg-red-600/80 text-white hover:bg-red-500',
              )}
              data-tooltip={t('settings.keybinds.actions.flag_reject' as any)}
            >
              X
            </button>
            <button
              type="button"
              disabled={isRatingDisabled || !onSetFlag}
              onClick={() => onSetFlag?.(null)}
              className="px-1 h-5 rounded text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface disabled:opacity-40"
              data-tooltip={t('settings.keybinds.actions.flag_unflag' as any)}
            >
              U
            </button>
          </div>
          <div className="h-5 w-px bg-surface"></div>
          <div className="flex items-center gap-2">
            <button
              className="relative w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={isCopyDisabled}
              onClick={onCopy}
              data-tooltip={t('ui.bottomBar.tooltips.copySettings')}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isCopied ? (
                  <motion.div
                    key="copied"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Check size={18} className="text-green-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Copy size={18} />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <button
              className="relative w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={isPasteDisabled}
              onClick={onPaste}
              data-tooltip={t('ui.bottomBar.tooltips.pasteSettings')}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isPasted ? (
                  <motion.div
                    key="pasted"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <Check size={18} className="text-green-500" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="paste"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute"
                  >
                    <ClipboardPaste size={18} />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <button
              className="relative w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={matchPreviousDisabled}
              onClick={() => onMatchPrevious?.()}
              data-tooltip={t('ui.bottomBar.tooltips.previousSettings' as any, {
                defaultValue: 'Previous photo settings (Ctrl+Alt+P)',
              })}
            >
              <Undo2 size={18} />
            </button>

            <button
              className="relative w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={isSyncSettingsDisabled || !onSyncSettings}
              onClick={() => onSyncSettings?.()}
              data-tooltip={t('ui.bottomBar.tooltips.syncSettings' as any, {
                defaultValue: 'Sync settings to selected photos (Ctrl+Alt+S)',
              })}
            >
              <RefreshCw size={17} />
            </button>

            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
              onClick={onOpenCopyPasteSettings}
              data-tooltip={t('ui.bottomBar.tooltips.copyPasteSettings')}
            >
              <Settings size={18} />
            </button>
          </div>

          <div className="h-5 w-px bg-surface"></div>

          <div
            className={clsx(
              'flex items-center transition-all duration-300',
              isFilterExpanded ? 'bg-surface rounded-md' : 'bg-transparent',
            )}
          >
            <button
              className={clsx(
                'relative w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0',
                isFilterExpanded ? 'text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary',
              )}
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              data-tooltip={t('ui.bottomBar.tooltips.quickFilter', 'Quick Filter')}
            >
              <Filter size={16} />
            </button>

            <div
              className={clsx(
                'flex items-center transition-all duration-300 ease-in-out overflow-hidden',
                isFilterExpanded ? 'max-w-[28rem] opacity-100 pr-2 ml-1' : 'max-w-0 opacity-0 pr-0 ml-0',
              )}
            >
              <div className="flex items-center gap-3 whitespace-nowrap">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((starValue) => {
                    const paintingRating =
                      libraryPainter?.kind === 'rating' && Number(libraryPainter.value) === starValue;
                    const isFilled =
                      paintingRating ||
                      (filterCriteria.rating > 0 && starValue <= filterCriteria.rating);
                    return (
                      <button
                        key={`qf-star-${starValue}`}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const lib = useLibraryStore.getState();
                            const cur = lib.libraryPainter;
                            const active =
                              cur?.kind === 'rating' && Number(cur.value) === starValue;
                            lib.setLibrary({
                              libraryPainter: active
                                ? null
                                : { kind: 'rating', value: starValue },
                              keywordPaintTag: null,
                            });
                            return;
                          }
                          if (e.altKey) {
                            e.preventDefault();
                            const paths = (imageList || [])
                              .filter((img) => {
                                const r = Number(ratingsMap?.[img.path] ?? img.rating) || 0;
                                return r === starValue;
                              })
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          setFilterCriteria((prev) => ({
                            ...prev,
                            rating: prev.rating === starValue ? 0 : starValue,
                          }));
                        }}
                        className="p-0.5 focus:outline-none"
                        data-tooltip={t('ui.bottomBar.tooltips.paintRating' as any, {
                          defaultValue:
                            '★ filter (≥N, exact at 5) · Shift=paint · Alt=select exact',
                        })}
                      >
                        <Star
                          size={14}
                          className={clsx(
                            'transition-colors duration-150',
                            paintingRating
                              ? 'text-amber-300 fill-amber-300 ring-1 ring-amber-300/50 rounded-sm'
                              : isFilled
                                ? 'text-accent fill-accent'
                                : 'text-text-secondary hover:text-accent',
                          )}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <div className="flex items-center gap-1.5">
                  {allColors.map((color) => {
                    const isSelected = (filterCriteria.colors || []).includes(color.name);

                    const tooltipTitle =
                      (color.name === 'none'
                        ? t('library.header.viewOptions.noLabel')
                        : t(`contextMenus.colors.${color.name}`, {
                            defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                          })) +
                      t('ui.bottomBar.tooltips.colorChipHint' as any, {
                        defaultValue: ' · Shift=paint · Alt=select',
                      });

                    return (
                      <button
                        key={`qf-color-${color.name}`}
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const lib = useLibraryStore.getState();
                            const cur = lib.libraryPainter;
                            const active =
                              cur?.kind === 'color' && String(cur.value) === color.name;
                            lib.setLibrary({
                              libraryPainter: active
                                ? null
                                : { kind: 'color', value: color.name },
                              keywordPaintTag: null,
                            });
                            return;
                          }
                          if (e.altKey) {
                            e.preventDefault();
                            const paths = (imageList || [])
                              .filter((img) => {
                                const tags = img.tags || [];
                                if (color.name === 'none') {
                                  return !tags.some((tg: string) => tg.startsWith('color:'));
                                }
                                return tags.some(
                                  (tg: string) =>
                                    tg === `color:${color.name}` || tg.endsWith(`:${color.name}`),
                                );
                              })
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          const currentColors = filterCriteria.colors || [];
                          const newColors = currentColors.includes(color.name)
                            ? currentColors.filter((c) => c !== color.name)
                            : [...currentColors, color.name];
                          setFilterCriteria((prev) => ({ ...prev, colors: newColors }));
                        }}
                        className={clsx(
                          'w-4 h-4 rounded-full transition-transform hover:scale-105 flex items-center justify-center focus:outline-none',
                          isSelected ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary' : '',
                        )}
                        style={{ backgroundColor: color.color }}
                        data-tooltip={tooltipTitle}
                      >
                        {isSelected && <Check size={10} className="text-white drop-shadow-md" />}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <div className="flex items-center gap-0.5">
                  {(
                    [
                      [
                        FlagStatus.Pick,
                        'P',
                        'bg-emerald-600/90 text-white',
                        t('library.filters.flag.picked' as any, { defaultValue: 'Picks · Shift=paint · Alt=select' }),
                      ],
                      [
                        FlagStatus.Reject,
                        'X',
                        'bg-red-600/90 text-white',
                        t('library.filters.flag.rejected' as any, { defaultValue: 'Rejects · Shift=paint · Alt=select' }),
                      ],
                      [
                        FlagStatus.Unflagged,
                        'U',
                        'bg-surface text-text-secondary border border-border-color/40',
                        t('library.filters.flag.unflagged' as any, { defaultValue: 'Unflagged · Shift=paint · Alt=select' }),
                      ],
                    ] as const
                  ).map(([status, label, cls, tip]) => {
                    const active = (filterCriteria.flagStatus || FlagStatus.All) === status;
                    return (
                      <button
                        key={`qf-flag-${label}`}
                        type="button"
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const lib = useLibraryStore.getState();
                            const flagVal =
                              status === FlagStatus.Pick
                                ? 'pick'
                                : status === FlagStatus.Reject
                                  ? 'reject'
                                  : null;
                            const cur = lib.libraryPainter;
                            const active =
                              cur?.kind === 'flag' &&
                              (cur.value === flagVal || (flagVal === null && cur.value === null));
                            lib.setLibrary({
                              libraryPainter: active ? null : { kind: 'flag', value: flagVal },
                              keywordPaintTag: null,
                            });
                            return;
                          }
                          if (e.altKey) {
                            e.preventDefault();
                            const paths = (imageList || [])
                              .filter((img) => {
                                const tags = img.tags || [];
                                const isPick = tags.some(
                                  (tg: string) => tg === 'flag:pick' || tg.endsWith(':pick'),
                                );
                                const isReject = tags.some(
                                  (tg: string) =>
                                    tg === 'flag:reject' || tg.endsWith(':reject'),
                                );
                                if (status === FlagStatus.Pick) return isPick;
                                if (status === FlagStatus.Reject) return isReject;
                                return !isPick && !isReject;
                              })
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          setFilterCriteria((prev) => ({
                            ...prev,
                            flagStatus: prev.flagStatus === status ? FlagStatus.All : status,
                          }));
                        }}
                        className={clsx(
                          'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                          cls,
                          active
                            ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                            : 'opacity-70 hover:opacity-100',
                        )}
                        data-tooltip={tip}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <div className="flex items-center gap-0.5">
                  {(
                    [
                      [
                        EditedStatus.EditedOnly,
                        'E',
                        t('ui.bottomBar.tooltips.filterEdited' as any, { defaultValue: 'Edited only' }),
                        'bg-sky-500/90 text-white',
                      ],
                      [
                        EditedStatus.UneditedOnly,
                        'NE',
                        t('ui.bottomBar.tooltips.filterUnedited' as any, {
                          defaultValue: 'Unedited only',
                        }),
                        'bg-zinc-500/80 text-white',
                      ],
                    ] as const
                  ).map(([status, label, tip, cls]) => {
                    const active = (filterCriteria.editedStatus || EditedStatus.All) === status;
                    return (
                      <button
                        key={`qf-edited-${label}`}
                        type="button"
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const wantEdited = status === EditedStatus.EditedOnly;
                            const paths = (imageList || [])
                              .filter((img) => (wantEdited ? !!img.is_edited : !img.is_edited))
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          setFilterCriteria((prev) => ({
                            ...prev,
                            editedStatus:
                              prev.editedStatus === status ? EditedStatus.All : status,
                          }));
                        }}
                        className={clsx(
                          'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                          cls,
                          active
                            ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                            : 'opacity-70 hover:opacity-100',
                        )}
                        data-tooltip={tip}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <div className="flex items-center gap-0.5">
                  {(
                    [
                      [
                        RawStatus.RawOnly,
                        'RAW',
                        t('ui.bottomBar.tooltips.filterRaw' as any, { defaultValue: 'RAW only · Shift-click to select' }),
                      ],
                      [
                        RawStatus.NonRawOnly,
                        'JPG',
                        t('ui.bottomBar.tooltips.filterNonRaw' as any, {
                          defaultValue: 'Non-RAW only · Shift-click to select',
                        }),
                      ],
                    ] as const
                  ).map(([status, label, tip]) => {
                    const active = (filterCriteria.rawStatus || RawStatus.All) === status;
                    return (
                      <button
                        key={`qf-raw-${label}`}
                        type="button"
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const wantRaw = status === RawStatus.RawOnly;
                            const paths = (imageList || [])
                              .filter((img) => (wantRaw ? !!img.is_raw : !img.is_raw))
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          setFilterCriteria((prev) => ({
                            ...prev,
                            rawStatus: prev.rawStatus === status ? RawStatus.All : status,
                          }));
                        }}
                        className={clsx(
                          'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                          active
                            ? 'bg-card-active text-text-primary ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                            : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                        )}
                        data-tooltip={tip}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <div className="flex items-center gap-0.5">
                  {(
                    [
                      [
                        'landscape',
                        'L',
                        t('ui.bottomBar.tooltips.filterLandscape' as any, {
                          defaultValue: 'Landscape only',
                        }),
                      ],
                      [
                        'portrait',
                        'P',
                        t('ui.bottomBar.tooltips.filterPortrait' as any, {
                          defaultValue: 'Portrait only',
                        }),
                      ],
                      [
                        'square',
                        'S',
                        t('ui.bottomBar.tooltips.filterSquare' as any, {
                          defaultValue: 'Square only',
                        }),
                      ],
                    ] as const
                  ).map(([status, label, tip]) => {
                    const active = (filterCriteria.orientation || 'all') === status;
                    return (
                      <button
                        key={`qf-orient-${label}`}
                        type="button"
                        onClick={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            const paths = (imageList || [])
                              .filter((img) => {
                                const ex = img.exif || {};
                                const w =
                                  Number(img.width) ||
                                  parseFloat(
                                    String(
                                      ex.ImageWidth ||
                                        ex.PixelXDimension ||
                                        ex.ExifImageWidth ||
                                        '0',
                                    ),
                                  ) ||
                                  0;
                                const h =
                                  Number(img.height) ||
                                  parseFloat(
                                    String(
                                      ex.ImageHeight ||
                                        ex.PixelYDimension ||
                                        ex.ExifImageHeight ||
                                        '0',
                                    ),
                                  ) ||
                                  0;
                                if (!(w > 0 && h > 0)) return false;
                                const ratio = w / h;
                                if (status === 'landscape') return ratio > 1.02;
                                if (status === 'portrait') return ratio < 0.98;
                                if (status === 'square') return ratio >= 0.95 && ratio <= 1.05;
                                return true;
                              })
                              .map((img) => img.path);
                            useLibraryStore.getState().setLibrary({
                              multiSelectedPaths: paths,
                              libraryActivePath: paths[paths.length - 1] || null,
                              selectionAnchorPath: paths[0] || null,
                              showSelectedOnly: false,
                            });
                            return;
                          }
                          setFilterCriteria((prev) => ({
                            ...prev,
                            orientation: prev.orientation === status ? 'all' : status,
                          }));
                        }}
                        className={clsx(
                          'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                          active
                            ? 'bg-card-active text-text-primary ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                            : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                        )}
                        data-tooltip={tip}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="h-4 w-px bg-border-color"></div>

                <button
                  type="button"
                  key="qf-gps"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const lat = img.exif?.GPSLatitude;
                          const lon = img.exif?.GPSLongitude;
                          if (lat == null || lon == null || lat === '' || lon === '') return false;
                          return (
                            Number.isFinite(parseFloat(String(lat))) &&
                            Number.isFinite(parseFloat(String(lon)))
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const lat = img.exif?.GPSLatitude;
                          const lon = img.exif?.GPSLongitude;
                          if (lat == null || lon == null || lat === '' || lon === '') return true;
                          return !(
                            Number.isFinite(parseFloat(String(lat))) &&
                            Number.isFinite(parseFloat(String(lon)))
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasGps || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasGps: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasGps || 'all') === 'yes'
                      ? 'bg-sky-500/25 text-sky-200 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasGps || 'all') === 'no'
                        ? 'bg-sky-900/40 text-sky-300/70 ring-1 ring-sky-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterGps' as any, {
                    defaultValue:
                      'GPS: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  GPS
                </button>

                <button
                  type="button"
                  key="qf-vc"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !!img.is_virtual_copy || String(img.path || '').includes('?vc='),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !img.is_virtual_copy && !String(img.path || '').includes('?vc='),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.virtualCopies || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, virtualCopies: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.virtualCopies || 'all') === 'yes'
                      ? 'bg-fuchsia-500/25 text-fuchsia-200 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.virtualCopies || 'all') === 'no'
                        ? 'bg-fuchsia-900/40 text-fuchsia-300/70 ring-1 ring-fuchsia-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterVirtualCopies' as any, {
                    defaultValue:
                      'VC: click cycle yes/no/all · Shift=select VCs · Alt=select masters',
                  })}
                >
                  VC
                </button>

                <button
                  type="button"
                  key="qf-kw"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) =>
                          (img.tags || []).some(
                            (tg: string) =>
                              tg.startsWith('user:') ||
                              (!tg.startsWith('flag:') &&
                                !tg.startsWith('color:') &&
                                !tg.startsWith('stack:') &&
                                !tg.includes(':')),
                          ),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !(img.tags || []).some(
                              (tg: string) =>
                                tg.startsWith('user:') ||
                                (!tg.startsWith('flag:') &&
                                  !tg.startsWith('color:') &&
                                  !tg.startsWith('stack:') &&
                                  !tg.includes(':')),
                            ),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasKeywords || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasKeywords: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasKeywords || 'all') === 'yes'
                      ? 'bg-violet-500/25 text-violet-200 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasKeywords || 'all') === 'no'
                        ? 'bg-violet-900/40 text-violet-300/70 ring-1 ring-violet-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterKeywords' as any, {
                    defaultValue:
                      'Keywords: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  KW
                </button>

                <button
                  type="button"
                  key="qf-cap"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          const hay = [
                            ex.ImageDescription,
                            ex.XPComment,
                            ex.XPTitle,
                            ex.Description,
                            ex.Caption,
                            ex['Caption-Abstract'],
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .trim();
                          return hay.length > 0;
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          const hay = [
                            ex.ImageDescription,
                            ex.XPComment,
                            ex.XPTitle,
                            ex.Description,
                            ex.Caption,
                            ex['Caption-Abstract'],
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .trim();
                          return hay.length === 0;
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCaption || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCaption: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCaption || 'all') === 'yes'
                      ? 'bg-teal-500/25 text-teal-200 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCaption || 'all') === 'no'
                        ? 'bg-teal-900/40 text-teal-300/70 ring-1 ring-teal-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCaption' as any, {
                    defaultValue:
                      'Caption: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  CAP
                </button>

                <button
                  type="button"
                  key="qf-loc"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          return !!(
                            (ex.City && String(ex.City).trim()) ||
                            (ex.Country && String(ex.Country).trim()) ||
                            (ex.Location && String(ex.Location).trim()) ||
                            (ex.SubLocation && String(ex.SubLocation).trim()) ||
                            (ex.State && String(ex.State).trim()) ||
                            (ex.Province && String(ex.Province).trim())
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          return !(
                            (ex.City && String(ex.City).trim()) ||
                            (ex.Country && String(ex.Country).trim()) ||
                            (ex.Location && String(ex.Location).trim()) ||
                            (ex.SubLocation && String(ex.SubLocation).trim()) ||
                            (ex.State && String(ex.State).trim()) ||
                            (ex.Province && String(ex.Province).trim())
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasLocation || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasLocation: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasLocation || 'all') === 'yes'
                      ? 'bg-emerald-500/20 text-emerald-200 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasLocation || 'all') === 'no'
                        ? 'bg-emerald-900/40 text-emerald-300/70 ring-1 ring-emerald-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterLocation' as any, {
                    defaultValue:
                      'Location: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  LOC
                </button>

                                                                <button
                  type="button"
                  key="qf-pe"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
                          return !!(pe && String(pe).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
                          return !(pe && String(pe).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasPeople || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasPeople: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasPeople || 'all') === 'yes'
                      ? 'bg-pink-500/25 text-pink-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasPeople || 'all') === 'no'
                        ? 'bg-pink-900/40 text-pink-300/70 ring-1 ring-pink-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterPeople' as any, {
                    defaultValue:
                      'People: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  PE
                </button>

                <button
                  type="button"
                  key="qf-ev"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ev = img.exif?.Event;
                          return !!(ev && String(ev).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ev = img.exif?.Event;
                          return !(ev && String(ev).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasEvent || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasEvent: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasEvent || 'all') === 'yes'
                      ? 'bg-indigo-500/25 text-indigo-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasEvent || 'all') === 'no'
                        ? 'bg-indigo-900/40 text-indigo-300/70 ring-1 ring-indigo-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterEvent' as any, {
                    defaultValue:
                      'Event: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  EV
                </button>

                <button
                  type="button"
                  key="qf-sc"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc = img.exif?.Scene;
                          return !!(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc = img.exif?.Scene;
                          return !(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasScene || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasScene: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasScene || 'all') === 'yes'
                      ? 'bg-lime-500/25 text-lime-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasScene || 'all') === 'no'
                        ? 'bg-lime-900/40 text-lime-300/70 ring-1 ring-lime-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterScene' as any, {
                    defaultValue:
                      'Scene: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  SC
                </button>

                <button
                  type="button"
                  key="qf-ge"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const g =
                            img.exif?.IntellectualGenre ||
                            img.exif?.['Intellectual Genre'] ||
                            '';
                          return !!(g && String(g).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const g =
                            img.exif?.IntellectualGenre ||
                            img.exif?.['Intellectual Genre'] ||
                            '';
                          return !(g && String(g).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasGenre || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasGenre: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasGenre || 'all') === 'yes'
                      ? 'bg-cyan-500/25 text-cyan-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasGenre || 'all') === 'no'
                        ? 'bg-cyan-900/40 text-cyan-300/70 ring-1 ring-cyan-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterGenre' as any, {
                    defaultValue:
                      'Genre: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  GE
                </button>

                <button
                  type="button"
                  key="qf-su"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc =
                            img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
                          return !!(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc =
                            img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
                          return !(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasSubjectCode || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasSubjectCode: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasSubjectCode || 'all') === 'yes'
                      ? 'bg-rose-500/25 text-rose-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasSubjectCode || 'all') === 'no'
                        ? 'bg-rose-900/40 text-rose-300/70 ring-1 ring-rose-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterSubjectCode' as any, {
                    defaultValue:
                      'Subject code: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  SU
                </button>

                <button
                  type="button"
                  key="qf-ca"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Category;
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Category;
                          return !(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCategory || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCategory: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCategory || 'all') === 'yes'
                      ? 'bg-amber-500/25 text-amber-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCategory || 'all') === 'no'
                        ? 'bg-amber-900/40 text-amber-300/70 ring-1 ring-amber-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCategory' as any, {
                    defaultValue:
                      'Category: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  CA
                </button>

                <button
                  type="button"
                  key="qf-jo"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const j =
                            img.exif?.JobIdentifier ||
                            img.exif?.JobID ||
                            img.exif?.['Job Identifier'] ||
                            '';
                          return !!(j && String(j).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const j =
                            img.exif?.JobIdentifier ||
                            img.exif?.JobID ||
                            img.exif?.['Job Identifier'] ||
                            '';
                          return !(j && String(j).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasJobId || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasJobId: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasJobId || 'all') === 'yes'
                      ? 'bg-stone-500/30 text-stone-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasJobId || 'all') === 'no'
                        ? 'bg-stone-900/40 text-stone-300/70 ring-1 ring-stone-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterJobId' as any, {
                    defaultValue:
                      'Job ID: click cycle yes/no/all · Shift=select with · Alt=select without',
                  })}
                >
                  JO
                </button>

                <button
                  type="button"
                  key="qf-ur"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const n = parseInt(String(img.exif?.Urgency || ''), 10);
                          return Number.isFinite(n) && n >= 1 && n <= 8;
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const n = parseInt(String(img.exif?.Urgency || ''), 10);
                          return !(Number.isFinite(n) && n >= 1 && n <= 8);
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    // Ctrl/meta: high urgency only (1-2)
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      setFilterCriteria((prev) => {
                        const active =
                          prev.hasUrgency === 'yes' && prev.urgencyMax === 2;
                        return {
                          ...prev,
                          hasUrgency: active ? 'all' : 'yes',
                          urgencyMax: active ? undefined : 2,
                        };
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasUrgency || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return {
                        ...prev,
                        hasUrgency: next,
                        urgencyMax: next === 'yes' ? prev.urgencyMax : undefined,
                      };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasUrgency || 'all') === 'yes' &&
                      filterCriteria.urgencyMax === 2
                      ? 'bg-red-500/30 text-red-100 ring-2 ring-red-400 ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasUrgency || 'all') === 'yes'
                        ? 'bg-red-500/20 text-red-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                        : (filterCriteria.hasUrgency || 'all') === 'no'
                          ? 'bg-red-900/40 text-red-300/70 ring-1 ring-red-400/30 line-through opacity-90'
                          : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterUrgency' as any, {
                    defaultValue:
                      'Urgency: click cycle · Ctrl=high (1–2) · Shift=select with · Alt=without',
                  })}
                >
                  UR
                  {filterCriteria.hasUrgency === 'yes' && filterCriteria.urgencyMax === 2
                    ? '!'
                    : ''}
                </button>

                <button
                  type="button"
                  key="qf-cw"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const w =
                            img.exif?.CaptionWriter ||
                            img.exif?.['Caption Writer'] ||
                            img.exif?.Writer ||
                            '';
                          return !!(w && String(w).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const w =
                            img.exif?.CaptionWriter ||
                            img.exif?.['Caption Writer'] ||
                            img.exif?.Writer ||
                            '';
                          return !(w && String(w).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCaptionWriter || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCaptionWriter: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCaptionWriter || 'all') === 'yes'
                      ? 'bg-sky-500/25 text-sky-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCaptionWriter || 'all') === 'no'
                        ? 'bg-sky-900/40 text-sky-300/70 ring-1 ring-sky-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCaptionWriter' as any, {
                    defaultValue:
                      'Caption writer: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CW
                </button>

                <button
                  type="button"
                  key="qf-ds"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const d =
                            img.exif?.DigitalSourceType ||
                            img.exif?.['Digital Source Type'] ||
                            '';
                          return !!(d && String(d).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const d =
                            img.exif?.DigitalSourceType ||
                            img.exif?.['Digital Source Type'] ||
                            '';
                          return !(d && String(d).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasDigitalSource || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasDigitalSource: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasDigitalSource || 'all') === 'yes'
                      ? 'bg-fuchsia-500/25 text-fuchsia-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasDigitalSource || 'all') === 'no'
                        ? 'bg-fuchsia-900/40 text-fuchsia-300/70 ring-1 ring-fuchsia-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterDigitalSource' as any, {
                    defaultValue:
                      'Digital source: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  DS
                </button>

                <button
                  type="button"
                  key="qf-hl"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Headline && String(img.exif.Headline).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !(img.exif?.Headline && String(img.exif.Headline).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasHeadline || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasHeadline: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasHeadline || 'all') === 'yes'
                      ? 'bg-blue-500/25 text-blue-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasHeadline || 'all') === 'no'
                        ? 'bg-blue-900/40 text-blue-300/70 ring-1 ring-blue-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterHeadline' as any, {
                    defaultValue: 'Headline: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  HL
                </button>

                <button
                  type="button"
                  key="qf-ti"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const title =
                            img.exif?.XPTitle || img.exif?.Title || '';
                          return !!(title && String(title).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const title =
                            img.exif?.XPTitle || img.exif?.Title || '';
                          return !(title && String(title).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasTitle || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasTitle: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasTitle || 'all') === 'yes'
                      ? 'bg-indigo-500/25 text-indigo-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasTitle || 'all') === 'no'
                        ? 'bg-indigo-900/40 text-indigo-300/70 ring-1 ring-indigo-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterTitle' as any, {
                    defaultValue: 'Title: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  TI
                </button>

                <button
                  type="button"
                  key="qf-cr"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Credit && String(img.exif.Credit).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !(img.exif?.Credit && String(img.exif.Credit).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCredit || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCredit: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCredit || 'all') === 'yes'
                      ? 'bg-yellow-500/25 text-yellow-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCredit || 'all') === 'no'
                        ? 'bg-yellow-900/40 text-yellow-300/70 ring-1 ring-yellow-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCredit' as any, {
                    defaultValue: 'Credit: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CR
                </button>

                <button
                  type="button"
                  key="qf-so"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Source && String(img.exif.Source).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !(img.exif?.Source && String(img.exif.Source).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasSource || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasSource: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasSource || 'all') === 'yes'
                      ? 'bg-orange-500/25 text-orange-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasSource || 'all') === 'no'
                        ? 'bg-orange-900/40 text-orange-300/70 ring-1 ring-orange-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterSource' as any, {
                    defaultValue: 'Source: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  SO
                </button>

                <button
                  type="button"
                  key="qf-in"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !!(img.exif?.Instructions && String(img.exif.Instructions).trim()),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !(img.exif?.Instructions && String(img.exif.Instructions).trim()),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasInstructions || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasInstructions: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasInstructions || 'all') === 'yes'
                      ? 'bg-slate-500/30 text-slate-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasInstructions || 'all') === 'no'
                        ? 'bg-slate-900/40 text-slate-300/70 ring-1 ring-slate-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterInstructions' as any, {
                    defaultValue: 'Instructions: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  IN
                </button>

                <button
                  type="button"
                  key="qf-ct"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Artist || img.exif?.Creator || '';
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Artist || img.exif?.Creator || '';
                          return !(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCreator || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCreator: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCreator || 'all') === 'yes'
                      ? 'bg-teal-500/25 text-teal-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCreator || 'all') === 'no'
                        ? 'bg-teal-900/40 text-teal-300/70 ring-1 ring-teal-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCreator' as any, {
                    defaultValue: 'Creator: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CT
                </button>

                <button
                  type="button"
                  key="qf-rt"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const r =
                            img.exif?.Copyright ||
                            img.exif?.Rights ||
                            img.exif?.UsageTerms ||
                            img.exif?.['Usage Terms'] ||
                            '';
                          return !!(r && String(r).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const r =
                            img.exif?.Copyright ||
                            img.exif?.Rights ||
                            img.exif?.UsageTerms ||
                            img.exif?.['Usage Terms'] ||
                            '';
                          return !(r && String(r).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasRights || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasRights: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasRights || 'all') === 'yes'
                      ? 'bg-rose-500/25 text-rose-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasRights || 'all') === 'no'
                        ? 'bg-rose-900/40 text-rose-300/70 ring-1 ring-rose-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterRights' as any, {
                    defaultValue: 'Rights/Copyright: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  RT
                </button>

                <button
                  type="button"
                  key="qf-jt"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const j =
                            img.exif?.AuthorsPosition ||
                            img.exif?.['Authors Position'] ||
                            '';
                          return !!(j && String(j).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const j =
                            img.exif?.AuthorsPosition ||
                            img.exif?.['Authors Position'] ||
                            '';
                          return !(j && String(j).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasJobTitle || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasJobTitle: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasJobTitle || 'all') === 'yes'
                      ? 'bg-indigo-500/25 text-indigo-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasJobTitle || 'all') === 'no'
                        ? 'bg-indigo-900/40 text-indigo-300/70 ring-1 ring-indigo-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterJobTitle' as any, {
                    defaultValue: 'Job Title: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  JT
                </button>

                <button
                  type="button"
                  key="qf-cy"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.City && String(img.exif.City).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !(img.exif?.City && String(img.exif.City).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCity || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCity: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCity || 'all') === 'yes'
                      ? 'bg-cyan-500/25 text-cyan-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCity || 'all') === 'no'
                        ? 'bg-cyan-900/40 text-cyan-300/70 ring-1 ring-cyan-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCity' as any, {
                    defaultValue: 'City: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CY
                </button>

                <button
                  type="button"
                  key="qf-cn"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Country && String(img.exif.Country).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => !(img.exif?.Country && String(img.exif.Country).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCountry || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCountry: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCountry || 'all') === 'yes'
                      ? 'bg-emerald-500/25 text-emerald-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCountry || 'all') === 'no'
                        ? 'bg-emerald-900/40 text-emerald-300/70 ring-1 ring-emerald-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCountry' as any, {
                    defaultValue: 'Country: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CN
                </button>

                <button
                  type="button"
                  key="qf-st"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.State || img.exif?.Province || '';
                          return !!(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.State || img.exif?.Province || '';
                          return !(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasState || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasState: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasState || 'all') === 'yes'
                      ? 'bg-lime-500/25 text-lime-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasState || 'all') === 'no'
                        ? 'bg-lime-900/40 text-lime-300/70 ring-1 ring-lime-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterState' as any, {
                    defaultValue: 'State/Province: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  ST
                </button>

                <button
                  type="button"
                  key="qf-sl"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.Location || img.exif?.SubLocation || '';
                          return !!(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.Location || img.exif?.SubLocation || '';
                          return !(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasSubLocation || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasSubLocation: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasSubLocation || 'all') === 'yes'
                      ? 'bg-violet-500/25 text-violet-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasSubLocation || 'all') === 'no'
                        ? 'bg-violet-900/40 text-violet-300/70 ring-1 ring-violet-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterSubLocation' as any, {
                    defaultValue: 'Sub-location: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  SL
                </button>

                <button
                  type="button"
                  key="qf-cc"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c =
                            img.exif?.CountryCode || img.exif?.['Country Code'] || '';
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c =
                            img.exif?.CountryCode || img.exif?.['Country Code'] || '';
                          return !(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasCountryCode || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasCountryCode: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasCountryCode || 'all') === 'yes'
                      ? 'bg-sky-500/25 text-sky-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasCountryCode || 'all') === 'no'
                        ? 'bg-sky-900/40 text-sky-300/70 ring-1 ring-sky-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterCountryCode' as any, {
                    defaultValue: 'Country code (ISO): click cycle · Shift=select with · Alt=without',
                  })}
                >
                  CC
                </button>

                <button
                  type="button"
                  key="qf-ut"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const u =
                            img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
                          return !!(u && String(u).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) => {
                          const u =
                            img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
                          return !(u && String(u).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasUsageTerms || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasUsageTerms: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasUsageTerms || 'all') === 'yes'
                      ? 'bg-fuchsia-500/25 text-fuchsia-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasUsageTerms || 'all') === 'no'
                        ? 'bg-fuchsia-900/40 text-fuchsia-300/70 ring-1 ring-fuchsia-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterUsageTerms' as any, {
                    defaultValue: 'Usage terms: click cycle · Shift=select with · Alt=without',
                  })}
                >
                  UT
                </button>
















<button
                  type="button"
                  key="qf-stk"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter((img) =>
                          (img.tags || []).some((tg: string) => tg.startsWith('stack:')),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    if (e.altKey) {
                      e.preventDefault();
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !(img.tags || []).some((tg: string) => tg.startsWith('stack:')),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                      return;
                    }
                    setFilterCriteria((prev) => {
                      const cur = prev.hasStack || 'all';
                      const next = cur === 'all' ? 'yes' : cur === 'yes' ? 'no' : 'all';
                      return { ...prev, hasStack: next };
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    (filterCriteria.hasStack || 'all') === 'yes'
                      ? 'bg-amber-500/25 text-amber-100 ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : (filterCriteria.hasStack || 'all') === 'no'
                        ? 'bg-amber-900/40 text-amber-300/70 ring-1 ring-amber-400/30 line-through opacity-90'
                        : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterStack' as any, {
                    defaultValue:
                      'Stack: click cycle yes/no/all · Shift=select stacked · Alt=select unstacked',
                  })}
                >
                  STK
                </button>

                {libraryFilterPresets.slice(0, 6).map((fp: any) => {
                  const critKey = (c: any) =>
                    JSON.stringify({
                      colors: c?.colors || [],
                      rating: c?.rating ?? 0,
                      rawStatus: c?.rawStatus,
                      editedStatus: c?.editedStatus,
                      flagStatus: c?.flagStatus,
                      hasGps: c?.hasGps,
                      hasCaption: c?.hasCaption,
                      hasLocation: c?.hasLocation,
                      orientation: c?.orientation,
                      hasStack: c?.hasStack,
                      hasKeywords: c?.hasKeywords,
                      virtualCopies: c?.virtualCopies,
                    });
                  const activePreset = critKey(fp?.criteria) === critKey(filterCriteria);
                  return (
                  <button
                    type="button"
                    key={`qf-fp-${fp.id}`}
                    onClick={(e) => {
                      if (e.altKey && appSettingsForFilters && handleSettingsChange) {
                        e.preventDefault();
                        const next = libraryFilterPresets.filter((p: any) => p.id !== fp.id);
                        handleSettingsChange({
                          ...appSettingsForFilters,
                          libraryFilterPresets: next,
                        });
                        return;
                      }
                      if (fp?.criteria) {
                        useLibraryStore.getState().setLibrary({
                          filterCriteria: { ...fp.criteria } as any,
                          showPreviousImportOnly: false,
                          showQuickCollectionOnly: false,
                          showSelectedOnly: false,
                        });
                      }
                    }}
                    className={clsx(
                      'px-1.5 h-5 rounded text-[9px] font-semibold uppercase max-w-[4.5rem] truncate border transition-colors',
                      activePreset
                        ? 'bg-accent/25 text-text-primary border-accent/50 ring-1 ring-accent/40'
                        : 'bg-surface text-text-secondary border-border-color/40 opacity-80 hover:opacity-100 hover:text-text-primary',
                    )}
                    data-tooltip={t('ui.bottomBar.tooltips.filterPreset' as any, {
                      defaultValue: '{{name}} — click apply · Alt-click delete · Ctrl+Shift+Q cycle',
                      name: fp.name,
                    })}
                  >
                    {fp.name}
                  </button>
                  );
                })}

<button
                  type="button"
                  key="qf-sel"
                  onClick={() => {
                    const lib = useLibraryStore.getState();
                    const hasSel =
                      (lib.multiSelectedPaths && lib.multiSelectedPaths.length > 0) ||
                      !!lib.libraryActivePath;
                    if (!hasSel && !lib.showSelectedOnly) return;
                    lib.setLibrary({
                      showSelectedOnly: !lib.showSelectedOnly,
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                    });
                  }}
                  className={clsx(
                    'px-1.5 h-5 rounded text-[9px] font-bold uppercase transition-transform hover:scale-105',
                    showSelectedOnly
                      ? 'bg-accent/30 text-text-primary ring-2 ring-accent ring-offset-1 ring-offset-bg-primary'
                      : 'bg-surface text-text-secondary border border-border-color/40 opacity-70 hover:opacity-100',
                  )}
                  data-tooltip={t('ui.bottomBar.tooltips.filterSelected' as any, {
                    defaultValue: 'Show selected only (Ctrl+Alt+A)',
                  })}
                >
                  SEL
                </button>

<button
                  type="button"
                  key="qf-clear"
                  className="px-1.5 h-5 rounded text-[9px] font-bold uppercase text-text-secondary hover:text-text-primary hover:bg-card-active border border-border-color/30"
                  data-tooltip={t('ui.bottomBar.tooltips.clearFilters' as any, {
                    defaultValue: 'Clear all filters (Ctrl+Alt+L)',
                  })}
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
                        hasPeople: 'all',
                        hasEvent: 'all',
                        hasScene: 'all',
                        hasGenre: 'all',
                        hasSubjectCode: 'all',
                        hasCategory: 'all',
                        hasJobId: 'all',
                        hasUrgency: 'all',
                        urgencyMax: undefined,
                        hasCaptionWriter: 'all',
                        hasDigitalSource: 'all',
                        hasHeadline: 'all',
                        hasTitle: 'all',
                        hasCredit: 'all',
                        hasSource: 'all',
                        hasInstructions: 'all',
                        hasCreator: 'all',
                        hasRights: 'all',
                        hasJobTitle: 'all',
                        hasCity: 'all',
                        hasCountry: 'all',
                        hasState: 'all',
                        hasSubLocation: 'all',
                        hasCountryCode: 'all',
                        hasUsageTerms: 'all',
                        orientation: 'all',
                        hasStack: 'all',
                        hasKeywords: 'all',
                        virtualCopies: 'all',
                      } as any,
                      showPreviousImportOnly: false,
                      showQuickCollectionOnly: false,
                      showSelectedOnly: false,
                    });
                  }}
                >
                  ×
                </button>



              </div>
            </div>
          </div>

          <div
            className={clsx(
              'flex items-center transition-all duration-300 ease-out overflow-hidden',
              numSelected > 0 || (isLibraryView && total > 0)
                ? 'max-w-xs opacity-100'
                : 'max-w-0 opacity-0',
            )}
          >
            <div className="h-5 w-px bg-surface mr-4"></div>
            <Text as="span" className="whitespace-nowrap tabular-nums">
              {numSelected > 0
                ? t('ui.bottomBar.imagesSelected', { current: numSelected, total })
                : t('ui.bottomBar.imagesTotal' as any, {
                    defaultValue: '{{total}} photos',
                    total,
                  })}
            </Text>
            {isLibraryView && sortCriteria && (
              <button
                type="button"
                className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tabular-nums text-text-secondary hover:text-text-primary hover:bg-card-active border border-border-color/30"
                data-tooltip={t('ui.bottomBar.sortChipTip' as any, {
                  defaultValue: 'Click reverse · Ctrl+Alt+Y/U/O · 8 flag · 9 color · 0 edited · Ctrl+Alt+Shift+, cycle',
                })}
                onClick={(e) => {
                  if (e.altKey || e.shiftKey) {
                    e.preventDefault();
                    const orderKeys = [
                      'name',
                      'date_taken',
                      'date',
                      'rating',
                      'flag',
                      'color',
                      'edited',
                      'camera',
                      'lens',
                      'iso',
                      'aperture',
                      'focal_length',
                      'shutter_speed',
                      'file_type',
            'has_gps',
                      'urgency',
                      'category',
                      'creator',
                      'credit',
                      'job_title',
                      'city',
                      'country',
                      'state',
                      'sublocation',
                      'headline',
                      'country_code',
                      'usage_terms',
                    ];
                    const cur = sortCriteria.key || 'name';
                    let idx = orderKeys.indexOf(cur === 'color_label' ? 'color' : cur);
                    idx = e.shiftKey
                      ? idx <= 0
                        ? orderKeys.length - 1
                        : idx - 1
                      : idx < 0
                        ? 0
                        : (idx + 1) % orderKeys.length;
                    setSortCriteria({ ...sortCriteria, key: orderKeys[idx] });
                    return;
                  }
                  const order = sortCriteria.order === 'asc' ? 'desc' : 'asc';
                  setSortCriteria({ ...sortCriteria, order });
                }}
              >
                {(() => {
                  const k = sortCriteria.key || 'name';
                  const labels: Record<string, string> = {
                    name: 'Name',
                    date_taken: 'Capture',
                    date: 'Modified',
                    rating: 'Rating',
                    flag: 'Flag',
                    color: 'Color',
                    color_label: 'Color',
                    edited: 'Edited',
                    camera: 'Camera',
                    lens: 'Lens',
                    iso: 'ISO',
                    aperture: 'f/',
                    focal_length: 'mm',
                    shutter_speed: 'Shutter',
                    file_type: 'Type',
                    has_gps: 'GPS',
                    urgency: 'Urgency',
                    category: 'Category',
                    creator: 'Creator',
                    credit: 'Credit',
                    job_title: 'Job Title',
                    city: 'City',
                    country: 'Country',
                    state: 'State',
                    sublocation: 'Sub-location',
                    headline: 'Headline',
                    country_code: 'Country code',
                    usage_terms: 'Usage terms',
                  };
                  const label = labels[k] || k;
                  const arrow = sortCriteria.order === 'asc' ? '↑' : '↓';
                  return `${label} ${arrow}`;
                })()}
              </button>
            )}
            {isLibraryView && libraryStats.total > 0 && (
              <span className="ml-2 flex items-center gap-1.5 text-[10px] text-text-secondary/80 tabular-nums">
                {libraryStats.picks > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:ring-1 hover:ring-emerald-400/50"
                    data-tooltip={t('ui.bottomBar.statsPicks' as any, {
                      defaultValue: 'Picks in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) =>
                          (img.tags || []).some(
                            (tg: string) => tg === 'flag:pick' || tg.endsWith(':pick'),
                          ),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    P {libraryStats.picks}
                  </button>
                )}
                {libraryStats.rejects > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-red-500/20 text-red-300 hover:ring-1 hover:ring-red-400/50"
                    data-tooltip={t('ui.bottomBar.statsRejects' as any, {
                      defaultValue: 'Rejects in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) =>
                          (img.tags || []).some(
                            (tg: string) => tg === 'flag:reject' || tg.endsWith(':reject'),
                          ),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    X {libraryStats.rejects}
                  </button>
                )}
                {libraryStats.edited > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-sky-500/15 text-sky-300 hover:ring-1 hover:ring-sky-400/40"
                    data-tooltip={t('ui.bottomBar.statsEdited' as any, {
                      defaultValue: 'Edited in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => !!img.is_edited)
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    E {libraryStats.edited}
                  </button>
                )}
                {libraryStats.rated > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-200 hover:ring-1 hover:ring-amber-400/40"
                    data-tooltip={t('ui.bottomBar.statsRated' as any, {
                      defaultValue: 'Rated in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => (Number(ratingsMap?.[img.path] ?? img.rating) || 0) > 0)
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    ★ {libraryStats.rated}
                  </button>
                )}
                {libraryStats.gps > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-sky-500/10 text-sky-200/90 hover:ring-1 hover:ring-sky-400/40"
                    data-tooltip={t('ui.bottomBar.statsGps' as any, {
                      defaultValue: 'GPS-tagged in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const lat = img.exif?.GPSLatitude;
                          const lon = img.exif?.GPSLongitude;
                          if (lat == null || lon == null || lat === '' || lon === '') return false;
                          return (
                            Number.isFinite(parseFloat(String(lat))) &&
                            Number.isFinite(parseFloat(String(lon)))
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    ⌖ {libraryStats.gps}
                  </button>
                )}
                {libraryStats.captions > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-teal-500/15 text-teal-200 hover:ring-1 hover:ring-teal-400/40"
                    data-tooltip={t('ui.bottomBar.statsCaptions' as any, {
                      defaultValue: 'With caption — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          const hay = [
                            ex.ImageDescription,
                            ex.XPComment,
                            ex.XPTitle,
                            ex.Description,
                            ex.Caption,
                            ex['Caption-Abstract'],
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .trim();
                          return hay.length > 0;
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CAP {libraryStats.captions}
                  </button>
                )}
                {libraryStats.cities > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-200 hover:ring-1 hover:ring-cyan-400/40"
                    data-tooltip={t('ui.bottomBar.statsCities' as any, {
                      defaultValue: 'With city — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.City && String(img.exif.City).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CY {libraryStats.cities}
                  </button>
                )}
                {libraryStats.countries > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-200 hover:ring-1 hover:ring-emerald-400/40"
                    data-tooltip={t('ui.bottomBar.statsCountries' as any, {
                      defaultValue: 'With country — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Country && String(img.exif.Country).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CN {libraryStats.countries}
                  </button>
                )}
                {libraryStats.states > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-lime-500/15 text-lime-200 hover:ring-1 hover:ring-lime-400/40"
                    data-tooltip={t('ui.bottomBar.statsStates' as any, {
                      defaultValue: 'With state/province — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.State || img.exif?.Province || '';
                          return !!(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    ST {libraryStats.states}
                  </button>
                )}
                {libraryStats.sublocations > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-violet-500/15 text-violet-200 hover:ring-1 hover:ring-violet-400/40"
                    data-tooltip={t('ui.bottomBar.statsSubLocations' as any, {
                      defaultValue: 'With sub-location — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const s = img.exif?.Location || img.exif?.SubLocation || '';
                          return !!(s && String(s).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    SL {libraryStats.sublocations}
                  </button>
                )}
                {libraryStats.countryCodes > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-sky-500/15 text-sky-200 hover:ring-1 hover:ring-sky-400/40"
                    data-tooltip={t('ui.bottomBar.statsCountryCodes' as any, {
                      defaultValue: 'With country code — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c =
                            img.exif?.CountryCode || img.exif?.['Country Code'] || '';
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CC {libraryStats.countryCodes}
                  </button>
                )}
                {libraryStats.usageTerms > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-200 hover:ring-1 hover:ring-fuchsia-400/40"
                    data-tooltip={t('ui.bottomBar.statsUsageTerms' as any, {
                      defaultValue: 'With usage terms — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const u =
                            img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
                          return !!(u && String(u).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    UT {libraryStats.usageTerms}
                  </button>
                )}
                {libraryStats.headlines > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-100 hover:ring-1 hover:ring-amber-400/40"
                    data-tooltip={t('ui.bottomBar.statsHeadlines' as any, {
                      defaultValue: 'With headline — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => !!(img.exif?.Headline && String(img.exif.Headline).trim()))
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    HL {libraryStats.headlines}
                  </button>
                )}
                {libraryStats.creators > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-teal-500/15 text-teal-200 hover:ring-1 hover:ring-teal-400/40"
                    data-tooltip={t('ui.bottomBar.statsCreators' as any, {
                      defaultValue: 'With creator — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Artist || img.exif?.Creator || '';
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CT {libraryStats.creators}
                  </button>
                )}
                {libraryStats.people > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-pink-500/15 text-pink-200 hover:ring-1 hover:ring-pink-400/40"
                    data-tooltip={t('ui.bottomBar.statsPeople' as any, {
                      defaultValue: 'With people tags — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
                          return !!(pe && String(pe).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    PE {libraryStats.people}
                  </button>
                )}
                {libraryStats.events > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-200 hover:ring-1 hover:ring-indigo-400/40"
                    data-tooltip={t('ui.bottomBar.statsEvents' as any, {
                      defaultValue: 'With event tags — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ev = img.exif?.Event;
                          return !!(ev && String(ev).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    EV {libraryStats.events}
                  </button>
                )}
                {libraryStats.scenes > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-lime-500/15 text-lime-200 hover:ring-1 hover:ring-lime-400/40"
                    data-tooltip={t('ui.bottomBar.statsScenes' as any, {
                      defaultValue: 'With scene tags — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc = img.exif?.Scene;
                          return !!(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    SC {libraryStats.scenes}
                  </button>
                )}
                {libraryStats.genres > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-200 hover:ring-1 hover:ring-cyan-400/40"
                    data-tooltip={t('ui.bottomBar.statsGenres' as any, {
                      defaultValue: 'With genre — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const g =
                            img.exif?.IntellectualGenre ||
                            img.exif?.['Intellectual Genre'] ||
                            '';
                          return !!(g && String(g).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    GE {libraryStats.genres}
                  </button>
                )}
                {libraryStats.subjects > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-rose-500/15 text-rose-200 hover:ring-1 hover:ring-rose-400/40"
                    data-tooltip={t('ui.bottomBar.statsSubjects' as any, {
                      defaultValue: 'With subject code — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const sc =
                            img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
                          return !!(sc && String(sc).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    SU {libraryStats.subjects}
                  </button>
                )}
                {libraryStats.categories > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-200 hover:ring-1 hover:ring-amber-400/40"
                    data-tooltip={t('ui.bottomBar.statsCategories' as any, {
                      defaultValue: 'With category — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const c = img.exif?.Category;
                          return !!(c && String(c).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    CA {libraryStats.categories}
                  </button>
                )}
                {libraryStats.jobs > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-stone-500/20 text-stone-200 hover:ring-1 hover:ring-stone-400/40"
                    data-tooltip={t('ui.bottomBar.statsJobs' as any, {
                      defaultValue: 'With job ID — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const j =
                            img.exif?.JobIdentifier ||
                            img.exif?.JobID ||
                            img.exif?.['Job Identifier'] ||
                            '';
                          return !!(j && String(j).trim());
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    JO {libraryStats.jobs}
                  </button>
                )}
                {libraryStats.urgencies > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-red-500/15 text-red-200 hover:ring-1 hover:ring-red-400/40"
                    data-tooltip={t('ui.bottomBar.statsUrgency' as any, {
                      defaultValue: 'With urgency — click to select · Shift-click high (1–2)',
                    })}
                    onClick={(e) => {
                      const highOnly = e.shiftKey;
                      const paths = (imageList || [])
                        .filter((img) => {
                          const n = parseInt(String(img.exif?.Urgency || ''), 10);
                          if (!(Number.isFinite(n) && n >= 1 && n <= 8)) return false;
                          return highOnly ? n <= 2 : true;
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    UR {libraryStats.urgencies}
                    {libraryStats.highUrgency > 0
                      ? ` (!${libraryStats.highUrgency})`
                      : ''}
                  </button>
                )}







                {libraryStats.locations > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-200 hover:ring-1 hover:ring-emerald-400/40"
                    data-tooltip={t('ui.bottomBar.statsLocations' as any, {
                      defaultValue: 'With IPTC location — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => {
                          const ex = img.exif || {};
                          return !!(
                            (ex.City && String(ex.City).trim()) ||
                            (ex.Country && String(ex.Country).trim()) ||
                            (ex.Location && String(ex.Location).trim()) ||
                            (ex.SubLocation && String(ex.SubLocation).trim()) ||
                            (ex.State && String(ex.State).trim()) ||
                            (ex.Province && String(ex.Province).trim())
                          );
                        })
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    LOC {libraryStats.locations}
                  </button>
                )}
                {libraryStats.raw > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-orange-500/20 text-orange-200 hover:ring-1 hover:ring-orange-400/40"
                    data-tooltip={t('ui.bottomBar.statsRaw' as any, {
                      defaultValue: 'RAW in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) => !!img.is_raw)
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    RAW {libraryStats.raw}
                  </button>
                )}
                {libraryStats.virtualCopies > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-200 hover:ring-1 hover:ring-fuchsia-400/40"
                    data-tooltip={t('ui.bottomBar.statsVc' as any, {
                      defaultValue: 'Virtual copies in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter(
                          (img) =>
                            !!img.is_virtual_copy || String(img.path || '').includes('?vc='),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    VC {libraryStats.virtualCopies}
                  </button>
                )}
                {libraryStats.stacked > 0 && (
                  <button
                    type="button"
                    className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-200 hover:ring-1 hover:ring-amber-400/40"
                    data-tooltip={t('ui.bottomBar.statsStacked' as any, {
                      defaultValue: 'Stacked in view — click to select',
                    })}
                    onClick={() => {
                      const paths = (imageList || [])
                        .filter((img) =>
                          (img.tags || []).some((tg: string) => tg.startsWith('stack:')),
                        )
                        .map((img) => img.path);
                      useLibraryStore.getState().setLibrary({
                        multiSelectedPaths: paths,
                        libraryActivePath: paths[paths.length - 1] || null,
                        selectionAnchorPath: paths[0] || null,
                        showSelectedOnly: false,
                      });
                    }}
                  >
                    S {libraryStats.stacked}
                  </button>
                )}



              </span>
            )}
          </div>
        </div>
        <div className="grow" />
        {isLibraryView ? (
          <div className="flex items-center gap-3">
            <StarRating rating={rating} onRate={onRate} disabled={isRatingDisabled} />
            <div className="flex items-center gap-1">
              {COLOR_LABELS.map((color) => {
                const path = multiSelectedPaths[0];
                const imgTags = path ? imageList.find((img) => img.path === path)?.tags || [] : [];
                const tag = imgTags.find?.((x: string) => x.startsWith('color:'));
                const activeColor = tag ? tag.substring(6) : null;
                const isActiveColor = activeColor === color.name;
                return (
                  <button
                    key={`lib-assign-color-${color.name}`}
                    type="button"
                    disabled={isRatingDisabled || !onSetColorLabel}
                    onClick={() => onSetColorLabel?.(color.name)}
                    className={clsx(
                      'w-3.5 h-3.5 rounded-full transition-transform hover:scale-110 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed',
                      isActiveColor ? 'ring-2 ring-white/90 scale-110' : 'ring-1 ring-black/20',
                    )}
                    style={{ backgroundColor: color.color }}
                    data-tooltip={t(`contextMenus.colors.${color.name}`, {
                      defaultValue: color.name.charAt(0).toUpperCase() + color.name.slice(1),
                    })}
                  />
                );
              })}
              <button
                type="button"
                disabled={isRatingDisabled || !onSetColorLabel}
                onClick={() => onSetColorLabel?.(null)}
                className={clsx(
                  'w-3.5 h-3.5 rounded-full border border-dashed border-white/40 transition-transform hover:scale-110',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
                data-tooltip={t('library.header.viewOptions.noLabel')}
              />
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isRatingDisabled || !onSetFlag}
                onClick={() => onSetFlag?.('pick')}
                className="px-1.5 h-5 rounded text-[9px] font-bold uppercase bg-emerald-600/80 text-white hover:bg-emerald-500 disabled:opacity-40"
                data-tooltip={t('settings.keybinds.actions.flag_pick' as any)}
              >
                P
              </button>
              <button
                type="button"
                disabled={isRatingDisabled || !onSetFlag}
                onClick={() => onSetFlag?.('reject')}
                className="px-1.5 h-5 rounded text-[9px] font-bold uppercase bg-red-600/80 text-white hover:bg-red-500 disabled:opacity-40"
                data-tooltip={t('settings.keybinds.actions.flag_reject' as any)}
              >
                X
              </button>
            </div>
            <div className="h-5 w-px bg-surface" />
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              disabled={isExportDisabled}
              onClick={onExportClick}
              data-tooltip={t('ui.bottomBar.tooltips.export')}
            >
              <FileInput size={16} />
            </button>
          </div>
        ) : showZoomControls ? (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 w-56">
              <div
                className="relative w-12 h-full flex items-center justify-end cursor-pointer"
                onClick={handleResetZoom}
                onMouseEnter={() => setIsZoomLabelHovered(true)}
                onMouseLeave={() => setIsZoomLabelHovered(false)}
                data-tooltip={t('ui.bottomBar.tooltips.resetZoom')}
              >
                <span className="absolute right-0 text-xs text-text-secondary select-none text-right w-max transition-colors hover:text-text-primary">
                  {isZoomLabelHovered ? t('ui.bottomBar.zoomLabelReset') : t('ui.bottomBar.zoomLabel')}
                </span>
              </div>

              <div className="relative flex-1 h-5">
                <div className="absolute top-1/2 left-0 w-full h-1.5 -translate-y-1/2 bg-surface rounded-full pointer-events-none" />
                <input
                  type="range"
                  min={0.1}
                  max={2.0}
                  step="0.05"
                  value={latchedSliderValue}
                  onChange={handleSliderChange}
                  onKeyDown={handleZoomKeyDown}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onTouchStart={handleMouseDown}
                  onTouchEnd={handleMouseUp}
                  onDoubleClick={handleResetZoom}
                  className={`absolute top-1/2 left-0 w-full h-1.5 mt-[-1.5px] appearance-none bg-transparent cursor-pointer p-0 slider-input z-10 ${
                    isZoomActive ? 'slider-thumb-active' : ''
                  }`}
                />
              </div>

              <div className="relative text-xs text-text-secondary w-6 text-right flex items-center justify-end h-5 gap-1">
                {isEditingPercent ? (
                  <input
                    ref={percentInputRef}
                    type="text"
                    value={percentInputValue}
                    onChange={(e) => setPercentInputValue(e.target.value)}
                    onKeyDown={handlePercentKeyDown}
                    onBlur={handlePercentSubmit}
                    className="w-full text-xs text-text-primary bg-bg-primary border border-border-color rounded-sm px-1 text-right"
                    style={{ fontSize: '12px', height: '18px' }}
                  />
                ) : (
                  <span
                    onClick={handlePercentClick}
                    className="cursor-pointer hover:text-text-primary transition-colors select-none"
                    data-tooltip={t('ui.bottomBar.tooltips.customZoom')}
                  >
                    {latchedDisplayPercent}%
                  </span>
                )}
              </div>
            </div>
            
            {!isLibraryView && showFilmstrip && isFilmstripVisible && (
              <div className="flex items-center gap-0.5 mr-1">
                {(
                  [
                    ['all', t('ui.bottomBar.filmstripAll' as any, { defaultValue: 'All' })],
                    ['selected', t('ui.bottomBar.filmstripSelected' as any, { defaultValue: 'Sel' })],
                    ['picks', t('ui.bottomBar.filmstripPicks' as any, { defaultValue: 'Picks' })],
                    ['rejects', t('ui.bottomBar.filmstripRejects' as any, { defaultValue: 'Rej' })],
                    ['edited', t('ui.bottomBar.filmstripEdited' as any, { defaultValue: 'Edit' })],
                    ['unflagged', t('ui.bottomBar.filmstripUnflagged' as any, { defaultValue: 'U' })],
                    ['rated', t('ui.bottomBar.filmstripRated' as any, { defaultValue: '★' })],
                    ['unrated', t('ui.bottomBar.filmstripUnrated' as any, { defaultValue: '☆' })],
                    ['landscape', t('ui.bottomBar.filmstripLandscape' as any, { defaultValue: 'Ls' })],
                    ['portrait', t('ui.bottomBar.filmstripPortrait' as any, { defaultValue: 'Pt' })],
                    ['vc', t('ui.bottomBar.filmstripVc' as any, { defaultValue: 'VC' })],
                    ['masters', t('ui.bottomBar.filmstripMasters' as any, { defaultValue: 'Mst' })],
                    ['raw', t('ui.bottomBar.filmstripRaw' as any, { defaultValue: 'RAW' })],
                    ['caption', t('ui.bottomBar.filmstripCaption' as any, { defaultValue: 'CAP' })],
                    ['gps', t('ui.bottomBar.filmstripGps' as any, { defaultValue: 'GPS' })],
                    ['location', t('ui.bottomBar.filmstripLocation' as any, { defaultValue: 'LOC' })],
                    ['keywords', t('ui.bottomBar.filmstripKeywords' as any, { defaultValue: 'KW' })],
                    ['people', t('ui.bottomBar.filmstripPeople' as any, { defaultValue: 'PE' })],
                    ['event', t('ui.bottomBar.filmstripEvent' as any, { defaultValue: 'EV' })],
                    ['scene', t('ui.bottomBar.filmstripScene' as any, { defaultValue: 'SC' })],
                    ['genre', t('ui.bottomBar.filmstripGenre' as any, { defaultValue: 'GE' })],
                    ['subject', t('ui.bottomBar.filmstripSubject' as any, { defaultValue: 'SU' })],
                    ['category', t('ui.bottomBar.filmstripCategory' as any, { defaultValue: 'CA' })],
                    ['job', t('ui.bottomBar.filmstripJob' as any, { defaultValue: 'JO' })],
                    ['urgency', t('ui.bottomBar.filmstripUrgency' as any, { defaultValue: 'UR' })],
                    ['captionwriter', t('ui.bottomBar.filmstripCapWriter' as any, { defaultValue: 'CW' })],
                    ['digitalsource', t('ui.bottomBar.filmstripDigSrc' as any, { defaultValue: 'DS' })],
                    ['headline', t('ui.bottomBar.filmstripHeadline' as any, { defaultValue: 'HL' })],
                    ['title', t('ui.bottomBar.filmstripTitle' as any, { defaultValue: 'TI' })],
                    ['credit', t('ui.bottomBar.filmstripCredit' as any, { defaultValue: 'CR' })],
                    ['source', t('ui.bottomBar.filmstripSource' as any, { defaultValue: 'SO' })],
                    ['instructions', t('ui.bottomBar.filmstripInstructions' as any, { defaultValue: 'IN' })],
                    ['creator', t('ui.bottomBar.filmstripCreator' as any, { defaultValue: 'CT' })],
                    ['rights', t('ui.bottomBar.filmstripRights' as any, { defaultValue: 'RT' })],
                    ['jobtitle', t('ui.bottomBar.filmstripJobTitle' as any, { defaultValue: 'JT' })],
                    ['city', t('ui.bottomBar.filmstripCity' as any, { defaultValue: 'CY' })],
                    ['country', t('ui.bottomBar.filmstripCountry' as any, { defaultValue: 'CN' })],
                    ['state', t('ui.bottomBar.filmstripState' as any, { defaultValue: 'ST' })],
                    ['sublocation', t('ui.bottomBar.filmstripSubLocation' as any, { defaultValue: 'SL' })],
                    ['countrycode', t('ui.bottomBar.filmstripCountryCode' as any, { defaultValue: 'CC' })],
                    ['usageterms', t('ui.bottomBar.filmstripUsageTerms' as any, { defaultValue: 'UT' })],
                    ['stacked', t('ui.bottomBar.filmstripStacked' as any, { defaultValue: 'Stk' })],
                    ['unstacked', t('ui.bottomBar.filmstripUnstacked' as any, { defaultValue: 'USt' })],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilmstripScope(id)}
                    className={clsx(
                      'px-1.5 h-5 rounded text-[9px] uppercase font-semibold transition-colors',
                      filmstripScope === id
                        ? 'bg-card-active text-text-primary'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface',
                    )}
                    data-tooltip={
                      (
                        {
                          all: t('ui.bottomBar.filmstripAllTip' as any, {
                            defaultValue: 'Show all photos in filmstrip',
                          }),
                          selected: t('ui.bottomBar.filmstripSelectedTip' as any, {
                            defaultValue: 'Show only selected photos',
                          }),
                          picks: t('ui.bottomBar.filmstripPicksTip' as any, {
                            defaultValue: 'Show only flagged picks',
                          }),
                          rejects: t('ui.bottomBar.filmstripRejectsTip' as any, {
                            defaultValue: 'Show only rejects',
                          }),
                          edited: t('ui.bottomBar.filmstripEditedTip' as any, {
                            defaultValue: 'Show only edited photos',
                          }),
                          unflagged: t('ui.bottomBar.filmstripUnflaggedTip' as any, {
                            defaultValue: 'Show unflagged only',
                          }),
                          rated: t('ui.bottomBar.filmstripRatedTip' as any, {
                            defaultValue: 'Show rated (★1+) only',
                          }),
                          unrated: t('ui.bottomBar.filmstripUnratedTip' as any, {
                            defaultValue: 'Show unrated (no stars) only',
                          }),
                          landscape: t('ui.bottomBar.filmstripLandscapeTip' as any, {
                            defaultValue: 'Landscape orientation only',
                          }),
                          portrait: t('ui.bottomBar.filmstripPortraitTip' as any, {
                            defaultValue: 'Portrait orientation only',
                          }),
                          vc: t('ui.bottomBar.filmstripVcTip' as any, {
                            defaultValue: 'Virtual copies only',
                          }),
                          masters: t('ui.bottomBar.filmstripMastersTip' as any, {
                            defaultValue: 'Masters only (exclude virtual copies)',
                          }),
                          raw: t('ui.bottomBar.filmstripRawTip' as any, {
                            defaultValue: 'RAW files only',
                          }),
                          caption: t('ui.bottomBar.filmstripCaptionTip' as any, {
                            defaultValue: 'Photos with caption/title only',
                          }),
                          gps: t('ui.bottomBar.filmstripGpsTip' as any, {
                            defaultValue: 'GPS-tagged only',
                          }),
                          location: t('ui.bottomBar.filmstripLocationTip' as any, {
                            defaultValue: 'IPTC location only',
                          }),
                          keywords: t('ui.bottomBar.filmstripKeywordsTip' as any, {
                            defaultValue: 'Has user keywords only',
                          }),
                          people: t('ui.bottomBar.filmstripPeopleTip' as any, {
                            defaultValue: 'Photos with people tags only',
                          }),
                          event: t('ui.bottomBar.filmstripEventTip' as any, {
                            defaultValue: 'Photos with event tags only',
                          }),
                          scene: t('ui.bottomBar.filmstripSceneTip' as any, {
                            defaultValue: 'Photos with scene tags only',
                          }),
                          genre: t('ui.bottomBar.filmstripGenreTip' as any, {
                            defaultValue: 'Photos with genre only',
                          }),
                          subject: t('ui.bottomBar.filmstripSubjectTip' as any, {
                            defaultValue: 'Photos with subject code only',
                          }),
                          category: t('ui.bottomBar.filmstripCategoryTip' as any, {
                            defaultValue: 'Photos with category only',
                          }),
                          job: t('ui.bottomBar.filmstripJobTip' as any, {
                            defaultValue: 'Photos with job ID only',
                          }),
                          urgency: t('ui.bottomBar.filmstripUrgencyTip' as any, {
                            defaultValue: 'Photos with urgency set only',
                          }),
                          captionwriter: t('ui.bottomBar.filmstripCapWriterTip' as any, {
                            defaultValue: 'Photos with caption writer only',
                          }),
                          digitalsource: t('ui.bottomBar.filmstripDigSrcTip' as any, {
                            defaultValue: 'Photos with digital source type only',
                          }),
                          headline: t('ui.bottomBar.filmstripHeadlineTip' as any, {
                            defaultValue: 'Photos with headline only',
                          }),
                          title: t('ui.bottomBar.filmstripTitleTip' as any, {
                            defaultValue: 'Photos with title only',
                          }),
                          credit: t('ui.bottomBar.filmstripCreditTip' as any, {
                            defaultValue: 'Photos with credit only',
                          }),
                          source: t('ui.bottomBar.filmstripSourceTip' as any, {
                            defaultValue: 'Photos with source only',
                          }),
                          instructions: t('ui.bottomBar.filmstripInstructionsTip' as any, {
                            defaultValue: 'Photos with instructions only',
                          }),
                          creator: t('ui.bottomBar.filmstripCreatorTip' as any, {
                            defaultValue: 'Photos with creator/artist only',
                          }),
                          rights: t('ui.bottomBar.filmstripRightsTip' as any, {
                            defaultValue: 'Photos with rights/copyright only',
                          }),
                          jobtitle: t('ui.bottomBar.filmstripJobTitleTip' as any, {
                            defaultValue: 'Photos with job title only',
                          }),
                          city: t('ui.bottomBar.filmstripCityTip' as any, {
                            defaultValue: 'Photos with city only',
                          }),
                          country: t('ui.bottomBar.filmstripCountryTip' as any, {
                            defaultValue: 'Photos with country only',
                          }),
                          state: t('ui.bottomBar.filmstripStateTip' as any, {
                            defaultValue: 'Photos with state/province only',
                          }),
                          sublocation: t('ui.bottomBar.filmstripSubLocationTip' as any, {
                            defaultValue: 'Photos with sub-location only',
                          }),
                          countrycode: t('ui.bottomBar.filmstripCountryCodeTip' as any, {
                            defaultValue: 'Photos with country code only',
                          }),
                          usageterms: t('ui.bottomBar.filmstripUsageTermsTip' as any, {
                            defaultValue: 'Photos with usage terms only',
                          }),
                          stacked: t('ui.bottomBar.filmstripStackedTip' as any, {
                            defaultValue: 'Stacked photos only',
                          }),
                          unstacked: t('ui.bottomBar.filmstripUnstackedTip' as any, {
                            defaultValue: 'Unstacked photos only',
                          }),
                        } as Record<string, string>
                      )[id] || id
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
{showFilmstrip && (
              <>
                <div className="h-5 w-px bg-surface"></div>
                <button
                  className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                  onClick={() => setIsFilmstripVisible?.(!isFilmstripVisible)}
                  data-tooltip={
                    isFilmstripVisible
                      ? t('ui.bottomBar.tooltips.collapseFilmstrip')
                      : t('ui.bottomBar.tooltips.expandFilmstrip')
                  }
                >
                  {isFilmstripVisible ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
