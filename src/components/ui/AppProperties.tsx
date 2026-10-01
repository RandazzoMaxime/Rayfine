import { ExportPreset } from './ExportImportProperties';
import { Adjustments, CopyPasteSettings } from '../../utils/adjustments';
import { ToolType } from '../panel/right/Masks';

export const GLOBAL_KEYS = [
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'f',
  'b',
  'a',
  's',
  'd',
  'r',
  'm',
  'k',
  'p',
  'i',
  'e',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  'Enter',
];
export const OPTION_SEPARATOR = 'separator';

export enum Invokes {
  AddTagForPaths = 'add_tag_for_paths',
  ApplyAdjustments = 'apply_adjustments',
  ApplyAdjustmentsToPaths = 'apply_adjustments_to_paths',
  ApplyRelativeAdjustmentsToPaths = 'apply_relative_adjustments_to_paths',
  ApplyAutoAdjustmentsToPaths = 'apply_auto_adjustments_to_paths',
  ApplyDenoising = 'apply_denoising',
  CalculateAutoAdjustments = 'calculate_auto_adjustments',
  CancelExport = 'cancel_export',
  CheckAIConnectorStatus = 'check_ai_connector_status',
  ClearAllSidecars = 'clear_all_sidecars',
  ClearAiTags = 'clear_ai_tags',
  ClearAllTags = 'clear_all_tags',
  ClearThumbnailCache = 'clear_thumbnail_cache',
  CopyFiles = 'copy_files',
  CopyFileTo = 'copy_file_to',
  CreateFolder = 'create_folder',
  CreateVirtualCopy = 'create_virtual_copy',
  CullImages = 'cull_images',
  DeleteFolder = 'delete_folder',
  DuplicateFile = 'duplicate_file',
  EstimateExportSizes = 'estimate_export_sizes',
  ExportImages = 'export_images',
  FrontendLog = 'frontend_log',
  GenerateAiForegroundMask = 'generate_ai_foreground_mask',
  GenerateAiSkyMask = 'generate_ai_sky_mask',
  GenerateAiSubjectMask = 'generate_ai_subject_mask',
  GenerateFullscreenPreview = 'generate_fullscreen_preview',
  GeneratePreviewForPath = 'generate_preview_for_path',
  GenerateMaskOverlay = 'generate_mask_overlay',
  GeneratePresetPreview = 'generate_preset_preview',
  GenerateThumbnailsProgressive = 'generate_thumbnails_progressive',
  GenerateUncroppedPreview = 'generate_uncropped_preview',
  GetFolderTree = 'get_folder_tree',
  GetFolderChildren = 'get_folder_children',
  GetLogFilePath = 'get_log_file_path',
  GetOrCreateInternalLibraryRoot = 'get_or_create_internal_library_root',
  GetCatalogLocation = 'get_catalog_location',
  SetCatalogLocation = 'set_catalog_location',
  ListWatermarks = 'list_watermarks',
  ImportWatermarks = 'import_watermarks',
  RemoveWatermark = 'remove_watermark',
  GetPinnedFolderTrees = 'get_pinned_folder_trees',
  GetSupportedFileTypes = 'get_supported_file_types',
  HandleExportPresetsToFile = 'handle_export_presets_to_file',
  ExportPresetToXmp = 'export_preset_to_xmp',
  ReimportDevelopFromXmp = 'reimport_develop_from_xmp',
  ReimportDevelopFromXmpPaths = 'reimport_develop_from_xmp_paths',
  ExportPresetsToXmpDirectory = 'export_presets_to_xmp_directory',
  HandleImportPresetsFromFile = 'handle_import_presets_from_file',
  HandleImportLegacyPresetsFromFile = 'handle_import_legacy_presets_from_file',
  HandleImportLegacyPresetsFromPaths = 'handle_import_legacy_presets_from_paths',
  HandleImportLegacyPresetsFromDirectory = 'handle_import_legacy_presets_from_directory',
  ParseLegacyPresetFiles = 'parse_legacy_preset_files',
  ImportFiles = 'import_files',
  InvokeGenerativeReplace = 'invoke_generative_replace',
  InvokeGenerativeReplaseWithMaskDef = 'invoke_generative_replace_with_mask_def',
  ListImagesInDir = 'list_images_in_dir',
  ListImagesRecursive = 'list_images_recursive',
  LoadImage = 'load_image',
  LoadMetadata = 'load_metadata',
  SaveImageSnapshots = 'save_image_snapshots',
  LoadPresets = 'load_presets',
  LoadSettings = 'load_settings',
  MoveFiles = 'move_files',
  ReadExifForPaths = 'read_exif_for_paths',
  RemoveTagForPaths = 'remove_tag_for_paths',
  RenameFiles = 'rename_files',
  RenameFolder = 'rename_folder',
  ResetAdjustmentsForPaths = 'reset_adjustments_for_paths',
  SaveMetadataAndUpdateThumbnail = 'save_metadata_and_update_thumbnail',
  SaveCollage = 'save_collage',
  SaveDenoisedImage = 'save_denoised_image',
  SavePanorama = 'save_panorama',
  SaveHdr = 'save_hdr',
  SavePresets = 'save_presets',
  SaveSettings = 'save_settings',
  SetColorLabelForPaths = 'set_color_label_for_paths',
  SetRatingForPaths = 'set_rating_for_paths',
  SetFlagForPaths = 'set_flag_for_paths',
  WriteTextFile = 'write_text_file',
  ShowInFinder = 'show_in_finder',
  ShowXmpSidecar = 'show_xmp_sidecar',
  ExportDevelopToXmp = 'export_develop_to_xmp',
  StartBackgroundIndexing = 'start_background_indexing',
  StitchPanorama = 'stitch_panorama',
  MergeHdr = 'merge_hdr',
  TestAIConnectorConnection = 'test_ai_connector_connection',
  UpdateWgpuTransform = 'update_wgpu_transform',
  ListMonitors = 'list_monitors',
  GetDualDisplayState = 'get_dual_display_state',
  SetDualDisplay = 'set_dual_display',
  UpdateExifFields = 'update_exif_fields',
  FetchCommunityPresets = 'fetch_community_presets',
  GenerateAllCommunityPreviews = 'generate_all_community_previews',
  SaveCommunityPreset = 'save_community_preset',
  SaveTempFile = 'save_temp_file',
  GetAlbums = 'get_albums',
  SaveAlbums = 'save_albums',
  AddToAlbum = 'add_to_album',
  GetAlbumImages = 'get_album_images',
  ImportLightroomCatalog = 'import_lightroom_catalog',
}

