import { useState, useMemo, useCallback } from 'react';
import { ExportPreset, WatermarkAnchor } from '../components/ui/ExportImportProperties';

export function useExportSettings() {
  const [fileFormat, setFileFormat] = useState('jpeg');
  const [jpegQuality, setJpegQuality] = useState(90);
  const [enableResize, setEnableResize] = useState(false);
  const [resizeMode, setResizeMode] = useState('longEdge');
  const [resizeValue, setResizeValue] = useState(2048);
  const [dontEnlarge, setDontEnlarge] = useState(true);
  const [keepMetadata, setKeepMetadata] = useState(true);
  const [preserveTimestamps, setPreserveTimestamps] = useState(false);
  const [stripGps, setStripGps] = useState(true);
  const [exportMasks, setExportMasks] = useState(false);
  const [preserveFolders, setPreserveFolders] = useState(false);
  const [filenameTemplate, setFilenameTemplate] = useState('{original_filename}_edited');
  const [colorSpace, setColorSpace] = useState('srgb');
  const [outputSharpening, setOutputSharpening] = useState('screen');
  const [resolutionDpi, setResolutionDpi] = useState(240);
  const [limitFileSizeKb, setLimitFileSizeKb] = useState<number | null>(null);
  const [bitDepth, setBitDepth] = useState<8 | 16>(8);
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkPath, setWatermarkPath] = useState<string | null>(null);
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkTextColor, setWatermarkTextColor] = useState('#FFFFFF');
  const [watermarkAnchor, setWatermarkAnchor] = useState<WatermarkAnchor>(WatermarkAnchor.BottomRight);
  const [watermarkScale, setWatermarkScale] = useState(10);
  const [watermarkSpacing, setWatermarkSpacing] = useState(5);
  const [watermarkOpacity, setWatermarkOpacity] = useState(75);
  const [watermarkMode, setWatermarkMode] = useState<'unique' | 'multiple'>('unique');

  const handleApplyPreset = useCallback((preset: ExportPreset) => {
    setFileFormat(preset.fileFormat);
    setJpegQuality(preset.jpegQuality);
    setEnableResize(preset.enableResize);
    setResizeMode(preset.resizeMode);
    setResizeValue(preset.resizeValue);
    setDontEnlarge(preset.dontEnlarge);
    setKeepMetadata(preset.keepMetadata);
    setPreserveTimestamps(preset.preserveTimestamps ?? false);
    setStripGps(preset.stripGps);
    setExportMasks(preset.exportMasks ?? false);
    setPreserveFolders(preset.preserveFolders ?? false);
    setFilenameTemplate(preset.filenameTemplate);
    setColorSpace(preset.colorSpace || 'srgb');
    setOutputSharpening(preset.outputSharpening || 'screen');
    setResolutionDpi(preset.resolutionDpi || 240);
    setLimitFileSizeKb(preset.limitFileSizeKb ?? null);
    setBitDepth(preset.bitDepth === 16 ? 16 : 8);
    setEnableWatermark(preset.enableWatermark);
    setWatermarkPath(preset.watermarkPath);
    setWatermarkText(preset.watermarkText || '');
    setWatermarkTextColor(preset.watermarkTextColor || '#FFFFFF');
    setWatermarkAnchor(preset.watermarkAnchor as WatermarkAnchor);
    setWatermarkScale(preset.watermarkScale);
    setWatermarkSpacing(preset.watermarkSpacing);
    setWatermarkOpacity(preset.watermarkOpacity);
    setWatermarkMode(preset.watermarkMode === 'multiple' ? 'multiple' : 'unique');
  }, []);

  const currentSettingsObject = useMemo(
    () => ({
      fileFormat,
      jpegQuality,
      enableResize,
      resizeMode,
      resizeValue,
      dontEnlarge,
      keepMetadata,
      preserveTimestamps,
      stripGps,
      exportMasks,
      preserveFolders,
      filenameTemplate,
      colorSpace,
      outputSharpening,
      resolutionDpi,
      limitFileSizeKb,
      bitDepth,
      enableWatermark,
      watermarkPath,
      watermarkText,
      watermarkTextColor,
      watermarkAnchor,
      watermarkScale,
      watermarkSpacing,
      watermarkOpacity,
      watermarkMode,
    }),
    [
      fileFormat,
      jpegQuality,
      enableResize,
      resizeMode,
      resizeValue,
      dontEnlarge,
      keepMetadata,
      preserveTimestamps,
      stripGps,
      exportMasks,
      preserveFolders,
      filenameTemplate,
      colorSpace,
      outputSharpening,
      resolutionDpi,
      limitFileSizeKb,
      bitDepth,
      enableWatermark,
      watermarkPath,
      watermarkText,
      watermarkTextColor,
      watermarkAnchor,
      watermarkScale,
      watermarkSpacing,
      watermarkOpacity,
      watermarkMode,
    ]
  );

  return {
    fileFormat,
    setFileFormat,
    jpegQuality,
    setJpegQuality,
    enableResize,
    setEnableResize,
    resizeMode,
    setResizeMode,
    resizeValue,
    setResizeValue,
    dontEnlarge,
    setDontEnlarge,
    keepMetadata,
    setKeepMetadata,
    preserveTimestamps,
    setPreserveTimestamps,
    stripGps,
    setStripGps,
    exportMasks,
    setExportMasks,
    preserveFolders,
    setPreserveFolders,
    filenameTemplate,
    setFilenameTemplate,
    colorSpace,
    setColorSpace,
    outputSharpening,
    setOutputSharpening,
    resolutionDpi,
    setResolutionDpi,
    limitFileSizeKb,
    setLimitFileSizeKb,
    bitDepth,
    setBitDepth,
    enableWatermark,
    setEnableWatermark,
    watermarkPath,
    setWatermarkPath,
    watermarkText,
    setWatermarkText,
    watermarkTextColor,
    setWatermarkTextColor,
    watermarkAnchor,
    setWatermarkAnchor,
    watermarkScale,
    setWatermarkScale,
    watermarkSpacing,
    setWatermarkSpacing,
    watermarkOpacity,
    setWatermarkOpacity,
    watermarkMode,
    setWatermarkMode,
    handleApplyPreset,
    currentSettingsObject,
  };
}