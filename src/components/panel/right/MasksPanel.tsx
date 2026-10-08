import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  pointerWithin,
} from '@dnd-kit/core';
import {
  ChevronDown,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileEdit,
  FolderOpen,
  Folder as FolderIcon,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  RotateCcw,
  Trash2,
  SwatchBook,
  SquaresIntersect,
} from 'lucide-react';

import CollapsibleSection from '../../ui/CollapsibleSection';
import Switch from '../../ui/Switch';
import Slider from '../../ui/Slider';
import BasicAdjustments from '../../adjustments/Basic';
import CurveGraph from '../../adjustments/Curves';
import ColorPanel, { ColorGradingPanel } from '../../adjustments/Color';
import DetailsPanel from '../../adjustments/Details';
import EffectsPanel from '../../adjustments/Effects';
import { DepthRangePicker } from '../../ui/DepthRangePicker';

import {
  Mask,
  MaskType,
  SubMask,
  MASK_PANEL_CREATION_TYPES,
  OTHERS_MASK_TYPES,
  MASK_ICON_MAP,
  SubMaskMode,
  ToolType,
  formatMaskTypeName,
  getSubMaskName,
  getMaskTypeName,
} from './Masks';
import {
  Adjustments,
  INITIAL_MASK_ADJUSTMENTS,
  INITIAL_MASK_CONTAINER,
  MaskContainer,
  ADJUSTMENT_SECTIONS,
} from '../../../utils/adjustments';
import { useContextMenu } from '../../../context/ContextMenuContext';
import AddMaskMenu, { type AddMaskAction } from './AddMaskMenu';
import { OPTION_SEPARATOR, Orientation } from '../../ui/AppProperties';
import { createSubMask } from '../../../utils/maskUtils';
import { usePresets } from '../../../hooks/usePresets';
import Text from '../../ui/Text';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { useAiMasking } from '../../../hooks/useAiMasking';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useUIStore } from '../../../store/useUIStore';

interface DragData {
  type: 'Container' | 'SubMask' | 'Creation';
  item?: MaskContainer | SubMask;
  maskType?: Mask;
  parentId?: string;
}

const SUB_MASK_CONFIG: Record<Mask, any> = {
  [Mask.Radial]: {
    parameters: [{ key: 'feather', min: 0, max: 100, step: 1, multiplier: 100, defaultValue: 50 }],
  },
  [Mask.Brush]: { showBrushTools: true },
  [Mask.Clone]: { showBrushTools: true },
  [Mask.Heal]: { showBrushTools: true },
  [Mask.Flow]: { showBrushTools: true, showFlowControl: true },
  [Mask.Linear]: { parameters: [] },
  [Mask.Color]: {
    parameters: [{ key: 'refine', min: 0, max: 100, step: 1, defaultValue: 50 }],
  },
  [Mask.Luminance]: {
    parameters: [
      { key: 'rangeLow', min: 0, max: 100, step: 1, defaultValue: 0 },
      { key: 'rangeHigh', min: 0, max: 100, step: 1, defaultValue: 100 },
      { key: 'smoothness', min: 0, max: 100, step: 1, defaultValue: 50 },
    ],
  },
  [Mask.All]: { parameters: [] },
  [Mask.AiDepth]: {
    parameters: [{ key: 'feather', min: 0, max: 100, step: 1, defaultValue: 15 }],
  },
  [Mask.AiSubject]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiForeground]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiSky]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.QuickEraser]: { parameters: [] },
};

const BrushTools = ({
  settings,
  onSettingsChange,
  onDragStateChange,
}: {
  settings: any;
  onSettingsChange: any;
  onDragStateChange?: (isDragging: boolean) => void;
}) => {
  const { t } = useTranslation();

  return (
    <div>
      <Slider
        defaultValue={100}
        label={t('editor.masks.brush.size')}
        data-tooltip={t('editor.masks.brush.sizeTip' as any, { defaultValue: '[ ] or Ctrl+↑/↓' })}
        max={200}
        min={1}
        onChange={(e: any) => onSettingsChange((s: any) => ({ ...s, size: Number(e.target.value) }))}
        step={1}
        value={settings.size}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <Slider
        defaultValue={50}
        label={t('editor.masks.brush.feather')}
        data-tooltip={t('editor.masks.brush.featherTip' as any, { defaultValue: 'Ctrl+Shift+↑/↓' })}
        max={100}
        min={0}
        onChange={(e: any) => onSettingsChange((s: any) => ({ ...s, feather: Number(e.target.value) }))}
        step={1}
        value={settings.feather}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <div className="grid grid-cols-2 gap-2 pt-2">
        <button
          type="button"
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Brush ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
          data-tooltip={t('editor.masks.brush.brushTip' as any, { defaultValue: 'Brush (E)' })}
          onClick={() => onSettingsChange((s: any) => ({ ...s, tool: ToolType.Brush }))}
        >
          {t('editor.masks.brush.brush')}
        </button>
        <button
          type="button"
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Eraser ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
          data-tooltip={t('editor.masks.brush.eraserTip' as any, { defaultValue: 'Eraser (E)' })}
          onClick={() => onSettingsChange((s: any) => ({ ...s, tool: ToolType.Eraser }))}
        >
          {t('editor.masks.brush.eraser')}
        </button>
      </div>
    </div>
  );
};

const FlowBrushTool = ({
  flow,
  onFlowChange,
  settings,
  onSettingsChange,
  onDragStateChange,
}: {
  flow: number;
  onFlowChange: (flow: number) => void;
  settings: any;
  onSettingsChange: any;
  onDragStateChange?: (isDragging: boolean) => void;
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 border-t border-surface">
      <Slider
        defaultValue={10}
        label={t('editor.masks.brush.flow')}
        max={100}
        min={0}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onFlowChange(Number(e.target.value))}
        step={1}
        value={flow}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <BrushTools settings={settings} onSettingsChange={onSettingsChange} onDragStateChange={onDragStateChange} />
    </div>
  );
};

/**
 * A mask adjustment section, re-rendered only when its own props change: dragging a
 * sub-mask rewrites `adjustments.masks` every frame without touching these values.
 */
const MaskSection = memo(({ Component, ...props }: { Component: any; [key: string]: any }) => (
  <Component {...props} />
));