export enum ExifOverlay {
  Off = 'off',
  Hover = 'hover',
  Always = 'always',
}

export enum Panel {
  Adjustments = 'adjustments',
  Ai = 'ai',
  Crop = 'crop',
  Export = 'export',
  Masks = 'masks',
  Metadata = 'metadata',
  Presets = 'presets',
}

export enum RawStatus {
  All = 'all',
  NonRawOnly = 'nonRawOnly',
  RawOnly = 'rawOnly',
}

export enum FlagStatus {
  All = 'all',
  Pick = 'pick',
  Reject = 'reject',
  Unflagged = 'unflagged',
}


export enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

export type FolderSortKey = 'name' | 'modified' | 'created' | 'imageCount';

export interface FolderTreeSort {
  key: FolderSortKey;
  order: SortDirection;
}

export enum Theme {
  Arctic = 'arctic',
  Blue = 'blue',
  Dark = 'dark',
  Grey = 'grey',
  Light = 'light',
  MutedGreen = 'muted-green',
  Sepia = 'sepia',
  Snow = 'snow',
}

export enum ThumbnailAspectRatio {
  Cover = 'cover',
  Contain = 'contain',
}

export type GroupPreference = 'jpeg' | 'raw';
export type GroupingMode = 'off' | GroupPreference;

