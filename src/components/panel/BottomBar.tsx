import { useState, useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { Star } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import Filmstrip from './Filmstrip';
import FilmstripFilterMenu, { FilmstripFilterScope } from './FilmstripFilterMenu';
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

  const rateTargets =
    multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage?.path ? [selectedImage.path] : [];
  const canRate = rateTargets.length > 0 && !isRatingDisabled;
  const selectedColorTag =
    imageList.find((img) => img.path === (selectedImage?.path || rateTargets[0]))?.tags?.find((t: string) =>
      t.startsWith('color:'),
    )?.substring(6) || null;

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



  const currentFolderPath = useLibraryStore((s) => s.currentFolderPath);
  const sourceLabel = (() => {
    if (!currentFolderPath) return t('library.folders.catalogAll' as any, { defaultValue: 'All Photographs' });
    if (currentFolderPath.startsWith('Album: ')) return currentFolderPath.slice(7);
    const parts = currentFolderPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || currentFolderPath;
  })();
  const selectedName = (() => {
    const p = selectedImage?.path;
    if (!p) return '';
    return (p.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
  })();
  const shownCount = filmstripImageList.length;
  const sourceTotal = imageList.length;

  return (
    <div className="shrink-0 bg-bg-secondary flex flex-col border-t border-border-color/40">
      {showFilmstrip && (
        <div className="h-6 px-2 flex items-center gap-3 text-[11px] text-text-secondary">
          <span className="truncate max-w-[14rem] text-text-primary/90">{sourceLabel}</span>
          <span className="truncate tabular-nums min-w-0">
            {t('ui.bottomBar.filmstripStatus' as any, {
              defaultValue: '{{shown}} photo(s) of {{total}} / {{selected}} selected / {{name}}',
              shown: shownCount,
              total: sourceTotal,
              selected: numSelected,
              name: selectedName,
            })}
          </span>
          <div className="grow" />
          <div className="flex items-center gap-2 shrink-0">
            <div className={clsx('flex items-center', !canRate && 'opacity-40 pointer-events-none')}>
              {[1, 2, 3, 4, 5].map((starValue) => (
                <button
                  key={`bb-star-${starValue}`}
                  type="button"
                  className="p-0.5 leading-none"
                  data-tooltip={t('ui.bottomBar.rate' as any, { defaultValue: 'Note' })}
                  onClick={() => onRate(starValue === rating ? 0 : starValue, rateTargets)}
                >
                  <Star
                    size={12}
                    className={clsx(
                      starValue <= rating ? 'fill-amber-300 text-amber-300' : 'text-white/35 hover:text-white/70',
                    )}
                  />
                </button>
              ))}
            </div>
            <div className={clsx('flex items-center gap-0.5', !canRate && 'opacity-40 pointer-events-none')}>
              {COLOR_LABELS.map((c) => {
                const active = selectedColorTag === c.name;
                return (
                  <button
                    key={`bb-col-${c.name}`}
                    type="button"
                    className={clsx(
                      'w-2.5 h-2.5 rounded-[1px] border',
                      active ? 'border-white scale-110' : 'border-black/40 opacity-80 hover:opacity-100',
                    )}
                    style={{ backgroundColor: c.color }}
                    data-tooltip={c.name}
                    onClick={() => onSetColorLabel?.(active ? null : c.name, rateTargets)}
                  />
                );
              })}
            </div>
            <FilmstripFilterMenu
              scope={filmstripScope as FilmstripFilterScope}
              onScopeChange={(next) => setFilmstripScope(next as typeof filmstripScope)}
            />
          </div>
        </div>
      )}

      {showFilmstrip && (
        <div
          className={clsx('overflow-hidden', !isResizing && 'transition-all duration-300 ease-in-out')}
          style={{ height: isFilmstripVisible ? `${filmstripHeight}px` : '0px' }}
        >
          <div className="w-full" style={{ height: `${filmstripHeight}px` }}>
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
              onSetColorLabel={onSetColorLabel}
              onRequestThumbnails={onRequestThumbnails}
              selectedImage={selectedImage}
              thumbnailAspectRatio={thumbnailAspectRatio}
            />
          </div>
        </div>
      )}
    </div>
  );
}