export default function MasksPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { handleGenerateAiDepthMask, handleGenerateAiForegroundMask, handleGenerateAiSkyMask } = useAiMasking();
  const setCustomEscapeHandler = useUIStore((s) => s.setCustomEscapeHandler);
  const { appSettings } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
    })),
  );

  const { aiModelDownloadStatus } = useProcessStore(
    useShallow((state) => ({
      aiModelDownloadStatus: state.aiModelDownloadStatus,
    })),
  );

  const {
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    copiedMask,
    isGeneratingAiMask,
    selectedImage,
    showMaskOverlay,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      activeMaskContainerId: state.activeMaskContainerId,
      activeMaskId: state.activeMaskId,
      adjustments: state.adjustments,
      brushSettings: state.brushSettings,
      copiedMask: state.copiedMask,
      isGeneratingAiMask: state.isGeneratingAiMask,
      selectedImage: state.selectedImage,
      showMaskOverlay: state.showMaskOverlay !== false,
      setEditor: state.setEditor,
    })),
  );

  const setBrushSettings = useCallback(
    (updater: any) => {
      setEditor((state) => ({ brushSettings: typeof updater === 'function' ? updater(state.brushSettings) : updater }));
    },
    [setEditor],
  );
  const selectBrushToolForNewMask = useCallback(() => {
    setEditor((state) => ({
      brushSettings: {
        ...(state.brushSettings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
        tool: ToolType.Brush,
      },
    }));
  }, [setEditor]);

  const setCopiedMask = useCallback((mask: MaskContainer) => setEditor({ copiedMask: mask }), [setEditor]);
  const setIsMaskControlHovered = useCallback(
    (hovered: boolean) => setEditor({ isMaskControlHovered: hovered }),
    [setEditor],
  );
  const onDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );
  const onSelectContainer = useCallback((id: string | null) => setEditor({ activeMaskContainerId: id }), [setEditor]);
  const onSelectMask = useCallback((id: string | null) => setEditor({ activeMaskId: id }), [setEditor]);

  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set());
  const [addMenu, setAddMenu] = useState<null | {
    anchor: { left: number; top: number; bottom: number };
    target: { kind: 'new' } | { kind: 'component'; containerId: string; mode: SubMaskMode };
    title?: string;
  }>(null);
  const [maskListCollapsed, setMaskListCollapsed] = useState(false);
  const [canvasHost, setCanvasHost] = useState<HTMLElement | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<DragData | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [copiedSubMask, setCopiedSubMask] = useState<SubMask | null>(null);
  const [collapsibleState, setCollapsibleState] = useState<any>({
    basic: true,
    curves: false,
    color: false,
    colorGrading: false,
    details: false,
    effects: false,
  });
  const [copiedSectionAdjustments, setCopiedSectionAdjustments] = useState<any | null>(null);
  const [isSettingsSectionOpen, setSettingsSectionOpen] = useState(true);
  const [isSettingsPanelEverOpened, setIsSettingsPanelEverOpened] = useState(false);
  const hasPerformedInitialSelection = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [analyzingSubMaskId, setAnalyzingSubMaskId] = useState<string | null>(null);

  const { showContextMenu } = useContextMenu();
  const { presets } = usePresets(adjustments);

  const { setNodeRef: setRootDroppableRef, isOver: isRootOver } = useDroppable({ id: 'mask-list-root' });

  const activeContainer = adjustments.masks?.find((m) => m.id === activeMaskContainerId);
  const activeSubMaskData = activeContainer?.subMasks?.find((sm) => sm.id === activeMaskId);
  const isAiMask =
    activeSubMaskData && [Mask.AiSubject, Mask.AiForeground, Mask.AiSky, Mask.AiDepth].includes(activeSubMaskData.type);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isGeneratingAiMask && isAiMask) {
      timer = setTimeout(() => {
        setAnalyzingSubMaskId(activeMaskId);
      }, 200);
    } else {
      setAnalyzingSubMaskId(null);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isGeneratingAiMask, isAiMask, activeMaskId]);

  useEffect(() => {
    if (activeMaskContainerId) {
      const containerExists = adjustments.masks?.some((m) => m.id === activeMaskContainerId);
      if (!containerExists) {
        onSelectContainer(null);
        onSelectMask(null);
      }
    }
  }, [adjustments.masks, activeMaskContainerId, onSelectContainer, onSelectMask]);

  useEffect(() => {
    if (!hasPerformedInitialSelection.current && !activeMaskContainerId && adjustments.masks?.length > 0) {
      const lastMask = adjustments.masks[adjustments.masks.length - 1];
      if (lastMask) {
        onSelectContainer(lastMask.id);
        onSelectMask(null);
      }
    }

    if (activeMaskContainerId) {
      const shouldAutoExpand = !hasPerformedInitialSelection.current || activeMaskId;

      if (shouldAutoExpand) {
        setExpandedContainers((prev) => {
          if (prev.has(activeMaskContainerId)) {
            return prev;
          }
          return new Set(prev).add(activeMaskContainerId);
        });
      }

      hasPerformedInitialSelection.current = true;
    }

    if (activeMaskContainerId || adjustments.masks?.length > 0) {
      setIsSettingsPanelEverOpened(true);
    }
  }, [activeMaskContainerId, activeMaskId, adjustments.masks, onSelectContainer, onSelectMask]);

  useEffect(() => {
    const handler = () => {
      if (renamingId) {
        setRenamingId(null);
        setTempName('');
      } else if (activeMaskId) onSelectMask(null);
      else if (activeMaskContainerId) onSelectContainer(null);
    };
    if (activeMaskContainerId || renamingId) setCustomEscapeHandler(() => handler);
    else setCustomEscapeHandler(null);
    return () => setCustomEscapeHandler(null);
  }, [activeMaskContainerId, activeMaskId, renamingId, onSelectContainer, onSelectMask, setCustomEscapeHandler]);

  const handleDeselect = () => {
    onSelectContainer(null);
    onSelectMask(null);
  };

  const handleToggleExpand = (id: string) => {
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResetAllMasks = () => {
    handleDeselect();
    setAdjustments((prev: any) => ({ ...prev, masks: [] }));
  };

  const createMaskLogic = (type: Mask, mode: SubMaskMode = SubMaskMode.Additive) => {
    if (!selectedImage) return createSubMask(type, {} as any, mode);
    const subMask = createSubMask(type, selectedImage, mode);

    const steps = adjustments?.orientationSteps || 0;
    const isRotated = steps === 1 || steps === 3;
    const imgW = isRotated ? selectedImage.height || 1000 : selectedImage.width || 1000;
    const imgH = isRotated ? selectedImage.width || 1000 : selectedImage.height || 1000;

    const parameters: any = (subMask as any).parameters || {};
    if (type === Mask.Linear) {
      parameters.range = Math.min(imgW, imgH) * 0.1;
    }

    if (type === Mask.Linear || type === Mask.Radial || type === Mask.Color) {
      parameters.isInitialDraw = true;
      if (type === Mask.Linear || type === Mask.Radial) {
        parameters.startX = -10000;
        parameters.startY = -10000;
        parameters.endX = -10000;
        parameters.endY = -10000;
        parameters.centerX = -10000;
        parameters.centerY = -10000;
        parameters.radiusX = 0;
        parameters.radiusY = 0;
      } else {
        parameters.targetX = -10000;
        parameters.targetY = -10000;
        parameters.samples = [];
        parameters.refine = 50;
      }
    }
    if (type === Mask.Luminance) {
      Object.assign(parameters, { rangeLow: 0, rangeHigh: 100, smoothness: 50 });
    }

    if (type === Mask.AiDepth) {
      parameters.minDepth = 20;
      parameters.maxDepth = 80;
      parameters.minFade = 15;
      parameters.maxFade = 15;
      parameters.feather = 10;
    }
    (subMask as any).parameters = parameters;
    return subMask;
  };

  const handleAddMaskContainer = (type: Mask, options?: { invert?: boolean; name?: string }) => {
    const subMask = createMaskLogic(type);
    if (options?.invert) subMask.invert = true;
    if (options?.name) subMask.name = options.name;
    const count = (adjustments.masks?.length || 0) + 1;
    const newContainer = {
      ...INITIAL_MASK_CONTAINER,
      id: uuidv4(),
      name: t('editor.masks.patches.maskName', { count }),
      subMasks: [subMask],
    };
    setAdjustments((prev: Adjustments) => ({ ...prev, masks: [...(prev.masks || []), newContainer] }));
    onSelectContainer(newContainer.id);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(newContainer.id));
    if (type === Mask.Brush || type === Mask.Flow) selectBrushToolForNewMask();
    if (type === Mask.AiForeground) handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiSky) handleGenerateAiSkyMask(subMask.id);
    else if (type === Mask.AiDepth) handleGenerateAiDepthMask(subMask.id, subMask.parameters);
  };

  const applyAddMask = (action: AddMaskAction) => {
    if (action === 'background') {
      handleAddMaskContainer(Mask.AiForeground, {
        invert: true,
        name: t('editor.masks.addMenu.background'),
      });
      return;
    }
    const typeByAction: Record<Exclude<AddMaskAction, 'background'>, Mask> = {
      subject: Mask.AiSubject,
      sky: Mask.AiSky,
      foreground: Mask.AiForeground,
      brush: Mask.Brush,
      flow: Mask.Flow,
      linear: Mask.Linear,
      radial: Mask.Radial,
      color: Mask.Color,
      luminance: Mask.Luminance,
      depth: Mask.AiDepth,
      all: Mask.All,
    };
    handleAddMaskContainer(typeByAction[action]);
  };

  const addComponentFromAction = (containerId: string, action: AddMaskAction, mode: SubMaskMode) => {
    if (action === 'background') {
      handleAddSubMask(containerId, Mask.AiForeground, mode, -1, {
        invert: true,
        name: t('editor.masks.addMenu.background'),
      });
      return;
    }
    const typeByAction: Record<Exclude<AddMaskAction, 'background'>, Mask> = {
      subject: Mask.AiSubject,
      sky: Mask.AiSky,
      foreground: Mask.AiForeground,
      brush: Mask.Brush,
      flow: Mask.Flow,
      linear: Mask.Linear,
      radial: Mask.Radial,
      color: Mask.Color,
      luminance: Mask.Luminance,
      depth: Mask.AiDepth,
      all: Mask.All,
    };
    handleAddSubMask(containerId, typeByAction[action], mode);
  };

  const deleteEmptyMasks = () => {
    const emptyIds = new Set(
      (adjustments.masks || []).filter((m) => !(m.subMasks?.length)).map((m) => m.id),
    );
    if (emptyIds.size === 0) return;
    if (activeMaskContainerId && emptyIds.has(activeMaskContainerId)) handleDeselect();
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: (prev.masks || []).filter((m) => !emptyIds.has(m.id)),
    }));
  };

  const applyAddMaskRef = useRef(applyAddMask);
  applyAddMaskRef.current = applyAddMask;

  useEffect(() => {
    setCanvasHost(document.getElementById('editor-canvas-stage'));
  }, []);

  useEffect(() => {
    const onAdd = (event: Event) => {
      const action = (event as CustomEvent<AddMaskAction>).detail;
      if (!action) return;
      applyAddMaskRef.current(action);
      setAddMenu(null);
    };
    window.addEventListener('rayfine:add-mask', onAdd);
    return () => window.removeEventListener('rayfine:add-mask', onAdd);
  }, []);

  const handleAddSubMask = (
    containerId: string,
    type: Mask,
    mode: SubMaskMode = SubMaskMode.Additive,
    insertIndex: number = -1,
    options?: { invert?: boolean; name?: string },
  ) => {
    const subMask = createMaskLogic(type, mode);
    if (options?.invert) subMask.invert = true;
    if (options?.name) subMask.name = options.name;
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks?.map((c: MaskContainer) => {
        if (c.id === containerId) {
          const newSubMasks = [...c.subMasks];
          if (insertIndex >= 0) {
            newSubMasks.splice(insertIndex, 0, subMask);
          } else {
            newSubMasks.push(subMask);
          }
          return { ...c, subMasks: newSubMasks };
        }
        return c;
      }),
    }));
    onSelectContainer(containerId);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
    if (type === Mask.Brush || type === Mask.Flow) selectBrushToolForNewMask();
    if (type === Mask.AiForeground) handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiSky) handleGenerateAiSkyMask(subMask.id);
    else if (type === Mask.AiDepth) handleGenerateAiDepthMask(subMask.id, subMask.parameters);
  };

  const handleGridClick = (type: Mask, forceNewMaskContainer: boolean = false) => {
    if (!forceNewMaskContainer && activeMaskContainerId) handleAddSubMask(activeMaskContainerId, type);
    else handleAddMaskContainer(type);
  };

  const handleGridRightClick = (event: React.MouseEvent, type: Mask | null) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    if (!type) return;
    handleGridClick(type, true);
  };

  const handleAddOthersMask = (event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const options = OTHERS_MASK_TYPES.map((maskType) => ({
      label: getMaskTypeName(maskType),
      icon: maskType.icon,
      onClick: () => handleGridClick(maskType.type),
      onRightClick: () => handleGridClick(maskType.type, true),
    }));
    showContextMenu(rect.left, rect.bottom + 5, options);
  };

  const handleAddMaskContextMenu = (event: React.MouseEvent, targetContainerId?: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    const buildMenu = (types: MaskType[], mode: SubMaskMode = SubMaskMode.Additive) =>
      types.map((maskType: MaskType) => ({
        label: getMaskTypeName(maskType),
        icon: maskType.icon,
        disabled: maskType.disabled,
        onClick: () => {
          if (targetContainerId) {
            handleAddSubMask(targetContainerId, maskType.type, mode);
          } else {
            handleAddMaskContainer(maskType.type);
          }
        },
      }));

    const container = targetContainerId ? adjustments.masks?.find((m) => m.id === targetContainerId) : null;
    const hasComponents = container && container.subMasks.length > 0;

    const buildModeSubmenu = (label: string, icon: any, mode: SubMaskMode) => ({
      label,
      icon,
      submenu: MASK_PANEL_CREATION_TYPES.map((maskType) => {
        if (maskType.id === 'others') {
          return {
            label: getMaskTypeName(maskType),
            icon: maskType.icon,
            submenu: buildMenu(OTHERS_MASK_TYPES, mode),
          };
        }
        return {
          label: getMaskTypeName(maskType),
          icon: maskType.icon,
          disabled: maskType.disabled,
          onClick: () => handleAddSubMask(targetContainerId!, maskType.type, mode),
        };
      }),
    });

    const options: any[] = buildMenu(
      MASK_PANEL_CREATION_TYPES.filter((m) => m.id !== 'others'),
      SubMaskMode.Additive,
    );
    const others = MASK_PANEL_CREATION_TYPES.find((m) => m.id === 'others');
    if (others) {
      options.push({
        label: getMaskTypeName(others),
        icon: others.icon,
        submenu: buildMenu(OTHERS_MASK_TYPES, SubMaskMode.Additive),
      });
    }

    if (targetContainerId && hasComponents) {
      options.push(
        { type: OPTION_SEPARATOR },
        buildModeSubmenu(t('editor.masks.actions.subtractFromMask'), Minus, SubMaskMode.Subtractive),
        buildModeSubmenu(t('editor.masks.actions.intersectMaskWith'), SquaresIntersect, SubMaskMode.Intersect),
      );
    }

    showContextMenu(rect.left, rect.bottom + 5, options);
  };

  const updateContainer = (id: string, data: any) =>
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) => (m.id === id ? { ...m, ...data } : m)),
    }));
  const updateSubMask = (id: string, data: any) =>
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) => ({
        ...m,
        subMasks: m.subMasks.map((sm) => (sm.id === id ? { ...sm, ...data } : sm)),
      })),
    }));

  const handleDeleteContainer = (id: string) => {
    if (activeMaskContainerId === id) handleDeselect();
    setAdjustments((prev: Adjustments) => ({ ...prev, masks: prev.masks.filter((m) => m.id !== id) }));
  };

  const handleDeleteSubMask = (containerId: string, subMaskId: string) => {
    if (activeMaskId === subMaskId) onSelectMask(null);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) =>
        m.id === containerId ? { ...m, subMasks: m.subMasks.filter((sm) => sm.id !== subMaskId) } : m,
      ),
    }));
  };

  const cloneMaskContainerData = (
    container: MaskContainer,
    options: { invert?: boolean; rename?: boolean; resetAdjustments?: boolean } = {},
  ): MaskContainer => {
    const clonedContainer = JSON.parse(JSON.stringify(container));

    clonedContainer.id = uuidv4();
    clonedContainer.invert = options.invert ? !clonedContainer.invert : clonedContainer.invert;
    clonedContainer.name =
      options.rename === false ? clonedContainer.name : t('editor.masks.patches.copyName', { name: container.name });
    clonedContainer.subMasks = clonedContainer.subMasks.map((subMask: SubMask) => ({
      ...subMask,
      id: uuidv4(),
    }));

    if (options.resetAdjustments) {
      clonedContainer.adjustments = JSON.parse(JSON.stringify(INITIAL_MASK_ADJUSTMENTS));
    }

    return clonedContainer;
  };

  const cloneSubMaskData = (subMask: SubMask, options: { invert?: boolean; rename?: boolean } = {}): SubMask => {
    const clonedSubMask = JSON.parse(JSON.stringify(subMask));

    clonedSubMask.id = uuidv4();
    clonedSubMask.invert = options.invert ? !clonedSubMask.invert : clonedSubMask.invert;
    clonedSubMask.name =
      options.rename === false
        ? clonedSubMask.name
        : t('editor.masks.patches.copyName', { name: getSubMaskName(subMask) });

    return clonedSubMask;
  };

  const copyMaskToClipboard = (container: MaskContainer) => {
    setCopiedMask(JSON.parse(JSON.stringify(container)));
  };

  const copySubMaskToClipboard = (subMask: SubMask) => {
    setCopiedSubMask(JSON.parse(JSON.stringify(subMask)));
  };

  const insertMaskContainer = (container: MaskContainer, insertIndex?: number) => {
    setAdjustments((prev: Adjustments) => {
      const newMasks = [...(prev.masks || [])];
      const targetIndex = Math.max(0, Math.min(insertIndex ?? newMasks.length, newMasks.length));

      newMasks.splice(targetIndex, 0, container);

      return { ...prev, masks: newMasks };
    });

    onSelectContainer(container.id);
    onSelectMask(null);
    setExpandedContainers((prev) => new Set(prev).add(container.id));
  };

  const insertSubMaskIntoContainer = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((container) => {
        if (container.id !== containerId) {
          return container;
        }

        const newSubMasks = [...container.subMasks];
        const targetIndex = Math.max(0, Math.min(insertIndex ?? newSubMasks.length, newSubMasks.length));

        newSubMasks.splice(targetIndex, 0, subMask);

        return { ...container, subMasks: newSubMasks };
      }),
    }));

    onSelectContainer(containerId);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
  };

  const handleDuplicateContainer = (container: MaskContainer) => {
    const containerIndex = adjustments.masks.findIndex((mask) => mask.id === container.id);
    const duplicatedContainer = cloneMaskContainerData(container, { rename: true, resetAdjustments: true });

    insertMaskContainer(duplicatedContainer, containerIndex >= 0 ? containerIndex + 1 : undefined);
  };

  const handleDuplicateAndInvertContainer = (container: MaskContainer) => {
    const containerIndex = adjustments.masks.findIndex((mask) => mask.id === container.id);
    const duplicatedContainer = cloneMaskContainerData(container, {
      invert: true,
      rename: false,
      resetAdjustments: true,
    });
    duplicatedContainer.name = t('editor.masks.patches.invertedName', { name: container.name });

    insertMaskContainer(duplicatedContainer, containerIndex >= 0 ? containerIndex + 1 : undefined);
  };

  const handlePasteMask = (insertAfterContainerId?: string) => {
    if (!copiedMask) {
      return;
    }

    const pastedContainer = cloneMaskContainerData(copiedMask, { rename: false });
    const containerIndex = insertAfterContainerId
      ? adjustments.masks.findIndex((mask) => mask.id === insertAfterContainerId)
      : -1;

    insertMaskContainer(pastedContainer, containerIndex >= 0 ? containerIndex + 1 : undefined);
  };

  useEffect(() => {
    const onCopy = () => {
      if (!activeMaskContainerId) return;
      const container = adjustments.masks?.find((m) => m.id === activeMaskContainerId);
      if (container) copyMaskToClipboard(container);
    };
    const onPaste = () => handlePasteMask(activeMaskContainerId || undefined);
    const onDup = () => {
      if (!activeMaskContainerId) return;
      const container = adjustments.masks?.find((m) => m.id === activeMaskContainerId);
      if (container) handleDuplicateContainer(container);
    };
    window.addEventListener('rustroom:copy-mask', onCopy as EventListener);
    window.addEventListener('rustroom:paste-mask', onPaste as EventListener);
    window.addEventListener('rustroom:duplicate-mask', onDup as EventListener);
    return () => {
      window.removeEventListener('rustroom:copy-mask', onCopy as EventListener);
      window.removeEventListener('rustroom:paste-mask', onPaste as EventListener);
      window.removeEventListener('rustroom:duplicate-mask', onDup as EventListener);
    };
  }, [activeMaskContainerId, adjustments.masks, copiedMask]);

  const handleDuplicateSubMask = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    const duplicatedSubMask = cloneSubMaskData(subMask, { rename: true });

    insertSubMaskIntoContainer(containerId, duplicatedSubMask, insertIndex);
  };

  const handleDuplicateAndInvertSubMask = (containerId: string, subMask: SubMask) => {
    const parentContainer = adjustments.masks.find((m) => m.id === containerId);
    if (!parentContainer) return;

    const duplicatedSubMask = cloneSubMaskData(subMask, { invert: true, rename: false });
    const newContainer = cloneMaskContainerData(parentContainer, { rename: false, resetAdjustments: true });

    newContainer.name = t('editor.masks.patches.invertedName', { name: getSubMaskName(subMask) });
    newContainer.subMasks = [duplicatedSubMask];
    newContainer.invert = false;

    const parentIndex = adjustments.masks.findIndex((m) => m.id === containerId);
    insertMaskContainer(newContainer, parentIndex >= 0 ? parentIndex + 1 : undefined);
  };

  const handlePasteSubMask = (containerId: string, insertIndex?: number) => {
    if (!copiedSubMask) {
      return;
    }

    const pastedSubMask = cloneSubMaskData(copiedSubMask, { rename: false });

    insertSubMaskIntoContainer(containerId, pastedSubMask, insertIndex);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current as DragData);
    if (onDragStateChange) onDragStateChange(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragData = active.data.current as DragData;
    const overData = over?.data.current as DragData;

    if (dragData.type === 'Creation' && dragData.maskType) {
      const creationFn = () => {
        if (overData?.type === 'Container') {
          handleAddSubMask(overData.item!.id, dragData.maskType!);
        } else if (over && overData?.type === 'SubMask') {
          const container = adjustments.masks.find((m) => m.id === overData.parentId);
          if (container) {
            const targetIndex = container.subMasks.findIndex((sm) => sm.id === over.id);
            handleAddSubMask(overData.parentId!, dragData.maskType!, SubMaskMode.Additive, targetIndex);
          }
        } else {
          handleAddMaskContainer(dragData.maskType!);
        }
      };

      if (adjustments.masks && adjustments.masks.length > 0) {
        setPendingAction(() => creationFn);
      } else {
        creationFn();
      }

      setActiveDragItem(null);
      if (onDragStateChange) onDragStateChange(false);
      return;
    }

    setActiveDragItem(null);
    if (onDragStateChange) onDragStateChange(false);

    if (dragData.type === 'Container') {
      const overId = over?.id;
      if (!overId || active.id === overId) return;

      setAdjustments((prev: Adjustments) => {
        const oldIndex = prev.masks.findIndex((m) => m.id === dragData.item!.id);
        let newIndex = -1;

        if (overId === 'mask-list-root') {
          newIndex = prev.masks.length - 1;
        } else if (overData?.type === 'Container') {
          newIndex = prev.masks.findIndex((m) => m.id === overId);
        } else if (overData?.type === 'SubMask') {
          newIndex = prev.masks.findIndex((m) => m.id === overData.parentId);
        }

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newMasks = [...prev.masks];
          const [movedItem] = newMasks.splice(oldIndex, 1);
          newMasks.splice(newIndex, 0, movedItem);
          return { ...prev, masks: newMasks };
        }
        return prev;
      });
      return;
    }

    if (dragData.type === 'SubMask') {
      const sourceContainerId = dragData.parentId;
      if (!sourceContainerId) return;

      if (!over || over.id === 'mask-list-root') return;

      let targetContainerId: string | null = null;
      if (overData?.type === 'Container') targetContainerId = overData.item!.id;
      else if (overData?.type === 'SubMask' && overData.parentId) targetContainerId = overData.parentId;

      if (targetContainerId) {
        setAdjustments((prev: Adjustments) => {
          const newMasks = prev.masks.map((m) => ({ ...m, subMasks: [...m.subMasks] }));
          const sourceContainer = newMasks.find((m) => m.id === sourceContainerId);
          const targetContainer = newMasks.find((m) => m.id === targetContainerId);
          if (!sourceContainer || !targetContainer) return prev;

          const sourceSubMaskIndex = sourceContainer.subMasks.findIndex((sm) => sm.id === dragData.item!.id);
          if (sourceSubMaskIndex === -1) return prev;

          const [movedSubMask] = sourceContainer.subMasks.splice(sourceSubMaskIndex, 1);

          if (sourceContainerId === targetContainerId) {
            if (overData?.type === 'SubMask') {
              const overSubMaskIndex = sourceContainer.subMasks.findIndex((sm) => sm.id === over.id);
              const insertIndex = overSubMaskIndex >= 0 ? overSubMaskIndex : sourceContainer.subMasks.length;
              sourceContainer.subMasks.splice(insertIndex, 0, movedSubMask);
            } else {
              sourceContainer.subMasks.push(movedSubMask);
            }
          } else {
            if (overData?.type === 'SubMask') {
              const overSubMaskIndex = targetContainer.subMasks.findIndex((sm) => sm.id === over.id);
              const insertIndex = overSubMaskIndex >= 0 ? overSubMaskIndex : targetContainer.subMasks.length;
              targetContainer.subMasks.splice(insertIndex, 0, movedSubMask);
            } else {
              targetContainer.subMasks.push(movedSubMask);
            }
            setExpandedContainers((p) => new Set(p).add(targetContainerId!));
          }
          return { ...prev, masks: newMasks };
        });
      }
    }
  };

  const handlePanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const allTypes = [...MASK_PANEL_CREATION_TYPES.filter((m) => m.id !== 'others'), ...OTHERS_MASK_TYPES];
    const newMaskSubMenu = allTypes.map((m) => ({
      label: getMaskTypeName(m),
      icon: m.icon,
      onClick: () => handleAddMaskContainer(m.type),
    }));
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.pasteMask'),
        icon: ClipboardPaste,
        disabled: !copiedMask,
        onClick: () => handlePasteMask(),
      },
      { label: t('editor.masks.addNewMask'), icon: Plus, submenu: newMaskSubMenu },
    ]);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      collisionDetection={pointerWithin}
    >
      <div className="flex flex-col h-full select-none overflow-hidden" onContextMenu={handlePanelContextMenu}>
        <div className="px-3 py-2 flex items-center shrink-0">
          <Text variant={TextVariants.title}>{t('editor.masks.maskAdjustmentsTitle')}</Text>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 px-4 pb-4">
          <AnimatePresence>
            {isSettingsPanelEverOpened && (
              <motion.div
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex-1 min-h-0"
              >
                <SettingsPanel
                  container={activeContainer}
                  activeSubMask={activeSubMaskData || null}
                  aiModelDownloadStatus={aiModelDownloadStatus}
                  brushSettings={brushSettings}
                  setBrushSettings={setBrushSettings}
                  updateContainer={updateContainer}
                  updateSubMask={updateSubMask}
                  appSettings={appSettings}
                  isGeneratingAiMask={isGeneratingAiMask}
                  setIsMaskControlHovered={setIsMaskControlHovered}
                  collapsibleState={collapsibleState}
                  setCollapsibleState={setCollapsibleState}
                  copiedSectionAdjustments={copiedSectionAdjustments}
                  setCopiedSectionAdjustments={setCopiedSectionAdjustments}
                  onDragStateChange={onDragStateChange}
                  isSettingsSectionOpen={isSettingsSectionOpen}
                  setSettingsSectionOpen={setSettingsSectionOpen}
                  presets={presets}
                  handleGenerateAiDepthMask={handleGenerateAiDepthMask}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeDragItem ? (
          <div className="w-(--sidebar-width,280px) pointer-events-none">
            {activeDragItem.type === 'Container' && activeDragItem.item && (
              <Text
                as="div"
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="flex items-center gap-2 p-2 rounded-md bg-surface shadow-2xl opacity-90 ring-1 ring-black/10"
              >
                <FolderIcon size={18} className={TEXT_COLOR_KEYS[TextColors.secondary]} />
                <span className="flex-1 truncate">{(activeDragItem.item as MaskContainer).name}</span>
              </Text>
            )}

            {activeDragItem.type === 'SubMask' && activeDragItem.item && (
              <Text
                as="div"
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="flex items-center gap-2 p-2 rounded-md bg-surface shadow-2xl opacity-90 ring-1 ring-black/10 ml-3.75"
              >
                {(() => {
                  const sm = activeDragItem.item as SubMask;
                  const Icon = MASK_ICON_MAP[sm.type] || Circle;
                  return <Icon size={16} className={`shrink-0 ml-1 ${TEXT_COLOR_KEYS[TextColors.secondary]}`} />;
                })()}
                <span className="flex-1 truncate">{getSubMaskName(activeDragItem.item as SubMask)}</span>
              </Text>
            )}

            {activeDragItem.type === 'Creation' && (
              <Text
                as="div"
                variant={TextVariants.small}
                color={TextColors.primary}
                className="bg-surface rounded-lg gap-2 p-2 flex flex-col items-center justify-center aspect-square w-20 shadow-xl opacity-90"
              >
                {(() => {
                  const maskType =
                    MASK_PANEL_CREATION_TYPES.find((m) => m.type === activeDragItem.maskType) ||
                    OTHERS_MASK_TYPES.find((m) => m.type === activeDragItem.maskType);
                  const Icon = maskType?.icon || Circle;
                  return (
                    <>
                      <Icon size={24} />
                      <span className="text-center">
                        {activeDragItem.maskType ? formatMaskTypeName(activeDragItem.maskType) : 'Mask'}
                      </span>
                    </>
                  );
                })()}
              </Text>
            )}
          </div>
        ) : null}
      </DragOverlay>
      {canvasHost &&
        createPortal(
          <div
            className="absolute top-3 right-0 z-30 w-[250px] max-h-[min(72%,560px)] flex flex-col rounded-lg border border-border-color bg-bg-secondary text-text-primary shadow-xl"
            // Only interaction *starts* are kept from the canvas. Moves and releases must
            // propagate: dnd-kit tracks them on the document, and a swallowed pointerup left
            // a row drag armed, so it then followed the mouse without the button held.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 px-2 py-1.5">
              <span className="flex-1 text-center text-xs font-medium tracking-wide">{t('editor.masks.maskingTitle')}</span>
              <button
                type="button"
                className="rounded p-1 text-text-secondary hover:bg-card-active hover:text-text-primary"
                aria-label={maskListCollapsed ? t('editor.masks.panel.expand') : t('editor.masks.panel.collapse')}
                onClick={() => setMaskListCollapsed((v) => !v)}
              >
                {maskListCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
            {!maskListCollapsed && (
              <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-text-primary hover:bg-card-active"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setAddMenu({
                      anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
                      target: { kind: 'new' },
                    });
                  }}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-text-secondary">
                    <Plus size={16} />
                  </span>
                  {t('editor.masks.panel.create')}
                </button>
                <div ref={setRootDroppableRef} className={isRootOver ? 'rounded-md bg-surface' : ''} onClick={handleDeselect}>
                  <AnimatePresence initial={false}>
                    {(adjustments.masks || []).map((container) => (
                      <ContainerRow
                        key={container.id}
                        container={container}
                        isSelected={activeMaskContainerId === container.id && activeMaskId === null}
                        hasActiveChild={activeMaskContainerId === container.id && activeMaskId !== null}
                        isExpanded={expandedContainers.has(container.id)}
                        onToggle={() => handleToggleExpand(container.id)}
                        onSelect={() => {
                          onSelectContainer(container.id);
                          onSelectMask(null);
                        }}
                        renamingId={renamingId}
                        setRenamingId={setRenamingId}
                        tempName={tempName}
                        setTempName={setTempName}
                        updateContainer={updateContainer}
                        handleDelete={handleDeleteContainer}
                        handleDuplicate={handleDuplicateContainer}
                        handleDuplicateAndInvert={handleDuplicateAndInvertContainer}
                        handlePasteMask={handlePasteMask}
                        copyMaskToClipboard={copyMaskToClipboard}
                        copiedMask={copiedMask}
                        presets={presets}
                        setAdjustments={setAdjustments}
                        activeDragItem={activeDragItem}
                        activeMaskId={activeMaskId}
                        onSelectContainer={onSelectContainer}
                        onSelectMask={onSelectMask}
                        updateSubMask={updateSubMask}
                        handleDeleteSubMask={handleDeleteSubMask}
                        handleDuplicateSubMask={handleDuplicateSubMask}
                        handleDuplicateAndInvertSubMask={handleDuplicateAndInvertSubMask}
                        handlePasteSubMask={handlePasteSubMask}
                        copySubMaskToClipboard={copySubMaskToClipboard}
                        copiedSubMask={copiedSubMask}
                        analyzingSubMaskId={analyzingSubMaskId}
                        setIsMaskControlHovered={setIsMaskControlHovered}
                        onRequestAdd={(e: React.MouseEvent, mode: SubMaskMode) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setAddMenu({
                            anchor: { left: rect.left, top: rect.top, bottom: rect.bottom },
                            target: { kind: 'component', containerId: container.id, mode },
                            title:
                              mode === SubMaskMode.Subtractive ? t('editor.masks.panel.subtractTitle') : undefined,
                          });
                        }}
                        onAddToMask={addComponentFromAction}
                        onDeleteEmptyMasks={deleteEmptyMasks}
                        onDeleteAllMasks={handleResetAllMasks}
                        emptyMaskCount={(adjustments.masks || []).filter((m) => !(m.subMasks?.length)).length}
                      />
                    ))}
                  </AnimatePresence>
                  {activeDragItem?.type === 'Creation' && (adjustments.masks || []).length > 0 && (
                    <NewMaskDropZone isOver={isRootOver} />
                  )}
                </div>
                <label className="mt-1 flex items-center gap-2 px-1 py-1 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    className="accent-red-500"
                    checked={showMaskOverlay}
                    onChange={() => setEditor({ showMaskOverlay: !showMaskOverlay })}
                  />
                  <span className="flex-1">{t('editor.masks.panel.showOverlay')}</span>
                  <span className="h-3.5 w-3.5 rounded-sm bg-red-600 ring-1 ring-border-color" />
                </label>
              </div>
            )}
          </div>,
          canvasHost,
        )}
      {addMenu && (
        <AddMaskMenu
          anchor={addMenu.anchor}
          title={addMenu.title}
          onClose={() => setAddMenu(null)}
          onPick={(action) => {
            const target = addMenu.target;
            setAddMenu(null);
            if (target.kind === 'new') applyAddMask(action);
            else addComponentFromAction(target.containerId, action, target.mode);
          }}
        />
      )}
    </DndContext>
  );
}

