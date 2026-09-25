import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ChevronRight,
  CopyPlus,
  Edit,
  FileDown,
  FileUp,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'react-toastify';

import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { usePresetStore, pickAndParseLegacyPresets } from '../../store/usePresetStore';
import { useEditorActions } from '../../hooks/useEditorActions';
import { useContextMenu } from '../../context/ContextMenuContext';
import { Invokes, OPTION_SEPARATOR, Preset } from '../ui/AppProperties';
import type { UserPreset } from '../../hooks/usePresets';
import CreatePresetModal, { CreatePresetResult } from '../modals/CreatePresetModal';
import RenameFolderModal from '../modals/RenameFolderModal';
import {
  DEFAULT_PRESET_GROUP,
  PRESET_SECTIONS,
  addPresetsToGroup,
  buildPresetAdjustments,
  ensureGroup,
  findPreset,
  flattenPresets,
  getGroups,
  moveGroupBefore,
  movePresetTo,
  removeGroup,
  removePreset,
  renameGroup,
  updatePreset,
} from '../../utils/presetTree';

const FAVORITES_KEY = 'rustroom.presets.favorites.v1';
const COLLAPSED_KEY = 'rustroom.presets.collapsedGroups.v1';
const HOVER_PREVIEW_DELAY_MS = 120;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const safeFileName = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_');

interface PromptState {
  title: string;
  initial: string;
  buttonText?: string;
  onSave(value: string): void;
}

interface DevelopPresetListProps {
  /** Renders the collapsible section chrome (header action + body) of the Develop left panel. */
  renderSection(action: ReactNode, body: ReactNode, titleAction?: ReactNode): ReactNode;
}

// ---------------------------------------------------------------------------
// DnD rows
// ---------------------------------------------------------------------------

function PresetRow({
  preset,
  groupId,
  isActive,
  isFavorite,
  onApply,
  onHoverStart,
  onHoverEnd,
  onContextMenu,
  onToggleFavorite,
  indent = true,
}: {
  preset: Preset;
  groupId: string;
  isActive: boolean;
  isFavorite: boolean;
  onApply(p: Preset): void;
  onHoverStart(p: Preset): void;
  onHoverEnd(): void;
  onContextMenu(e: React.MouseEvent, p: Preset, groupId: string): void;
  onToggleFavorite(id: string): void;
  indent?: boolean;
}) {
  const { t } = useTranslation();
  const dndId = `p:${groupId}:${preset.id}`;
  const drag = useDraggable({ id: dndId, data: { type: 'preset', presetId: preset.id, groupId } });
  const drop = useDroppable({ id: dndId, data: { type: 'preset', presetId: preset.id, groupId } });
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag.setNodeRef, drop.setNodeRef],
  );

  return (
    <div
      ref={setRef}
      {...drag.listeners}
      {...drag.attributes}
      role="button"
      tabIndex={-1}
      className={clsx(
        'flex items-center gap-0.5 group rounded border-t-2 outline-none',
        drop.isOver && !drag.isDragging ? 'border-accent' : 'border-transparent',
        drag.isDragging && 'opacity-40',
        indent && 'ml-3',
      )}
      style={{ touchAction: 'none' }}
      onClick={() => onApply(preset)}
      onMouseEnter={() => onHoverStart(preset)}
      onMouseLeave={onHoverEnd}
      onContextMenu={(e) => onContextMenu(e, preset, groupId)}
    >
      <span
        className={clsx(
          'flex-1 min-w-0 text-left px-1.5 py-0.5 rounded text-[10px] truncate border-l-2 cursor-default',
          isActive
            ? 'bg-card-active text-text-primary font-medium border-white/60'
            : 'text-text-primary hover:bg-card-active border-transparent',
        )}
        title={preset.name}
      >
        {preset.name}
      </span>
      <button
        type="button"
        className={clsx(
          'p-0.5 shrink-0 rounded hover:bg-card-active',
          isFavorite ? 'text-amber-300 opacity-100' : 'text-text-secondary/40 opacity-0 group-hover:opacity-100',
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(preset.id);
        }}
        data-tooltip={
          isFavorite
            ? t('ui.developLeft.unfavorite' as any, { defaultValue: 'Remove favorite' })
            : t('ui.developLeft.favorite' as any, { defaultValue: 'Favorite preset' })
        }
      >
        <Star size={11} className={isFavorite ? 'fill-amber-300' : ''} />
      </button>
    </div>
  );
}

