import { create } from 'zustand';
import { ImageFile, LibraryViewMode, Panel, UiVisibility, CullingSuggestions } from '../components/ui/AppProperties';

const RIGHT_PANEL_ORDER = [
  Panel.Metadata,
  Panel.Adjustments,
  Panel.Crop,
  Panel.Masks,
  Panel.Ai,
  Panel.Export,
];

export interface CollapsibleSectionsState {
  basic: boolean;
  color: boolean;
  colorGrading: boolean;
  curves: boolean;
  details: boolean;
  effects: boolean;
  optics: boolean;
  geometry: boolean;
  lensBlur: boolean;
  calibration: boolean;
  anamorphic: boolean;
}

export interface ConfirmModalState {
  confirmText?: string;
  confirmVariant?: string;
  isOpen: boolean;
  message?: string;
  onConfirm?(): void;
  title?: string;
}

export interface CollageModalState {
  isOpen: boolean;
  sourceImages: Array<Pick<ImageFile, 'path'>>;
}

export interface PanoramaModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface HdrModalState {
  error: string | null;
  finalImageBase64: string | null;
  isOpen: boolean;
  isProcessing: boolean;
  progressMessage: string | null;
  stitchingSourcePaths: Array<string>;
}

export interface DenoiseModalState {
  isOpen: boolean;
  isProcessing: boolean;
  previewBase64: string | null;
  originalBase64?: string | null;
  error: string | null;
  targetPaths: string[];
  progressMessage: string | null;
  isRaw: boolean;
}

export interface NegativeConversionModalState {
  isOpen: boolean;
  targetPaths: Array<string>;
}

export interface CullingModalState {
  isOpen: boolean;
  suggestions: CullingSuggestions | null;
  progress: { current: number; total: number; stage: string } | null;
  error: string | null;
  pathsToCull: Array<string>;
}

interface UIState {
  // View & Layout
  activeView: string;
  /** Secondary-monitor loupe: image is on the principal screen, chrome stays here. */
  dualDisplayActive: boolean;
  dualDisplayPrincipalId: string | null;
  isFullScreen: boolean;
  /** LR Lights Out: 0=normal, 1=dim chrome, 2=black (immersive) */
  lightsOut: 0 | 1 | 2;
  isWindowFullScreen: boolean;
  isInstantTransition: boolean;
  isLayoutReady: boolean;
  uiVisibility: UiVisibility;
  isLibraryExportPanelVisible: boolean;
  isExportModalOpen: boolean;
  isImageInfoModalOpen: boolean;
  isSettingsOpen: boolean;
  isCustomizeModalOpen: boolean;

  /** Map module: images the filmstrip should show (collection + GPS filter). null = normal list. */
  mapImageList: ImageFile[] | null;

  // Dimensions
  leftPanelWidth: number;
  developLeftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  compactEditorPanelHeightOverride: number | null;

  // Right Panel
  activeRightPanel: Panel | null;
  renderedRightPanel: Panel | null;
  slideDirection: number;
  collapsibleSectionsState: CollapsibleSectionsState;

  // Modals & Dialogs
  isCreateFolderModalOpen: boolean;
  isRenameFolderModalOpen: boolean;
  isRenameFileModalOpen: boolean;
  renameTargetPaths: Array<string>;
  isImportModalOpen: boolean;
  isCopyPasteSettingsModalOpen: boolean;
  /** Develop "Preset Browser" modal (grid of presets not yet in the user list). */
  isPresetBrowserOpen: boolean;
  isProfileBrowserOpen: boolean;
  importTargetFolder: string | null;
  importSourcePaths: Array<string>;
  folderActionTarget: string | null;

  // Album Modals
  isCreateAlbumModalOpen: boolean;
  isCreateAlbumGroupModalOpen: boolean;
  isRenameAlbumModalOpen: boolean;
  albumActionTarget: string | null;
  /** When set, next created album is seeded with these photo paths. */
  pendingAlbumSeedPaths: string[] | null;