function NewMaskDropZone({ isOver }: { isOver: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: '4px' }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`p-4 rounded-lg text-center ${isOver ? 'border border-accent/80 bg-bg-tertiary/50' : ''}`}
    >
      <Text weight={TextWeights.medium}>{t('editor.masks.dropzoneText')}</Text>
    </motion.div>
  );
}

function DraggableGridItem({ maskType, onClick, onRightClick, isDraggable, activeMaskContainerId }: any) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `create-${maskType.id || maskType.type}`,
    data: { type: 'Creation', maskType: maskType.type },
    disabled: !isDraggable,
  });

  const tooltip = maskType.disabled
    ? t('editor.masks.comingSoon')
    : maskType.id === 'others'
      ? t('editor.masks.tooltips.showMore')
      : activeMaskContainerId
        ? t('editor.masks.tooltips.addToCurrent', { name: getMaskTypeName(maskType) })
        : t('editor.masks.tooltips.createNew', { name: getMaskTypeName(maskType) });

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.button !== 2) return;
        onRightClick(event);
      }}
      className={`bg-surface text-text-primary rounded-lg p-2 flex flex-col items-center justify-center gap-2 aspect-square transition-colors
                ${maskType.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-card-active active:bg-accent/20'} ${isDragging ? 'opacity-50' : ''}`}
      data-tooltip={tooltip}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <maskType.icon size={24} />{' '}
      <Text as="span" variant={TextVariants.small} color={TextColors.primary}>
        {getMaskTypeName(maskType)}
      </Text>
    </motion.div>
  );
}

