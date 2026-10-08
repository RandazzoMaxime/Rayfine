import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  History as HistoryIcon,
  SwatchBook,
  Compass,
  FolderHeart,
  Star,
  Images,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'react-toastify';
import { invoke } from '@tauri-apps/api/core';

import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useEditorActions } from '../../hooks/useEditorActions';
import { useContextMenu } from '../../context/ContextMenuContext';
import Text from '../ui/Text';
import { TextVariants, TextWeights } from '../../types/typography';
import { Invokes, AlbumItem, Album, AlbumGroup, ImageFile } from '../ui/AppProperties';
import { reimportDevelopFromXmpPath } from '../../utils/reimportXmp';
import DevelopPresetList from './DevelopPresetList';


const PATHS_MIME = 'application/x-rustroom-paths';

function parseDroppedPaths(e: DragEvent): string[] {
  try {
    const raw = e.dataTransfer.getData(PATHS_MIME) || e.dataTransfer.getData('text/plain');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

const HISTORY_KEYS = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'vibrance',
  'saturation',
  'clarity',
  'dehaze',
  'structure',
  'sharpness',
  'convertToGrayscale',
  'whiteBalance',
  'cameraProfile',
  'lookName',
  'processVersion',
  'toneCurveName',
  'hdrEditMode',
  'grainAmount',
  'vignetteAmount',
  'texture',
  'sharpeningAmount',
  'luminanceSeparation',
  'colorNoiseReduction',
  'lensDistortionAmount',
  'perspectiveUpright',
  'guidedUprightLines',
  'transformVertical',
  'transformHorizontal',
  'transformRotate',
  'transformDistortion',
  'transformAspect',
  'transformScale',
  'transformXOffset',
  'transformYOffset',
  'anamorphicSqueeze',
  'cropConstrainToWarp',
  'pointColors',
  'colorVariance',
] as const;

function historyLabel(history: any[], idx: number, t: (k: any, o?: any) => string): string {
  if (idx === 0) return t('ui.developLeft.historyImport' as any);
  const prev = history[idx - 1] || {};
  const curr = history[idx] || {};
  const changed: string[] = [];
  for (const key of HISTORY_KEYS) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
      changed.push(key);
    }
  }
  // nested-ish
  if (JSON.stringify(prev.hsl) !== JSON.stringify(curr.hsl)) changed.push('hsl');
  if (JSON.stringify(prev.curves) !== JSON.stringify(curr.curves)) changed.push('curves');
  if (JSON.stringify(prev.parametricCurve) !== JSON.stringify(curr.parametricCurve)) changed.push('parametric');
  if (JSON.stringify(prev.colorGrading) !== JSON.stringify(curr.colorGrading)) changed.push('color');
  if (JSON.stringify(prev.colorCalibration) !== JSON.stringify(curr.colorCalibration)) changed.push('calibration');
  if (JSON.stringify(prev.crop) !== JSON.stringify(curr.crop)) changed.push('crop');
  if (JSON.stringify(prev.masks) !== JSON.stringify(curr.masks)) changed.push('masks');
  if (JSON.stringify(prev.pointColors) !== JSON.stringify(curr.pointColors)) changed.push('pointColor');
  if (changed.length === 0) return t('ui.developLeft.historyStep' as any, { n: idx });
  const pretty = (k: string) => {
    const special: Record<string, string> = {
      perspectiveUpright: 'Upright',
      guidedUprightLines: 'Guided Upright',
      transformVertical: 'Vertical',
      transformHorizontal: 'Horizontal',
      transformRotate: 'Rotate',
      transformDistortion: 'Distortion',
      transformAspect: 'Aspect',
      transformScale: 'Scale',
      transformXOffset: 'X Offset',
      transformYOffset: 'Y Offset',
      anamorphicSqueeze: 'Anamorphic',
      cropConstrainToWarp: 'Constrain Crop',
      pointColors: 'Point Color',
      colorVariance: 'Color Variance',
      cameraProfile: 'Camera Profile',
      lookName: 'Look',
      processVersion: 'Process Version',
      toneCurveName: 'Tone Curve',
      hdrEditMode: 'HDR',
      convertToGrayscale: 'B&W',
      whiteBalance: 'White Balance',
    };
    if (special[k]) return special[k];
    return k
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  };
  // Prefer Guided Upright label when guides or upright mode changed together
  if (changed.includes('guidedUprightLines') || (changed.includes('perspectiveUpright') && Number(curr.perspectiveUpright) === 5)) {
    if (changed.length === 1 || (changed.includes('guidedUprightLines') && changed.every((c) =>
      ['guidedUprightLines', 'perspectiveUpright', 'transformVertical', 'transformHorizontal', 'transformRotate'].includes(c)
    ))) {
      return t('ui.developLeft.historyGuidedUpright' as any, { defaultValue: 'Guided Upright' });
    }
  }
  if (changed.length === 1) return pretty(changed[0]);
  return `${pretty(changed[0])} +${changed.length - 1}`;
}