export interface AppSettings {
  aiConnectorAddress?: string;
  aiProvider?: string;
  decorations?: any;
  editorPreviewResolution?: number;
  enableZoomHifi?: boolean;
  useFullDpiRendering?: boolean;
  highResZoomMultiplier?: number;
  enableLivePreviews?: boolean;
  livePreviewQuality?: string;
  enableAiTagging?: boolean;
  aiTagCount?: number;
  customAiTags?: string[];
  filterCriteria?: FilterCriteria;
  lastFolderState?: any;
  pinnedFolders?: any;
  /** Recently visited library folders (paths), newest first. */
  recentFolders?: string[];
  lastRootPath: string | null;
  /** User data folder (catalog, watermarks, settings copy). */
  dataDir?: string | null;
  /** @deprecated use dataDir */
  catalogDir?: string | null;
  rootFolders?: string[];
  libraryViewMode?: LibraryViewMode;
  sortCriteria?: SortCriteria;
  theme: Theme;
  thumbnailSize?: ThumbnailSize;
  thumbnailAspectRatio?: ThumbnailAspectRatio;
  uiVisibility?: UiVisibility;
  adjustmentVisibility?: { [key: string]: boolean };
  rawHighlightCompression?: number;
  processingBackend?: string;
  linuxGpuOptimization?: boolean;
  exportPresets?: ExportPreset[];
  myLenses?: any;
  enableFolderImageCounts?: boolean;
  displayEditIcon?: boolean;
  /** LR View Options: always show file names under grid thumbnails. */
  showGridFilenames?: boolean;
  linearRawMode?: string;
  enableXmpSync?: boolean;
  createXmpIfMissing?: boolean;
  isWaveformVisible?: boolean;
  waveformHeight?: number;
  activeWaveformChannel?: string;
  useWgpuRenderer?: boolean;
  canvasInputMode?: 'mouse' | 'trackpad';
  zoomSpeedMultiplier?: number;
  keybinds?: { [action: string]: string[] };
  tonemapperOverrideEnabled?: boolean;
  defaultRawTonemapper?: string;
  defaultNonRawTonemapper?: string;
  copyPasteSettings?: CopyPasteSettings;
  enableFocusMode?: boolean;
  openTreeSections?: string[];
  folderIcons?: Record<string, string>;
  exifOverlay?: ExifOverlay;
  language?: string;
  fontFamily?: string;
  folderTreeSort?: FolderTreeSort;
  taggingShortcuts?: string[];
  libraryDisplayMode?: LibraryDisplayMode;
  grouping?: GroupingMode;
  requireMatchingExif?: boolean;
  groupEditedFiles?: boolean;
  groupPreferredType?: GroupPreference; // legacy
  /** When true (default), rating/flag/color in Library advances to next photo (LR culling). */
  autoAdvanceOnCull?: boolean;
  /**
   * LR-style: hide rejected photos from Library/Filmstrip views
   * (independent of flag filter; rejects still exist for "Delete Rejected").
   */
  hideRejectedPhotos?: boolean;
  /** Saved Library attribute filter presets (LR-style). */
  libraryFilterPresets?: Array<{ id: string; name: string; criteria: FilterCriteria }>;
  /** Custom dark/light color seeds; persisted in settings.json. */
  appearance?: {
    appearance: 'dark' | 'light';
    seeds: {
      dark: { canvas: string; text: string; accent: string };
      light: { canvas: string; text: string; accent: string };
    };
  };
  /** Last-used Library import dialog settings (LR-style remember). */
  lastImportSettings?: {
    filenameTemplate?: string;
    organizeByDate?: boolean;
    dateFolderFormat?: string;
    deleteAfterImport?: boolean;
    skipDuplicates?: boolean;
    buildPreviews?: boolean;
    previewQuality?: 'minimal' | 'standard' | 'one_to_one';
    copyAsDng?: boolean;
    developPresetId?: string | null;
    keywords?: string[];
    creator?: string | null;
    copyright?: string | null;
    caption?: string | null;
  };
}


export interface BrushSettings {
  feather: number;
  size: number;
  tool: ToolType;
}

export enum LibraryViewMode {
  Flat = 'flat',
  Recursive = 'recursive',
}

export const EditedStatus = {
  All: 'all',
  EditedOnly: 'editedOnly',
  UneditedOnly: 'uneditedOnly',
} as const;

export type EditedStatus = (typeof EditedStatus)[keyof typeof EditedStatus];