function MaskThumb({ container }: { container: MaskContainer }) {
  const first = container.subMasks?.[0];
  const light = container.invert ? 'bg-black' : 'bg-white';
  return (
    <span className={`absolute inset-0 ${container.invert ? 'bg-white' : 'bg-black'}`}>
      {first?.type === Mask.Radial && <span className={`absolute inset-1.5 rounded-full ${light}`} />}
      {first?.type === Mask.Linear && <span className={`absolute inset-y-0 left-0 w-1/2 ${light}`} />}
      {first && first.type !== Mask.Radial && first.type !== Mask.Linear && (
        <span className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${light}`} />
      )}
    </span>
  );
}

function toolLabel(subMask: SubMask, index: number) {
  const typeName = formatMaskTypeName(subMask.type);
  const custom = subMask.name?.trim();
  if (!custom || custom === typeName) return `${typeName} ${index}`;
  return custom;
}

function buildIntersectSubmenu(
  t: (key: any, options?: any) => string,
  onAdd: (containerId: string, action: AddMaskAction, mode: SubMaskMode) => void,
  containerId: string,
) {
  const item = (label: string, action: AddMaskAction) => ({
    label,
    onClick: () => onAdd(containerId, action, SubMaskMode.Intersect),
  });
  return [
    item(t('editor.masks.actions.selectSubject'), 'subject' as AddMaskAction),
    item(t('editor.masks.actions.selectSky'), 'sky'),
    item(t('editor.masks.actions.selectBackground'), 'background'),
    item(t('masks.types.foreground'), 'foreground'),
    { type: OPTION_SEPARATOR },
    item(t('masks.types.brush'), 'brush'),
    item(t('editor.masks.addMenu.linear'), 'linear'),
    item(t('editor.masks.addMenu.radial'), 'radial'),
    { type: OPTION_SEPARATOR },
    item(t('editor.masks.panel.colorRange'), 'color'),
    item(t('editor.masks.panel.luminanceRange'), 'luminance'),
    item(t('editor.masks.panel.depthRange'), 'depth'),
  ];
}

function ContainerRow({
  container,
  isSelected,
  hasActiveChild,
  isExpanded,
  onToggle,
  onSelect,
  renamingId,
  setRenamingId,
  tempName,
  setTempName,
  updateContainer,
  handleDelete,
  handleDuplicate,
  handleDuplicateAndInvert,
  handlePasteMask,
  copyMaskToClipboard,
  copiedMask,
  presets,
  setAdjustments,
  activeDragItem,
  activeMaskId,
  onSelectContainer,
  onSelectMask,
  updateSubMask,
  handleDeleteSubMask,
  handleDuplicateSubMask,
  handleDuplicateAndInvertSubMask,
  handlePasteSubMask,
  copySubMaskToClipboard,
  copiedSubMask,
  analyzingSubMaskId,
  setIsMaskControlHovered,
  onRequestAdd,
  onAddToMask,
  onDeleteEmptyMasks,
  onDeleteAllMasks,
  emptyMaskCount,
}: any) {
  const { t } = useTranslation();
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: container.id,
    data: { type: 'Container', item: container },
  });
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({ id: container.id, data: { type: 'Container', item: container } });
  const { showContextMenu } = useContextMenu();

  const setCombinedRef = (node: HTMLElement | null) => {
    setDroppableRef(node);
    setDraggableRef(node);
  };

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      setAdjustments((prev: any) => {
        const updatedMasks = prev.masks.map((m: any) => (m.id === container.id ? { ...m, name: newName } : m));
        return { ...prev, masks: updatedMasks };
      });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.renameEllipsis'),
        onClick: () => {
          setRenamingId(container.id);
          setTempName(container.name);
        },
      },
      {
        label: t('editor.masks.actions.invertNamed', { name: container.name }),
        shortcut: 'I',
        onClick: () => updateContainer(container.id, { invert: !container.invert }),
      },
      {
        label: t('editor.masks.actions.duplicateAndInvertMask'),
        onClick: () => handleDuplicateAndInvert(container),
      },
      {
        label: t('editor.masks.actions.intersectWith'),
        submenu: buildIntersectSubmenu(t, onAddToMask, container.id),
      },
      {
        label: t('editor.masks.actions.duplicateNamed', { name: container.name }),
        onClick: () => handleDuplicate(container),
      },
      {
        label: container.visible ? t('editor.masks.actions.hide') : t('editor.masks.actions.show'),
        shortcut: 'H',
        onClick: () => updateContainer(container.id, { visible: !container.visible }),
      },
      {
        label: t('editor.masks.actions.deleteNamed', { name: container.name }),
        onClick: () => handleDelete(container.id),
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.masks.actions.deleteEmptyMasks'),
        disabled: emptyMaskCount === 0,
        onClick: onDeleteEmptyMasks,
      },
      {
        label: t('editor.masks.actions.deleteAllEmptyMasks'),
        disabled: emptyMaskCount === 0,
        onClick: onDeleteEmptyMasks,
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.masks.actions.deleteAllMasks'),
        onClick: onDeleteAllMasks,
      },
    ]);
  };

  const isDraggingContainer = activeDragItem?.type === 'Container';
  let borderClass = '';

  if (isOver) {
    if (isDraggingContainer) {
      borderClass = 'border-t-2 border-accent';
    } else if (
      (activeDragItem?.type === 'SubMask' && activeDragItem?.parentId !== container.id) ||
      activeDragItem?.type === 'Creation'
    ) {
      borderClass = 'bg-card-active border border-accent/50';
    }
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: isDragging ? 0.4 : 1, height: 'auto' }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      className="overflow-hidden"
    >
      <div
        {...listeners}
        {...attributes}
        className={`flex items-center gap-2 px-1.5 py-1 rounded-md transition-colors group touch-none
             ${isSelected ? 'bg-card-active' : 'hover:bg-surface'}
             ${!container.visible ? 'opacity-50' : ''}
             ${borderClass}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onContextMenu={onContextMenu}
      >
        <button
          type="button"
          className="relative h-7 w-7 shrink-0 overflow-hidden rounded-sm bg-black ring-1 ring-border-color"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            onToggle();
          }}
          aria-label={container.name}
        >
          <MaskThumb container={container} />
        </button>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenamingId(container.id);
            setTempName(container.name);
          }}
        >
          {renamingId === container.id ? (
            <input
              autoFocus
              className="bg-bg-primary text-sm w-full rounded-sm px-1 outline-hidden border border-accent"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <Text color={TextColors.primary} weight={TextWeights.medium} className="truncate select-none">
              {container.name}
            </Text>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pl-7"
            layout
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {container.subMasks.map((subMask: SubMask, index: number) => (
                <SubMaskRow
                  key={subMask.id}
                  subMask={subMask}
                  index={index + 1}
                  totalCount={container.subMasks.length}
                  containerId={container.id}
                  isActive={activeMaskId === subMask.id}
                  parentVisible={container.visible}
                  activeDragItem={activeDragItem}
                  onSelect={() => {
                    onSelectContainer(container.id);
                    onSelectMask(subMask.id);
                  }}
                  updateSubMask={updateSubMask}
                  handleDelete={() => handleDeleteSubMask(container.id, subMask.id)}
                  handleDuplicate={() => handleDuplicateSubMask(container.id, subMask, index + 1)}
                  handleDuplicateAndInvert={() => handleDuplicateAndInvertSubMask(container.id, subMask)}
                  handlePaste={() => handlePasteSubMask(container.id, index + 1)}
                  handleCopy={() => copySubMaskToClipboard(subMask)}
                  hasCopiedSubMask={!!copiedSubMask}
                  analyzingSubMaskId={analyzingSubMaskId}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  tempName={tempName}
                  setTempName={setTempName}
                  setIsMaskControlHovered={setIsMaskControlHovered}
                  onAddToMask={onAddToMask}
                />
              ))}
            </AnimatePresence>

            {(isSelected || hasActiveChild || container.subMasks.length === 0) && (
              <div className="flex gap-1 px-0.5 py-1">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-text-primary hover:bg-card-active"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestAdd(e, SubMaskMode.Additive);
                  }}
                >
                  <Plus size={13} />
                  {t('editor.masks.panel.add')}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-text-primary hover:bg-card-active"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestAdd(e, SubMaskMode.Subtractive);
                  }}
                >
                  <Minus size={13} />
                  {t('editor.masks.panel.subtract')}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SubMaskRow({
  subMask,
  index,
  totalCount,
  containerId,
  isActive,
  parentVisible,
  onSelect,
  updateSubMask,
  handleDelete,
  handleDuplicate,
  handleDuplicateAndInvert,
  handlePaste,
  handleCopy,
  hasCopiedSubMask,
  activeDragItem,
  analyzingSubMaskId,
  renamingId,
  setRenamingId,
  tempName,
  setTempName,
  setIsMaskControlHovered,
  onAddToMask,
}: any) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const setCombinedRef = (node: HTMLElement | null) => {
    setNodeRef(node);
    setDroppableRef(node);
  };
  const MaskIcon = MASK_ICON_MAP[subMask.type as Mask] || Circle;
  const { showContextMenu } = useContextMenu();
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDraggingContainer = activeDragItem?.type === 'Container';
  const isAnalyzing = subMask.id === analyzingSubMaskId;

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      updateSubMask(subMask.id, { name: newName });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label = toolLabel(subMask, index);
    const subtractive = subMask.mode === SubMaskMode.Subtractive;
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.renameEllipsis'),
        onClick: () => {
          setRenamingId(subMask.id);
          setTempName(getSubMaskName(subMask));
        },
      },
      {
        label: subtractive ? t('editor.masks.actions.convertToAdd') : t('editor.masks.actions.convertToSubtract'),
        onClick: () =>
          updateSubMask(subMask.id, {
            mode: subtractive ? SubMaskMode.Additive : SubMaskMode.Subtractive,
          }),
      },
      {
        label: t('editor.masks.actions.invertTool'),
        onClick: () => updateSubMask(subMask.id, { invert: !subMask.invert }),
      },
      {
        label: t('editor.masks.actions.intersectWith'),
        submenu: buildIntersectSubmenu(t, onAddToMask, containerId),
      },
      {
        label: t('editor.masks.actions.duplicateNamed', { name: label }),
        onClick: handleDuplicate,
      },
      {
        label: subMask.visible ? t('editor.masks.actions.hide') : t('editor.masks.actions.show'),
        onClick: () => updateSubMask(subMask.id, { visible: !subMask.visible }),
      },
      {
        label: t('editor.masks.actions.deleteNamed', { name: label }),
        onClick: handleDelete,
      },
    ]);
  };

  const showNumber = isHovered && totalCount > 1;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -15, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      {...attributes}
      {...listeners}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex items-center gap-2 px-1 py-1 rounded-md transition-colors group cursor-pointer touch-none
            ${isActive ? 'bg-card-active' : 'hover:bg-surface'}
            ${isOver && !isDraggingContainer ? 'border-t-2 border-accent' : ''}
            ${isDragging ? 'opacity-40' : ''}
            ${parentVisible === false || subMask.visible === false ? 'opacity-50' : ''}
            ${isDraggingContainer ? 'opacity-30 pointer-events-none' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      <Text
        as="div"
        variant={TextVariants.small}
        weight={TextWeights.bold}
        className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          {isAnalyzing ? (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <Loader2 size={16} className="animate-spin" />
            </motion.div>
          ) : showNumber ? (
            <motion.span
              key="number"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              {index}
            </motion.span>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <MaskIcon size={16} />
            </motion.div>
          )}
        </AnimatePresence>
      </Text>
      {renamingId === subMask.id ? (
        <input
          autoFocus
          className="bg-bg-primary text-sm w-full rounded px-1 outline-none border border-accent"
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Text color={TextColors.primary} className="flex-1 truncate select-none">
          {toolLabel(subMask, index)}
        </Text>
      )}
      {subMask.mode === SubMaskMode.Subtractive && <Minus size={13} className="shrink-0 text-text-secondary" />}
      {subMask.mode === SubMaskMode.Intersect && (
        <SquaresIntersect size={13} className="shrink-0 text-text-secondary" />
      )}
    </motion.div>
  );
}

