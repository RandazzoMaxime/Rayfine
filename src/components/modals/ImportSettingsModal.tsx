import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import Switch from '../ui/Switch';
import { FILENAME_VARIABLES } from '../ui/ExportImportProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { Invokes } from '../ui/AppProperties';
import { useSettingsStore } from '../../store/useSettingsStore';

interface ImportSettingsModalProps {
  fileCount: number;
  isOpen: boolean;
  onClose(): void;
  onSave(settings: any): void;
}

interface PresetOption {
  id: string;
  label: string;
}

export default function ImportSettingsModal({ fileCount, isOpen, onClose, onSave }: ImportSettingsModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);

  const [filenameTemplate, setFilenameTemplate] = useState('{original_filename}');
  const [organizeByDate, setOrganizeByDate] = useState(false);
  const [dateFolderFormat, setDateFolderFormat] = useState('YYYY/MM-DD');
  const [deleteAfterImport, setDeleteAfterImport] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [buildPreviews, setBuildPreviews] = useState(true);
  const [previewQuality, setPreviewQuality] = useState<'minimal' | 'standard' | 'one_to_one'>('standard');
  const [copyAsDng, setCopyAsDng] = useState(false);
  const [developPresetId, setDevelopPresetId] = useState<string>('');
  const [keywordsText, setKeywordsText] = useState('');
  const [creatorText, setCreatorText] = useState('');
  const [copyrightText, setCopyrightText] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [presetOptions, setPresetOptions] = useState<PresetOption[]>([]);
  const filenameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      // LR: restore last import settings
      try {
        const last = useSettingsStore.getState().appSettings?.lastImportSettings;
        if (last) {
          if (typeof last.filenameTemplate === 'string') setFilenameTemplate(last.filenameTemplate);
          if (typeof last.organizeByDate === 'boolean') setOrganizeByDate(last.organizeByDate);
          if (typeof last.dateFolderFormat === 'string') setDateFolderFormat(last.dateFolderFormat);
          if (typeof last.deleteAfterImport === 'boolean') setDeleteAfterImport(last.deleteAfterImport);
          if (typeof last.skipDuplicates === 'boolean') setSkipDuplicates(last.skipDuplicates);
          if (typeof last.buildPreviews === 'boolean') setBuildPreviews(last.buildPreviews);
          if (last.previewQuality === 'minimal' || last.previewQuality === 'standard' || last.previewQuality === 'one_to_one') {
            setPreviewQuality(last.previewQuality);
          }
          if (typeof last.copyAsDng === 'boolean') setCopyAsDng(last.copyAsDng);
          if (last.developPresetId) setDevelopPresetId(String(last.developPresetId));
          if (Array.isArray(last.keywords) && last.keywords.length) {
            setKeywordsText(last.keywords.join(', '));
          }
          if (last.creator) setCreatorText(String(last.creator));
          if (last.copyright) setCopyrightText(String(last.copyright));
          if (last.caption) setCaptionText(String(last.caption));
        }
      } catch {
        /* ignore */
      }
      // Load presets for optional develop-on-import
      invoke<any[]>(Invokes.LoadPresets)
        .then((items) => {
          const opts: PresetOption[] = [];
          for (const item of items || []) {
            if (item.preset) {
              opts.push({ id: item.preset.id, label: item.preset.name });
            } else if (item.folder?.children) {
              for (const child of item.folder.children) {
                opts.push({
                  id: child.id,
                  label: `${item.folder.name} / ${child.name}`,
                });
              }
            }
          }
          opts.sort((a, b) => a.label.localeCompare(b.label));
          setPresetOptions(opts);
        })
        .catch(() => setPresetOptions([]));
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setIsMounted(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    let finalFilenameTemplate = filenameTemplate;
    if (
      fileCount > 1 &&
      !filenameTemplate.includes('{sequence}') &&
      !filenameTemplate.includes('{original_filename}')
    ) {
      finalFilenameTemplate = `${filenameTemplate}_{sequence}`;
    }

    onSave({
      filenameTemplate: finalFilenameTemplate,
      organizeByDate,
      dateFolderFormat,
      deleteAfterImport,
      skipDuplicates,
      buildPreviews,
      previewQuality,
      copyAsDng,
      developPresetId: developPresetId || null,
      keywords: keywordsText
        .split(/[,;]+/)
        .map((k) => k.trim())
        .filter(Boolean),
      creator: creatorText.trim() || null,
      copyright: copyrightText.trim() || null,
      caption: captionText.trim() || null,
    });
    onClose();
  }, [
    onSave,
    onClose,
    filenameTemplate,
    organizeByDate,
    dateFolderFormat,
    deleteAfterImport,
    skipDuplicates,
    buildPreviews,
    previewQuality,
    copyAsDng,
    developPresetId,
    keywordsText,
    creatorText,
    copyrightText,
    captionText,
    fileCount,
  ]);

  const handleKeyDown = useCallback(
    (e: any) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [handleSave, onClose],
  );

  const handleVariableClick = (variable: string) => {
    if (!filenameInputRef.current) {
      return;
    }
    const input = filenameInputRef.current;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentValue = input.value;
    const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
    setFilenameTemplate(newValue);
    setTimeout(() => {
      input.focus();
      const newCursorPos = start + variable.length;
      input.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div
      aria-modal="true"
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      role="dialog"
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e: any) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('modals.importSettings.title')}
        </Text>

        <div className="space-y-6 text-sm">
          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.fileNaming')}
            </Text>
            <input
              autoFocus
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
              onChange={(e: any) => setFilenameTemplate(e.target.value)}
              ref={filenameInputRef}
              type="text"
              value={filenameTemplate}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {FILENAME_VARIABLES.map((variable: string) => (
                <button
                  className="px-2 py-1 bg-surface text-text-secondary text-xs rounded-md hover:bg-card-active transition-colors"
                  key={variable}
                  onClick={() => handleVariableClick(variable)}
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Text variant={TextVariants.heading} className="block mb-2">
              {t('modals.importSettings.folderOrganization')}
            </Text>
            <Switch
              label={t('modals.importSettings.organizeByDate')}
              checked={organizeByDate}
              onChange={setOrganizeByDate}
            />
            {organizeByDate && (
              <div className="mt-2">
                <Text variant={TextVariants.label} className="block mb-1">
                  {t('modals.importSettings.dateFormat')}
                </Text>
                <input
                  className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                  onChange={(e: any) => setDateFolderFormat(e.target.value)}
                  placeholder={t('modals.importSettings.dateFormatPlaceholder')}
                  type="text"
                  value={dateFolderFormat}
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Text variant={TextVariants.heading} className="block">
              {t('modals.importSettings.applyPreset')}
            </Text>
            <select
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary"
              value={developPresetId}
              onChange={(e) => setDevelopPresetId(e.target.value)}
            >
              <option value="">{t('modals.importSettings.applyPresetNone')}</option>
              {presetOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Text variant={TextVariants.heading} className="block">
              {t('modals.importSettings.keywords' as any, { defaultValue: 'Keywords' })}
            </Text>
            <input
              className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
              type="text"
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={t('modals.importSettings.keywordsPlaceholder' as any, {
                defaultValue: 'comma, keywords — use travel/paris for hierarchy',
              })}
            />
            <Text variant={TextVariants.small} className="text-text-secondary">
              {t('modals.importSettings.keywordsHint' as any, {
                defaultValue: 'Applied to all files after import (and written to XMP when sync is on).',
              })}
            </Text>
          </div>

          <div className="space-y-3">
            <Text variant={TextVariants.heading} className="block">
              {t('modals.importSettings.renderPreviews')}
            </Text>
            <Switch
              checked={buildPreviews}
              label={t('modals.importSettings.buildPreviews')}
              onChange={setBuildPreviews}
            />
            {buildPreviews && (
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['minimal', 'modals.importSettings.previewMinimal'],
                    ['standard', 'modals.importSettings.previewStandard'],
                    ['one_to_one', 'modals.importSettings.preview1to1'],
                  ] as const
                ).map(([value, labelKey]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPreviewQuality(value)}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      previewQuality === value
                        ? 'border-accent bg-accent/15 text-text-primary'
                        : 'border-surface text-text-secondary hover:bg-card-active'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>

          
          <div className="space-y-2">
            <Text variant={TextVariants.heading} className="block">
              {t('modals.importSettings.metadata' as any, { defaultValue: 'Metadata (IPTC)' })}
            </Text>
            <div>
              <Text variant={TextVariants.label} className="block mb-1">
                {t('modals.importSettings.creator' as any, { defaultValue: 'Creator' })}
              </Text>
              <input
                className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                type="text"
                value={creatorText}
                onChange={(e) => setCreatorText(e.target.value)}
                placeholder={t('modals.importSettings.creatorPlaceholder' as any, {
                  defaultValue: 'Photographer / author',
                })}
              />
            </div>
            <div>
              <Text variant={TextVariants.label} className="block mb-1">
                {t('modals.importSettings.copyright' as any, { defaultValue: 'Copyright' })}
              </Text>
              <input
                className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent"
                type="text"
                value={copyrightText}
                onChange={(e) => setCopyrightText(e.target.value)}
                placeholder={t('modals.importSettings.copyrightPlaceholder' as any, {
                  defaultValue: '© Year Name',
                })}
              />
            </div>
            <div>
              <Text variant={TextVariants.label} className="block mb-1">
                {t('modals.importSettings.caption' as any, { defaultValue: 'Caption' })}
              </Text>
              <textarea
                className="w-full bg-bg-primary border border-surface rounded-md p-2 text-sm text-text-primary focus:ring-accent focus:border-accent min-h-[56px] resize-y"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                placeholder={t('modals.importSettings.captionPlaceholder' as any, {
                  defaultValue: 'Optional caption applied to all imported photos',
                })}
              />
            </div>
            <Text variant={TextVariants.small} className="text-text-secondary">
              {t('modals.importSettings.metadataHint' as any, {
                defaultValue:
                  'Applied to all imported files (XMP/IPTC interop). Settings are remembered for next import.',
              })}
            </Text>
          </div>
<div className="space-y-3">
            <Text variant={TextVariants.heading} className="block">
              {t('modals.importSettings.sourceFiles')}
            </Text>
            <Switch
              checked={skipDuplicates}
              label={t('modals.importSettings.dontImportDuplicates')}
              onChange={setSkipDuplicates}
            />
            <Switch checked={copyAsDng} label={t('modals.importSettings.copyAsDng')} onChange={setCopyAsDng} />
            {copyAsDng && (
              <Text variant={TextVariants.small} className="mt-1 text-text-secondary/70">
                {t('modals.importSettings.copyAsDngNote' as any, {
                  defaultValue:
                    'Already-DNG files keep the .dng extension. Other RAW formats import as originals until a full RAW→DNG encoder is available.',
                })}
              </Text>
            )}
            <Switch
              checked={deleteAfterImport}
              label={t('modals.importSettings.deleteAfterImport')}
              onChange={setDeleteAfterImport}
            />
            {deleteAfterImport && (
              <Text variant={TextVariants.small} className="mt-1">
                {t('modals.importSettings.deleteWarning')}
              </Text>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8">
          <button
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
            onClick={onClose}
          >
            {t('modals.importSettings.cancel')}
          </button>
          <button
            className="px-4 py-2 rounded-md bg-accent shadow-shiny text-button-text font-semibold hover:bg-accent-hover transition-colors"
            onClick={handleSave}
          >
            {t('modals.importSettings.startImport')}
          </button>
        </div>
      </div>
    </div>
  );
}
