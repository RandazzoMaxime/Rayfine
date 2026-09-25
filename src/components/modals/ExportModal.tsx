import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ChevronDown, ChevronRight, Folder, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';
import clsx from 'clsx';

import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useExportSettings } from '../../hooks/useExportSettings';
import {
  ExportPreset,
  ExportSettings,
  FILE_FORMATS,
  FileFormats,
  Status,
  WatermarkAnchor,
} from '../ui/ExportImportProperties';
import { Invokes } from '../ui/AppProperties';
import CheckBox from '../ui/CheckBox';
import PanelSelect from '../ui/PanelSelect';

const USER_FOLDER = 'Paramètres prédéfinis de l’utilisateur';

function Collapsible({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border-color/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left bg-surface/40 hover:bg-surface/70"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-primary">{title}</span>
      </button>
      {open && <div className="px-3 py-2 space-y-2">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-h-7">
      <span className="w-[9.5rem] shrink-0 text-[11px] text-text-secondary text-right">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

const inputClass =
  'w-full h-7 px-1.5 rounded bg-bg-primary border border-border-color/40 text-[11px] text-text-primary outline-none';

export default function ExportModal() {
  const { t } = useTranslation();
  const openModal = useUIStore((s) => s.isExportModalOpen);
  const setUI = useUIStore((s) => s.setUI);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const multiSelectedPaths = useLibraryStore((s) => s.multiSelectedPaths);
  const rootPaths = useLibraryStore((s) => s.rootPaths);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const handleSettingsChange = useSettingsStore((s) => s.handleSettingsChange);
  const setExportState = useProcessStore((s) => s.setExportState);
  const exportStatus = useProcessStore((s) => s.exportState.status);
  const thumbs = useProcessStore((s) => s.thumbnails);

  const exp = useExportSettings();
  const [folder, setFolder] = useState('');
  const [putInSubfolder, setPutInSubfolder] = useState(false);
  const [subfolderName, setSubfolderName] = useState('');
  const [existingFiles, setExistingFiles] = useState<'overwrite' | 'skip' | 'ask'>('ask');
  const [renameEnabled, setRenameEnabled] = useState(false);
  const [extensionCase, setExtensionCase] = useState<'upper' | 'lower'>('upper');
  const [metadataInclude, setMetadataInclude] = useState<
    'all' | 'copyright' | 'copyrightContact' | 'allExceptCamera' | 'none'
  >('all');
  const [openLoc, setOpenLoc] = useState(true);
  const [openName, setOpenName] = useState(true);
  const [openFile, setOpenFile] = useState(true);
  const [openSize, setOpenSize] = useState(true);
  const [openMeta, setOpenMeta] = useState(true);
  const [openWm, setOpenWm] = useState(true);
  const [wmList, setWmList] = useState<Array<{ name: string; path: string }>>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('Paramètre prédéfini sans titre');
  const [newFolder, setNewFolder] = useState('EXPORT');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const paths = useMemo(() => {
    if (multiSelectedPaths.length > 0) return [...multiSelectedPaths];
    if (selectedImage?.path) return [selectedImage.path];
    return [] as string[];
  }, [multiSelectedPaths, selectedImage?.path]);

  const presets = useMemo(
    () => (appSettings?.exportPresets || []).filter((p) => p.id !== '__last_used__'),
    [appSettings?.exportPresets],
  );

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const p of presets) set.add(p.folder || USER_FOLDER);
    if (!set.has('EXPORT')) set.add('EXPORT');
    set.add(USER_FOLDER);
    return Array.from(set);
  }, [presets]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExportPreset[]>();
    for (const f of folders) map.set(f, []);
    for (const p of presets) {
      const f = p.folder || USER_FOLDER;
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(p);
    }
    return Array.from(map.entries());
  }, [presets, folders]);

  useEffect(() => {
    if (!openModal) return;
    const last = appSettings?.exportPresets?.find((p) => p.id === '__last_used__');
    if (last) {
      exp.handleApplyPreset(last);
      if (last.exportFolder) setFolder(last.exportFolder);
      if (last.putInSubfolder != null) setPutInSubfolder(!!last.putInSubfolder);
      if (last.subfolderName) setSubfolderName(last.subfolderName);
      if (last.existingFiles) setExistingFiles(last.existingFiles);
      if (last.renameEnabled != null) setRenameEnabled(!!last.renameEnabled);
      if (last.extensionCase) setExtensionCase(last.extensionCase);
      if (last.metadataInclude) setMetadataInclude(last.metadataInclude);
    }
    invoke<Array<{ name: string; path: string }>>(Invokes.ListWatermarks)
      .then(setWmList)
      .catch(() => setWmList([]));
    if (paths[0]) invoke('update_thumbnail_queue', { paths: [paths[0]] }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openModal]);

  const snapshot = useCallback(
    (): Omit<ExportPreset, 'id' | 'name'> => ({
      ...exp.currentSettingsObject,
      folder: newFolder,
      exportFolder: folder,
      putInSubfolder,
      subfolderName,
      existingFiles,
      renameEnabled,
      extensionCase,
      metadataInclude,
    }),
    [
      exp.currentSettingsObject,
      newFolder,
      folder,
      putInSubfolder,
      subfolderName,
      existingFiles,
      renameEnabled,
      extensionCase,
      metadataInclude,
    ],
  );

  const applyPreset = (p: ExportPreset) => {
    exp.handleApplyPreset(p);
    if (p.exportFolder) setFolder(p.exportFolder);
    setPutInSubfolder(!!p.putInSubfolder);
    setSubfolderName(p.subfolderName || '');
    if (p.existingFiles) setExistingFiles(p.existingFiles);
    setRenameEnabled(!!p.renameEnabled);
    if (p.extensionCase) setExtensionCase(p.extensionCase);
    if (p.metadataInclude) setMetadataInclude(p.metadataInclude);
  };

  const persistPresets = (next: ExportPreset[]) => {
    if (!appSettings) return;
    const last = (appSettings.exportPresets || []).filter((p) => p.id === '__last_used__');
    handleSettingsChange({ ...appSettings, exportPresets: [...next, ...last] });
  };

  const createPreset = () => {
    const name = newName.trim() || 'Paramètre prédéfini sans titre';
    const folderName = newFolderMode ? folderDraft.trim() : newFolder;
    if (newFolderMode && !folderName) return;
    const preset: ExportPreset = {
      id: uuidv4(),
      name,
      ...snapshot(),
      folder: folderName || USER_FOLDER,
    };
    persistPresets([...presets, preset]);
    setChecked((s) => new Set(s).add(preset.id));
    applyPreset(preset);
    setCreating(false);
    setNewFolderMode(false);
    setNewName('Paramètre prédéfini sans titre');
  };

  const deleteChecked = () => {
    if (checked.size === 0) return;
    persistPresets(presets.filter((p) => !checked.has(p.id)));
    setChecked(new Set());
  };

  const close = () => setUI({ isExportModalOpen: false });

  const buildExportSettings = (): ExportSettings => {
    const keep = metadataInclude !== 'none';
    const gps = metadataInclude === 'all' ? false : true;
    return {
      filenameTemplate: renameEnabled ? exp.filenameTemplate : '{original_filename}',
      jpegQuality: exp.jpegQuality,
      keepMetadata: keep,
      preserveTimestamps: exp.preserveTimestamps,
      preserveFolders: false,
      resize: exp.enableResize
        ? { mode: exp.resizeMode, value: exp.resizeValue, dontEnlarge: exp.dontEnlarge }
        : null,
      stripGps: gps || exp.stripGps,
      colorSpace: exp.colorSpace,
      outputSharpening: exp.outputSharpening,
      resolutionDpi: exp.resolutionDpi,
      limitFileSizeKb: exp.limitFileSizeKb || undefined,
      bitDepth: exp.bitDepth,
      watermark:
        exp.enableWatermark && exp.watermarkPath
          ? {
              path: exp.watermarkPath,
              anchor: exp.watermarkAnchor,
              scale: exp.watermarkScale,
              spacing: exp.watermarkSpacing,
              opacity: exp.watermarkOpacity,
              mode: exp.watermarkMode,
            }
          : null,
    };
  };

  const wmSrc = (p: string) => {
    try {
      return convertFileSrc(p.replace(/\\/g, '/'));
    } catch {
      return '';
    }
  };

  const importWatermarks = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      title: t('export.watermark.import' as any, { defaultValue: 'Importer des logos' }),
    });
    if (!picked) return;
    const sourcePaths = Array.isArray(picked) ? picked : [picked];
    try {
      const next = await invoke<Array<{ name: string; path: string }>>(Invokes.ImportWatermarks, {
        sourcePaths,
      });
      setWmList(next);
      const last = next[next.length - 1];
      if (last) exp.setWatermarkPath(last.path);
      exp.setEnableWatermark(true);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const runOne = async (outputFolder: string, settings: ExportSettings, formatId: string, n: number) => {
    const fmt = FILE_FORMATS.find((f) => f.id === formatId) || FILE_FORMATS[0];
    await invoke(Invokes.ExportImages, {
      paths,
      outputFolderOrFile: outputFolder,
      isExplicitFilePath: false,
      baseOriginFolders: rootPaths,
      exportSettings: settings,
      outputFormat: fmt.extensions[0],
      currentEditPath: selectedImage?.path || null,
      currentEditAdjustments: useEditorStore.getState().adjustments || null,
    });
    return n;
  };

  const handleExport = async () => {
    if (paths.length === 0) {
      toast.info(t('export.noneSelected' as any, { defaultValue: 'Sélectionnez des photos dans la barre du bas.' }));
      return;
    }
    let dest = folder;
    if (!dest) {
      const picked = await open({ directory: true, title: t('export.dialog.selectFolderTitle', { count: paths.length }) });
      if (typeof picked !== 'string' || !picked) return;
      dest = picked;
      setFolder(picked);
    }
    const destFor = (p: ExportPreset | null) => {
      const base = p?.exportFolder || dest;
      if (p?.putInSubfolder && p.subfolderName) return `${base.replace(/[\\/]+$/, '')}/${p.subfolderName}`;
      if (!p && putInSubfolder && subfolderName) return `${dest.replace(/[\\/]+$/, '')}/${subfolderName}`;
      return base;
    };

    const batches: ExportPreset[] =
      checked.size > 0
        ? presets.filter((p) => checked.has(p.id))
        : [
            {
              id: '__current__',
              name: 'current',
              ...snapshot(),
              exportFolder: dest,
            },
          ];

    const total = paths.length * batches.length;
    setExportState({ status: Status.Exporting, progress: { current: 0, total }, errorMessage: '' });
    close();
    try {
      let done = 0;
      for (const batch of batches) {
        if (batch.id !== '__current__') applyPreset(batch);
        const settings = batch.id === '__current__' ? buildExportSettings() : (() => {
          applyPreset(batch);
          return buildExportSettings();
        })();
        const out = destFor(batch.id === '__current__' ? null : batch);
        await runOne(out, settings, batch.fileFormat || exp.fileFormat, paths.length);
        done += paths.length;
        setExportState({ progress: { current: done, total } });
      }
      setExportState({ status: Status.Success, progress: { current: total, total } });
      toast.success(
        t('export.done' as any, {
          defaultValue: '{{count}} fichier(s) exporté(s)',
          count: total,
        }),
      );
    } catch (err) {
      setExportState({
        status: Status.Error,
        errorMessage: typeof err === 'string' ? err : String(err),
      });
      toast.error(String(err));
    }
  };

  if (!openModal) return null;

  const isExporting = exportStatus === Status.Exporting;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onClick={close}>
      <div
        className="w-[min(920px,calc(100vw-2rem))] h-[min(640px,calc(100vh-3rem))] bg-bg-secondary border border-border-color/50 rounded-md shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-9 px-3 flex items-center justify-between border-b border-border-color/40 shrink-0">
          <span className="text-[12px] font-semibold">
            {t('export.title' as any, { defaultValue: 'Exporter un fichier' })}
            {paths.length > 0 && (
              <span className="ml-2 font-normal text-text-secondary">
                ({paths.length} {paths.length === 1 ? 'photo' : 'photos'})
              </span>
            )}
          </span>
          <button type="button" className="p-1 text-text-secondary hover:text-text-primary" onClick={close}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="w-56 shrink-0 border-r border-border-color/40 flex flex-col">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-secondary">
              {t('export.presetCol' as any, { defaultValue: 'Paramètre prédéfini' })}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-1 pb-1">
              {grouped.map(([folderName, items]) => {
                const collapsed = collapsedFolders.has(folderName);
                return (
                  <div key={folderName} className="mb-0.5">
                    <button
                      type="button"
                      className="w-full flex items-center gap-1 px-1 py-0.5 text-[11px] text-text-primary hover:bg-card-active"
                      onClick={() =>
                        setCollapsedFolders((s) => {
                          const n = new Set(s);
                          if (n.has(folderName)) n.delete(folderName);
                          else n.add(folderName);
                          return n;
                        })
                      }
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <Folder size={12} className="opacity-70" />
                      <span className="truncate">{folderName}</span>
                    </button>
                    {!collapsed &&
                      items.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-center gap-1.5 pl-6 pr-1 py-0.5 text-[11px] hover:bg-card-active cursor-pointer"
                          onDoubleClick={() => applyPreset(p)}
                        >
                          <CheckBox
                            checked={checked.has(p.id)}
                            onChange={(v) => {
                              setChecked((s) => {
                                const n = new Set(s);
                                if (v) n.add(p.id);
                                else n.delete(p.id);
                                return n;
                              });
                              if (v) applyPreset(p);
                            }}
                            label={p.name}
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      ))}
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 flex gap-1 p-1.5 border-t border-border-color/30">
              <button
                type="button"
                className="flex-1 h-7 rounded bg-surface border border-border-color/40 text-[11px] hover:bg-card-active"
                onClick={() => setCreating(true)}
              >
                {t('export.addPreset' as any, { defaultValue: 'Ajouter' })}
              </button>
              <button
                type="button"
                disabled={checked.size === 0}
                className="flex-1 h-7 rounded bg-surface border border-border-color/40 text-[11px] hover:bg-card-active disabled:opacity-40"
                onClick={deleteChecked}
              >
                {t('export.removePreset' as any, { defaultValue: 'Supprimer' })}
              </button>
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
            <Collapsible
              title={t('export.sections.location' as any, { defaultValue: 'Emplacement d’exportation' })}
              open={openLoc}
              onToggle={() => setOpenLoc((v) => !v)}
            >
              <Field label={t('export.toFolder' as any, { defaultValue: 'Exporter vers' })}>
                <span className="text-[11px] text-text-primary">
                  {t('export.specificFolder' as any, { defaultValue: 'Dossier spécifique' })}
                </span>
              </Field>
              <Field label={t('export.folder' as any, { defaultValue: 'Dossier' })}>
                <div className="flex gap-1">
                  <input readOnly value={folder} className={inputClass} placeholder="…" />
                  <button
                    type="button"
                    className="h-7 px-2 shrink-0 rounded bg-surface border border-border-color/40 text-[11px] hover:bg-card-active"
                    onClick={async () => {
                      const picked = await open({ directory: true });
                      if (typeof picked === 'string') setFolder(picked);
                    }}
                  >
                    {t('export.choose' as any, { defaultValue: 'Sélectionner…' })}
                  </button>
                </div>
              </Field>
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox checked={putInSubfolder} onChange={setPutInSubfolder} label="subfolder" />
                  {t('export.subfolder' as any, { defaultValue: 'Placer dans un sous-dossier' })}
                  <input
                    disabled={!putInSubfolder}
                    value={subfolderName}
                    onChange={(e) => setSubfolderName(e.target.value)}
                    className={clsx(inputClass, 'max-w-[10rem]')}
                  />
                </label>
              </Field>
              <Field label={t('export.existing' as any, { defaultValue: 'Fichiers existants' })}>
                <PanelSelect
                  size="md"
                  value={existingFiles}
                  onChange={(v) => setExistingFiles(v as typeof existingFiles)}
                  options={[
                    { value: 'ask', label: t('export.existingAsk' as any, { defaultValue: 'Demander conseil' }) },
                    { value: 'overwrite', label: t('export.existingOverwrite' as any, { defaultValue: 'Écraser' }) },
                    { value: 'skip', label: t('export.existingSkip' as any, { defaultValue: 'Ignorer' }) },
                  ]}
                />
              </Field>
            </Collapsible>

            <Collapsible
              title={t('export.sections.naming' as any, { defaultValue: 'Dénomination de fichier' })}
              open={openName}
              onToggle={() => setOpenName((v) => !v)}
            >
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox checked={renameEnabled} onChange={setRenameEnabled} label="rename" />
                  {t('export.renameTo' as any, { defaultValue: 'Renommer en' })}
                </label>
              </Field>
              <Field label={t('export.template' as any, { defaultValue: 'Modèle' })}>
                <PanelSelect
                  size="md"
                  disabled={!renameEnabled}
                  value={exp.filenameTemplate}
                  onChange={exp.setFilenameTemplate}
                  options={[
                    {
                      value: '{original_filename}',
                      label: t('export.tplFilename' as any, { defaultValue: 'Nom de fichier d’origine' }),
                    },
                    {
                      value: '{original_filename}_{sequence}',
                      label: t('export.tplFilenameSeq' as any, { defaultValue: 'Nom d’origine - Numéro de séquence' }),
                    },
                    {
                      value: '{YYYY}{MM}{DD}_{original_filename}',
                      label: t('export.tplDateFilename' as any, { defaultValue: 'Date - Nom de fichier' }),
                    },
                    {
                      value: '{sequence}_{original_filename}',
                      label: t('export.tplSeqFilename' as any, { defaultValue: 'Numéro de séquence - Nom d’origine' }),
                    },
                  ]}
                />
              </Field>
              <Field label={t('export.example' as any, { defaultValue: 'Exemple' })}>
                <span className="text-[11px] text-text-secondary tabular-nums">
                  {renameEnabled
                    ? `${exp.filenameTemplate.replace('{original_filename}', 'IMG_0001').replace('{sequence}', '1').replace('{YYYY}', '2026').replace('{MM}', '09').replace('{DD}', '25')}.${extensionCase === 'upper' ? 'JPG' : 'jpg'}`
                    : `IMG_0001.${extensionCase === 'upper' ? 'JPG' : 'jpg'}`}
                </span>
              </Field>
              <Field label={t('export.extensions' as any, { defaultValue: 'Extensions' })}>
                <PanelSelect
                  size="md"
                  value={extensionCase}
                  onChange={(v) => setExtensionCase(v as typeof extensionCase)}
                  options={[
                    { value: 'upper', label: t('export.extUpper' as any, { defaultValue: 'Majuscules' }) },
                    { value: 'lower', label: t('export.extLower' as any, { defaultValue: 'Minuscules' }) },
                  ]}
                />
              </Field>
            </Collapsible>

            <Collapsible
              title={t('export.sections.file' as any, { defaultValue: 'Paramètres de fichier' })}
              open={openFile}
              onToggle={() => setOpenFile((v) => !v)}
            >
              <Field label={t('export.format' as any, { defaultValue: 'Format d’image' })}>
                <PanelSelect
                  size="md"
                  value={exp.fileFormat}
                  onChange={(v) => {
                    exp.setFileFormat(v);
                    if (v !== FileFormats.Png && v !== FileFormats.Tiff) exp.setBitDepth(8);
                    if (v === FileFormats.Original) {
                      exp.setEnableResize(false);
                      exp.setEnableWatermark(false);
                      exp.setLimitFileSizeKb(null);
                    }
                  }}
                  options={FILE_FORMATS.filter((f) => f.id !== FileFormats.Cube).map((f) => ({
                    value: f.id,
                    label:
                      f.id === FileFormats.Original
                        ? t('export.formatOriginal' as any, { defaultValue: 'Original' })
                        : f.name,
                  }))}
                />
              </Field>
              {(exp.fileFormat === FileFormats.Jpeg ||
                exp.fileFormat === FileFormats.Webp ||
                exp.fileFormat === FileFormats.Jxl ||
                exp.fileFormat === FileFormats.Avif) &&
                exp.fileFormat !== FileFormats.Original && (
                <Field label={t('export.quality' as any, { defaultValue: 'Qualité' })}>
                  {(() => {
                    const limitOn = exp.limitFileSizeKb != null;
                    return (
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={clsx('flex items-center gap-2 flex-1 min-w-0', limitOn && 'opacity-40')}>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            disabled={limitOn}
                            value={exp.jpegQuality}
                            onChange={(e) => {
                              exp.setLimitFileSizeKb(null);
                              exp.setJpegQuality(Number(e.target.value));
                            }}
                            className="flex-1 min-w-0 accent-accent disabled:pointer-events-none"
                          />
                          <span className="text-[11px] tabular-nums text-text-secondary w-7 shrink-0 text-right">
                            {exp.jpegQuality}
                          </span>
                        </div>
                        <label className={clsx('flex items-center gap-1.5 text-[11px] shrink-0', !limitOn && 'opacity-40')}>
                          <CheckBox
                            checked={limitOn}
                            onChange={(v) => exp.setLimitFileSizeKb(v ? exp.limitFileSizeKb || 2200 : null)}
                            label="limit"
                          />
                          <span className="whitespace-nowrap">
                            {t('export.limitSizeTo' as any, { defaultValue: 'Limiter la taille de fichier à' })}
                          </span>
                          <input
                            type="number"
                            min={50}
                            disabled={!limitOn}
                            value={exp.limitFileSizeKb ?? 2200}
                            onChange={(e) => exp.setLimitFileSizeKb(Number(e.target.value) || 50)}
                            className={clsx(inputClass, 'w-16 text-center disabled:pointer-events-none')}
                          />
                          <span className="text-text-secondary">K</span>
                        </label>
                      </div>
                    );
                  })()}
                </Field>
              )}
              <Field label={t('export.colorSpace' as any, { defaultValue: 'Espace colorimétrique' })}>
                <PanelSelect
                  size="md"
                  disabled={exp.fileFormat === FileFormats.Original}
                  value={exp.colorSpace}
                  onChange={exp.setColorSpace}
                  options={[
                    { value: 'srgb', label: 'sRGB' },
                    { value: 'adobe-rgb', label: 'Adobe RGB (1998)' },
                    { value: 'display-p3', label: 'Display P3' },
                    { value: 'prophoto', label: 'ProPhoto RGB' },
                  ]}
                />
              </Field>
              <Field label={t('export.bitDepth' as any, { defaultValue: 'Profondeur' })}>
                {(() => {
                  const sixteenOk =
                    exp.fileFormat === FileFormats.Png || exp.fileFormat === FileFormats.Tiff;
                  return (
                    <PanelSelect
                      size="md"
                      disabled={!sixteenOk || exp.fileFormat === FileFormats.Original}
                      value={sixteenOk ? String(exp.bitDepth) : '8'}
                      onChange={(v) => exp.setBitDepth(v === '16' ? 16 : 8)}
                      options={[
                        { value: '8', label: t('export.bit8' as any, { defaultValue: '8 bits/composant' }) },
                        { value: '16', label: t('export.bit16' as any, { defaultValue: '16 bits/composant' }) },
                      ]}
                    />
                  );
                })()}
              </Field>
            </Collapsible>

            <Collapsible
              title={t('export.sections.sizing' as any, { defaultValue: 'Dimensionnement de l’image' })}
              open={openSize}
              onToggle={() => setOpenSize((v) => !v)}
            >
              <div className={clsx(exp.fileFormat === FileFormats.Original && 'opacity-40 pointer-events-none')}>
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox checked={exp.enableResize} onChange={exp.setEnableResize} label="resize" />
                  {t('export.resizeToFit' as any, { defaultValue: 'Redimensionner pour adapter' })}
                </label>
              </Field>
              <Field label={t('export.resizeMode' as any, { defaultValue: 'Adapter' })}>
                <PanelSelect
                  size="md"
                  disabled={!exp.enableResize}
                  value={exp.resizeMode}
                  onChange={exp.setResizeMode}
                  options={[
                    { value: 'longEdge', label: t('export.longEdge' as any, { defaultValue: 'Côté long' }) },
                    { value: 'shortEdge', label: t('export.shortEdge' as any, { defaultValue: 'Côté court' }) },
                    { value: 'width', label: t('export.width' as any, { defaultValue: 'Largeur' }) },
                    { value: 'height', label: t('export.height' as any, { defaultValue: 'Hauteur' }) },
                    { value: 'megapixels', label: t('export.megapixels' as any, { defaultValue: 'Mégapixels' }) },
                    { value: 'percentage', label: t('export.percentage' as any, { defaultValue: 'Pourcentage' }) },
                  ]}
                />
              </Field>
              <Field label={t('export.size' as any, { defaultValue: 'Taille' })}>
                <input
                  type="number"
                  disabled={!exp.enableResize}
                  value={exp.resizeValue}
                  onChange={(e) => exp.setResizeValue(Number(e.target.value) || 0)}
                  className={clsx(inputClass, 'w-28')}
                />
                <span className="ml-1 text-[11px] text-text-secondary">
                  {exp.resizeMode === 'percentage' ? '%' : exp.resizeMode === 'megapixels' ? 'MP' : 'px'}
                </span>
              </Field>
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox
                    checked={exp.dontEnlarge}
                    onChange={exp.setDontEnlarge}
                    disabled={!exp.enableResize}
                    label="dont enlarge"
                  />
                  {t('export.dontEnlarge' as any, { defaultValue: 'Ne pas agrandir' })}
                </label>
              </Field>
              <Field label={t('export.resolution' as any, { defaultValue: 'Résolution' })}>
                <input
                  type="number"
                  value={exp.resolutionDpi}
                  onChange={(e) => exp.setResolutionDpi(Number(e.target.value) || 72)}
                  className={clsx(inputClass, 'w-20')}
                />
                <span className="ml-1 text-[11px] text-text-secondary">ppi</span>
              </Field>
              </div>
            </Collapsible>

            <Collapsible
              title={t('export.sections.watermark' as any, { defaultValue: 'Filigrane' })}
              open={openWm}
              onToggle={() => setOpenWm((v) => !v)}
            >
              <div className={clsx(exp.fileFormat === FileFormats.Original && 'opacity-40 pointer-events-none')}>
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox
                    checked={exp.enableWatermark}
                    onChange={exp.setEnableWatermark}
                    label="watermark"
                  />
                  {t('export.watermark.include' as any, { defaultValue: 'Inclure le filigrane' })}
                </label>
              </Field>
              <div className={clsx(!exp.enableWatermark && 'opacity-40 pointer-events-none')}>
                <Field label={t('export.watermark.library' as any, { defaultValue: 'Logos' })}>
                  <div className="flex items-start gap-1.5">
                    <div className="flex-1 min-w-0 grid grid-cols-4 gap-1.5">
                      {wmList.length === 0 && (
                        <div className="col-span-4 text-[10px] text-text-secondary py-2">
                          {t('export.watermark.empty' as any, {
                            defaultValue: 'Aucun logo. Importez un PNG ou JPEG.',
                          })}
                        </div>
                      )}
                      {wmList.map((w) => {
                        const on = exp.watermarkPath === w.path;
                        return (
                          <button
                            key={w.path}
                            type="button"
                            title={w.name}
                            onClick={() => exp.setWatermarkPath(w.path)}
                            className={clsx(
                              'aspect-square rounded border overflow-hidden bg-[#8a8a8a]',
                              on ? 'border-accent ring-1 ring-accent' : 'border-border-color/40 hover:border-text-secondary',
                            )}
                          >
                            <img src={wmSrc(w.path)} alt="" className="w-full h-full object-contain" />
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => void importWatermarks()}
                      className="h-8 w-8 shrink-0 rounded border border-border-color/40 hover:bg-card-active flex items-center justify-center"
                      data-tooltip={t('export.watermark.import' as any, { defaultValue: 'Importer des logos' })}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </Field>
                <Field label={t('export.watermark.mode' as any, { defaultValue: 'Placement' })}>
                  <div className="flex gap-1">
                    {(['unique', 'multiple'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => exp.setWatermarkMode(m)}
                        className={clsx(
                          'h-7 px-2 rounded border text-[11px]',
                          exp.watermarkMode === m
                            ? 'bg-card-active border-accent text-text-primary'
                            : 'border-border-color/40 text-text-secondary hover:text-text-primary',
                        )}
                      >
                        {m === 'unique'
                          ? t('export.watermark.unique' as any, { defaultValue: 'Unique' })
                          : t('export.watermark.multiple' as any, { defaultValue: 'Multiple' })}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={t('export.watermark.scale' as any, { defaultValue: 'Taille' })}>
                  <input
                    type="range"
                    min={4}
                    max={50}
                    value={exp.watermarkScale}
                    onChange={(e) => exp.setWatermarkScale(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <span className="text-[11px] tabular-nums text-text-secondary ml-2">{exp.watermarkScale}%</span>
                </Field>
                <Field label={t('export.watermark.opacity' as any, { defaultValue: 'Opacité' })}>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={exp.watermarkOpacity}
                    onChange={(e) => exp.setWatermarkOpacity(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <span className="text-[11px] tabular-nums text-text-secondary ml-2">{exp.watermarkOpacity}%</span>
                </Field>
                <Field label={t('export.watermark.previewText' as any, { defaultValue: 'Aperçu' })}>
                  <div className="relative w-full aspect-[3/2] rounded overflow-hidden bg-[#2a2a2a] border border-border-color/40">
                    {paths[0] && thumbs[paths[0]] ? (
                      <img src={thumbs[paths[0]]} alt="" className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] text-text-secondary">
                        {t('export.watermark.previewEmpty' as any, {
                          defaultValue: 'Sélectionnez une photo à exporter',
                        })}
                      </div>
                    )}
                    {exp.watermarkPath && exp.watermarkMode === 'unique' && (
                      <button
                        type="button"
                        className={clsx(
                          'absolute max-w-[50%] max-h-[50%] pointer-events-none',
                          exp.watermarkAnchor === WatermarkAnchor.TopLeft && 'top-2 left-2',
                          exp.watermarkAnchor === WatermarkAnchor.TopCenter && 'top-2 left-1/2 -translate-x-1/2',
                          exp.watermarkAnchor === WatermarkAnchor.TopRight && 'top-2 right-2',
                          exp.watermarkAnchor === WatermarkAnchor.CenterLeft && 'top-1/2 left-2 -translate-y-1/2',
                          exp.watermarkAnchor === WatermarkAnchor.Center &&
                            'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
                          exp.watermarkAnchor === WatermarkAnchor.CenterRight && 'top-1/2 right-2 -translate-y-1/2',
                          exp.watermarkAnchor === WatermarkAnchor.BottomLeft && 'bottom-2 left-2',
                          exp.watermarkAnchor === WatermarkAnchor.BottomCenter &&
                            'bottom-2 left-1/2 -translate-x-1/2',
                          exp.watermarkAnchor === WatermarkAnchor.BottomRight && 'bottom-2 right-2',
                        )}
                        style={{ width: `${exp.watermarkScale * 1.6}%`, opacity: exp.watermarkOpacity / 100 }}
                      >
                        <img src={wmSrc(exp.watermarkPath)} alt="" className="w-full h-auto object-contain" />
                      </button>
                    )}
                    {exp.watermarkPath && exp.watermarkMode === 'multiple' && (
                      <div
                        className="absolute inset-0 grid pointer-events-none p-1"
                        style={{
                          opacity: exp.watermarkOpacity / 100,
                          gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(12, exp.watermarkScale * 1.4)}%, 1fr))`,
                          gap: `${Math.max(2, exp.watermarkScale / 4)}px`,
                        }}
                      >
                        {Array.from({ length: 24 }).map((_, i) => (
                          <img
                            key={i}
                            src={wmSrc(exp.watermarkPath!)}
                            alt=""
                            className="w-full h-auto object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {exp.watermarkMode === 'unique' && (
                      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                        {(
                          [
                            WatermarkAnchor.TopLeft,
                            WatermarkAnchor.TopCenter,
                            WatermarkAnchor.TopRight,
                            WatermarkAnchor.CenterLeft,
                            WatermarkAnchor.Center,
                            WatermarkAnchor.CenterRight,
                            WatermarkAnchor.BottomLeft,
                            WatermarkAnchor.BottomCenter,
                            WatermarkAnchor.BottomRight,
                          ] as const
                        ).map((a) => (
                          <button
                            key={a}
                            type="button"
                            className={clsx(
                              'min-w-0 min-h-0',
                              exp.watermarkAnchor === a ? 'ring-1 ring-accent/80 ring-inset' : 'hover:bg-white/10',
                            )}
                            onClick={() => exp.setWatermarkAnchor(a)}
                            aria-label={a}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
                {exp.watermarkMode === 'unique' && (
                  <div className="text-[10px] text-text-secondary pl-[9.5rem]">
                    {t('export.watermark.clickPlace' as any, {
                      defaultValue: 'Cliquez l’aperçu pour placer le logo.',
                    })}
                  </div>
                )}
              </div>
              </div>
            </Collapsible>

            <Collapsible
              title={t('export.sections.metadata' as any, { defaultValue: 'Métadonnées' })}
              open={openMeta}
              onToggle={() => setOpenMeta((v) => !v)}
            >
              <Field label={t('export.include' as any, { defaultValue: 'Inclure' })}>
                <PanelSelect
                  size="md"
                  value={metadataInclude}
                  onChange={(v) => setMetadataInclude(v as typeof metadataInclude)}
                  options={[
                    { value: 'all', label: t('export.metaAll' as any, { defaultValue: 'Toutes les métadonnées' }) },
                    { value: 'copyright', label: t('export.metaCopyright' as any, { defaultValue: 'Copyright uniquement' }) },
                    {
                      value: 'copyrightContact',
                      label: t('export.metaCopyrightContact' as any, { defaultValue: 'Copyright et coordonnées' }),
                    },
                    {
                      value: 'allExceptCamera',
                      label: t('export.metaExceptCamera' as any, { defaultValue: 'Tout sauf infos appareil' }),
                    },
                    { value: 'none', label: t('export.metaNone' as any, { defaultValue: 'Aucune métadonnée' }) },
                  ]}
                />
              </Field>
              <Field label="">
                <label className="flex items-center gap-2 text-[11px]">
                  <CheckBox checked={exp.stripGps} onChange={exp.setStripGps} label="gps" />
                  {t('export.removeGps' as any, { defaultValue: 'Supprimer les informations de localisation' })}
                </label>
              </Field>
            </Collapsible>
          </div>
        </div>

        <div className="shrink-0 h-11 px-3 flex items-center justify-end gap-2 border-t border-border-color/40">
          <button
            type="button"
            disabled={isExporting || paths.length === 0}
            className="h-8 px-3 rounded text-[12px] font-semibold bg-accent/90 text-button-text hover:bg-accent disabled:opacity-40"
            onClick={handleExport}
          >
            {t('export.export' as any, { defaultValue: 'Exporter' })}
          </button>
          <button
            type="button"
            className="h-8 px-3 rounded text-[12px] bg-surface border border-border-color/40 hover:bg-card-active"
            onClick={close}
          >
            {t('export.cancel' as any, { defaultValue: 'Annuler' })}
          </button>
        </div>
      </div>

      {creating && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
          onClick={() => setCreating(false)}
        >
          <div
            className="w-[22rem] rounded-md bg-surface border border-border-color/50 shadow-xl p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[12px] font-semibold">
              {t('export.newPresetTitle' as any, { defaultValue: 'Nouveau fichier Paramètre prédéfini' })}
            </div>
            <label className="block text-[11px] text-text-secondary">
              {t('export.presetName' as any, { defaultValue: 'Nom' })}
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={clsx(inputClass, 'mt-0.5')}
              />
            </label>
            <label className="block text-[11px] text-text-secondary">
              {t('export.presetFolder' as any, { defaultValue: 'Dossier' })}
              {newFolderMode ? (
                <input
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  placeholder={t('export.newFolder' as any, { defaultValue: 'Nouveau dossier…' })}
                  className={clsx(inputClass, 'mt-0.5')}
                />
              ) : (
                <div className="mt-0.5">
                  <PanelSelect
                    size="md"
                    value={newFolder}
                    onChange={(v) => {
                      if (v === '__new__') {
                        setNewFolderMode(true);
                        setFolderDraft('');
                      } else setNewFolder(v);
                    }}
                    options={[
                      ...folders.map((f) => ({ value: f, label: f })),
                      { value: '__new__', label: t('export.newFolder' as any, { defaultValue: 'Nouveau dossier…' }) },
                    ]}
                  />
                </div>
              )}
            </label>
            <div className="flex justify-end gap-1.5 pt-1">
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] hover:bg-card-active"
                onClick={() => {
                  setCreating(false);
                  setNewFolderMode(false);
                }}
              >
                {t('export.cancel' as any, { defaultValue: 'Annuler' })}
              </button>
              <button
                type="button"
                className="h-7 px-2.5 rounded text-[11px] font-semibold bg-accent/80 text-button-text"
                onClick={createPreset}
              >
                {t('export.create' as any, { defaultValue: 'Créer' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