function SettingsPanel({
  container,
  activeSubMask,
  aiModelDownloadStatus,
  brushSettings,
  setBrushSettings,
  updateContainer,
  updateSubMask,
  appSettings,
  isGeneratingAiMask: _isGeneratingAiMask,
  setIsMaskControlHovered,
  collapsibleState,
  setCollapsibleState,
  copiedSectionAdjustments,
  setCopiedSectionAdjustments,
  onDragStateChange,
  isSettingsSectionOpen,
  setSettingsSectionOpen,
  presets,
  handleGenerateAiDepthMask,
}: any) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const isActive = !!container;
  const presetButtonRef = useRef<HTMLButtonElement>(null);

  const placeholderContainer = {
    ...INITIAL_MASK_CONTAINER,
    adjustments: INITIAL_MASK_ADJUSTMENTS,
  };
  const displayContainer = container || placeholderContainer;

  const handleApplyPresetToMask = (presetAdjustments: Partial<Adjustments>) => {
    if (!container) return;
    const currentAdjustments = container.adjustments;
    const newMaskAdjustments = {
      ...currentAdjustments,
      ...presetAdjustments,
      sectionVisibility: {
        ...(currentAdjustments.sectionVisibility || INITIAL_MASK_ADJUSTMENTS.sectionVisibility),
        ...(presetAdjustments.sectionVisibility || {}),
      },
    };
    updateContainer(container.id, { adjustments: newMaskAdjustments });
  };

  const generatePresetSubmenu = (presetList: any[]): any[] => {
    return presetList
      .map((item: any) => {
        if (item.folder) {
          return {
            label: item.folder.name,
            icon: FolderIcon,
            submenu: generatePresetSubmenu(item.folder.children),
          };
        }
        if (item.preset || item.adjustments) {
          return {
            label: item.name || item.preset.name,
            onClick: () => handleApplyPresetToMask(item.adjustments || item.preset.adjustments),
          };
        }
        return null;
      })
      .filter(Boolean);
  };

  const handlePresetSelectClick = () => {
    if (presetButtonRef.current) {
      const rect = presetButtonRef.current.getBoundingClientRect();
      const presetSubmenu = generatePresetSubmenu(presets);
      const options =
        presetSubmenu.length > 0
          ? presetSubmenu
          : [{ label: t('editor.masks.settings.noPresetsFound'), disabled: true }];
      showContextMenu(rect.left, rect.bottom + 5, options);
    }
  };

  const handleMaskPropertyChange = (key: string, value: any) => {
    if (!isActive) return;
    updateContainer(container.id, { [key]: value });
  };

  const handleSubMaskParametersChange = (changes: Record<string, number>) => {
    if (!isActive || !activeSubMask) return;
    const newParams = { ...activeSubMask.parameters, ...changes };
    if (activeSubMask.type === Mask.Luminance) {
      const low = Number(newParams.rangeLow ?? 0);
      const high = Number(newParams.rangeHigh ?? 100);
      if ('rangeLow' in changes && low > high) newParams.rangeHigh = low;
      if ('rangeHigh' in changes && high < low) newParams.rangeLow = high;
    }
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const handleDepthRangeChange = (values: { minDepth: number; maxDepth: number; minFade: number; maxFade: number }) => {
    if (!isActive || !activeSubMask) return;

    const newParams = {
      ...activeSubMask.parameters,
      minDepth: 100 - values.maxDepth,
      maxDepth: 100 - values.minDepth,
      minFade: values.maxFade,
      maxFade: values.minFade,
    };
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const subMaskConfig = activeSubMask ? SUB_MASK_CONFIG[activeSubMask.type as Mask] || {} : {};
  const isAiMask = activeSubMask && ['ai-subject', 'ai-foreground', 'ai-sky', 'ai-depth'].includes(activeSubMask.type);
  const isComponentMode = !!activeSubMask;

  const setMaskContainerAdjustments = (updater: any) => {
    if (!isActive) return;
    const currentAdjustments = container.adjustments;
    const newAdjustments = typeof updater === 'function' ? updater(currentAdjustments) : updater;
    updateContainer(container.id, { adjustments: newAdjustments });
  };

  // Stable identity (always the latest closure) so MaskSection's memo holds while a sub-mask
  // is dragged.
  const setMaskContainerAdjustmentsRef = useRef(setMaskContainerAdjustments);
  setMaskContainerAdjustmentsRef.current = setMaskContainerAdjustments;
  const stableSetMaskContainerAdjustments = useCallback(
    (updater: any) => setMaskContainerAdjustmentsRef.current(updater),
    [],
  );

  const handleToggleSection = (section: string) => {
    setCollapsibleState((prev: any) => {
      const isOpening = !prev[section];
      if (appSettings?.enableFocusMode && isOpening) {
        setSettingsSectionOpen(false);
        const newState = { ...prev };
        Object.keys(newState).forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const handleToggleVisibility = (sectionName: string) => {
    if (!isActive) return;
    const cur = container.adjustments;
    const vis = cur.sectionVisibility || INITIAL_MASK_ADJUSTMENTS.sectionVisibility;
    updateContainer(container.id, {
      adjustments: { ...cur, sectionVisibility: { ...vis, [sectionName]: !vis[sectionName] } },
    });
  };

  const handleSectionContextMenu = (event: any, sectionName: string) => {
    if (!isActive) return;
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName as keyof typeof ADJUSTMENT_SECTIONS];
    if (!sectionKeys) return;

    const handleCopy = () => {
      const adjustmentsToCopy: Record<string, any> = {};
      for (const key of sectionKeys) {
        if (container.adjustments && container.adjustments[key] !== undefined) {
          adjustmentsToCopy[key] = JSON.parse(JSON.stringify(container.adjustments[key]));
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) return;

      setMaskContainerAdjustments((prev: any) => ({
        ...prev,
        ...copiedSectionAdjustments.values,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_MASK_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const resetValues: any = {};
      for (const key of sectionKeys) {
        if (INITIAL_MASK_ADJUSTMENTS[key] !== undefined) {
          resetValues[key] = JSON.parse(JSON.stringify(INITIAL_MASK_ADJUSTMENTS[key]));
        }
      }
      setMaskContainerAdjustments((prev: any) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_MASK_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const isPasteAllowed = copiedSectionAdjustments && copiedSectionAdjustments.section === sectionName;
    const sectionTitle = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);

    const pasteLabel = copiedSectionAdjustments
      ? t('editor.masks.settings.pasteSectionSettings', { section: sectionTitle })
      : t('editor.masks.settings.pasteSettings');

    showContextMenu(event.clientX, event.clientY, [
      {
        icon: Copy,
        label: t('editor.masks.settings.copySectionSettings', { section: sectionTitle }),
        onClick: handleCopy,
      },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: OPTION_SEPARATOR },
      {
        icon: RotateCcw,
        label: t('editor.masks.settings.resetSectionSettings', { section: sectionTitle }),
        onClick: handleReset,
      },
    ]);
  };

  const sectionVisibility =
    displayContainer.adjustments.sectionVisibility || INITIAL_MASK_ADJUSTMENTS.sectionVisibility;

  return (
    <div
      className={`space-y-2 transition-opacity duration-300 ${!isActive ? 'opacity-50 pointer-events-none' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <CollapsibleSection
        title={
          isComponentMode
            ? t('editor.masks.settings.componentPropertiesTitle', { name: getSubMaskName(activeSubMask) })
            : t('editor.masks.settings.maskPropertiesTitle')
        }
        isOpen={isSettingsSectionOpen}
        onToggle={() => {
          const isOpening = !isSettingsSectionOpen;
          setSettingsSectionOpen(isOpening);
          if (appSettings?.enableFocusMode && isOpening) {
            setCollapsibleState((prev: any) => {
              const newState = { ...prev };
              Object.keys(newState).forEach((key) => {
                newState[key] = false;
              });
              return newState;
            });
          }
        }}
        canToggleVisibility={false}
        isContentVisible={true}
      >
        <div className="space-y-4 pt-2">
          {!isComponentMode && (
            <Switch
              checked={!!displayContainer.invert}
              label={t('editor.masks.settings.invertMask')}
              data-tooltip={t('editor.masks.settings.invertTip' as any, { defaultValue: 'Invert mask (I)' })}
              onChange={(v) => handleMaskPropertyChange('invert', v)}
            />
          )}

          {!isComponentMode && (
            <div className="flex justify-between items-center">
              <Text variant={TextVariants.label} className="select-none">
                {t('editor.masks.settings.applyPreset')}
              </Text>
              <button
                ref={presetButtonRef}
                onClick={handlePresetSelectClick}
                className="text-sm text-text-primary text-right select-none cursor-pointer hover:text-accent transition-colors"
                data-tooltip={t('editor.masks.settings.selectPresetTooltip')}
              >
                {t('editor.masks.settings.select')}
              </button>
            </div>
          )}

          <Slider
            defaultValue={100}
            label={t('editor.masks.settings.opacity')}
            max={100}
            min={0}
            value={(isComponentMode ? activeSubMask.opacity : displayContainer.opacity) ?? 100}
            onChange={(e: any) =>
              isComponentMode
                ? updateSubMask(activeSubMask.id, { opacity: Number(e.target.value) })
                : handleMaskPropertyChange('opacity', Number(e.target.value))
            }
            step={1}
            fillOrigin="min"
            onDragStateChange={onDragStateChange}
          />

          {isComponentMode && (
            <>
              {isAiMask && aiModelDownloadStatus && (
                <Text
                  as="div"
                  variant={TextVariants.small}
                  color={TextColors.accent}
                  weight={TextWeights.medium}
                  className="p-3 bg-card-active rounded-md border border-surface flex items-center gap-3"
                >
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <div className="leading-relaxed">
                    <Text variant={TextVariants.small}>{t('editor.masks.settings.aiModelDownloading')}</Text>
                    <span>{aiModelDownloadStatus}</span>
                  </div>
                </Text>
              )}

              {activeSubMask.type === Mask.AiDepth && (
                <DepthRangePicker
                  minDepth={100 - (activeSubMask.parameters?.maxDepth ?? 100)}
                  maxDepth={100 - (activeSubMask.parameters?.minDepth ?? 0)}
                  minFade={activeSubMask.parameters?.maxFade ?? 15}
                  maxFade={activeSubMask.parameters?.minFade ?? 15}
                  defaultMinDepth={20}
                  defaultMaxDepth={80}
                  defaultMinFade={15}
                  defaultMaxFade={15}
                  onChange={handleDepthRangeChange}
                  onDragStateChange={onDragStateChange}
                />
              )}

              {subMaskConfig.parameters?.map((param: any) => (
                <Slider
                  key={param.key}
                  label={
                    param.key === 'feather' && activeSubMask.type === Mask.AiDepth
                      ? t('editor.masks.params.globalFeather')
                      : param.key === 'refine'
                        ? t('editor.masks.params.refine')
                        : t(('editor.masks.params.' + param.key) as any)
                  }
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  defaultValue={param.defaultValue}
                  value={(
                    activeSubMask.parameters[param.key] ??
                    (param.key === 'refine' ? activeSubMask.parameters.tolerance : undefined) ??
                    param.defaultValue
                  ) * (param.multiplier || 1)}
                  onChange={(e: any) =>
                    handleSubMaskParametersChange({ [param.key]: parseFloat(e.target.value) / (param.multiplier || 1) })
                  }
                  {...(param.key !== 'grow' && { fillOrigin: 'min' })}
                  onDragStateChange={onDragStateChange}
                />
              ))}

              {subMaskConfig.showBrushTools &&
                brushSettings &&
                (activeSubMask.type === Mask.Flow ? (
                  <FlowBrushTool
                    flow={activeSubMask.parameters?.flow ?? 10}
                    onFlowChange={(flow: number) => handleSubMaskParametersChange({ flow })}
                    settings={brushSettings}
                    onSettingsChange={setBrushSettings}
                    onDragStateChange={onDragStateChange}
                  />
                ) : (
                  <BrushTools
                    settings={brushSettings}
                    onSettingsChange={setBrushSettings}
                    onDragStateChange={onDragStateChange}
                  />
                ))}
            </>
          )}
        </div>
      </CollapsibleSection>

      <div
        onMouseEnter={() => setIsMaskControlHovered(true)}
        onMouseLeave={() => setIsMaskControlHovered(false)}
        className="flex flex-col gap-2"
      >
        {(['basic', 'curves', 'color', 'colorGrading', 'details', 'effects'] as const).map((sectionName) => {
          const SectionComponent: any = {
            basic: BasicAdjustments,
            curves: CurveGraph,
            color: ColorPanel,
            colorGrading: ColorGradingPanel,
            details: DetailsPanel,
            effects: EffectsPanel,
          }[sectionName];
          const title = t(`editor.adjustments.sections.${sectionName}`);
          return (
            <CollapsibleSection
              key={sectionName}
              title={title}
              isOpen={collapsibleState[sectionName]}
              isContentVisible={sectionVisibility[sectionName] !== false}
              onToggle={() => handleToggleSection(sectionName)}
              onToggleVisibility={() => handleToggleVisibility(sectionName)}
              onContextMenu={(e: any) => handleSectionContextMenu(e, sectionName)}
            >
              <MaskSection
                Component={SectionComponent}
                adjustments={displayContainer.adjustments}
                setAdjustments={stableSetMaskContainerAdjustments}
                isForMask={true}
                appSettings={appSettings}
                onDragStateChange={onDragStateChange}
                panel={sectionName === 'color' ? 'mixer' : sectionName === 'colorGrading' ? 'grading' : undefined}
                variant={sectionName === 'effects' ? 'effects' : undefined}
              />
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}