  // Complex Modal States
  confirmModalState: ConfirmModalState;
  panoramaModalState: PanoramaModalState;
  hdrModalState: HdrModalState;
  negativeModalState: NegativeConversionModalState;
  denoiseModalState: DenoiseModalState;
  cullingModalState: CullingModalState;
  collageModalState: CollageModalState;

  // Actions
  setUI: (updater: Partial<UIState> | ((state: UIState) => Partial<UIState>)) => void;
  setRightPanel: (panel: Panel | null) => void;
  customEscapeHandler: (() => void) | null;
  setCustomEscapeHandler: (handler: (() => void) | null) => void;
  searchFocusRequest: number;
  requestSearchFocus: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeView: 'library',
  dualDisplayActive: false,
  dualDisplayPrincipalId: null,
  isFullScreen: false,
  lightsOut: 0,
  isWindowFullScreen: false,
  isInstantTransition: false,
  isLayoutReady: false,
  uiVisibility: { folderTree: true, filmstrip: true, developLeft: true, libraryRight: true },
  isLibraryExportPanelVisible: false,
  isExportModalOpen: false,
  isImageInfoModalOpen: false,
  isSettingsOpen: false,
  isCustomizeModalOpen: false,

  mapImageList: null,

  leftPanelWidth: 240,
  developLeftPanelWidth: 220,
  rightPanelWidth: 340,
  bottomPanelHeight: 88,
  compactEditorPanelHeightOverride: null,

  activeRightPanel: Panel.Adjustments,
  renderedRightPanel: Panel.Adjustments,
  slideDirection: 1,
  collapsibleSectionsState: {
    basic: true,
    color: false,
    colorGrading: false,
    curves: false,
    details: false,
    effects: false,
    optics: false,
    geometry: false,
    lensBlur: false,
    calibration: false,
    anamorphic: false,
  },

  isCreateFolderModalOpen: false,
  isRenameFolderModalOpen: false,
  isRenameFileModalOpen: false,
  renameTargetPaths: [],
  isImportModalOpen: false,
  isCopyPasteSettingsModalOpen: false,
  isPresetBrowserOpen: false,
  isProfileBrowserOpen: false,
  importTargetFolder: null,
  importSourcePaths: [],
  folderActionTarget: null,

  isCreateAlbumModalOpen: false,
  isCreateAlbumGroupModalOpen: false,
  isRenameAlbumModalOpen: false,
  albumActionTarget: null,
  pendingAlbumSeedPaths: null,

  confirmModalState: { isOpen: false },
  panoramaModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  hdrModalState: {
    error: null,
    finalImageBase64: null,
    isOpen: false,
    isProcessing: false,
    progressMessage: '',
    stitchingSourcePaths: [],
  },
  negativeModalState: { isOpen: false, targetPaths: [] },
  denoiseModalState: {
    isOpen: false,
    isProcessing: false,
    previewBase64: null,
    error: null,
    targetPaths: [],
    progressMessage: null,
    isRaw: false,
  },
  cullingModalState: { isOpen: false, suggestions: null, progress: null, error: null, pathsToCull: [] },
  collageModalState: { isOpen: false, sourceImages: [] },

  setUI: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),

  setRightPanel: (panelId) => {
    const current = get().activeRightPanel;
    if (panelId === current) {
      set({ activeRightPanel: null });
    } else {
      const currentIndex = current ? RIGHT_PANEL_ORDER.indexOf(current) : -1;
      const newIndex = panelId ? RIGHT_PANEL_ORDER.indexOf(panelId) : -1;
      set({
        slideDirection: newIndex > currentIndex ? 1 : -1,
        activeRightPanel: panelId,
        renderedRightPanel: panelId,
      });
    }
  },

  customEscapeHandler: null,
  setCustomEscapeHandler: (handler) => set({ customEscapeHandler: handler }),

  searchFocusRequest: 0,
  requestSearchFocus: () => set((state) => ({ searchFocusRequest: state.searchFocusRequest + 1 })),
}));
