import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { FileInput, CheckCircle, XCircle, Loader, Ban, ChevronDown, ChevronRight, Settings, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import debounce from 'lodash.debounce';
import Switch from '../../ui/Switch';
import Button from '../../ui/Button';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import ImagePicker from '../../ui/ImagePicker';
import {
  ExportPreset,
  ExportSettings,
  FileFormat,
  FILE_FORMATS,
  FILENAME_VARIABLES,
  Status,
  ExportState,
  FileFormats,
  WatermarkAnchor,
} from '../../ui/ExportImportProperties';
import { Invokes, SelectedImage, AppSettings } from '../../ui/AppProperties';
import ExportPresetsList from '../../ui/ExportPresetsList';
import { useExportSettings } from '../../../hooks/useExportSettings';
import { useOsPlatform } from '../../../hooks/useOsPlatform';
import Text from '../../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';

interface ExportPanelProps {
  exportState: ExportState;
  multiSelectedPaths: Array<string>;
  selectedImage: SelectedImage | null;
  setExportState(state: any): void;
  appSettings: AppSettings | null;
  onSettingsChange: (settings: AppSettings) => void;
  rootPaths: string[];
  isVisible?: boolean;
  onClose?: () => void;
}

interface SectionProps {
  children: any;
  title: string;
}

function Section({ title, children }: SectionProps) {
  return (
    <div>
      <Text variant={TextVariants.heading} className="mb-2">
        {title}
      </Text>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function WatermarkPreview({
  anchor,
  scale,
  spacing,
  opacity,
  watermarkPath,
  imageAspectRatio,
  watermarkImageAspectRatio,
}: {
  anchor: WatermarkAnchor;
  scale: number;
  spacing: number;
  opacity: number;
  watermarkPath: string | null;
  imageAspectRatio: number;
  watermarkImageAspectRatio: number;
}) {
  const { t } = useTranslation();

  const getPositionStyles = () => {
    const minDimPercent = imageAspectRatio > 1 ? 100 / imageAspectRatio : 100;
    const watermarkSizePercent = minDimPercent * (scale / 100);
    const spacingPercent = minDimPercent * (spacing / 100);

    const styles: React.CSSProperties = {
      width: `${watermarkSizePercent}%`,
      opacity: opacity / 100,
      position: 'absolute',
    };

    const spacingString = `${spacingPercent}%`;

    switch (anchor) {
      case WatermarkAnchor.TopLeft:
        styles.top = spacingString;
        styles.left = spacingString;
        break;
      case WatermarkAnchor.TopCenter:
        styles.top = spacingString;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case WatermarkAnchor.TopRight:
        styles.top = spacingString;
        styles.right = spacingString;
        break;
      case WatermarkAnchor.CenterLeft:
        styles.top = '50%';
        styles.left = spacingString;
        styles.transform = 'translateY(-50%)';
        break;
      case WatermarkAnchor.Center:
        styles.top = '50%';
        styles.left = '50%';
        styles.transform = 'translate(-50%, -50%)';
        break;
      case WatermarkAnchor.CenterRight:
        styles.top = '50%';
        styles.right = spacingString;
        styles.transform = 'translateY(-50%)';
        break;
      case WatermarkAnchor.BottomLeft:
        styles.bottom = spacingString;
        styles.left = spacingString;
        break;
      case WatermarkAnchor.BottomCenter:
        styles.bottom = spacingString;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case WatermarkAnchor.BottomRight:
        styles.bottom = spacingString;
        styles.right = spacingString;
        break;
    }
    return styles;
  };

  return (
    <div
      className="w-full bg-surface rounded-md relative overflow-hidden border border-surface"
      style={{ aspectRatio: imageAspectRatio }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Text variant={TextVariants.label}>{t('export.watermark.previewText')}</Text>
      </div>
      {watermarkPath && (
        <div style={getPositionStyles()}>
          <div
            className="w-full bg-accent/50 border-2 border-dashed border-accent rounded-xs flex items-center justify-center"
            style={{ aspectRatio: watermarkImageAspectRatio }}
          >
            <span className="text-white text-[8px] font-bold">{t('export.watermark.logoText')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const formatBytes = (bytes: number, t: any, decimals = 2) => {
  if (!+bytes) return `0 ${t('export.bytes.bytes')}`;
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = [
    t('export.bytes.bytes'),
    t('export.bytes.kb'),
    t('export.bytes.mb'),
    t('export.bytes.gb'),
    t('export.bytes.tb'),
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export default function ExportPanel({
  exportState,
  multiSelectedPaths,
  selectedImage,
  setExportState,
  appSettings,
  onSettingsChange,
  rootPaths,
  isVisible = true,
  onClose,
}: ExportPanelProps) {
  const { t } = useTranslation();

  const resizeModeOptions = useMemo(
    () => [
      { label: t('export.resize.modes.longEdge'), value: 'longEdge' },
      { label: t('export.resize.modes.shortEdge'), value: 'shortEdge' },
      { label: t('export.resize.modes.width'), value: 'width' },
      { label: t('export.resize.modes.height'), value: 'height' },
    ],
    [t],
  );

  const {
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
    enableWatermark,
    setEnableWatermark,
    watermarkMode,
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
    preserveFolders,
    setPreserveFolders,
    handleApplyPreset,
    currentSettingsObject,
  } = useExportSettings();

  const adjustmentsRef = useRef(useEditorStore.getState().adjustments);

  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  const initDone = useRef(false);

  useEffect(() => {
    if (initDone.current || appSettings === null || !isVisible) return;
    initDone.current = true;
    const lastUsed = appSettings.exportPresets?.find((p) => p.id === '__last_used__');
    if (lastUsed) {
      handleApplyPreset(lastUsed);
    }
  }, [appSettings, handleApplyPreset, isVisible]);

  const saveLastUsedPreset = useCallback(
    (exportPath: string) => {
      if (!appSettings) return;
      const lastUsedPreset: ExportPreset = {
        ...currentSettingsObject,
        id: '__last_used__',
        name: '__last_used__',
        lastExportPath: exportPath,
      };
      const updatedPresets = [
        ...(appSettings.exportPresets ?? []).filter((p) => p.id !== '__last_used__'),
        lastUsedPreset,
      ];
      onSettingsChange({ ...appSettings, exportPresets: updatedPresets });
    },
    [appSettings, currentSettingsObject, onSettingsChange],
  );

  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);
  const [lastExportOutput, setLastExportOutput] = useState<string | null>(null);
  const [revealAfterExport, setRevealAfterExport] = useState(() => {
    try {
      return localStorage.getItem('rustroom.export.revealAfter') !== '0';
    } catch {
      return true;
    }
  });
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [watermarkImageAspectRatio, setWatermarkImageAspectRatio] = useState(1);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const filenameInputRef = useRef<HTMLInputElement>(null);
  const osPlatform = useOsPlatform();
  const isAndroid = osPlatform === 'android';

  const { status, progress, errorMessage } = exportState;

  useEffect(() => {
    if (status !== Status.Success || !revealAfterExport || !lastExportOutput || isAndroid) return;
    invoke(Invokes.ShowInFinder, { path: lastExportOutput }).catch(() => {});
  }, [status, revealAfterExport, lastExportOutput, isAndroid]);
  const isExporting = [Status.Exporting, Status.Cancelling].includes(status);
  const isCancelling = status === Status.Cancelling;
  const isLibraryContext = !!onClose;

  const pathsToExport = isLibraryContext
    ? multiSelectedPaths
    : multiSelectedPaths.length > 0
      ? multiSelectedPaths
      : selectedImage
        ? [selectedImage.path]
        : [];
  const numImages = pathsToExport.length;

  useEffect(() => {
    const fetchDims = async () => {
      if (!enableWatermark || numImages === 0 || !isVisible) return;
      if (!isLibraryContext && selectedImage && selectedImage.width && selectedImage.height) {
        setImageAspectRatio(selectedImage.width / selectedImage.height);
        return;
      }
      try {
        const dims: any = await invoke('get_image_dimensions', { path: pathsToExport[0] });
        if (dims.width > 0 && dims.height > 0) setImageAspectRatio(dims.width / dims.height);
      } catch {
        setImageAspectRatio(3 / 2);
      }
    };
    fetchDims();
  }, [pathsToExport, isLibraryContext, selectedImage, enableWatermark, numImages, isVisible]);

  useEffect(() => {
    const fetchWatermarkDimensions = async () => {
      if (!watermarkPath) {
        setWatermarkImageAspectRatio(1);
        return;
      }
      try {
        const dimensions: { width: number; height: number } = await invoke('get_image_dimensions', {
          path: watermarkPath,
        });
        setWatermarkImageAspectRatio(dimensions.height > 0 ? dimensions.width / dimensions.height : 1);
      } catch (error) {
        setWatermarkImageAspectRatio(1);
      }
    };
    fetchWatermarkDimensions();
  }, [watermarkPath]);

  const anchorOptions = useMemo(
    () => [
      { label: t('export.watermark.anchors.topLeft'), value: WatermarkAnchor.TopLeft },
      { label: t('export.watermark.anchors.topCenter'), value: WatermarkAnchor.TopCenter },
      { label: t('export.watermark.anchors.topRight'), value: WatermarkAnchor.TopRight },
      { label: t('export.watermark.anchors.centerLeft'), value: WatermarkAnchor.CenterLeft },
      { label: t('export.watermark.anchors.center'), value: WatermarkAnchor.Center },
      { label: t('export.watermark.anchors.centerRight'), value: WatermarkAnchor.CenterRight },
      { label: t('export.watermark.anchors.bottomLeft'), value: WatermarkAnchor.BottomLeft },
      { label: t('export.watermark.anchors.bottomCenter'), value: WatermarkAnchor.BottomCenter },
      { label: t('export.watermark.anchors.bottomRight'), value: WatermarkAnchor.BottomRight },
    ],
    [t],
  );

  const debouncedEstimateSize = useMemo(
    () =>
      debounce(async (paths, currentAdj, currentPath, exportSettings, format) => {
        if (paths.length === 0 || !isVisible) {
          setEstimatedSize(null);
          return;
        }
        setIsEstimating(true);
        try {
          const size: number = await invoke(Invokes.EstimateExportSizes, {
            paths,
            exportSettings,
            outputFormat: format,
            currentEditPath: currentPath || null,
            currentEditAdjustments: currentAdj || null,
          });
          setEstimatedSize(size);
        } catch (err) {
          setEstimatedSize(null);
        } finally {
          setIsEstimating(false);
        }
      }, 500),
    [isVisible],
  );

  useEffect(() => {
    const exportSettings: ExportSettings = {
      filenameTemplate,
      jpegQuality,
      keepMetadata,
      preserveTimestamps,
      preserveFolders,
      resize: enableResize ? { mode: resizeMode, value: resizeValue, dontEnlarge } : null,
      stripGps,
      colorSpace,
      outputSharpening,
      resolutionDpi,
      limitFileSizeKb: limitFileSizeKb || undefined,
      bitDepth,
      exportMasks: !isLibraryContext ? exportMasks : undefined,
      watermark:
        enableWatermark && (watermarkPath || (watermarkText && watermarkText.trim()))
          ? {
            path: watermarkPath || null,
            text: watermarkText?.trim() || null,
            textColor: watermarkTextColor || '#FFFFFF',
            anchor: watermarkAnchor,
            scale: watermarkScale,
            spacing: watermarkSpacing,
            opacity: watermarkOpacity,
            mode: watermarkMode,
          }
          : null,
    };
    const format = FILE_FORMATS.find((f: FileFormat) => f.id === fileFormat)?.extensions[0] || 'jpeg';
    const runEstimate = () =>
      debouncedEstimateSize(pathsToExport, adjustmentsRef.current, selectedImage?.path, exportSettings, format);

    runEstimate();
    const unsubscribe = useEditorStore.subscribe((state) => {
      adjustmentsRef.current = state.adjustments;
      runEstimate();
    });

    return () => {
      unsubscribe();
      debouncedEstimateSize.cancel();
    };
  }, [
    pathsToExport,
    selectedImage?.path,
    fileFormat,
    jpegQuality,
    enableResize,
    resizeMode,
    resizeValue,
    dontEnlarge,
    keepMetadata,
    preserveTimestamps,
    stripGps,
    filenameTemplate,
    enableWatermark,
    watermarkMode,
    watermarkPath,
    watermarkAnchor,
    watermarkScale,
    watermarkSpacing,
    watermarkOpacity,
    debouncedEstimateSize,
    exportMasks,
    preserveFolders,
    isLibraryContext,
    colorSpace,
    outputSharpening,
    resolutionDpi,
    limitFileSizeKb,
  ]);

  const handleVariableClick = (variable: string) => {
    if (!filenameInputRef.current) return;
    const input: HTMLInputElement = filenameInputRef.current;
    const start = Number(input.selectionStart);
    const end = Number(input.selectionEnd);
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setFilenameTemplate(newValue);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const handleExport = async () => {
    if (numImages === 0 || isExporting) return;

    let finalFilenameTemplate = filenameTemplate;
    if (
      numImages > 1 &&
      !filenameTemplate.includes('{sequence}') &&
      !filenameTemplate.includes('{original_filename}')
    ) {
      finalFilenameTemplate = `${filenameTemplate}_{sequence}`;
      setFilenameTemplate(finalFilenameTemplate);
    }

    const exportSettings: ExportSettings = {
      filenameTemplate: finalFilenameTemplate,
      jpegQuality,
      keepMetadata,
      preserveTimestamps,
      preserveFolders,
      resize: enableResize ? { mode: resizeMode, value: resizeValue, dontEnlarge } : null,
      stripGps,
      colorSpace,
      outputSharpening,
      resolutionDpi,
      limitFileSizeKb: limitFileSizeKb || undefined,
      bitDepth,
      exportMasks: !isLibraryContext ? exportMasks : undefined,
      watermark:
        enableWatermark && (watermarkPath || (watermarkText && watermarkText.trim()))
          ? {
            path: watermarkPath || null,
            text: watermarkText?.trim() || null,
            textColor: watermarkTextColor || '#FFFFFF',
            anchor: watermarkAnchor,
            scale: watermarkScale,
            spacing: watermarkSpacing,
            opacity: watermarkOpacity,
            mode: watermarkMode,
          }
          : null,
    };

    const lastExportPath = appSettings?.exportPresets?.find((p) => p.id === '__last_used__')?.lastExportPath;

    try {
      const selectedFormat: any = FILE_FORMATS.find((f) => f.id === fileFormat);

      let outputFolderOrFile = '';
      const shouldChooseOutputFile = numImages === 1 && !preserveFolders;
      if (shouldChooseOutputFile) {
        const originalFilename = pathsToExport[0].split(/[\\/]/).pop() || '';
        const stem = originalFilename.substring(0, originalFilename.lastIndexOf('.')) || originalFilename;
        const suggestedName = finalFilenameTemplate.replace('{original_filename}', stem);
        const outputFileName = `${suggestedName}.${selectedFormat.extensions[0]}`;

        outputFolderOrFile = isAndroid
          ? outputFileName
          : ((await save({
              title: t('export.dialog.saveEditedImageTitle'),
              defaultPath: lastExportPath ? `${lastExportPath}/${outputFileName}` : outputFileName,
              filters: [
                { name: selectedFormat.name, extensions: selectedFormat.extensions },
                ...FILE_FORMATS.filter((f: FileFormat) => f.id !== fileFormat).map((f: FileFormat) => ({
                  name: f.name,
                  extensions: f.extensions,
                })),
              ],
            })) as string);
      } else {
        outputFolderOrFile = isAndroid
          ? ''
          : ((await open({
              title: t('export.dialog.selectFolderTitle', { count: numImages }),
              directory: true,
              defaultPath: lastExportPath ?? undefined,
            })) as string);
      }

      if (isAndroid || outputFolderOrFile) {
        if (!isAndroid) {
          const dir = shouldChooseOutputFile
            ? outputFolderOrFile.substring(
                0,
                Math.max(outputFolderOrFile.lastIndexOf('/'), outputFolderOrFile.lastIndexOf('\\')),
              )
            : outputFolderOrFile;
          if (dir) saveLastUsedPreset(dir);
        }

        setLastExportOutput(outputFolderOrFile || null);
        setExportState({ status: Status.Exporting, progress: { current: 0, total: numImages }, errorMessage: '' });
        await invoke(Invokes.ExportImages, {
          paths: pathsToExport,
          outputFolderOrFile: outputFolderOrFile,
          isExplicitFilePath: shouldChooseOutputFile,
          baseOriginFolders: rootPaths,
          exportSettings,
          outputFormat: selectedFormat.extensions[0],
          currentEditPath: selectedImage?.path || null,
          currentEditAdjustments: adjustmentsRef.current || null,
        });
      }
    } catch (error) {
      setExportState({
        errorMessage: typeof error === 'string' ? error : t('export.status.failed'),
        progress,
        status: Status.Error,
      });
    }
  };


  // Export with Previous (Ctrl+Alt+Shift+W): last settings + last folder, skip dialog when possible
  const runExportPrevious = useCallback(() => {
    if (isExporting) return;
    try {
      sessionStorage.removeItem('rustroom.export.previous');
    } catch {
      /* ignore */
    }
    const lastUsed = appSettings?.exportPresets?.find((p) => p.id === '__last_used__');
    if (lastUsed) {
      handleApplyPreset(lastUsed);
    }
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('rustroom:export-previous-go'));
      } catch {
        /* ignore */
      }
    }, 50);
  }, [appSettings, handleApplyPreset, isExporting]);

  useEffect(() => {
    const onPrev = () => runExportPrevious();
    window.addEventListener('rustroom:export-previous', onPrev as EventListener);
    return () => window.removeEventListener('rustroom:export-previous', onPrev as EventListener);
  }, [runExportPrevious]);

  // If panel just opened after export_previous keybind, consume pending flag
  useEffect(() => {
    if (!isVisible || isExporting) return;
    try {
      if (sessionStorage.getItem('rustroom.export.previous') === '1') {
        runExportPrevious();
      }
    } catch {
      /* ignore */
    }
  }, [isVisible, isExporting, runExportPrevious]);

  useEffect(() => {
    const onGo = async () => {
      if (isExporting || numImages === 0) return;
      const lastExportPath = appSettings?.exportPresets?.find((p) => p.id === '__last_used__')?.lastExportPath;
      if (!lastExportPath) {
        // Fall back to normal export (will prompt)
        handleExport();
        return;
      }
      // Build settings from current (just applied last-used)
      let finalFilenameTemplate = filenameTemplate;
      if (
        numImages > 1 &&
        !filenameTemplate.includes('{sequence}') &&
        !filenameTemplate.includes('{original_filename}')
      ) {
        finalFilenameTemplate = `${filenameTemplate}_{sequence}`;
      }
      const exportSettings: ExportSettings = {
        filenameTemplate: finalFilenameTemplate,
        jpegQuality,
        keepMetadata,
        preserveTimestamps,
        preserveFolders,
        resize: enableResize ? { mode: resizeMode, value: resizeValue, dontEnlarge } : null,
        stripGps,
        colorSpace,
        outputSharpening,
        resolutionDpi,
        limitFileSizeKb: limitFileSizeKb || undefined,
      bitDepth,
        exportMasks: !isLibraryContext ? exportMasks : undefined,
        watermark:
          enableWatermark && (watermarkPath || (watermarkText && watermarkText.trim()))
            ? {
              path: watermarkPath || null,
              text: watermarkText?.trim() || null,
              textColor: watermarkTextColor || '#FFFFFF',
              anchor: watermarkAnchor,
              scale: watermarkScale,
              spacing: watermarkSpacing,
              opacity: watermarkOpacity,
            }
            : null,
      };
      const selectedFormat: any = FILE_FORMATS.find((f) => f.id === fileFormat);
      try {
        setLastExportOutput(lastExportPath);
        setExportState({
          status: Status.Exporting,
          progress: { current: 0, total: numImages },
          errorMessage: '',
        });
        await invoke(Invokes.ExportImages, {
          paths: pathsToExport,
          outputFolderOrFile: lastExportPath,
          isExplicitFilePath: false,
          baseOriginFolders: rootPaths,
          exportSettings,
          outputFormat: selectedFormat?.extensions?.[0] || 'jpg',
          currentEditPath: selectedImage?.path || null,
          currentEditAdjustments: adjustmentsRef.current || null,
        });
        saveLastUsedPreset(lastExportPath);
      } catch (error) {
        setExportState({
          errorMessage: typeof error === 'string' ? error : t('export.status.failed'),
          progress,
          status: Status.Error,
        });
      }
    };
    window.addEventListener('rustroom:export-previous-go', onGo as EventListener);
    return () => window.removeEventListener('rustroom:export-previous-go', onGo as EventListener);
  });

  const handleCancel = async () => {
    setExportState((current: ExportState) =>
      current.status === Status.Exporting ? { status: Status.Cancelling } : {},
    );
    try {
      await invoke(Invokes.CancelExport);
    } catch (error) {
      console.error('Failed to cancel:', error);
      setExportState((current: ExportState) =>
        current.status === Status.Cancelling ? { status: Status.Exporting } : {},
      );
    }
  };

  const canExport = numImages > 0;
  const isLut = fileFormat === FileFormats.Cube;
  const itemLabel = isLut ? t('export.labels.lut') : t('export.labels.image');
  const itemLabelPlural = isLut ? t('export.labels.lut_plural') : t('export.labels.image_plural');

  return (
    <div className={onClose ? 'h-full bg-bg-secondary rounded-lg flex flex-col' : 'flex flex-col h-full'}>
      <div className="px-3 py-2 flex justify-between items-center shrink-0 border-b border-border-color/40">
        <Text variant={TextVariants.title}>{t('export.title')}</Text>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary"
          >
            <X size={20} />
          </button>
        )}
      </div>
      <div className="grow overflow-y-auto p-4 space-y-8">
        {canExport ? (
          <>
            <div className={isExporting ? 'opacity-50 pointer-events-none' : ''}>
              <ExportPresetsList
                appSettings={appSettings}
                onSettingsChange={onSettingsChange}
                currentSettings={currentSettingsObject}
                onApplyPreset={handleApplyPreset}
              />
            </div>

            <Section title={t('export.sections.destinationPresets' as any, { defaultValue: 'Quick destinations' })}>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    [
                      'email',
                      t('export.dest.email' as any, { defaultValue: 'Email' }),
                      {
                        fileFormat: FileFormats.Jpeg,
                        jpegQuality: 75,
                        enableResize: true,
                        resizeMode: 'longEdge',
                        resizeValue: 2048,
                        colorSpace: 'srgb',
                        outputSharpening: 'screen',
                        resolutionDpi: 72,
                        limitFileSizeKb: 500,
                      },
                    ],
                    [
                      'web',
                      t('export.dest.web' as any, { defaultValue: 'Web' }),
                      {
                        fileFormat: FileFormats.Jpeg,
                        jpegQuality: 85,
                        enableResize: true,
                        resizeMode: 'longEdge',
                        resizeValue: 2560,
                        colorSpace: 'srgb',
                        outputSharpening: 'screen',
                        resolutionDpi: 72,
                      },
                    ],
                    [
                      'print',
                      t('export.dest.print' as any, { defaultValue: 'Print' }),
                      {
                        fileFormat: FileFormats.Jpeg,
                        jpegQuality: 95,
                        enableResize: false,
                        resizeValue: 3840,
                        colorSpace: 'adobe-rgb',
                        outputSharpening: 'matte',
                        resolutionDpi: 300,
                      },
                    ],
                    [
                      'full',
                      t('export.dest.full' as any, { defaultValue: 'Full Size' }),
                      {
                        fileFormat: FileFormats.Jpeg,
                        jpegQuality: 100,
                        enableResize: false,
                        colorSpace: 'srgb',
                        outputSharpening: 'none',
                        resolutionDpi: 240,
                      },
                    ],
                  ] as const
                ).map(([id, label, preset]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={isExporting}
                    onClick={() => {
                      setFileFormat(preset.fileFormat);
                      setJpegQuality(preset.jpegQuality);
                      setEnableResize(preset.enableResize);
                      if ('resizeMode' in preset && (preset as any).resizeMode) {
                        setResizeMode((preset as any).resizeMode);
                      }
                      if ('resizeValue' in preset && (preset as any).resizeValue) {
                        setResizeValue((preset as any).resizeValue);
                      }
                      setColorSpace(preset.colorSpace);
                      setOutputSharpening(preset.outputSharpening);
                      setResolutionDpi(preset.resolutionDpi);
                      setLimitFileSizeKb(
                        'limitFileSizeKb' in preset && (preset as any).limitFileSizeKb
                          ? (preset as any).limitFileSizeKb
                          : null,
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-md text-[11px] uppercase tracking-wide bg-surface text-text-secondary hover:bg-card-active hover:text-text-primary transition-colors disabled:opacity-50 border border-border-color/30"
                    data-tooltip={t('export.dest.tip' as any, {
                      defaultValue: 'Apply format, quality, resize, color, sharpen & DPI',
                    })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-text-secondary/50">
                {t('export.dest.hint' as any, {
                  defaultValue: 'LR-style quick destinations — adjust details below after applying.',
                })}
              </p>
            </Section>

            <Section title={t('export.sections.fileSettings')}>
              <div className="grid grid-cols-3 gap-2">
                {FILE_FORMATS.map((format: FileFormat) => (
                  <button
                    className={`px-2 py-1.5 rounded-md transition-colors ${fileFormat === format.id ? 'bg-accent' : 'bg-surface hover:bg-card-active'} disabled:opacity-50`}
                    disabled={isExporting}
                    key={format.id}
                    onClick={() => setFileFormat(format.id)}
                  >
                    <Text color={fileFormat === format.id ? TextColors.button : TextColors.secondary}>
                      {format.name}
                    </Text>
                  </button>
                ))}
              </div>
              {[FileFormats.Jpeg, FileFormats.Webp, FileFormats.Jxl].includes(fileFormat as FileFormats) && (
                <div className={isExporting ? 'opacity-50 pointer-events-none' : ''}>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {(
                      [
                        [100, t('export.file.qualityMax' as any, { defaultValue: 'Max' })],
                        [90, t('export.file.qualityHigh' as any, { defaultValue: 'High' })],
                        [75, t('export.file.qualityMed' as any, { defaultValue: 'Med' })],
                        [60, t('export.file.qualityLow' as any, { defaultValue: 'Low' })],
                      ] as const
                    ).map(([q, label]) => (
                      <button
                        key={q}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setJpegQuality(q)}
                        className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide transition-colors disabled:opacity-50 ${
                          jpegQuality === q
                            ? 'bg-accent text-button-text'
                            : 'bg-surface text-text-secondary hover:bg-card-active'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Slider
                    defaultValue={90}
                    label={
                      fileFormat === FileFormats.Jxl && jpegQuality === 100
                        ? t('export.file.qualityLossless')
                        : t('export.file.quality')
                    }
                    max={100}
                    min={1}
                    onChange={(e) => setJpegQuality(Number(e.target.value))}
                    step={1}
                    value={jpegQuality}
                    fillOrigin="min"
                  />
                </div>
              )}
              {fileFormat !== FileFormats.Cube && (
                <div className={isExporting ? 'opacity-50 pointer-events-none mt-2' : 'mt-2'}>
                  <Text variant={TextVariants.label} className="mb-1 block">
                    {t('export.file.colorSpace' as any, { defaultValue: 'Color space' })}
                  </Text>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        ['srgb', 'sRGB'],
                        ['adobe-rgb', 'Adobe RGB'],
                        ['display-p3', 'Display P3'],
                        ['prophoto', 'ProPhoto'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setColorSpace(id)}
                        className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wide transition-colors disabled:opacity-50 ${
                          colorSpace === id
                            ? 'bg-accent text-button-text'
                            : 'bg-surface text-text-secondary hover:bg-card-active'
                        }`}
                        data-tooltip={t('export.file.colorSpaceTip' as any, {
                          defaultValue:
                            'Tags EXIF ColorSpace; pixel conversion is best-effort (sRGB path today).',
                        })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Text variant={TextVariants.label} className="mb-1 mt-2 block">
                    {t('export.file.outputSharpening' as any, { defaultValue: 'Output sharpening' })}
                  </Text>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        ['none', 'None'],
                        ['screen', 'Screen'],
                        ['matte', 'Matte'],
                        ['glossy', 'Glossy'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setOutputSharpening(id)}
                        className={`px-2 py-1 rounded-md text-[10px] uppercase tracking-wide transition-colors disabled:opacity-50 ${
                          outputSharpening === id
                            ? 'bg-accent text-button-text'
                            : 'bg-surface text-text-secondary hover:bg-card-active'
                        }`}
                        data-tooltip={t('export.file.outputSharpeningTip' as any, {
                          defaultValue: 'Applied after resize (LR-style output sharpening)',
                        })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Text variant={TextVariants.label} className="mb-1 mt-2 block">
                    {t('export.file.resolution' as any, { defaultValue: 'Resolution (DPI)' })}
                  </Text>
                  <div className="flex flex-wrap gap-1">
                    {([72, 150, 240, 300] as const).map((dpi) => (
                      <button
                        key={dpi}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setResolutionDpi(dpi)}
                        className={`px-2 py-1 rounded-md text-[10px] tabular-nums transition-colors disabled:opacity-50 ${
                          resolutionDpi === dpi
                            ? 'bg-accent text-button-text'
                            : 'bg-surface text-text-secondary hover:bg-card-active'
                        }`}
                        data-tooltip={t('export.file.resolutionTip' as any, {
                          defaultValue: 'Writes EXIF X/YResolution (print/screen metadata)',
                        })}
                      >
                        {dpi}
                      </button>
                    ))}
                  </div>
                  {[FileFormats.Jpeg, FileFormats.Webp, FileFormats.Jxl].includes(fileFormat as FileFormats) && (
                    <>
                      <Text variant={TextVariants.label} className="mb-1 mt-2 block">
                        {t('export.file.limitSize' as any, {
                          defaultValue: 'Limit file size',
                        })}
                      </Text>
                      <div className="flex flex-wrap gap-1">
                        {(
                          [
                            [null, t('export.file.limitOff' as any, { defaultValue: 'Off' })],
                            [200, '200 KB'],
                            [500, '500 KB'],
                            [1024, '1 MB'],
                            [2048, '2 MB'],
                          ] as const
                        ).map(([kb, label]) => (
                          <button
                            key={String(kb)}
                            type="button"
                            disabled={isExporting}
                            onClick={() => setLimitFileSizeKb(kb)}
                            className={`px-2 py-1 rounded-md text-[10px] tabular-nums transition-colors disabled:opacity-50 ${
                              limitFileSizeKb === kb
                                ? 'bg-accent text-button-text'
                                : 'bg-surface text-text-secondary hover:bg-card-active'
                            }`}
                            data-tooltip={t('export.file.limitSizeTip' as any, {
                              defaultValue:
                                'LR-style: lower JPEG/WebP/JXL quality until under the limit (metadata size included).',
                            })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </Section>

            <Section title={t('export.sections.fileNaming')}>
              <input
                className="w-full bg-surface border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                disabled={isExporting}
                onChange={(e) => setFilenameTemplate(e.target.value)}
                ref={filenameInputRef}
                type="text"
                value={filenameTemplate}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {FILENAME_VARIABLES.map((variable: string) => (
                  <button
                    type="button"
                    className="px-2 py-1 bg-surface text-text-secondary text-[10px] rounded-md hover:bg-card-active transition-colors disabled:opacity-50 font-mono"
                    disabled={isExporting}
                    key={variable}
                    onClick={() => handleVariableClick(variable)}
                    data-tooltip={t('export.fileNaming.insertToken' as any, {
                      defaultValue: 'Insert token',
                    })}
                  >
                    {variable}
                  </button>
                ))}
              </div>
              {numImages <= 1 && (
                <p className="mt-1 text-[10px] text-text-secondary/50">
                  {t('export.fileNaming.singleHint' as any, {
                    defaultValue: 'Tokens apply on export; {sequence} is useful for batch jobs.',
                  })}
                </p>
              )}
            </Section>

            {fileFormat !== FileFormats.Cube && (
              <>
                <Section title={t('export.sections.imageSizing')}>
                  <Switch
                    label={t('export.resize.resizeToFit')}
                    checked={enableResize}
                    onChange={setEnableResize}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                  {enableResize && (
                    <div className="space-y-4 pl-2 border-l-2 border-surface">
                      <div className="flex items-center gap-2">
                        <Dropdown
                          options={resizeModeOptions}
                          value={resizeMode}
                          onChange={setResizeMode}
                          disabled={isExporting}
                          className="w-full"
                        />
                        <input
                          className="w-24 bg-surface text-center rounded-md p-2 border border-surface focus:border-accent focus:ring-accent text-text-secondary focus:text-text-primary"
                          disabled={isExporting}
                          min="1"
                          onChange={(e) => setResizeValue(parseInt(e?.target?.value))}
                          type="number"
                          value={resizeValue}
                        />
                        <Text variant={TextVariants.label}>{t('export.resize.pixels')}</Text>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {([2048, 2560, 3840, 5120] as const).map((px) => (
                          <button
                            key={px}
                            type="button"
                            disabled={isExporting}
                            onClick={() => {
                              setEnableResize(true);
                              setResizeValue(px);
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] tabular-nums transition-colors disabled:opacity-50 ${
                              enableResize && resizeValue === px
                                ? 'bg-accent text-button-text'
                                : 'bg-surface text-text-secondary hover:bg-card-active'
                            }`}
                          >
                            {px}px
                          </button>
                        ))}
                      </div>
                      <Switch
                        checked={dontEnlarge}
                        disabled={isExporting}
                        label={t('export.resize.dontEnlarge')}
                        onChange={setDontEnlarge}
                        trackClassName="bg-surface"
                      />
                    </div>
                  )}
                </Section>

                {fileFormat == FileFormats.Jpeg && (
                  <Section title={t('export.sections.metadata')}>
                    <Switch
                      checked={keepMetadata}
                      disabled={isExporting}
                      label={t('export.metadata.saveWithMetadata')}
                      onChange={setKeepMetadata}
                      trackClassName="bg-surface"
                    />
                    {keepMetadata && (
                      <div className="pl-2 border-l-2 border-surface">
                        <Switch
                          label={t('export.metadata.removeGps')}
                          checked={stripGps}
                          onChange={setStripGps}
                          disabled={isExporting}
                          trackClassName="bg-surface"
                        />
                      </div>
                    )}

                <div className="mt-2">
                  <Switch
                    label={t('export.revealAfter' as any, { defaultValue: 'Show in folder after export' })}
                    checked={revealAfterExport}
                    onChange={(v: boolean) => {
                      setRevealAfterExport(v);
                      try {
                        localStorage.setItem('rustroom.export.revealAfter', v ? '1' : '0');
                      } catch {
                        /* ignore */
                      }
                    }}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                </div>
                  </Section>
                )}

                <Section title={t('export.sections.watermark')}>
                  <Switch
                    label={t('export.watermark.addWatermark')}
                    checked={enableWatermark}
                    onChange={setEnableWatermark}
                    disabled={isExporting}
                    trackClassName="bg-surface"
                  />
                  {enableWatermark && (
                    <div className="space-y-4 pl-2 border-l-2 border-surface">
                      <div className={isExporting ? 'opacity-50 pointer-events-none' : ''}>
                        <Text variant={TextVariants.label} className="mb-1 block">
                          {t('export.watermark.text' as any, { defaultValue: 'Text watermark' })}
                        </Text>
                        <input
                          type="text"
                          value={watermarkText}
                          onChange={(e) => setWatermarkText(e.target.value)}
                          disabled={isExporting}
                          placeholder={t('export.watermark.textPlaceholder' as any, {
                            defaultValue: '© Your Name',
                          })}
                          className="w-full h-8 px-2 rounded-md bg-bg-primary border border-border-color/40 text-[12px] text-text-primary outline-none focus:border-white/30"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <Text variant={TextVariants.label} className="shrink-0">
                            {t('export.watermark.textColor' as any, { defaultValue: 'Color' })}
                          </Text>
                          <input
                            type="color"
                            value={watermarkTextColor || '#FFFFFF'}
                            onChange={(e) => setWatermarkTextColor(e.target.value)}
                            disabled={isExporting}
                            className="h-7 w-10 rounded border border-border-color/40 bg-transparent cursor-pointer"
                          />
                          <span className="text-[10px] text-text-secondary/60 font-mono">
                            {watermarkTextColor || '#FFFFFF'}
                          </span>
                        </div>
                      </div>
                      <div className={isExporting ? 'opacity-50 pointer-events-none' : ''}>
                        <ImagePicker
                          label={t('export.watermark.watermarkImage')}
                          imageName={watermarkPath ? watermarkPath.split(/[\\/]/).pop() || null : null}
                          onImageSelect={setWatermarkPath}
                          onClear={() => setWatermarkPath(null)}
                        />
                      </div>
                      {(watermarkPath || (watermarkText && watermarkText.trim())) && (
                        <>
                          <Dropdown
                            options={anchorOptions}
                            value={watermarkAnchor}
                            onChange={(val) => setWatermarkAnchor(val as WatermarkAnchor)}
                            disabled={isExporting}
                            className="w-full"
                          />
                          <div>
                            <Slider
                              label={t('export.watermark.scale')}
                              min={1}
                              max={50}
                              step={1}
                              value={watermarkScale}
                              onChange={(e) => setWatermarkScale(Number(e.target.value))}
                              disabled={isExporting}
                              defaultValue={10}
                            />
                            <Slider
                              label={t('export.watermark.spacing')}
                              min={0}
                              max={25}
                              step={1}
                              value={watermarkSpacing}
                              onChange={(e) => setWatermarkSpacing(Number(e.target.value))}
                              disabled={isExporting}
                              defaultValue={5}
                            />
                            <Slider
                              label={t('export.watermark.opacity')}
                              min={0}
                              max={100}
                              step={1}
                              value={watermarkOpacity}
                              onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                              disabled={isExporting}
                              defaultValue={75}
                            />
                          </div>
                          {watermarkPath && (
                            <WatermarkPreview
                              imageAspectRatio={imageAspectRatio}
                              watermarkImageAspectRatio={watermarkImageAspectRatio}
                              watermarkPath={watermarkPath}
                              anchor={watermarkAnchor as WatermarkAnchor}
                              scale={watermarkScale}
                              spacing={watermarkSpacing}
                              opacity={watermarkOpacity}
                            />
                          )}
                          {!!watermarkText?.trim() && !watermarkPath && (
                            <p className="text-[10px] text-text-secondary/50">
                              {t('export.watermark.textHint' as any, {
                                defaultValue:
                                  'Text is rendered at export with a system font (outline for contrast).',
                              })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </Section>
              </>
            )}

            <div>
              <Text variant={TextVariants.heading} className="mb-2">
                {t('export.sections.advanced')}
              </Text>
              <div className="bg-surface rounded-xl overflow-hidden">
                <button
                  onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
                  disabled={isExporting}
                  className="w-full flex items-center justify-between p-3.5 hover:bg-card-active transition-colors"
                >
                  <Text
                    as="span"
                    variant={TextVariants.label}
                    color={TextColors.primary}
                    className="flex items-center gap-2"
                  >
                    <Settings size={16} /> {t('export.advanced.title')}
                  </Text>
                  <Text color={TextColors.secondary}>
                    {isAdvancedExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </Text>
                </button>
                <AnimatePresence initial={false}>
                  {isAdvancedExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-surface/50 flex flex-col gap-4">
                        <Switch
                          label={t('export.advanced.preserveFolders')}
                          checked={preserveFolders}
                          onChange={setPreserveFolders}
                          disabled={isExporting}
                          trackClassName="bg-surface"
                        />
                        {fileFormat !== FileFormats.Cube && (
                          <>
                            <Switch
                              checked={preserveTimestamps}
                              disabled={isExporting}
                              label={t('export.advanced.preserveTimestamps')}
                              onChange={setPreserveTimestamps}
                              trackClassName="bg-surface"
                            />
                            {!isLibraryContext && (
                              <Switch
                                label={t('export.advanced.exportMasks')}
                                checked={exportMasks}
                                onChange={setExportMasks}
                                disabled={isExporting}
                                trackClassName="bg-surface"
                              />
                            )}
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        ) : (
          <Text
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {isLibraryContext ? t('export.status.noImagesSelected') : t('export.status.noImageSelected')}
          </Text>
        )}
      </div>

      <div className="p-4 border-t border-surface shrink-0 space-y-2">
        <Text as="div" variant={TextVariants.small} color={TextColors.primary} className="text-center">
          {isEstimating ? (
            <span className="italic">{t('export.status.estimatingSize')}</span>
          ) : estimatedSize !== null ? (
            <span>
              {numImages > 1
                ? t('export.status.estimatedTotalSize', { size: formatBytes(estimatedSize, t) }) ||
                  t('export.status.estimatedSize', { size: formatBytes(estimatedSize, t) })
                : t('export.status.estimatedSize', { size: formatBytes(estimatedSize, t) })}
              {numImages > 1 && ` (~${formatBytes(estimatedSize / numImages, t)})`}
            </span>
          ) : null}
        </Text>
        <Button
          className={`group rounded-md h-11 w-full flex items-center text-md font-bold! justify-center ${
            status === Status.Exporting
              ? 'bg-red-600/80 hover:bg-red-600 text-white'
              : status === Status.Cancelling
                ? 'bg-yellow-500/20 text-yellow-400 shadow-none'
                : status === Status.Success
                  ? 'bg-green-500/70 text-white shadow-none'
                  : status === Status.Error
                    ? 'bg-red-500/20 text-red-400 shadow-none'
                    : status === Status.Cancelled
                      ? 'bg-yellow-500/20 text-yellow-400 shadow-none'
                      : ''
          }`}
          disabled={isCancelling || (status !== Status.Exporting && !canExport)}
          onClick={status === Status.Exporting ? handleCancel : handleExport}
          size="lg"
        >
          {status === Status.Exporting ? (
            <>
              <span className="flex items-center group-hover:hidden">
                <Loader size={18} className="animate-spin mr-2" />
                {progress.total > 1
                  ? t('export.status.exportingProgress', { current: progress.current, total: progress.total })
                  : t('export.status.exporting')}
              </span>
              <span className="hidden items-center group-hover:flex">
                <Ban size={18} className="mr-2" />
                {t('export.status.cancelExport')}
              </span>
            </>
          ) : status === Status.Cancelling ? (
            <>
              <Loader size={18} className="animate-spin mr-2" /> {t('export.status.cancelling')}
            </>
          ) : status === Status.Success ? (
            <>
              <CheckCircle size={18} className="mr-2" /> {t('export.status.success')}
              {lastExportOutput && !isAndroid && (
                <button
                  type="button"
                  className="ml-3 text-[11px] underline text-text-secondary hover:text-text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    invoke(Invokes.ShowInFinder, { path: lastExportOutput }).catch(() => {});
                  }}
                >
                  {t('export.status.showInFolder' as any, { defaultValue: 'Show in folder' })}
                </button>
              )}
            </>
          ) : status === Status.Error ? (
            <>
              <XCircle size={18} className="mr-2" /> {errorMessage || t('export.status.failed')}
            </>
          ) : status === Status.Cancelled ? (
            <>
              <Ban size={18} className="mr-2" /> {t('export.status.cancelled')}
            </>
          ) : (
            <>
              <FileInput size={18} className="mr-2" />{' '}
              {numImages > 1
                ? t('export.status.exportMultiple', { count: numImages, label: itemLabelPlural })
                : t('export.status.exportSingle', { label: itemLabel })}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