export interface FilterCriteria {
  colors: Array<string>;
  rating: number;
  rawStatus: RawStatus;
  editedStatus?: EditedStatus;
  flagStatus?: FlagStatus;
  /** Empty string / undefined = all cameras; otherwise matches "Make Model" substring */
  camera?: string;
  /** Substring match on EXIF City (IPTC location) */
  city?: string;
  /** Substring match on EXIF Country (IPTC location) */
  country?: string;
  /** Substring match against image tags (user: stripped) */
  keyword?: string;
  /** Inclusive date range (YYYY-MM-DD) */
  dateFrom?: string;
  dateTo?: string;
  /** Which date to use for dateFrom/dateTo filters (default capture) */
  dateField?: 'capture' | 'modified';
  /** Lens model substring (from EXIF LensModel / Lens) */
  lens?: string;
  /** Inclusive ISO range (from EXIF PhotographicSensitivity / ISOSpeedRatings) */
  isoMin?: number;
  isoMax?: number;
  /** GPS presence: undefined/'all' = any; 'yes' = has GPS; 'no' = no GPS */
  hasGps?: 'all' | 'yes' | 'no';
  /** Inclusive aperture (f-number) range from EXIF FNumber */
  apertureMin?: number;
  apertureMax?: number;
  /** Inclusive focal length (mm) range from EXIF FocalLength */
  focalMin?: number;
  focalMax?: number;
  /**
   * Inclusive shutter speed range in seconds (from EXIF ExposureTime).
   * Examples: 1/250 → 0.004, 1/60 → ~0.0167, 1 → 1.0
   */
  shutterMin?: number;
  shutterMax?: number;
  /** File extension filter, e.g. "arw", "jpg" (no dot); undefined = all */
  fileExt?: string;
  /** Substring match on caption/title (EXIF ImageDescription / XPComment / XPTitle) */
  caption?: string;
  /** Caption presence: undefined/'all' | 'yes' | 'no' */
  hasCaption?: 'all' | 'yes' | 'no';
  /** People (PersonInImage) presence: undefined/'all' | 'yes' | 'no' */
  hasPeople?: 'all' | 'yes' | 'no';
  /** Event presence: undefined/'all' | 'yes' | 'no' */
  hasEvent?: 'all' | 'yes' | 'no';
  /** Scene presence: undefined/'all' | 'yes' | 'no' */
  hasScene?: 'all' | 'yes' | 'no';
  /** Genre (IntellectualGenre) presence: undefined/'all' | 'yes' | 'no' */
  hasGenre?: 'all' | 'yes' | 'no';
  /** IPTC Subject Code presence: undefined/'all' | 'yes' | 'no' */
  hasSubjectCode?: 'all' | 'yes' | 'no';
  /** photoshop:Category presence: undefined/'all' | 'yes' | 'no' */
  hasCategory?: 'all' | 'yes' | 'no';
  /** Job Identifier presence: undefined/'all' | 'yes' | 'no' */
  hasJobId?: 'all' | 'yes' | 'no';
  /** photoshop:Urgency set (1-8): undefined/'all' | 'yes' | 'no' */
  hasUrgency?: 'all' | 'yes' | 'no';
  /** Urgency max level inclusive (1=high … 8=low); when set with hasUrgency yes, filter urgency <= max */
  urgencyMax?: number;
  /** Caption writer presence */
  hasCaptionWriter?: 'all' | 'yes' | 'no';
  /** Digital source type presence */
  hasDigitalSource?: 'all' | 'yes' | 'no';
  /** Headline presence */
  hasHeadline?: 'all' | 'yes' | 'no';
  /** Title (XPTitle/dc:title) presence */
  hasTitle?: 'all' | 'yes' | 'no';
  /** Credit presence */
  hasCredit?: 'all' | 'yes' | 'no';
  /** Source presence */
  hasSource?: 'all' | 'yes' | 'no';
  /** Instructions presence */
  hasInstructions?: 'all' | 'yes' | 'no';
  /** Creator / Artist presence */
  hasCreator?: 'all' | 'yes' | 'no';
  /** Rights / Copyright / UsageTerms presence */
  hasRights?: 'all' | 'yes' | 'no';
  /** Job Title / AuthorsPosition presence */
  hasJobTitle?: 'all' | 'yes' | 'no';
  /** City presence (IPTC) */
  hasCity?: 'all' | 'yes' | 'no';
  /** Country presence (IPTC) */
  hasCountry?: 'all' | 'yes' | 'no';
  /** State / Province presence (IPTC) */
  hasState?: 'all' | 'yes' | 'no';
  /** Sub-location / Location presence (IPTC Iptc4xmpCore:Location) */
  hasSubLocation?: 'all' | 'yes' | 'no';
  /** Country code (ISO) presence — Iptc4xmpCore:CountryCode */
  hasCountryCode?: 'all' | 'yes' | 'no';
  /** Rights Usage Terms presence only (xmpRights:UsageTerms) */
  hasUsageTerms?: 'all' | 'yes' | 'no';
  /** IPTC location presence (City/Country/Location/State): undefined/'all' | 'yes' | 'no' */
  hasLocation?: 'all' | 'yes' | 'no';
  /** Frame orientation from EXIF pixel size (when available) */
  orientation?: 'all' | 'landscape' | 'portrait' | 'square';
  /** Keyword presence: undefined/'all' = any; 'yes' = has user: tags; 'no' = untagged */
  /** Manual stack presence: undefined/'all' | 'yes' | 'no' */
  hasStack?: 'all' | 'yes' | 'no';
  hasKeywords?: 'all' | 'yes' | 'no';
  /** Virtual copies: undefined/'all' | 'yes' | 'no' */
  virtualCopies?: 'all' | 'yes' | 'no';
}

