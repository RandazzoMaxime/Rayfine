import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History as HistoryIcon,
  SwatchBook,
  Compass,
  FolderHeart,
  Star,
  Images,
  LayoutGrid,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'react-toastify';
import { invoke } from '@tauri-apps/api/core';

import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useEditorActions } from '../../hooks/useEditorActions';
import Text from '../ui/Text';
import { TextVariants, TextWeights } from '../../types/typography';
import { Invokes, AlbumItem, Album, AlbumGroup, ImageFile } from '../ui/AppProperties';
import { reimportDevelopFromXmpPath } from '../../utils/reimportXmp';
import DevelopPresetList from './DevelopPresetList';


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
  icon: Icon,
  open,
  onToggle,
  children,
  tall,
  action,
}: {
  title: string;
  icon: typeof Compass;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  tall?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={clsx('flex flex-col border-b border-border-color/50 min-h-0', tall && 'flex-1')}>
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center justify-between px-2.5 py-1.5 text-left hover:bg-card-active"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            <Icon size={12} />
            {title}
          </span>
          <ChevronDown size={14} className={clsx('text-text-secondary transition-transform', open && 'rotate-180')} />
        </button>
        {action}
      </div>
      {open && (
        <div className={clsx('min-h-0 px-2 pb-2', tall ? 'flex-1 overflow-y-auto custom-scrollbar' : '')}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Develop-mode left stack (Navigator / Presets / History / Collections).
 * Layout inspired by public Lightroom Classic Develop left column; original RustROOM chrome.
 */
export default function DevelopLeftPanel({ isInstantTransition, width }: DevelopLeftPanelProps) {
  const { t } = useTranslation();
  const [openNav, setOpenNav] = useState(true);
  const [openPresets, setOpenPresets] = useState(true);
  const [openHistory, setOpenHistory] = useState(true);
  const [openCollections, setOpenCollections] = useState(true);

  const { selectedImage, adjustments, history, historyIndex, goToHistoryIndex, resetHistory, zoom } = useEditorStore(
    useShallow((s) => ({
      selectedImage: s.selectedImage,
      adjustments: s.adjustments,
      history: s.history,
      historyIndex: s.historyIndex,
      goToHistoryIndex: s.goToHistoryIndex,
      resetHistory: s.resetHistory,
      zoom: s.zoom,
    })),
  );

  const handleClearHistory = () => {
    // LR-style Clear: keep current adjustments as the only history step
    resetHistory({ ...adjustments });
    toast.info(t('ui.developLeft.historyCleared' as any, { defaultValue: 'History cleared' }));
  };

  useEffect(() => {
    const onClear = () => handleClearHistory();
    window.addEventListener('rustroom:clear-history', onClear as EventListener);
    return () => window.removeEventListener('rustroom:clear-history', onClear as EventListener);
  }, [adjustments]);

  const { setUI } = useUIStore(
    useShallow((s) => ({
      setUI: s.setUI,
    })),
  );

  const {
    albumTree,
    quickCollectionPaths,
    showQuickCollectionOnly,
    targetCollectionId,
    setLibrary,
  } = useLibraryStore(
    useShallow((s) => ({
      albumTree: s.albumTree,
      quickCollectionPaths: s.quickCollectionPaths,
      showQuickCollectionOnly: s.showQuickCollectionOnly,
      targetCollectionId: s.targetCollectionId,
      setLibrary: s.setLibrary,
    })),
  );

  const flatAlbums = useMemo(() => {
    const out: { id: string; name: string; images: string[] }[] = [];
    const walk = (nodes: AlbumItem[]) => {
      for (const n of nodes || []) {
        if (n.type === 'album') {
          const a = n as Album;
          out.push({ id: a.id, name: a.name, images: a.images || [] });
        } else if (n.type === 'group') {
          walk((n as AlbumGroup).children || []);
        }
      }
    };
    walk(albumTree || []);
    return out;
  }, [albumTree]);

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
    leaveDevelopToLibrary();
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
      leaveDevelopToLibrary();
      const files: ImageFile[] = await invoke(Invokes.GetAlbumImages, { paths: imagePaths });
      const initialRatings: Record<string, number> = {};
      files.forEach((f) => {
        if (f.rating !== undefined) initialRatings[f.path] = f.rating;
      });
      setLibrary({
        imageList: files,
        imageRatings: initialRatings,
        multiSelectedPaths: [],
        libraryActivePath: null,
        isViewLoading: false,
      });
    } catch (err) {
      toast.error(`Failed to load album: ${err}`);
      setLibrary({ isViewLoading: false });
    }
  };


  const { handleZoomChange } = useEditorActions();

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
        <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="p-1 rounded hover:bg-card-active text-text-secondary hover:text-text-primary"
          data-tooltip={t('ui.developLeft.presetBrowser' as any, { defaultValue: 'Preset Browser' })}
          onClick={() => setUI({ isPresetBrowserOpen: true })}
        >
          <LayoutGrid size={14} />
        </button>
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
      </div>

      <Section
        title={t('ui.developLeft.navigator' as any)}
        icon={Compass}
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
            {selectedImage.width > 0 && selectedImage.height > 0 && (
              <div className="text-[10px] text-text-secondary/80 tabular-nums">
                {selectedImage.width} × {selectedImage.height}
                {selectedImage.isRaw ? ' · RAW' : ''}
              </div>
            )}
          </div>
        )}
      </Section>

      <DevelopPresetList
        renderSection={(action, body) => (
          <Section
            title={t('ui.developLeft.presets' as any)}
            icon={SwatchBook}
            open={openPresets}
            onToggle={() => setOpenPresets((v) => !v)}
            tall
            action={action}
          >
            {body}
          </Section>
        )}
      />

      <Section
        title={t('ui.developLeft.history' as any)}
        icon={HistoryIcon}
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
        <ul className="space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar">
          {/* Newest first (classic History stack) */}
          {[...history.keys()].reverse().map((idx) => {
            const isCurrent = idx === historyIndex;
            const label = historyLabel(history, idx, t);
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
        icon={FolderHeart}
        open={openCollections}
        onToggle={() => setOpenCollections((v) => !v)}
      >
        <ul className="space-y-0.5 max-h-40 overflow-y-auto custom-scrollbar">
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
          {flatAlbums.length === 0 ? (
            <li className="px-1.5 py-1 text-[10px] text-text-secondary">
              {t('ui.developLeft.noAlbums' as any, { defaultValue: 'No albums yet' })}
            </li>
          ) : (
            flatAlbums.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => openAlbumInLibrary(a.id, a.name, a.images)}
                  className="w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center gap-1.5 text-text-primary hover:bg-card-active"
                >
                  <Images size={12} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">
                    {a.name}
                    {targetCollectionId === a.id && (
                      <span className="ml-1 text-[9px] text-amber-300" title="Target">●</span>
                    )}
                  </span>
                  <span className="text-[10px] tabular-nums text-text-secondary">{a.images.length}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </Section>
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