function GroupHeader({
  group,
  count,
  collapsed,
  onToggle,
  onContextMenu,
}: {
  group: { id: string; name: string };
  count: number;
  collapsed: boolean;
  onToggle(): void;
  onContextMenu(e: React.MouseEvent): void;
}) {
  const dndId = `g:${group.id}`;
  const drag = useDraggable({ id: dndId, data: { type: 'group', groupId: group.id } });
  const drop = useDroppable({ id: dndId, data: { type: 'group', groupId: group.id } });
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      drag.setNodeRef(node);
      drop.setNodeRef(node);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drag.setNodeRef, drop.setNodeRef],
  );

  return (
    <div
      ref={setRef}
      {...drag.listeners}
      {...drag.attributes}
      role="button"
      tabIndex={-1}
      style={{ touchAction: 'none' }}
      className={clsx(
        'w-full flex items-center gap-1 px-1 py-0.5 rounded text-[10px] text-text-secondary hover:text-text-primary cursor-default outline-none',
        drop.isOver && !drag.isDragging && 'bg-accent/20 text-text-primary',
        drag.isDragging && 'opacity-40',
      )}
      onClick={onToggle}
      onContextMenu={onContextMenu}
    >
      <ChevronRight size={11} className={clsx('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
      <span className="truncate font-medium">{group.name}</span>
      <span className="ml-auto opacity-50 tabular-nums">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main list
// ---------------------------------------------------------------------------

/** Lightroom Classic–style Develop "Presets" list (groups, apply on click, live preview on hover). */
export default function DevelopPresetList({ renderSection }: DevelopPresetListProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const { setAdjustments } = useEditorActions();
  const { presets, isLoading, loaded, load, commit, flush, replaceFromBackend } = usePresetStore(
    useShallow((s) => ({
      presets: s.presets,
      isLoading: s.isLoading,
      loaded: s.loaded,
      load: s.load,
      commit: s.commit,
      flush: s.flush,
      replaceFromBackend: s.replaceFromBackend,
    })),
  );
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const setUI = useUIStore((s) => s.setUI);

  const [query, setQuery] = useState('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    const v = readJson<string[]>(FAVORITES_KEY, []);
    return Array.isArray(v) ? v : [];
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readJson(COLLAPSED_KEY, {}));
  const [createState, setCreateState] = useState<{ open: boolean; groupId: string | null }>({
    open: false,
    groupId: null,
  });
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverActive = useRef(false);
  const lastDragEnd = useRef(0);

  useEffect(() => {
    if (!loaded && !isLoading) load();
  }, [loaded, isLoading, load]);

  useEffect(() => writeJson(FAVORITES_KEY, favoriteIds), [favoriteIds]);
  useEffect(() => writeJson(COLLAPSED_KEY, collapsed), [collapsed]);

  const imagePath = selectedImage?.path ?? null;
  useEffect(() => setActivePresetId(null), [imagePath]);

  const groups = useMemo(() => getGroups(presets), [presets]);
  const allFlat = useMemo(() => flattenPresets(presets), [presets]);

  // ---------------------------------------------------------------- hover preview
  const clearHoverPreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (hoverActive.current) {
      hoverActive.current = false;
      useEditorStore.getState().setEditor({ previewOverride: null });
    }
  }, []);

  useEffect(() => clearHoverPreview, [clearHoverPreview]);

  const startHoverPreview = useCallback(
    (preset: Preset) => {
      if (dragLabel) return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        const st = useEditorStore.getState();
        if (!st.selectedImage?.isReady) return;
        hoverActive.current = true;
        st.setEditor({ previewOverride: { ...st.adjustments, ...(preset.adjustments as any) } });
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [dragLabel],
  );

  // ---------------------------------------------------------------- apply
  const applyPreset = useCallback(
    async (preset: Preset) => {
      clearHoverPreview();
      if (Date.now() - lastDragEnd.current < 250) return; // click synthesized at the end of a drag
      if (!preset.adjustments || !useEditorStore.getState().selectedImage) return;
      setActivePresetId(preset.id);
      setAdjustments((prev: any) => ({ ...prev, ...preset.adjustments }));
      // LR-style: when multi-select includes other photos, push the preset to them too
      const openPath = useEditorStore.getState().selectedImage?.path;
      const { multiSelectedPaths, setLibrary } = useLibraryStore.getState();
      const others = (multiSelectedPaths || []).filter((p: string) => p && p !== openPath);
      if (others.length > 0) {
        try {
          await invoke(Invokes.ApplyAdjustmentsToPaths, { paths: others, adjustments: preset.adjustments });
          setLibrary((state: any) => ({
            imageList: state.imageList.map((img: any) => (others.includes(img.path) ? { ...img, is_edited: true } : img)),
          }));
          toast.success(
            t('ui.developLeft.presetAppliedMulti' as any, {
              defaultValue: 'Preset applied to {{count}} selected photos',
              count: others.length + (openPath ? 1 : 0),
            }),
          );
        } catch (err) {
          toast.error(String(err));
        }
      }
    },
    [clearHoverPreview, setAdjustments, t],
  );

  // ---------------------------------------------------------------- mutations
  const askConfirm = (title: string, message: string, confirmText: string, onConfirm: () => void) =>
    setUI({ confirmModalState: { isOpen: true, title, message, confirmText, confirmVariant: 'destructive', onConfirm } });

  const toggleFavorite = (id: string) =>
    setFavoriteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev].slice(0, 60)));

  const handleCreate = (res: CreatePresetResult) => {
    const current = useEditorStore.getState().adjustments as any;
    const adjustments = buildPresetAdjustments(current, res.sections);
    let tree = presets;
    let groupId = res.groupId;
    if (!groupId) [tree, groupId] = ensureGroup(tree, res.newGroupName || DEFAULT_PRESET_GROUP);
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: res.name,
      adjustments,
      includeMasks: res.sections.has('masks'),
      includeCropTransform: res.sections.has('crop') || res.sections.has('transform'),
      presetType: 'style',
    };
    commit(addPresetsToGroup(tree, groupId, [preset]));
    setCollapsed((c) => ({ ...c, [groupId!]: false }));
    setCreateState({ open: false, groupId: null });
    toast.success(t('ui.developLeft.presetCreated' as any, { defaultValue: 'Preset “{{name}}” created', name: res.name }));
  };

  const updateWithCurrent = (preset: Preset) => {
    const current = useEditorStore.getState().adjustments as any;
    const keys = Object.keys(preset.adjustments || {});
    let adjustments: Record<string, any>;
    if (keys.length > 0) {
      adjustments = {};
      for (const k of keys) if (current[k] !== undefined) adjustments[k] = JSON.parse(JSON.stringify(current[k]));
    } else {
      adjustments = buildPresetAdjustments(
        current,
        new Set(PRESET_SECTIONS.filter((s) => s.defaultOn).map((s) => s.id)),
      );
    }
    commit(updatePreset(presets, preset.id, { adjustments }));
    toast.success(t('ui.developLeft.presetUpdated' as any, { defaultValue: 'Preset “{{name}}” updated', name: preset.name }));
  };

  const exportPresetXmp = async (preset: Preset, groupName: string | null) => {
    try {
      const filePath = await saveDialog({
        defaultPath: safeFileName(`${preset.name}.xmp`),
        filters: [{ name: 'Lightroom preset (XMP)', extensions: ['xmp'] }],
        title: t('ui.developLeft.exportPresetXmp' as any, { defaultValue: 'Export preset as Lightroom XMP' }),
      });
      if (!filePath) return;
      await invoke(Invokes.ExportPresetToXmp, {
        name: preset.name,
        adjustments: preset.adjustments,
        filePath,
        group: groupName,
      });
      toast.success(t('ui.developLeft.exportXmpDone' as any, { defaultValue: 'XMP exported' }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const exportGroupXmp = async (group: { id: string; name: string; children: Preset[] }) => {
    try {
      const directory = await openDialog({
        directory: true,
        multiple: false,
        title: t('ui.developLeft.exportGroupXmpTitle' as any, { defaultValue: 'Choose a folder for the XMP presets' }),
      });
      if (typeof directory !== 'string') return;
      const count = await invoke<number>(Invokes.ExportPresetsToXmpDirectory, {
        presets: group.children.map((c) => ({ id: c.id, name: c.name, adjustments: c.adjustments, group: group.name })),
        directory,
      });
      toast.success(t('ui.developLeft.exportedXmpCount' as any, { defaultValue: '{{count}} XMP presets exported', count }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const exportGroupRr = async (group: { id: string; name: string; children: Preset[] }) => {
    try {
      const filePath = await saveDialog({
        defaultPath: safeFileName(`${group.name}.rrpreset`),
        filters: [{ name: 'RapidRAW preset', extensions: ['rrpreset'] }],
      });
      if (!filePath) return;
      await invoke(Invokes.HandleExportPresetsToFile, { presetsToExport: [{ folder: group }], filePath });
      toast.success(t('ui.developLeft.exportedGroup' as any, { defaultValue: 'Group exported' }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  /** Import Lightroom presets; `targetGroupId` null = keep the Lightroom group (crs:Group) of each file. */
  const importLightroom = async (targetGroupId: string | null) => {
    try {
      const res = await pickAndParseLegacyPresets(
        t('ui.developLeft.importLrTitle' as any, { defaultValue: 'Import Lightroom presets' }),
      );
      if (!res) return;
      let tree = usePresetStore.getState().presets;
      if (targetGroupId) {
        tree = addPresetsToGroup(tree, targetGroupId, res.presets);
      } else {
        for (const p of res.presets) {
          let gid: string;
          [tree, gid] = ensureGroup(tree, p.group || DEFAULT_PRESET_GROUP);
          tree = addPresetsToGroup(tree, gid, [p]);
        }
      }
      if (res.presets.length > 0) commit(tree);
      if (res.presets.length > 0)
        toast.success(
          t('ui.developLeft.importedPresets' as any, {
            defaultValue: '{{count}} presets imported',
            count: res.presets.length,
          }),
        );
      if (res.errors.length > 0) {
        console.warn('Preset import errors:', res.errors);
        toast.warn(
          t('ui.developLeft.importErrors' as any, {
            defaultValue: '{{count}} files could not be imported',
            count: res.errors.length,
          }),
        );
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const importRrPreset = async () => {
    try {
      const selected = await openDialog({
        filters: [{ name: 'RapidRAW preset', extensions: ['rrpreset'] }],
        multiple: true,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      flush();
      let latest: UserPreset[] | null = null;
      for (const filePath of paths) {
        latest = await invoke(Invokes.HandleImportPresetsFromFile, { filePath });
      }
      if (latest) replaceFromBackend(latest);
      toast.success(t('ui.developLeft.importedFiles' as any, { defaultValue: 'Presets imported' }));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const newGroupPrompt = (then?: (groupId: string) => void) =>
    setPrompt({
      title: t('ui.developLeft.newGroupTitle' as any, { defaultValue: 'New Preset Group' }),
      initial: '',
      buttonText: t('ui.developLeft.createGroup' as any, { defaultValue: 'Create' }),
      onSave: (name) => {
        const [tree, gid] = ensureGroup(usePresetStore.getState().presets, name);
        commit(tree);
        then?.(gid);
      },
    });

  // ---------------------------------------------------------------- context menus
  const onPresetContextMenu = (e: React.MouseEvent, preset: Preset, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    clearHoverPreview();
    const group = groups.find((g) => g.id === groupId);
    const isFav = favoriteIds.includes(preset.id);
    showContextMenu(e.clientX, e.clientY, [
      {
        icon: Edit,
        label: t('ui.developLeft.rename' as any, { defaultValue: 'Rename…' }),
        onClick: () =>
          setPrompt({
            title: t('ui.developLeft.renamePresetTitle' as any, { defaultValue: 'Rename Preset' }),
            initial: preset.name,
            onSave: (name) => commit(updatePreset(usePresetStore.getState().presets, preset.id, { name })),
          }),
      },
      {
        icon: RefreshCw,
        label: t('ui.developLeft.updateWithCurrent' as any, { defaultValue: 'Update with Current Settings' }),
        disabled: !selectedImage,
        onClick: () => updateWithCurrent(preset),
      },
      {
        icon: FolderInput,
        label: t('ui.developLeft.moveToGroup' as any, { defaultValue: 'Move to Group' }),
        submenu: [
          ...groups
            .filter((g) => g.id !== groupId)
            .map((g) => ({
              label: g.name,
              onClick: () => commit(movePresetTo(usePresetStore.getState().presets, preset.id, g.id)),
            })),
          ...(groups.length > 1 ? [{ type: OPTION_SEPARATOR }] : []),
          {
            icon: FolderPlus,
            label: t('ui.developLeft.newGroupOption' as any, { defaultValue: 'New group…' }),
            onClick: () =>
              newGroupPrompt((gid) => commit(movePresetTo(usePresetStore.getState().presets, preset.id, gid))),
          },
        ],
      },
      {
        icon: CopyPlus,
        label: t('ui.developLeft.duplicate' as any, { defaultValue: 'Duplicate' }),
        onClick: () =>
          commit(
            addPresetsToGroup(usePresetStore.getState().presets, groupId, [
              { ...preset, name: `${preset.name} Copy` },
            ]),
          ),
      },
      {
        icon: Star,
        label: isFav
          ? t('ui.developLeft.unfavorite' as any, { defaultValue: 'Remove from Favorites' })
          : t('ui.developLeft.addFavorite' as any, { defaultValue: 'Add to Favorites' }),
        onClick: () => toggleFavorite(preset.id),
      },
      { type: OPTION_SEPARATOR },
      {
        icon: FileDown,
        label: t('ui.developLeft.exportAsXmp' as any, { defaultValue: 'Export as Lightroom XMP…' }),
        onClick: () => exportPresetXmp(preset, group?.name ?? null),
      },
      { type: OPTION_SEPARATOR },
      {
        icon: Trash2,
        isDestructive: true,
        label: t('ui.developLeft.deletePreset' as any, { defaultValue: 'Delete' }),
        onClick: () =>
          askConfirm(
            t('ui.developLeft.deletePresetTitle' as any, { defaultValue: 'Delete Preset' }),
            t('ui.developLeft.deletePresetMsg' as any, {
              defaultValue: 'Delete the preset “{{name}}”? This cannot be undone.',
              name: preset.name,
            }),
            t('ui.developLeft.delete' as any, { defaultValue: 'Delete' }),
            () => {
              commit(removePreset(usePresetStore.getState().presets, preset.id));
              setFavoriteIds((prev) => prev.filter((x) => x !== preset.id));
            },
          ),
      },
    ]);
  };

  const onGroupContextMenu = (e: React.MouseEvent, group: { id: string; name: string; children: Preset[] }) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        icon: Edit,
        label: t('ui.developLeft.rename' as any, { defaultValue: 'Rename…' }),
        onClick: () =>
          setPrompt({
            title: t('ui.developLeft.renameGroupTitle' as any, { defaultValue: 'Rename Group' }),
            initial: group.name,
            onSave: (name) => commit(renameGroup(usePresetStore.getState().presets, group.id, name)),
          }),
      },
      {
        icon: Plus,
        label: t('ui.developLeft.newPresetHere' as any, { defaultValue: 'New Preset in This Group…' }),
        disabled: !selectedImage,
        onClick: () => setCreateState({ open: true, groupId: group.id }),
      },
      {
        icon: FileUp,
        label: t('ui.developLeft.importLrHere' as any, { defaultValue: 'Import Lightroom Presets Here…' }),
        onClick: () => importLightroom(group.id),
      },
      {
        icon: FileDown,
        label: t('ui.developLeft.exportGroup' as any, { defaultValue: 'Export Group' }),
        disabled: group.children.length === 0,
        submenu: [
          {
            label: t('ui.developLeft.exportGroupXmp' as any, { defaultValue: 'As Lightroom XMP files…' }),
            onClick: () => exportGroupXmp(group),
          },
          {
            label: t('ui.developLeft.exportGroupRr' as any, { defaultValue: 'As RapidRAW preset file…' }),
            onClick: () => exportGroupRr(group),
          },
        ],
      },
      { type: OPTION_SEPARATOR },
      {
        icon: Trash2,
        isDestructive: true,
        label: t('ui.developLeft.deleteGroup' as any, { defaultValue: 'Delete Group' }),
        onClick: () =>
          askConfirm(
            t('ui.developLeft.deleteGroupTitle' as any, { defaultValue: 'Delete Preset Group' }),
            group.children.length > 0
              ? t('ui.developLeft.deleteGroupMsg' as any, {
                  defaultValue:
                    'Delete the group “{{name}}” and the {{count}} presets it contains? This cannot be undone.',
                  name: group.name,
                  count: group.children.length,
                })
              : t('ui.developLeft.deleteEmptyGroupMsg' as any, {
                  defaultValue: 'Delete the empty group “{{name}}”?',
                  name: group.name,
                }),
            t('ui.developLeft.delete' as any, { defaultValue: 'Delete' }),
            () => commit(removeGroup(usePresetStore.getState().presets, group.id)),
          ),
      },
    ]);
  };

  // ---------------------------------------------------------------- DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (e: DragStartEvent) => {
    clearHoverPreview();
    const d: any = e.active.data.current;
    if (d?.type === 'preset') setDragLabel(findPreset(presets, d.presetId)?.preset.name || '');
    else if (d?.type === 'group') setDragLabel(groups.find((g) => g.id === d.groupId)?.name || '');
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    lastDragEnd.current = Date.now();
    const rawA: any = e.active.data.current;
    const o: any = e.over?.data.current;
    if (!rawA || !o || String(o.groupId).startsWith('fav-')) return;
    // Rows in the Favorites pseudo-group carry "fav-<realGroupId>"
    const a = { ...rawA, groupId: String(rawA.groupId).replace(/^fav-/, '') };
    const tree = usePresetStore.getState().presets;
    if (a.type === 'preset') {
      if (o.type === 'group') {
        if (o.groupId !== a.groupId) commit(movePresetTo(tree, a.presetId, o.groupId));
        return;
      }
      if (o.presetId === a.presetId) return;
      let before: string | null = o.presetId;
      if (o.groupId === a.groupId) {
        const children = groups.find((g) => g.id === o.groupId)?.children || [];
        const ai = children.findIndex((c) => c.id === a.presetId);
        const oi = children.findIndex((c) => c.id === o.presetId);
        if (ai < oi) before = children[oi + 1]?.id ?? null; // moving down → drop after target
      }
      commit(movePresetTo(tree, a.presetId, o.groupId, before));
      return;
    }
    if (a.type === 'group') {
      const targetGroupId: string = o.groupId;
      if (!targetGroupId || targetGroupId === a.groupId) return;
      const ai = groups.findIndex((g) => g.id === a.groupId);
      const oi = groups.findIndex((g) => g.id === targetGroupId);
      if (ai < oi) {
        const after = groups[oi + 1];
        if (after) commit(moveGroupBefore(tree, a.groupId, after.id));
        else {
          const item = tree.find((i) => i.folder?.id === a.groupId);
          if (item) commit([...tree.filter((i) => i !== item), item]);
        }
      } else {
        commit(moveGroupBefore(tree, a.groupId, targetGroupId));
      }
    }
  };

  // ---------------------------------------------------------------- render
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          visible: q
            ? g.children.filter((c) => c.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q))
            : g.children,
        }))
        .filter((g) => !q || g.visible.length > 0),
    [groups, q],
  );
  const favorites = useMemo(
    () =>
      favoriteIds
        .map((id) => allFlat.find((p) => p.preset.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p && (!q || p.preset.name.toLowerCase().includes(q))),
    [favoriteIds, allFlat, q],
  );
  const favoritesCollapsed = !!collapsed.__favorites__;

  const rowProps = {
    onApply: applyPreset,
    onHoverStart: startHoverPreview,
    onHoverEnd: clearHoverPreview,
    onContextMenu: onPresetContextMenu,
    onToggleFavorite: toggleFavorite,
  };

  const onPlusMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 2, [
      {
        icon: FileUp,
        label: t('ui.developLeft.importPresets' as any, { defaultValue: 'Importer preset' }),
        submenu: [
          {
            icon: FileUp,
            label: t('ui.developLeft.importLr' as any, {
              defaultValue: 'Import Lightroom Presets (.xmp, .lrtemplate)',
            }),
            submenu: [
              {
                label: t('ui.developLeft.importKeepGroups' as any, { defaultValue: 'Keep Lightroom groups' }),
                onClick: () => importLightroom(null),
              },
              { type: OPTION_SEPARATOR },
              ...groups.map((g) => ({
                label: t('ui.developLeft.importInto' as any, { defaultValue: 'Into “{{name}}”', name: g.name }),
                onClick: () => importLightroom(g.id),
              })),
              {
                icon: FolderPlus,
                label: t('ui.developLeft.importIntoNew' as any, { defaultValue: 'Into a new group…' }),
                onClick: () => newGroupPrompt((gid) => importLightroom(gid)),
              },
            ],
          },
          {
            icon: FileUp,
            label: t('ui.developLeft.importRr' as any, { defaultValue: 'Import RapidRAW Presets (.rrpreset)…' }),
            onClick: importRrPreset,
          },
        ],
      },
      {
        icon: Plus,
        label: t('ui.developLeft.newPresetFromCurrent' as any, {
          defaultValue: 'Create from current settings',
        }),
        disabled: !selectedImage,
        onClick: () => setCreateState({ open: true, groupId: null }),
      },
    ]);
  };

  const titleAction = (
    <button
      type="button"
      className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-card-active"
      data-tooltip={t('ui.developLeft.presetBrowser' as any, { defaultValue: 'Preset Browser' })}
      onClick={(e) => {
        e.stopPropagation();
        setUI({ isPresetBrowserOpen: true });
      }}
    >
      <LayoutGrid size={13} />
    </button>
  );

  const action = (
    <button
      type="button"
      className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-card-active"
      data-tooltip={t('ui.developLeft.addPreset' as any, { defaultValue: 'Add preset' })}
      onClick={onPlusMenu}
    >
      <Plus size={14} />
    </button>
  );

  const body = (
    <>
      {allFlat.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ui.developLeft.searchPresets' as any, { defaultValue: 'Search presets…' })}
          className="w-full h-6 mb-1 px-1.5 rounded bg-bg-primary border border-border-color/30 text-[10px] text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-white/25"
        />
      )}
      {isLoading && presets.length === 0 && <div className="text-[11px] text-text-secondary py-2">…</div>}
      {!isLoading && loaded && allFlat.length === 0 && groups.length === 0 && (
        <div className="text-[11px] text-text-secondary py-2">
          <p>{t('ui.developLeft.noPresets' as any, { defaultValue: 'No presets yet.' })}</p>
        </div>
      )}
      {q && visibleGroups.length === 0 && favorites.length === 0 && (
        <div className="text-[10px] text-text-secondary/60 py-1">
          {t('ui.developLeft.noPresetMatches' as any, { defaultValue: 'No matching presets' })}
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => {
        setDragLabel(null);
        lastDragEnd.current = Date.now();
      }}>
        <div className="space-y-0.5 pb-1">
          {favorites.length > 0 && (
            <div className="space-y-0.5">
              <button
                type="button"
                className="w-full flex items-center gap-1 px-1 py-0.5 rounded text-[10px] text-text-secondary hover:text-text-primary"
                onClick={() => setCollapsed((c) => ({ ...c, __favorites__: !favoritesCollapsed }))}
              >
                <ChevronRight size={11} className={clsx('shrink-0 transition-transform', !favoritesCollapsed && 'rotate-90')} />
                <span className="truncate font-medium">
                  {t('ui.developLeft.favoritePresets' as any, { defaultValue: 'Favorites' })}
                </span>
                <span className="ml-auto opacity-50 tabular-nums">{favorites.length}</span>
              </button>
              {!favoritesCollapsed &&
                favorites.map(({ preset, groupId }) => (
                  <PresetRow
                    key={`fav-${preset.id}`}
                    preset={preset}
                    groupId={`fav-${groupId}`}
                    isActive={activePresetId === preset.id}
                    isFavorite
                    {...rowProps}
                    onContextMenu={(e, p) => onPresetContextMenu(e, p, groupId || '')}
                  />
                ))}
            </div>
          )}
          {visibleGroups.map((g) => {
            const isCollapsed = !q && !!collapsed[g.id];
            return (
              <div key={g.id} className="space-y-0.5">
                <GroupHeader
                  group={g}
                  count={g.children.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                  onContextMenu={(e) => onGroupContextMenu(e, g)}
                />
                {!isCollapsed &&
                  g.visible.map((p) => (
                    <PresetRow
                      key={p.id}
                      preset={p}
                      groupId={g.id}
                      isActive={activePresetId === p.id}
                      isFavorite={favoriteIds.includes(p.id)}
                      {...rowProps}
                    />
                  ))}
                {!isCollapsed && g.children.length === 0 && (
                  <div className="ml-4 text-[9px] text-text-secondary/50 py-0.5">
                    {t('ui.developLeft.emptyGroup' as any, { defaultValue: 'Empty — drag presets here' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragLabel !== null ? (
            <div className="px-2 py-0.5 rounded bg-surface text-[10px] text-text-primary shadow-lg border border-border-color/40 max-w-[200px] truncate">
              {dragLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <CreatePresetModal
        isOpen={createState.open}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        defaultGroupId={createState.groupId ?? groups.find((g) => g.name === DEFAULT_PRESET_GROUP)?.id ?? null}
        onClose={() => setCreateState({ open: false, groupId: null })}
        onSave={handleCreate}
      />
      <RenameFolderModal
        isOpen={!!prompt}
        currentName={prompt?.initial ?? ''}
        title={prompt?.title}
        placeholder={t('ui.developLeft.namePlaceholder' as any, { defaultValue: 'Name' })}
        buttonText={prompt?.buttonText}
        onClose={() => setPrompt(null)}
        onSave={(name) => {
          prompt?.onSave(name);
          setPrompt(null);
        }}
      />
    </>
  );

  return <>{renderSection(action, body, titleAction)}</>;
}