interface DevelopLeftPanelProps {
  isResizing?: boolean;
  isInstantTransition?: boolean;
  width: number;
}

function Section({
  title,
  open,
  onToggle,
  children,
  action,
  titleAction,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  action?: ReactNode;
  titleAction?: ReactNode;
}) {
  return (
    <div className="flex flex-col border-b border-border-color/50 shrink-0">
      <div className="flex items-center shrink-0 hover:bg-card-active">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 pl-1.5 pr-1 py-1.5 text-left"
        >
          <ChevronRight
            size={14}
            className={clsx('text-text-secondary shrink-0 transition-transform', open && 'rotate-90')}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            {title}
          </span>
        </button>
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {titleAction}
        </div>
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 self-stretch" aria-label={title} />
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} className="pr-1">
          {action}
        </div>
      </div>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

function DevelopAlbumRows({
  items,
  depth,
  activeAlbumId,
  targetCollectionId,
  onOpenAlbum,
  onDropPhotos,
}: {
  items: AlbumItem[];
  depth: number;
  activeAlbumId: string | null;
  targetCollectionId: string | null;
  onOpenAlbum: (id: string, name: string, images: string[]) => void;
  onDropPhotos: (id: string, name: string, existing: string[], incoming: string[]) => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.type === 'group') {
          const g = item as AlbumGroup;
          const kids = g.children || [];
          return (
            <li key={g.id}>
              <div
                className="w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center gap-1.5 text-text-secondary"
                style={{ paddingLeft: 6 + depth * 12 }}
              >
                {kids.length > 0 ? <FolderOpen size={12} className="shrink-0 opacity-70" /> : <Folder size={12} className="shrink-0 opacity-70" />}
                <span className="truncate flex-1 font-medium">{g.name}</span>
                <span className="text-[10px] tabular-nums opacity-50">{kids.length}</span>
              </div>
              {kids.length > 0 ? (
                <ul className="space-y-0.5">
                  <DevelopAlbumRows
                    items={kids}
                    depth={depth + 1}
                    activeAlbumId={activeAlbumId}
                    targetCollectionId={targetCollectionId}
                    onOpenAlbum={onOpenAlbum}
                    onDropPhotos={onDropPhotos}
                  />
                </ul>
              ) : null}
            </li>
          );
        }
        const a = item as Album;
        return (
          <DevelopDropAlbum
            key={a.id}
            album={a}
            depth={depth}
            active={activeAlbumId === a.id}
            isTarget={targetCollectionId === a.id}
            onOpen={() => onOpenAlbum(a.id, a.name, a.images || [])}
            onDropPhotos={(incoming) => onDropPhotos(a.id, a.name, a.images || [], incoming)}
          />
        );
      })}
    </>
  );
}