export interface Folder {
  children: any;
  id?: string | undefined;
  name?: string | undefined;
  imageCount?: number;
}

export interface ImageFile {
  is_edited: boolean;
  modified: number;
  path: string;
  rating: number;
  tags: Array<string> | null;
  exif: { [key: string]: string } | null;
  is_virtual_copy: boolean;
  is_cloud_placeholder: boolean;
  is_raw: boolean;
  group_id: string | null;
  /** Optional pixel size when known (orientation filters prefer these). */
  width?: number;
  height?: number;
}

export interface Option {
  color?: string;
  disabled?: boolean;
  icon?: any;
  isDestructive?: boolean;
  label?: string;
  onClick?(): void;
  onRightClick?(): void;
  shortcut?: string;
  submenu?: any;
  type?: string;
}

export enum Orientation {
  Horizontal = 'horizontal',
  Vertical = 'vertical',
}

export interface Preset {
  adjustments: Partial<Adjustments>;
  folder?: Folder;
  id: string;
  name: string;
  includeMasks?: boolean;
  includeCropTransform?: boolean;
  presetType?: 'tool' | 'style';
  /** LR crs:Group when exporting XMP (optional) */
  group?: string | null;
}

export interface Progress {
  completed?: number;
  current?: number;
  total: number;
}

export interface SelectedImage {
  exif: any;
  group_id?: string | null;
  height: number;
  isRaw: boolean;
  isReady: boolean;
  metadata?: any;
  original_base64?: string;
  originalUrl: string | null;
  path: string;
  thumbnailUrl: string;
  width: number;
}

export interface SortCriteria {
  key: string;
  label?: string;
  order: string;
}

export interface SupportedTypes {
  nonRaw: Array<string>;
  raw: Array<string>;
}

export enum LibraryDisplayMode {
  Grid = 'grid',
  Cull = 'cull',
  List = 'list',
  Compare = 'compare',
  Survey = 'survey',
  Loupe = 'loupe',
}

export enum ThumbnailSize {
  Large = 'large',
  Medium = 'medium',
  Small = 'small',
}

export interface TransformState {
  positionX: number;
  positionY: number;
  scale: number;
}

export interface UiVisibility {
  folderTree: boolean;
  filmstrip: boolean;
  developLeft: boolean;
  /** Library right rail (Histogram / QD / Keywording / Metadata) */
  libraryRight?: boolean;
}

export interface WaveformData {
  blue: string;
  green: string;
  height: number;
  luma: string;
  red: string;
  rgb: string;
  parade: string;
  vectorscope: string;
  width: number;
}

export interface CullingSettings {
  similarityThreshold: number;
  blurThreshold: number;
  groupSimilar: boolean;
  filterBlurry: boolean;
}

export interface ImageAnalysisResult {
  path: string;
  qualityScore: number;
  sharpnessMetric: number;
  centerFocusMetric: number;
  exposureMetric: number;
  width: number;
  height: number;
}

export interface CullGroup {
  representative: ImageAnalysisResult;
  duplicates: ImageAnalysisResult[];
}

export interface CullingSuggestions {
  similarGroups: CullGroup[];
  blurryImages: ImageAnalysisResult[];
  failedPaths: string[];
}

export interface KeybindHandler {
  shouldFire?: () => boolean;
  execute: (event: KeyboardEvent) => void;
}

export type AlbumItem = Album | AlbumGroup;

export interface Album {
  type: 'album';
  id: string;
  name: string;
  icon?: string;
  images: string[];
}

export interface AlbumGroup {
  type: 'group';
  id: string;
  name: string;
  icon?: string;
  children: AlbumItem[];
}
