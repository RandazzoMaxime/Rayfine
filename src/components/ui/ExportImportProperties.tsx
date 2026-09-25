import { Progress } from './AppProperties';

export const EXPORT_TIMEOUT = 4000;
export const IMPORT_TIMEOUT = 5000;

export enum FileFormats {
  Original = 'original',
  Jpeg = 'jpeg',
  Png = 'png',
  Tiff = 'tiff',
  Webp = 'webp',
  Jxl = 'jxl',
  Avif = 'avif',
  Cube = 'cube',
}

export const FILE_FORMATS: Array<FileFormat> = [
  { id: FileFormats.Original, name: 'Original', extensions: ['original'] },
  { id: FileFormats.Jpeg, name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { id: FileFormats.Png, name: 'PNG', extensions: ['png'] },
  { id: FileFormats.Tiff, name: 'TIFF', extensions: ['tiff'] },
  { id: FileFormats.Webp, name: 'WebP', extensions: ['webp'] },
  { id: FileFormats.Jxl, name: 'JPEG XL', extensions: ['jxl'] },
  { id: FileFormats.Avif, name: 'AVIF', extensions: ['avif'] },
  { id: FileFormats.Cube, name: 'CUBE LUT', extensions: ['cube'] },
];

export const FILENAME_VARIABLES: Array<string> = [
  '{original_filename}',
  '{sequence}',
  '{YYYY}',
  '{MM}',
  '{DD}',
  '{hh}',
  '{mm}',
  '{ss}',
  '{YYYYMMDD}',
  '{folder}',
];

export interface ExportSettings {
  filenameTemplate: string | null;
  jpegQuality: number;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  resize: {
    mode: string;
    value: number;
    dontEnlarge: boolean;
  } | null;
  stripGps: boolean;
  watermark: WatermarkSettings | null;
  exportMasks?: boolean;
  preserveFolders?: boolean;
  /**
   * Output color space for export metadata / future conversion.
   * Values: 'srgb' | 'adobe-rgb' | 'display-p3' | 'prophoto'
   */
  colorSpace?: string;
  /**
   * Output sharpening preset after resize.
   * Values: 'none' | 'screen' | 'matte' | 'glossy'
   */
  outputSharpening?: string;
  /** Output resolution in DPI (EXIF X/YResolution). Common: 72, 240, 300 */
  resolutionDpi?: number;
  /** When set, iteratively lower quality so file stays under this many KB (JPEG/WebP/JXL). */
  limitFileSizeKb?: number | null;
  /** 8 or 16. 16-bit is PNG/TIFF only. */
  bitDepth?: 8 | 16;
}

export enum WatermarkAnchor {
  TopLeft = 'topLeft',
  TopCenter = 'topCenter',
  TopRight = 'topRight',
  CenterLeft = 'centerLeft',
  Center = 'center',
  CenterRight = 'centerRight',
  BottomLeft = 'bottomLeft',
  BottomCenter = 'bottomCenter',
  BottomRight = 'bottomRight',
}

export interface WatermarkSettings {
  path?: string | null;
  anchor: WatermarkAnchor;
  scale: number;
  spacing: number;
  opacity: number;
  text?: string | null;
  textColor?: string | null;
  /** unique = one stamp; multiple = tiled grid */
  mode?: 'unique' | 'multiple' | null;
}

export interface ExportState {
  errorMessage: string;
  progress: Progress;
  status: Status;
}

export interface FileFormat {
  extensions: Array<string>;
  id: string;
  name: string;
}

export interface ImportState {
  errorMessage: string;
  path?: string;
  progress?: Progress;
  status: Status;
}

export enum Status {
  Cancelled = 'cancelled',
  Cancelling = 'cancelling',
  Exporting = 'exporting',
  Error = 'error',
  Idle = 'idle',
  Importing = 'importing',
  Success = 'success',
}

export interface ExportPreset {
  id: string;
  name: string;
  /** User folder / group in the export dialog (e.g. EXPORT). */
  folder?: string;
  /** Destination folder for this preset. */
  exportFolder?: string;
  putInSubfolder?: boolean;
  subfolderName?: string;
  existingFiles?: 'overwrite' | 'skip' | 'ask';
  renameEnabled?: boolean;
  extensionCase?: 'upper' | 'lower';
  metadataInclude?: 'all' | 'copyright' | 'copyrightContact' | 'allExceptCamera' | 'none';
  fileFormat: string;
  jpegQuality: number;
  enableResize: boolean;
  resizeMode: string;
  resizeValue: number;
  dontEnlarge: boolean;
  keepMetadata: boolean;
  preserveTimestamps: boolean;
  stripGps: boolean;
  exportMasks?: boolean;
  preserveFolders?: boolean;
  colorSpace?: string;
  outputSharpening?: string;
  resolutionDpi?: number;
  limitFileSizeKb?: number | null;
  filenameTemplate: string;
  enableWatermark: boolean;
  watermarkPath: string | null;
  watermarkText?: string | null;
  watermarkTextColor?: string | null;
  watermarkAnchor: string;
  watermarkScale: number;
  watermarkSpacing: number;
  watermarkOpacity: number;
  watermarkMode?: 'unique' | 'multiple';
  bitDepth?: 8 | 16;
  lastExportPath?: string;
}