function DevelopDropAlbum({
  album,
  depth,
  active,
  isTarget,
  onOpen,
  onDropPhotos,
}: {
  album: Album;
  depth: number;
  active: boolean;
  isTarget: boolean;
  onOpen: () => void;
  onDropPhotos: (paths: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const paths = parseDroppedPaths(e);
          if (paths.length) onDropPhotos(paths);
        }}
        className={clsx(
          'w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center gap-1.5',
          over
            ? 'bg-accent/25 text-text-primary ring-1 ring-accent/50'
            : active
              ? 'bg-card-active text-text-primary font-medium'
              : 'text-text-primary hover:bg-card-active',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <Images size={12} className="shrink-0 opacity-70" />
        <span className="truncate flex-1">
          {album.name}
          {isTarget && <span className="ml-1 text-[9px] text-amber-300" title="Target">●</span>}
        </span>
        <span className="text-[10px] tabular-nums text-text-secondary">{(album.images || []).length}</span>
      </button>
    </li>
  );
}

/**
 * Develop-mode left stack (Navigator / Presets / History / Collections).
 * Layout inspired by public Lightroom Classic Develop left column; original RustROOM chrome.
 */
export default function DevelopLeftPanel({ isInstantTransition, width }: DevelopLeftPanelProps) {
  const { t } = useTranslation();
  const [openNav, setOpenNav] = useState(false);
  const [openPresets, setOpenPresets] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [openCollections, setOpenCollections] = useState(true);

  // No `adjustments` subscription: it changes on every slider frame; read it on demand.
  const { selectedImage, history, historyIndex, goToHistoryIndex, resetHistory, zoom } = useEditorStore(
    useShallow((s) => ({
      selectedImage: s.selectedImage,
      history: s.history,
      historyIndex: s.historyIndex,
      goToHistoryIndex: s.goToHistoryIndex,
      resetHistory: s.resetHistory,
      zoom: s.zoom,
    })),
  );

  const historyLabels = useMemo(() => history.map((_: any, idx: number) => historyLabel(history, idx, t)), [history, t]);

  const handleClearHistory = () => {
    // LR-style Clear: keep current adjustments as the only history step
    resetHistory({ ...useEditorStore.getState().adjustments });
    toast.info(t('ui.developLeft.historyCleared' as any, { defaultValue: 'History cleared' }));
  };

  useEffect(() => {
    const onClear = () => handleClearHistory();
    window.addEventListener('rustroom:clear-history', onClear as EventListener);
    return () => window.removeEventListener('rustroom:clear-history', onClear as EventListener);
  }, []);

  const { setUI } = useUIStore(
    useShallow((s) => ({
      setUI: s.setUI,
    })),
  );
  const { showContextMenu } = useContextMenu();

  const {
    albumTree,
    quickCollectionPaths,
    showQuickCollectionOnly,
    targetCollectionId,
    activeAlbumId,
    setLibrary,
  } = useLibraryStore(
    useShallow((s) => ({
      albumTree: s.albumTree,
      quickCollectionPaths: s.quickCollectionPaths,
      showQuickCollectionOnly: s.showQuickCollectionOnly,
      targetCollectionId: s.targetCollectionId,
      activeAlbumId: s.activeAlbumId,
      setLibrary: s.setLibrary,
    })),
  );

  const dropPhotosOnAlbum = async (albumId: string, albumName: string, imagePaths: string[], incoming: string[]) => {
    if (!incoming.length) return;
    try {
      await invoke(Invokes.AddToAlbum, { albumId, paths: incoming });
      const tree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
      setLibrary({ albumTree: tree as AlbumItem[] });
      toast.success(
        t('ui.developLeft.droppedInto' as any, {
          defaultValue: '{{count}} photo(s) → {{name}}',
          count: incoming.length,
          name: albumName,
        }),
      );
      if (activeAlbumId === albumId) {
        const merged = Array.from(new Set([...(imagePaths || []), ...incoming]));
        await openAlbumInLibrary(albumId, albumName, merged);
      }
    } catch (err) {
      toast.error(`Drop failed: ${err}`);
    }
  };

  const leaveDevelopToLibrary = () => {
    setUI({ activeView: 'library' });
    useEditorStore.getState().setEditor({
      selectedImage: null,
      finalPreviewUrl: null,
      uncroppedAdjustedPreviewUrl: null,
      showOriginal: false,
      beforeAfterSplit: false,
      softProofing: false,
    } as any);
  };

  const openQuickCollectionInLibrary = () => {
    setLibrary({
      showQuickCollectionOnly: true,
      showPreviousImportOnly: false,
      activeAlbumId: null,
    });
  };

  const openAlbumInLibrary = async (albumId: string, albumName: string, imagePaths: string[]) => {
    try {
      setLibrary({
        isViewLoading: true,
        showQuickCollectionOnly: false,
        showPreviousImportOnly: false,
        currentFolderPath: `Album: ${albumName}`,
        activeAlbumId: albumId,
        libraryScrollTop: 0,
      });
      const files: ImageFile[] = await invoke(Invokes.GetAlbumImages, { paths: imagePaths });
      const initialRatings: Record<string, number> = {};
      files.forEach((f) => {
        if (f.rating !== undefined) initialRatings[f.path] = f.rating;
      });
      const currentPath = useEditorStore.getState().selectedImage?.path;
      const keepCurrent = currentPath && files.some((f) => f.path === currentPath);
      setLibrary({
        imageList: files,
        imageRatings: initialRatings,
        multiSelectedPaths: keepCurrent && currentPath ? [currentPath] : files[0] ? [files[0].path] : [],
        libraryActivePath: keepCurrent ? currentPath || null : files[0]?.path ?? null,
        isViewLoading: false,
      });
      if (!keepCurrent && files[0]) {
        window.dispatchEvent(new CustomEvent('rustroom:open-image', { detail: { path: files[0].path } }));
      }
    } catch (err) {
      toast.error(`Failed to load album: ${err}`);
      setLibrary({ isViewLoading: false });
    }
  };


  const { handleZoomChange, handlePasteAdjustments } = useEditorActions();
  const copiedAdjustments = useEditorStore((s) => s.copiedAdjustments);

  const imagePath = selectedImage?.path ?? null;

  useEffect(() => {
    invoke(Invokes.GetAlbums)
      .then((res: any) => setLibrary({ albumTree: res as AlbumItem[] }))
      .catch(() => {});
  }, [setLibrary]);

  const reimportFromXmp = async () => {
    if (!imagePath) {
      toast.info(t('ui.developLeft.snapshotNeedImage' as any));
      return;
    }
    try {
      await reimportDevelopFromXmpPath(imagePath);
      toast.success(t('contextMenus.toasts.reimportedXmp'));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const thumb = selectedImage?.thumbnailUrl || selectedImage?.originalUrl;


  return (
    <div
      className={clsx(
        'h-full flex flex-col bg-bg-secondary rounded-lg overflow-hidden border border-border-color/30',
        !isInstantTransition && 'transition-[width] duration-200',
      )}
      style={{ width }}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-border-color/40 shrink-0">
        <Text
          variant={TextVariants.small}
          weight={TextWeights.semibold}
          className="uppercase tracking-wider text-[10px]"
        >
          {t('ui.developLeft.title' as any)}
        </Text>
        <button
          type="button"
          className="p-1 rounded hover:bg-card-active text-text-secondary"
          data-tooltip={t('ui.developLeft.hide' as any)}
          onClick={() =>
            setUI((state) => ({
              uiVisibility: { ...state.uiVisibility, developLeft: false },
            }))
          }
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col">
      <Section
        title={t('ui.developLeft.navigator' as any)}
        open={openNav}
        onToggle={() => setOpenNav((v) => !v)}
        action={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="px-1.5 py-1 text-text-secondary hover:text-text-primary hover:bg-card-active text-[10px] uppercase tracking-wide"
              data-tooltip={t('contextMenus.editor.reimportXmp')}
              onClick={reimportFromXmp}
            >
              {t('ui.developLeft.xmpIn' as any)}
            </button>
          </div>
        }
      >
        <div
          className="relative w-full aspect-[4/3] bg-bg-primary rounded overflow-hidden flex items-center justify-center cursor-pointer"
          onClick={() => {
            // LR-ish: click navigator cycles Fit ↔ 1:1
            const z = zoom || 1;
            if (z > 0.95 && z < 1.05) handleZoomChange(1, true);
            else handleZoomChange(1, false);
          }}
          onDoubleClick={() => handleZoomChange(1, false)}
          data-tooltip={t('ui.developLeft.navigatorClickTip' as any, {
            defaultValue: 'Click: Fit / 1:1 · Double-click: 100%',
          })}
        >
          {thumb ? (
            <img src={thumb} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
          ) : (
            <span className="text-[10px] text-text-secondary">—</span>
          )}
          <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 pointer-events-none">
            <div className="flex items-center gap-0.5 pointer-events-auto">
              <button
                type="button"
                className="px-1.5 py-0.5 rounded bg-black/50 text-[9px] uppercase tracking-wide text-white/90 hover:bg-black/70"
                data-tooltip={t('ui.developLeft.zoomFit' as any)}
                onClick={() => handleZoomChange(1, true)}
              >
                {t('ui.developLeft.fit' as any)}
              </button>
              <button
                type="button"
                className="px-1.5 py-0.5 rounded bg-black/50 text-[9px] uppercase tracking-wide text-white/90 hover:bg-black/70"
                data-tooltip={t('ui.developLeft.zoom100' as any)}
                onClick={() => handleZoomChange(1, false)}
              >
                1:1
              </button>
            </div>
            <div className="px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-white/90 tabular-nums">
              {Math.round((zoom || 1) * 100)}%
            </div>
          </div>
        </div>
        {selectedImage && (
          <div className="mt-1.5 space-y-0.5">
            <div className="text-[10px] text-text-secondary truncate" title={selectedImage.path}>
              {selectedImage.path.split(/[/\\]/).pop()}
            </div>
          </div>
        )}
      </Section>

      <DevelopPresetList
        renderSection={(action, body, titleAction) => (
          <Section
            title={t('ui.developLeft.presets' as any)}
            open={openPresets}
            onToggle={() => setOpenPresets((v) => !v)}
            action={action}
            titleAction={titleAction}
          >
            {body}
          </Section>
        )}
      />

      <Section
        title={t('ui.developLeft.history' as any)}
        open={openHistory}
        onToggle={() => setOpenHistory((v) => !v)}
        action={
          history.length > 1 ? (
            <button
              type="button"
              className="text-[9px] uppercase tracking-wide text-text-secondary hover:text-text-primary px-1"
              onClick={(e) => {
                e.stopPropagation();
                handleClearHistory();
              }}
              data-tooltip={t('ui.developLeft.clearHistory' as any, {
                defaultValue: 'Clear history (keep current)',
              })}
            >
              {t('ui.developLeft.clear' as any, { defaultValue: 'Clear' })}
            </button>
          ) : null
        }
      >
        <ul className="space-y-0.5">
          {/* Newest first (classic History stack) */}
          {[...history.keys()].reverse().map((idx) => {
            const isCurrent = idx === historyIndex;
            const label = historyLabels[idx];
            return (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => goToHistoryIndex(idx)}
                  className={clsx(
                    'w-full text-left px-1.5 py-0.5 rounded text-[10px] truncate border-l-2',
                    isCurrent
                      ? 'bg-card-active text-text-primary font-medium border-white/70'
                      : 'text-text-secondary hover:bg-card-active/70 hover:text-text-primary border-transparent',
                  )}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title={t('ui.developLeft.collections' as any, { defaultValue: 'Collections' })}
        open={openCollections}
        onToggle={() => setOpenCollections((v) => !v)}
        action={
          <button
            type="button"
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-card-active"
            data-tooltip={t('library.rightPanel.createCollection' as any, { defaultValue: 'Create collection' })}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              showContextMenu(rect.left, rect.bottom + 2, [
                {
                  icon: Folder,
                  label: t('ui.developLeft.createCollection' as any, { defaultValue: 'Créer Collection…' }),
                  onClick: () => setUI({ albumActionTarget: null, isCreateAlbumModalOpen: true }),
                },
                {
                  icon: FolderPlus,
                  label: t('ui.developLeft.createCollectionSet' as any, {
                    defaultValue: 'Créer Ensemble de collections…',
                  }),
                  onClick: () => setUI({ albumActionTarget: null, isCreateAlbumGroupModalOpen: true }),
                },
              ]);
            }}
          >
            <Plus size={14} />
          </button>
        }
      >
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              onClick={openQuickCollectionInLibrary}
              className={clsx(
                'w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center gap-1.5',
                showQuickCollectionOnly
                  ? 'bg-card-active text-text-primary font-medium'
                  : 'text-text-primary hover:bg-card-active',
              )}
              data-tooltip={t('ui.developLeft.quickCollectionHint' as any, {
                defaultValue: 'B to add · Ctrl+B to show',
              })}
            >
              <Star
                size={12}
                className={clsx(
                  'shrink-0',
                  (quickCollectionPaths?.length || 0) > 0 && 'fill-amber-300 text-amber-300',
                )}
              />
              <span className="truncate flex-1">
                {t('library.folders.catalogQuickCollection' as any, { defaultValue: 'Quick Collection' })}
                {!targetCollectionId && (
                  <span className="ml-1 text-[9px] text-amber-300" title="Target">●</span>
                )}
              </span>
              <span className="text-[10px] tabular-nums text-text-secondary">
                {quickCollectionPaths?.length || 0}
              </span>
            </button>
          </li>
          {(albumTree || []).length === 0 ? (
            <li className="px-1.5 py-1 text-[10px] text-text-secondary">
              {t('ui.developLeft.noAlbums' as any, { defaultValue: 'No albums yet' })}
            </li>
          ) : (
            <DevelopAlbumRows
              items={albumTree || []}
              depth={0}
              activeAlbumId={activeAlbumId}
              targetCollectionId={targetCollectionId}
              onOpenAlbum={openAlbumInLibrary}
              onDropPhotos={dropPhotosOnAlbum}
            />
          )}
        </ul>
      </Section>
      </div>

      <div className="shrink-0 flex border-t border-border-color/50">
        <button
          type="button"
          className="flex-1 h-8 text-[12px] text-text-primary bg-surface/80 hover:bg-card-active disabled:opacity-40 disabled:hover:bg-surface/80 border-r border-border-color/40"
          disabled={!selectedImage}
          onClick={() => setUI({ isCopyPasteSettingsModalOpen: true })}
          data-tooltip="Ctrl+C"
        >
          {t('ui.developLeft.copy' as any, { defaultValue: 'Copy' })}
        </button>
        <button
          type="button"
          className="flex-1 h-8 text-[12px] text-text-primary bg-surface/80 hover:bg-card-active disabled:opacity-40 disabled:hover:bg-surface/80"
          disabled={!copiedAdjustments}
          onClick={() => handlePasteAdjustments()}
          data-tooltip="Ctrl+V"
        >
          {t('ui.developLeft.paste' as any, { defaultValue: 'Paste' })}
        </button>
      </div>
    </div>
  );
}

/** Collapsed rail to re-show the develop left column */
export function DevelopLeftRail({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onShow}
      className="h-full w-8 flex flex-col items-center justify-start pt-2 gap-2 bg-bg-secondary rounded-lg border border-border-color/30 text-text-secondary hover:text-text-primary"
      data-tooltip={t('ui.developLeft.show' as any)}
    >
      <ChevronRight size={14} />
      <Compass size={14} />
      <SwatchBook size={14} />
      <HistoryIcon size={14} />
      <FolderHeart size={14} />
    </button>
  );
}
