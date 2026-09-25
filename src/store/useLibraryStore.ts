import { create } from 'zustand';

const QC_STORAGE_KEY = 'rustroom.quickCollection.v1';

function loadQuickCollection(): string[] {
  try {
    const raw = localStorage.getItem(QC_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function saveQuickCollection(paths: string[]) {
  try {
    localStorage.setItem(QC_STORAGE_KEY, JSON.stringify(paths.slice(0, 5000)));
  } catch {
    /* quota / private mode */
  }
}

const TARGET_COLLECTION_KEY = 'rustroom.targetCollection.v1';
const IMPORT_APPLY_KEY = 'rustroom.importApply.v1';

function loadImportApply(): { develop: string | null; metadata: string | null; keywords: string } {
  try {
    const raw = localStorage.getItem(IMPORT_APPLY_KEY);
    if (!raw) return { develop: null, metadata: null, keywords: '' };
    const p = JSON.parse(raw);
    return {
      develop: typeof p.develop === 'string' ? p.develop : null,
      metadata: typeof p.metadata === 'string' ? p.metadata : null,
      keywords: typeof p.keywords === 'string' ? p.keywords : '',
    };
  } catch {
    return { develop: null, metadata: null, keywords: '' };
  }
}

function saveImportApply(develop: string | null, metadata: string | null, keywords: string) {
  try {
    localStorage.setItem(IMPORT_APPLY_KEY, JSON.stringify({ develop, metadata, keywords }));
  } catch {
    /* ignore */
  }
}

function loadTargetCollectionId(): string | null {
  try {
    const v = localStorage.getItem(TARGET_COLLECTION_KEY);
    if (v === null || v === '' || v === 'qc') return null;
    return v;
  } catch {
    return null;
  }
}

function saveTargetCollectionId(id: string | null) {
  try {
    if (id == null) localStorage.setItem(TARGET_COLLECTION_KEY, 'qc');
    else localStorage.setItem(TARGET_COLLECTION_KEY, id);
  } catch {
    /* ignore */
  }
}

import {
  EditedStatus,
  FlagStatus,
  FilterCriteria,
  ImageFile,
  RawStatus,
  SortCriteria,
  SortDirection,
  AlbumItem,
} from '../components/ui/AppProperties';
import { Adjustments, INITIAL_ADJUSTMENTS } from '../utils/adjustments';
import { ColumnWidths } from '../components/panel/MainLibrary';

export interface SearchCriteria {
  tags: string[];
  text: string;
  mode: 'AND' | 'OR';
}

interface LibraryState {
  // Paths & Trees
  rootPaths: string[];
  currentFolderPath: string | null;
  expandedFolders: Set<string>;
  folderTrees: any[];
  pinnedFolderTrees: any[];

  // Albums
  albumTree: AlbumItem[];
  activeAlbumId: string | null;
  expandedAlbumGroups: Set<string>;

  // Images & Selection
  /** Paths from the most recent import batch (LR "Previous Import"). */
  lastImportedPaths: string[];
  /** When true, library view is limited to lastImportedPaths. */
  showPreviousImportOnly: boolean;
  /** LR-style Quick Collection path set (session-scoped). */
  quickCollectionPaths: string[];
  /** When true, library view is limited to quickCollectionPaths. */
  showQuickCollectionOnly: boolean;
  /** LR Filters → Selected: show only multi-selected (or active) photos. */
  showSelectedOnly: boolean;
  /**
   * LR Target Collection: null = Quick Collection; otherwise album id.
   * **B** adds/removes selection to this target.
   */
  targetCollectionId: string | null;
  imageList: Array<ImageFile>;
  imageRatings: Record<string, number>;
  multiSelectedPaths: Array<string>;
  selectionAnchorPath: string | null;
  libraryActivePath: string | null;
  libraryActiveAdjustments: Adjustments;
  /**
   * LR Library Painter: click thumbnails to spray attributes instead of selecting.
   * - keyword: value is bare hierarchical path (travel/paris)
   * - rating: 0–5
   * - color: label name or null to clear
   * - flag: 'pick' | 'reject' | null to unflag
   */
  libraryPainter: {
    kind: 'keyword' | 'rating' | 'color' | 'flag';
    value: string | number | null;
  } | null;
  /** @deprecated use libraryPainter; kept as mirror for keyword mode */
  keywordPaintTag: string | null;
  /**
   * LR Copy Metadata clipboard: IPTC/EXIF fields to paste onto other photos.
   * Keys match RapidRAW exif map (Artist, Copyright, ImageDescription, City, …).
   */
  copiedMetadata: Record<string, string> | null;
  /** Apply-during-import: existing develop preset id, or null = none. */
  importApplyDevelopPresetId: string | null;
  /** Apply-during-import: metadata preset id, or null = none. */
  importApplyMetadataPresetId: string | null;
  /** Apply-during-import keywords (comma or newline separated). */
  importApplyKeywords: string;
  /**
   * Manual / auto stack ids currently expanded (not collapsed in grid).
   * Values are effective group keys: "stack:<id>" or RAW/JPEG group_id.
   */
  expandedStackIds: string[];
  /**
   * LR-style folder navigation history (physical folder paths only).
   * folderHistoryIndex points at the current entry.
   */
  folderHistory: string[];
  folderHistoryIndex: number;

  // Sorting & Filtering
  sortCriteria: SortCriteria;
  filterCriteria: FilterCriteria;
  searchCriteria: SearchCriteria;

  // UI State specific to the Library View
  isTreeLoading: boolean;
  isViewLoading: boolean;
  libraryScrollTop: number;
  listColumnWidths: ColumnWidths;

  // Actions
  setLibrary: (updater: Partial<LibraryState> | ((state: LibraryState) => Partial<LibraryState>)) => void;
  clearSelection: () => void;
  setFilterCriteria: (criteria: Partial<FilterCriteria> | ((prev: FilterCriteria) => FilterCriteria)) => void;
  setSearchCriteria: (criteria: Partial<SearchCriteria> | ((prev: SearchCriteria) => SearchCriteria)) => void;
  setSortCriteria: (criteria: Partial<SortCriteria> | ((prev: SortCriteria) => SortCriteria)) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  rootPaths: [],
  currentFolderPath: null,
  expandedFolders: new Set<string>(),
  folderTrees: [],
  pinnedFolderTrees: [],

  albumTree: [],
  activeAlbumId: null,
  expandedAlbumGroups: new Set<string>(),

  lastImportedPaths: [],
  showPreviousImportOnly: false,
  quickCollectionPaths: typeof window !== 'undefined' ? loadQuickCollection() : [],
  showQuickCollectionOnly: false,
  showSelectedOnly: false,
  targetCollectionId: typeof window !== 'undefined' ? loadTargetCollectionId() : null,
  imageList: [],
  imageRatings: {},
  multiSelectedPaths: [],
  selectionAnchorPath: null,
  libraryActivePath: null,
  libraryPainter: null,
  keywordPaintTag: null,
  copiedMetadata: null,
  importApplyDevelopPresetId: typeof window !== 'undefined' ? loadImportApply().develop : null,
  importApplyMetadataPresetId: typeof window !== 'undefined' ? loadImportApply().metadata : null,
  importApplyKeywords: typeof window !== 'undefined' ? loadImportApply().keywords : '',
  expandedStackIds: [],
  folderHistory: [],
  folderHistoryIndex: -1,
  libraryActiveAdjustments: INITIAL_ADJUSTMENTS,

  sortCriteria: { key: 'name', order: SortDirection.Ascending },
  filterCriteria: { colors: [], rating: 0, rawStatus: RawStatus.All, editedStatus: EditedStatus.All, flagStatus: FlagStatus.All },
  searchCriteria: { tags: [], text: '', mode: 'OR' },

  isTreeLoading: false,
  isViewLoading: false,
  libraryScrollTop: 0,
  listColumnWidths: {
    thumbnail: 4,
    name: 12,
    date: 10,
    rating: 7,
    flag: 5,
    edited: 5,
    fileType: 6,
    gps: 4,
    urgency: 4,
    creator: 10,
    credit: 8,
    city: 8,
    country: 8,
    state: 7,
    headline: 10,
    color: 7,
    shutter: 8,
    aperture: 7,
    iso: 6,
    focal: 7,
    camera: 12,
    lens: 11,
  },

  setLibrary: (updater) =>
    set((state) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      if (patch.quickCollectionPaths) {
        saveQuickCollection(patch.quickCollectionPaths);
      }
      if ('targetCollectionId' in patch) {
        saveTargetCollectionId(patch.targetCollectionId ?? null);
      }
      if (
        'importApplyDevelopPresetId' in patch ||
        'importApplyMetadataPresetId' in patch ||
        'importApplyKeywords' in patch
      ) {
        saveImportApply(
          patch.importApplyDevelopPresetId !== undefined
            ? patch.importApplyDevelopPresetId
            : state.importApplyDevelopPresetId,
          patch.importApplyMetadataPresetId !== undefined
            ? patch.importApplyMetadataPresetId
            : state.importApplyMetadataPresetId,
          patch.importApplyKeywords !== undefined ? patch.importApplyKeywords : state.importApplyKeywords,
        );
      }
      return patch;
    }),

  clearSelection: () => set({ multiSelectedPaths: [], libraryActivePath: null }),

  setFilterCriteria: (criteria) =>
    set((state) => ({
      filterCriteria:
        typeof criteria === 'function' ? criteria(state.filterCriteria) : { ...state.filterCriteria, ...criteria },
    })),

  setSearchCriteria: (criteria) =>
    set((state) => ({
      searchCriteria:
        typeof criteria === 'function' ? criteria(state.searchCriteria) : { ...state.searchCriteria, ...criteria },
    })),

  setSortCriteria: (criteria) =>
    set((state) => ({
      sortCriteria:
        typeof criteria === 'function' ? criteria(state.sortCriteria) : { ...state.sortCriteria, ...criteria },
    })),
}));
