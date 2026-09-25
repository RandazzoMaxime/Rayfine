import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import { LibraryDisplayMode, ImageFile, Panel, ExifOverlay, Invokes } from '../components/ui/AppProperties';
import { toast } from 'react-toastify';
import { reimportDevelopFromXmpPath, reimportDevelopFromXmpPaths, exportDevelopToXmpPath, exportDevelopToXmpPaths } from '../utils/reimportXmp';
import { findVirtualCopyStack, newStackId, stackTag, stackIdFromTags, STACK_TAG_PREFIX, findManualStack, captureTimeKey, groupPathsByCaptureTime, effectiveGroupId } from '../utils/imageGrouping';
import { KEYBIND_DEFINITIONS, normalizeCombo } from '../utils/keyboardUtils';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { useProcessStore } from '../store/useProcessStore';
import { useEditorActions } from './useEditorActions';
import { useLibraryActions } from './useLibraryActions';
import { useTranslation } from 'react-i18next';
import { ToolType } from '../components/panel/right/Masks';
import { SOFT_PROOF_PROFILES } from '../utils/softProofProfiles';
import { COLOR_LABELS } from '../utils/adjustments';
import { pickDevelopPath } from '../utils/catalogMembership';

interface KeyboardShortcutsProps {
  sortedImageList: Array<ImageFile>;
  handleBackToLibrary(): void;
  handleDeleteSelected(): void;
  handleImageSelect(path: string): void;
  handlePasteFiles(str: string): void;
  handleToggleFullScreen(): void;
  handleZoomChange(zoomValue: number, fitToWindow?: boolean): void;
}

export const useKeyboardShortcuts = ({
  sortedImageList,
  handleBackToLibrary,
  handleDeleteSelected,
  handleImageSelect,
  handlePasteFiles,
  handleToggleFullScreen,
  handleZoomChange,
}: KeyboardShortcutsProps) => {
  const { t } = useTranslation();
  const { handleRotate, handleCopyAdjustments, handlePasteAdjustments, handleMatchPrevious, handleSyncSettings, setAdjustments, handleAutoAdjustments, handleResetAdjustments } = useEditorActions();
  const { handleRate, handleSetColorLabel, handleSetFlag } = useLibraryActions();

  const sortedListRef = useRef(sortedImageList);

  // Library (outside Cull layout): P checks / X unchecks the active photo instead of flagging.
  const isLibraryCheckMode = (s: any) =>
    !s.editor.selectedImage && s.settings?.appSettings?.libraryDisplayMode !== 'cull';

  const setActiveChecked = (s: any, checked: boolean) => {
    const active = s.library.libraryActivePath;
    if (!active) return;
    const current: string[] = s.library.multiSelectedPaths || [];
    const next = checked
      ? current.includes(active)
        ? current
        : [...current, active]
      : current.filter((p) => p !== active);
    s.library.setLibrary({ multiSelectedPaths: next });
  };

  const advanceCullSelection = (s: any) => {
    // Library-only; respect Settings → auto-advance while culling (default on)
    if (s.editor.selectedImage) return;
    if (s.settings?.appSettings?.autoAdvanceOnCull === false) return;
    const list = sortedListRef.current || [];
    if (list.length === 0) return;
    const cur =
      s.library.libraryActivePath ||
      (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]) ||
      null;
    const idx = cur ? list.findIndex((img: ImageFile) => img.path === cur) : -1;
    if (idx >= 0 && idx + 1 < list.length) {
      const nextPath = list[idx + 1].path;
      s.library.setLibrary({
        libraryActivePath: nextPath,
        multiSelectedPaths: [nextPath],
        selectionAnchorPath: nextPath,
      });
    }
  };

  useEffect(() => {
    sortedListRef.current = sortedImageList;
  }, [sortedImageList]);

  useEffect(() => {
    const getStoreState = () => ({
      editor: useEditorStore.getState(),
      library: useLibraryStore.getState(),
      ui: useUIStore.getState(),
      settings: useSettingsStore.getState(),
      process: useProcessStore.getState(),
    });

    const comboMap = new Map<string, string>();
    const keybinds = useSettingsStore.getState().appSettings?.keybinds;

    for (const def of KEYBIND_DEFINITIONS) {
      const userCombo = keybinds?.[def.action];
      const effective = userCombo && userCombo.length > 0 ? userCombo : def.defaultCombo;
      if (effective) {
        comboMap.set(effective.join('+'), def.action);
      }
    }

    const actions: Record<string, any> = {
      open_image: {
        shouldFire: (s: any) => !s.editor.selectedImage && s.library.libraryActivePath !== null,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleImageSelect(s.library.libraryActivePath!);
        },
      },
      go_to_library: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleBackToLibrary();
        },
      },
      go_to_develop: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.editor.selectedImage) {
            s.ui.setUI({
              activeView: 'develop',
              activeRightPanel: Panel.Adjustments,
              renderedRightPanel: Panel.Adjustments,
            });
            return;
          }
          const target = pickDevelopPath(s.library.albumTree, [
            s.library.libraryActivePath,
            ...(s.library.multiSelectedPaths || []),
            ...(s.library.imageList || []).map((img: ImageFile) => img.path),
          ]);
          if (target) handleImageSelect(target);
          else
            s.ui.setUI({
              activeView: 'develop',
              activeRightPanel: Panel.Adjustments,
              renderedRightPanel: Panel.Adjustments,
              uiVisibility: { ...s.ui.uiVisibility, developLeft: true, filmstrip: true },
            });
        },
      },

      module_library: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setUI({ activeView: 'library' });
          if (s.editor.selectedImage) handleBackToLibrary();
        },
      },
      module_develop: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.editor.selectedImage) {
            s.ui.setUI({
              activeView: 'develop',
              activeRightPanel: Panel.Adjustments,
              renderedRightPanel: Panel.Adjustments,
            });
            return;
          }
          const target = pickDevelopPath(s.library.albumTree, [
            s.library.libraryActivePath,
            ...(s.library.multiSelectedPaths || []),
            ...(s.library.imageList || []).map((img: ImageFile) => img.path),
          ]);
          if (target) handleImageSelect(target);
          else
            s.ui.setUI({
              activeView: 'develop',
              activeRightPanel: Panel.Adjustments,
              renderedRightPanel: Panel.Adjustments,
              uiVisibility: { ...s.ui.uiVisibility, developLeft: true, filmstrip: true },
            });
        },
      },
      module_map: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // Map focuses the active photo's pin (if any) via libraryActivePath.
          if (s.editor.selectedImage) handleBackToLibrary();
          s.ui.setUI({ activeView: 'map' });
        },
      },
      module_border: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.editor.selectedImage) handleBackToLibrary();
          s.ui.setUI({ activeView: 'border' });
        },
      },
      module_web: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.editor.selectedImage) handleBackToLibrary();
          s.ui.setUI({ activeView: 'web' });
        },
      },
      toggle_side_panels: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // LR Tab: hide/show side panels (folder tree + develop left + right panel)
          const vis = s.ui.uiVisibility || {};
          const rightOpen = !!s.ui.activeRightPanel;
          const libRightOpen = vis.libraryRight !== false;
          const sidesOpen =
            vis.folderTree !== false ||
            vis.developLeft !== false ||
            rightOpen ||
            libRightOpen;
          if (sidesOpen) {
            s.ui.setUI({
              uiVisibility: {
                ...vis,
                folderTree: false,
                developLeft: false,
                libraryRight: false,
              },
              activeRightPanel: null,
            });
          } else {
            s.ui.setUI({
              uiVisibility: {
                ...vis,
                folderTree: true,
                developLeft: true,
                libraryRight: true,
              },
              activeRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
              renderedRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
            });
          }
        },
      },
      toggle_filmstrip: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const vis = s.ui.uiVisibility || {};
          s.ui.setUI({
            uiVisibility: { ...vis, filmstrip: vis.filmstrip === false },
          });
        },
      },
      toggle_left_panels: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const vis = s.ui.uiVisibility || {};
          const open = vis.folderTree !== false || vis.developLeft !== false;
          s.ui.setUI({
            uiVisibility: {
              ...vis,
              folderTree: !open,
              developLeft: !open,
            },
          });
        },
      },
      toggle_right_panels: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const vis = s.ui.uiVisibility || {};
          const inDevelop = !!s.editor.selectedImage;
          if (inDevelop) {
            if (s.ui.activeRightPanel) {
              s.ui.setUI({ activeRightPanel: null });
            } else {
              const panel = s.ui.renderedRightPanel || Panel.Adjustments;
              s.ui.setUI({ activeRightPanel: panel, renderedRightPanel: panel });
            }
          } else {
            const open = vis.libraryRight !== false;
            s.ui.setUI({
              uiVisibility: { ...vis, libraryRight: !open },
            });
          }
        },
      },
      toggle_all_panels: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // Shift+Tab: hide/show everything including filmstrip
          const vis = s.ui.uiVisibility || {};
          const rightOpen = !!s.ui.activeRightPanel;
          const anyOpen =
            vis.folderTree !== false ||
            vis.developLeft !== false ||
            vis.filmstrip !== false ||
            vis.libraryRight !== false ||
            rightOpen;
          if (anyOpen) {
            s.ui.setUI({
              uiVisibility: {
                ...vis,
                folderTree: false,
                developLeft: false,
                filmstrip: false,
                libraryRight: false,
              },
              activeRightPanel: null,
            });
          } else {
            s.ui.setUI({
              uiVisibility: {
                ...vis,
                folderTree: true,
                developLeft: true,
                filmstrip: true,
                libraryRight: true,
              },
              activeRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
              renderedRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
            });
          }
        },
      },

      reimport_xmp: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage?.path || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const multi = s.library.multiSelectedPaths || [];
          const paths =
            multi.length > 0
              ? multi
              : [
                  s.editor.selectedImage?.path ||
                    s.library.libraryActivePath ||
                    multi[0],
                ].filter(Boolean);
          if (paths.length === 0) return;
          try {
            if (paths.length === 1) {
              await reimportDevelopFromXmpPath(paths[0]);
              if (s.editor.selectedImage?.path !== paths[0]) {
                handleImageSelect(paths[0]);
              }
              toast.success(t('contextMenus.toasts.reimportedXmp'));
            } else {
              const { ok, fail } = await reimportDevelopFromXmpPaths(paths);
              if (ok > 0) {
                toast.success(
                  t('contextMenus.toasts.reimportedXmpCount' as any, {
                    defaultValue: 'Reimported develop from XMP for {{count}} photos',
                    count: ok,
                  }),
                );
              }
              if (fail > 0) {
                toast.error(
                  t('contextMenus.toasts.reimportXmpFailed' as any, {
                    defaultValue: 'Failed to reimport XMP for {{count}} photos',
                    count: fail,
                  }),
                );
              }
            }
          } catch (err) {
            toast.error(String(err));
          }
        },
      },
      export_develop_xmp: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage?.path || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const multi = s.library.multiSelectedPaths || [];
          const paths =
            multi.length > 0
              ? multi
              : [
                  s.editor.selectedImage?.path ||
                    s.library.libraryActivePath ||
                    multi[0],
                ].filter(Boolean);
          if (paths.length === 0) return;
          try {
            const { ok, fail } = await exportDevelopToXmpPaths(paths);
            if (ok > 0) {
              toast.success(
                paths.length === 1
                  ? t('contextMenus.toasts.exportedDevelopXmp')
                  : t('contextMenus.toasts.exportedDevelopXmpCount' as any, {
                      defaultValue: 'Exported develop XMP for {{count}} photos',
                      count: ok,
                    }),
              );
            }
            if (fail > 0) {
              toast.error(
                t('contextMenus.toasts.exportDevelopXmpFailed' as any, {
                  defaultValue: 'Failed to export XMP for {{count}} photos',
                  count: fail,
                }),
              );
            }
          } catch (err) {
            toast.error(String(err));
          }
        },
      },
      create_snapshot: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.path,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:create-snapshot'));
          } catch {
            /* ignore */
          }
        },
      },
      snapshot_next: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.path,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:snapshot-next'));
          } catch {
            /* ignore */
          }
        },
      },
      snapshot_prev: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.path,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:snapshot-prev'));
          } catch {
            /* ignore */
          }
        },
      },
      delete_snapshot: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.path,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:delete-snapshot'));
          } catch {
            /* ignore */
          }
        },
      },

      rename_snapshot: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.path,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:rename-snapshot'));
          } catch {
            /* ignore */
          }
        },
      },
      auto_tone: {
        shouldFire: (s: any) => !!s.editor.selectedImage?.isReady,
        execute: (e: any) => {
          e.preventDefault();
          handleAutoAdjustments();
        },
      },
      toggle_wb_picker: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // LR-style WB selector (eyedropper) while developing
          s.editor.setEditor({
            isWbPickerActive: !s.editor.isWbPickerActive,
            isPointColorPickerActive: false,
            // leave crop/masks alone; picker is overlay mode
          });
        },
      },

      cycle_white_balance: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // LR-style named illuminant cycle (relative temp/tint offsets)
          const order = [
            'As Shot',
            'Auto',
            'Daylight',
            'Cloudy',
            'Shade',
            'Tungsten',
            'Fluorescent',
            'Flash',
            'Custom',
          ] as const;
          const WB_RELATIVE: Record<string, { temperature: number; tint: number }> = {
            'As Shot': { temperature: 0, tint: 0 },
            Auto: { temperature: 0, tint: 0 },
            Daylight: { temperature: 5, tint: 2 },
            Cloudy: { temperature: 18, tint: 5 },
            Shade: { temperature: 32, tint: 8 },
            Tungsten: { temperature: -55, tint: -8 },
            Fluorescent: { temperature: -22, tint: 28 },
            Flash: { temperature: 8, tint: 0 },
          };
          const adj = s.editor.adjustments || {};
          const cur = String(adj.whiteBalance || 'As Shot');
          let idx = order.findIndex(
            (n) => n.toLowerCase() === cur.toLowerCase() || (n === 'As Shot' && /as\s*shot/i.test(cur)),
          );
          if (idx < 0) idx = 0;
          const next = order[(idx + 1) % order.length];
          const off =
            next === 'Custom'
              ? { temperature: adj.temperature ?? 0, tint: adj.tint ?? 0 }
              : WB_RELATIVE[next] || { temperature: 0, tint: 0 };
          setAdjustments((prev: any) => ({
            ...prev,
            whiteBalance: next,
            temperature: off.temperature,
            tint: off.tint,
          }));
        },
      },
      toggle_straighten: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // Open Crop if needed, then toggle straighten tool
          if (s.ui.activeRightPanel !== Panel.Crop) {
            s.ui.setRightPanel(Panel.Crop);
            s.editor.setEditor({ isStraightenActive: true, isWbPickerActive: false });
          } else {
            s.editor.setEditor({
              isStraightenActive: !s.editor.isStraightenActive,
              isWbPickerActive: false,
            });
          }
        },
      },
      copy_adjustments: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setUI({ isCopyPasteSettingsModalOpen: true });
        },
      },
      paste_adjustments: {
        shouldFire: (s: any) => !!s.editor.copiedAdjustments,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          handlePasteAdjustments(paths);
        },
      },
      match_previous: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleMatchPrevious();
        },
      },
      sync_settings: {
        shouldFire: (s: any) => (s.library.multiSelectedPaths?.length || 0) >= 2,
        execute: (e: any) => {
          e.preventDefault();
          handleSyncSettings();
        },
      },
      copy_files: {
        shouldFire: (s: any) => s.library.multiSelectedPaths.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.process.setProcess({ copiedFilePaths: s.library.multiSelectedPaths });
        },
      },
      paste_files: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handlePasteFiles('copy');
        },
      },
      select_all: {
        shouldFire: () => sortedListRef.current.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.library.setLibrary({ multiSelectedPaths: sortedListRef.current.map((f: ImageFile) => f.path) });
          if (!s.editor.selectedImage) {
            s.library.setLibrary({ libraryActivePath: sortedListRef.current[sortedListRef.current.length - 1].path });
          }
        },
      },
      select_none: {
        shouldFire: (s: any) =>
          !s.editor.selectedImage &&
          ((s.library.multiSelectedPaths && s.library.multiSelectedPaths.length > 0) || !!s.library.libraryActivePath),
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.library.setLibrary({
            multiSelectedPaths: [],
            libraryActivePath: null,
            selectionAnchorPath: null,
            showSelectedOnly: false,
          });
        },
      },
      first_photo: {
        shouldFire: () => sortedListRef.current.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const list = sortedListRef.current;
          const first = list[0];
          if (!first) return;
          s.library.setLibrary({
            libraryActivePath: first.path,
            multiSelectedPaths: [first.path],
            selectionAnchorPath: first.path,
          });
          // Develop: open first photo
          if (s.editor.selectedImage && s.editor.selectedImage.path !== first.path) {
            handleImageSelect(first.path);
          }
        },
      },
      last_photo: {
        shouldFire: () => sortedListRef.current.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const list = sortedListRef.current;
          const last = list[list.length - 1];
          if (!last) return;
          s.library.setLibrary({
            libraryActivePath: last.path,
            multiSelectedPaths: [last.path],
            selectionAnchorPath: last.path,
          });
          if (s.editor.selectedImage && s.editor.selectedImage.path !== last.path) {
            handleImageSelect(last.path);
          }
        },
      },
      sort_by_capture: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          // Toggle direction if already capture sort
          const same = cur.key === 'date_taken';
          const order = same && cur.order === 'asc' ? 'desc' : same && cur.order === 'desc' ? 'asc' : 'desc';
          s.library.setSortCriteria({ key: 'date_taken', order });
          toast.info(order === 'desc' ? 'Sort: Capture time (newest first)' : 'Sort: Capture time (oldest first)');
        },
      },
      sort_by_rating: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const same = cur.key === 'rating';
          const order = same && cur.order === 'desc' ? 'asc' : 'desc';
          s.library.setSortCriteria({ key: 'rating', order });
          toast.info(order === 'desc' ? 'Sort: Rating (high → low)' : 'Sort: Rating (low → high)');
        },
      },
      sort_by_name: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const same = cur.key === 'name';
          const order = same && cur.order === 'asc' ? 'desc' : 'asc';
          s.library.setSortCriteria({ key: 'name', order });
          toast.info(order === 'asc' ? 'Sort: File name (A→Z)' : 'Sort: File name (Z→A)');
        },
      },
      toggle_sort_direction: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const order = cur.order === 'asc' ? 'desc' : 'asc';
          s.library.setSortCriteria({ ...cur, order });
          toast.info(order === 'asc' ? 'Sort ascending' : 'Sort descending');
        },
      },
      sort_by_flag: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const same = cur.key === 'flag';
          const order = same && cur.order === 'asc' ? 'desc' : 'asc';
          s.library.setSortCriteria({ key: 'flag', order });
          toast.info(
            order === 'asc'
              ? 'Sort: Flag (picks → rejects)'
              : 'Sort: Flag (rejects → picks)',
          );
        },
      },
      sort_by_color: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const same = cur.key === 'color' || cur.key === 'color_label';
          const order = same && cur.order === 'asc' ? 'desc' : 'asc';
          s.library.setSortCriteria({ key: 'color', order });
          toast.info(order === 'asc' ? 'Sort: Color label' : 'Sort: Color label (rev)');
        },
      },
      sort_by_edited: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          const same = cur.key === 'edited';
          const order = same && cur.order === 'desc' ? 'asc' : 'desc';
          s.library.setSortCriteria({ key: 'edited', order });
          toast.info(
            order === 'desc' ? 'Sort: Edited first' : 'Sort: Unedited first',
          );
        },
      },
      cycle_sort_field: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const orderKeys = [
            'name',
            'date_taken',
            'date',
            'rating',
            'flag',
            'color',
            'edited',
            'camera',
            'lens',
            'iso',
            'aperture',
            'focal_length',
            'shutter_speed',
            'file_type',
            'has_gps',
            'urgency',
            'category',
            'creator',
            'credit',
            'job_title',
            'city',
            'country',
            'state',
            'sublocation',
            'headline',
            'country_code',
            'usage_terms',
          ];
          const labels: Record<string, string> = {
            name: 'Name',
            date_taken: 'Capture',
            date: 'Modified',
            rating: 'Rating',
            flag: 'Flag',
            color: 'Color',
            edited: 'Edited',
            camera: 'Camera',
            lens: 'Lens',
            iso: 'ISO',
            aperture: 'Aperture',
            focal_length: 'Focal length',
            shutter_speed: 'Shutter',
            file_type: 'Type',
            has_gps: 'GPS',
            urgency: 'Urgency',
            category: 'Category',
            creator: 'Creator',
            credit: 'Credit',
            job_title: 'Job Title',
            city: 'City',
            country: 'Country',
            state: 'State',
            sublocation: 'Sub-location',
            headline: 'Headline',
            country_code: 'Country code',
            usage_terms: 'Usage terms',
          };
          const cur = s.library.sortCriteria || { key: 'name', order: 'asc' };
          let idx = orderKeys.indexOf(cur.key);
          if (idx < 0 && (cur.key === 'color_label')) idx = orderKeys.indexOf('color');
          if (e.shiftKey) {
            idx = idx <= 0 ? orderKeys.length - 1 : idx - 1;
          } else {
            idx = idx < 0 ? 0 : (idx + 1) % orderKeys.length;
          }
          const key = orderKeys[idx];
          s.library.setSortCriteria({ key, order: cur.order || 'asc' });
          toast.info(`Sort: ${labels[key] || key}`);
        },
      },

      invert_selection: {
        shouldFire: (s: any) => !s.editor.selectedImage && sortedListRef.current.length > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const list = sortedListRef.current;
          const current = new Set(s.library.multiSelectedPaths || []);
          // If nothing multi-selected but active path, treat active as selection
          if (current.size === 0 && s.library.libraryActivePath) {
            current.add(s.library.libraryActivePath);
          }
          const inverted = list.map((f: ImageFile) => f.path).filter((p: string) => !current.has(p));
          s.library.setLibrary({
            multiSelectedPaths: inverted,
            libraryActivePath: inverted.length ? inverted[inverted.length - 1] : null,
            selectionAnchorPath: inverted.length ? inverted[inverted.length - 1] : null,
            showSelectedOnly: false,
          });
        },
      },
      compare_swap: {
        shouldFire: (s: any) =>
          !s.editor.selectedImage &&
          Array.isArray(s.library.multiSelectedPaths) &&
          s.library.multiSelectedPaths.length >= 2,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const multi = [...s.library.multiSelectedPaths];
          const a = multi[0];
          const b = multi[1];
          multi[0] = b;
          multi[1] = a;
          s.library.setLibrary({
            multiSelectedPaths: multi,
            libraryActivePath: b,
            selectionAnchorPath: b,
          });
          toast.info('Compare: swapped Select / Candidate');
        },
      },
      reset_develop: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleResetAdjustments();
        },
      },
      cycle_lights_out: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = (s.ui.lightsOut ?? 0) as number;
          const next = ((cur + 1) % 3) as 0 | 1 | 2;
          // Level 2 also collapses chrome like classic Lights Out
          if (next === 2) {
            const vis = s.ui.uiVisibility || {};
            s.ui.setUI({
              lightsOut: 2,
              uiVisibility: {
                ...vis,
                folderTree: false,
                developLeft: false,
                libraryRight: false,
                filmstrip: false,
              },
              activeRightPanel: null,
            });
          } else if (next === 0) {
            // restore chrome
            const vis = s.ui.uiVisibility || {};
            s.ui.setUI({
              lightsOut: 0,
              uiVisibility: {
                ...vis,
                folderTree: true,
                developLeft: true,
                libraryRight: true,
                filmstrip: true,
              },
              activeRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
              renderedRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
            });
          } else {
            s.ui.setUI({ lightsOut: 1 });
          }
        },
      },
      delete_selected: {
        shouldFire: (s: any) => !s.editor.activeMaskContainerId && !s.editor.activeAiPatchContainerId,
        execute: (e: any) => {
          e.preventDefault();
          handleDeleteSelected();
        },
      },
      preview_prev: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === s.editor.selectedImage!.path);
          if (currentIndex === -1) return;
          let nextIndex = currentIndex - 1 < 0 ? sortedListRef.current.length - 1 : currentIndex - 1;
          handleImageSelect(sortedListRef.current[nextIndex].path);
        },
      },
      preview_next: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === s.editor.selectedImage!.path);
          if (currentIndex === -1) return;
          let nextIndex = currentIndex + 1 >= sortedListRef.current.length ? 0 : currentIndex + 1;
          handleImageSelect(sortedListRef.current[nextIndex].path);
        },
      },
      zoom_in_step: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.min(currentPercent + 0.1, 2.0));
        },
      },
      zoom_out_step: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.max(currentPercent - 0.1, 0.1));
        },
      },
      cycle_zoom: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const { originalSize, displaySize, baseRenderSize } = s.editor;
          const currentPercent =
            originalSize?.width > 0 && displaySize?.width > 0
              ? Math.round(((displaySize.width * dpr) / originalSize.width) * 100)
              : 100;
          let fitPercent = 100;

          if (originalSize?.width > 0 && baseRenderSize?.width > 0) {
            const originalAspect = originalSize.width / originalSize.height;
            const baseAspect = baseRenderSize.width / baseRenderSize.height;
            fitPercent =
              originalAspect > baseAspect
                ? Math.round(((baseRenderSize.width * dpr) / originalSize.width) * 100)
                : Math.round(((baseRenderSize.height * dpr) / originalSize.height) * 100);
          }

          const doubleFitPercent = fitPercent * 2;
          if (Math.abs(currentPercent - fitPercent) < 5) {
            handleZoomChange(doubleFitPercent < 100 ? doubleFitPercent / 100 : 1.0);
          } else if (Math.abs(currentPercent - doubleFitPercent) < 5 && doubleFitPercent < 100) {
            handleZoomChange(1.0);
          } else {
            handleZoomChange(0, true);
          }
        },
      },
      zoom_in: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.min(currentPercent * 1.2, 2.0));
        },
      },
      zoom_out: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
          const currentPercent =
            s.editor.originalSize?.width > 0 && s.editor.displaySize?.width > 0
              ? (s.editor.displaySize.width * dpr) / s.editor.originalSize.width
              : 1.0;
          handleZoomChange(Math.max(currentPercent / 1.2, 0.1));
        },
      },
      zoom_fit: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleZoomChange(0, true);
        },
      },



      cycle_filmstrip_scope: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent('rustroom:cycle-filmstrip-scope', { detail: { dir: 1 } }),
          );
        },
      },
      cycle_filmstrip_scope_prev: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent('rustroom:cycle-filmstrip-scope', { detail: { dir: -1 } }),
          );
        },
      },
      cycle_exif_overlay: {
        shouldFire: () => true,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const order = [ExifOverlay.Off, ExifOverlay.Hover, ExifOverlay.Always];
          const cur = settings.exifOverlay || ExifOverlay.Off;
          const idx = order.indexOf(cur);
          const next = order[(idx < 0 ? 0 : idx + 1) % order.length];
          await s.settings.handleSettingsChange({ ...settings, exifOverlay: next });
          const labels: Record<string, string> = {
            [ExifOverlay.Off]: 'Metadata overlay: off',
            [ExifOverlay.Hover]: 'Metadata overlay: hover',
            [ExifOverlay.Always]: 'Metadata overlay: always',
          };
          toast.info(labels[next] || String(next));
        },
      },

      toggle_quick_filter: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('rustroom:toggle-quick-filter'));
        },
      },
      loupe_cycle_zoom: {
        shouldFire: () => false,
        execute: () => {},
      },
      zoom_100: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleZoomChange(1.0);
        },
      },
      rotate_left: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleRotate(-90);
        },
      },
      rotate_right: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleRotate(90);
        },
      },

      flip_horizontal: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          setAdjustments((prev: any) => ({
            ...prev,
            flipHorizontal: !prev.flipHorizontal,
          }));
        },
      },
      flip_vertical: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          setAdjustments((prev: any) => ({
            ...prev,
            flipVertical: !prev.flipVertical,
          }));
        },
      },
      undo: {
        shouldFire: (s: any) => !!s.editor.selectedImage && s.editor.historyIndex > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.undo();
        },
      },
      redo: {
        shouldFire: (s: any) => !!s.editor.selectedImage && s.editor.historyIndex < s.editor.history.length - 1,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.redo();
        },
      },

      history_step_back: {
        shouldFire: (s: any) => !!s.editor.selectedImage && s.editor.historyIndex > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.goToHistoryIndex(s.editor.historyIndex - 1);
        },
      },
      history_step_forward: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && s.editor.historyIndex < s.editor.history.length - 1,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.goToHistoryIndex(s.editor.historyIndex + 1);
        },
      },

      clear_history: {
        shouldFire: (s: any) => !!s.editor.selectedImage && (s.editor.history?.length || 0) > 1,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:clear-history'));
          } catch {
            /* ignore */
          }
        },
      },

      expand_all_sections: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:expand-all-sections'));
          } catch {
            /* ignore */
          }
        },
      },
      collapse_all_sections: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:collapse-all-sections'));
          } catch {
            /* ignore */
          }
        },
      },
      toggle_fullscreen: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          handleToggleFullScreen();
        },
      },
      show_original: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const next = !s.editor.showOriginal;
          s.editor.setEditor({ showOriginal: next, beforeAfterSplit: next ? false : s.editor.beforeAfterSplit });
        },
      },

      toggle_clipping: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const adj = s.editor.adjustments || {};
          const on = !!(adj.showShadowClipping || adj.showHighlightClipping || adj.showClipping);
          s.editor.setEditor({
            adjustments: {
              ...adj,
              showClipping: false,
              showShadowClipping: !on,
              showHighlightClipping: !on,
            },
          });
        },
      },
      toggle_original: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const next = !s.editor.showOriginal;
          s.editor.setEditor({ showOriginal: next, beforeAfterSplit: next ? false : s.editor.beforeAfterSplit });
        },
      },
      before_after_split: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (e.shiftKey && s.editor.beforeAfterSplit) {
            const order = ['vertical', 'horizontal', 'two-up'] as const;
            const cur = s.editor.beforeAfterOrientation;
            const idx = order.indexOf(cur);
            const next = order[(idx < 0 ? 0 : idx + 1) % order.length];
            s.editor.setEditor({ beforeAfterOrientation: next });
            return;
          }
          const next = !(s.editor.beforeAfterSplit && s.editor.beforeAfterOrientation === 'two-up');
          s.editor.setEditor({
            beforeAfterSplit: next,
            beforeAfterOrientation: 'two-up',
            showOriginal: next ? false : s.editor.showOriginal,
          });
        },
      },
      soft_proof: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const next = !s.editor.softProofing;
          s.editor.setEditor({ softProofing: next });
          toast.info(next ? 'Soft proof: on (Sim)' : 'Soft proof: off');
        },
      },
      cycle_soft_proof_profile: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const profiles = [...SOFT_PROOF_PROFILES];
          const cur = s.editor.softProofProfile || 'sRGB';
          const idx = Math.max(0, profiles.indexOf(cur));
          const next = profiles[(idx + 1) % profiles.length];
          const wasOff = !s.editor.softProofing;
          s.editor.setEditor({ softProofProfile: next, softProofing: true });
          toast.info(
            wasOff
              ? `Soft proof on · ${next}`
              : `Soft proof profile: ${next}`,
          );
        },
      },
      cycle_soft_proof_profile_prev: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const profiles = [...SOFT_PROOF_PROFILES];
          const cur = s.editor.softProofProfile || 'sRGB';
          const idx = Math.max(0, profiles.indexOf(cur));
          const next = profiles[(idx - 1 + profiles.length) % profiles.length];
          const wasOff = !s.editor.softProofing;
          s.editor.setEditor({ softProofProfile: next, softProofing: true });
          toast.info(
            wasOff
              ? `Soft proof on · ${next}`
              : `Soft proof profile: ${next}`,
          );
        },
      },

      cycle_soft_proof_intent: {
        shouldFire: (s: any) => !!s.editor.selectedImage && !!s.editor.softProofing,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const intents = ['relative', 'perceptual', 'absolute'] as const;
          const cur = s.editor.softProofIntent || 'relative';
          const idx = Math.max(0, intents.indexOf(cur));
          const next = intents[(idx + 1) % intents.length];
          s.editor.setEditor({ softProofIntent: next });
          toast.info(`Soft proof intent: ${next}`);
        },
      },

      toggle_soft_proof_paper: {
        shouldFire: (s: any) => !!s.editor.selectedImage && !!s.editor.softProofing,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const next = !s.editor.softProofSimulatePaper;
          s.editor.setEditor({ softProofSimulatePaper: next });
          toast.info(next ? 'Soft proof: simulate paper on' : 'Soft proof: simulate paper off');
        },
      },
      create_proof_copy: {
        shouldFire: (s: any) => !!s.editor.selectedImage && !!s.editor.softProofing,
        execute: (e: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:create-proof-copy'));
          } catch {
            /* ignore */
          }
        },
      },
      toggle_soft_proof_gamut: {
        shouldFire: (s: any) => !!s.editor.selectedImage && !!s.editor.softProofing,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const next = !s.editor.softProofShowGamutWarning;
          s.editor.setEditor({ softProofShowGamutWarning: next });
          toast.info(next ? 'Soft proof: gamut warning on' : 'Soft proof: gamut warning off');
        },
      },


      library_thumb_larger: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('rustroom:library-thumb-size', { detail: { delta: 1 } }));
        },
      },
      library_thumb_smaller: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('rustroom:library-thumb-size', { detail: { delta: -1 } }));
        },
      },
      library_view_grid: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Grid });
          toast.info('Library view: Grid');
        },
      },
      library_view_loupe: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Loupe });
          toast.info('Library view: Loupe');
        },
      },
      library_view_compare: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Compare });
          toast.info('Library view: Compare');
        },
      },
      library_view_survey: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Survey });
          toast.info('Library view: Survey');
        },
      },
      library_view_cull: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.Cull });
          toast.info('Library view: Cull');
        },
      },
      library_view_list: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const { appSettings, handleSettingsChange } = useSettingsStore.getState();
          if (!appSettings) return;
          handleSettingsChange({ ...appSettings, libraryDisplayMode: LibraryDisplayMode.List });
          toast.info('Library view: List');
        },
      },


      clear_keywords: {
        shouldFire: (s: any) => {
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          return paths.length > 0;
        },
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          if (!paths.length) return;
          const list = s.library.imageList || [];
          let removed = 0;
          try {
            for (const path of paths) {
              const img = list.find((i: ImageFile) => i.path === path);
              const userTags = (img?.tags || []).filter(
                (tg: string) =>
                  tg.startsWith('user:') ||
                  (!tg.startsWith('color:') &&
                    !tg.startsWith('flag:') &&
                    !tg.startsWith('stack:') &&
                    !!tg),
              );
              for (const tag of userTags) {
                const full = tag.startsWith('user:') ? tag : `user:${tag}`;
                await invoke(Invokes.RemoveTagForPaths, { paths: [path], tag: full });
                if (!tag.startsWith('user:')) {
                  await invoke(Invokes.RemoveTagForPaths, { paths: [path], tag }).catch(() => {});
                }
                removed += 1;
              }
            }
            // Update local tags
            s.library.setLibrary({
              imageList: list.map((img: ImageFile) => {
                if (!paths.includes(img.path)) return img;
                const tags = (img.tags || []).filter(
                  (tg: string) =>
                    tg.startsWith('color:') ||
                    tg.startsWith('flag:') ||
                    tg.startsWith('stack:'),
                );
                return { ...img, tags: tags.length ? tags : null };
              }),
            });
            toast.success(
              removed
                ? `Cleared keywords (${removed} tag removals on ${paths.length} photo(s))`
                : 'No user keywords to clear',
            );
          } catch (err) {
            toast.error(`Clear keywords failed: ${err}`);
          }
        },
      },
      add_keyword_prompt: {
        shouldFire: (s: any) => {
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          return paths.length > 0;
        },
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          if (!paths.length) return;
          const raw = window.prompt(
            paths.length > 1
              ? `Add keyword to ${paths.length} photos (use parent/child for hierarchy)`
              : 'Add keyword (use parent/child for hierarchy)',
            '',
          );
          if (raw == null || !String(raw).trim()) return;
          // Expand hierarchy like LibraryRightPanel
          const cleaned = String(raw)
            .trim()
            .toLowerCase()
            .replace(/^user:/, '')
            .replace(/\s*>\s*/g, '/')
            .replace(/\s*\|\s*/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\/|\/$/g, '');
          if (!cleaned) return;
          const parts = cleaned.split('/').map((p) => p.trim()).filter(Boolean);
          const segments: string[] = [];
          let acc = '';
          for (const part of parts) {
            acc = acc ? `${acc}/${part}` : part;
            segments.push(acc);
          }
          try {
            for (const seg of segments) {
              const tag = `user:${seg}`;
              await invoke(Invokes.AddTagForPaths, { paths, tag });
            }
            const list = s.library.imageList || [];
            s.library.setLibrary({
              imageList: list.map((img: ImageFile) => {
                if (!paths.includes(img.path)) return img;
                const tags = [...(img.tags || [])];
                for (const seg of segments) {
                  const tag = `user:${seg}`;
                  if (!tags.includes(tag) && !tags.includes(seg)) tags.push(tag);
                }
                return { ...img, tags };
              }),
            });
            toast.success(
              segments.length > 1
                ? `Added hierarchical keyword (${segments[segments.length - 1].replace(/\//g, ' › ')})`
                : `Added keyword “${segments[0]}”`,
            );
          } catch (err) {
            toast.error(`Add keyword failed: ${err}`);
          }
        },
      },
      filter_selected_only: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const lib = s.library;
          const hasSel =
            (lib.multiSelectedPaths && lib.multiSelectedPaths.length > 0) || !!lib.libraryActivePath;
          if (!hasSel && !lib.showSelectedOnly) return;
          lib.setLibrary({
            showSelectedOnly: !lib.showSelectedOnly,
            showPreviousImportOnly: false,
            showQuickCollectionOnly: false,
          });
        },
      },
      toggle_quick_collection: {
        shouldFire: () => {
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          return !!(
            lib.multiSelectedPaths?.length ||
            lib.libraryActivePath ||
            ed.selectedImage?.path
          );
        },
        execute: async (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          const paths =
            lib.multiSelectedPaths?.length > 0
              ? lib.multiSelectedPaths
              : ed.selectedImage?.path
                ? [ed.selectedImage.path]
                : lib.libraryActivePath
                  ? [lib.libraryActivePath]
                  : [];
          if (!paths.length) return;

          const targetId = lib.targetCollectionId;

          // Target = Quick Collection (null)
          if (!targetId) {
            const current = new Set(lib.quickCollectionPaths || []);
            const primary = paths[0];
            if (current.has(primary)) {
              paths.forEach((p) => current.delete(p));
            } else {
              paths.forEach((p) => current.add(p));
            }
            lib.setLibrary({ quickCollectionPaths: Array.from(current) });
            return;
          }

          // Target = album id
          try {
            const tree = structuredClone(lib.albumTree || []);
            let album: any = null;
            const find = (nodes: any[]): any => {
              for (const n of nodes) {
                if (n.id === targetId && n.type === 'album') return n;
                if (n.type === 'group') {
                  const f = find(n.children || []);
                  if (f) return f;
                }
              }
              return null;
            };
            album = find(tree);
            if (!album) {
              // album gone — fall back to QC
              lib.setLibrary({ targetCollectionId: null });
              const current = new Set(lib.quickCollectionPaths || []);
              paths.forEach((p) => current.add(p));
              lib.setLibrary({ quickCollectionPaths: Array.from(current) });
              return;
            }
            const imgs: string[] = album.images || [];
            const primary = paths[0];
            const remove = imgs.includes(primary);
            if (remove) {
              album.images = imgs.filter((p: string) => !paths.includes(p));
              await invoke(Invokes.SaveAlbums, { tree });
              const sorted = await invoke(Invokes.GetAlbums);
              lib.setLibrary({ albumTree: sorted as any });
              // if viewing this album, refresh list
              if (lib.activeAlbumId === targetId) {
                const files: any[] = await invoke(Invokes.GetAlbumImages, { paths: album.images });
                lib.setLibrary({ imageList: files });
              }
            } else {
              await invoke(Invokes.AddToAlbum, { albumId: targetId, paths });
              const sorted = await invoke(Invokes.GetAlbums);
              lib.setLibrary({ albumTree: sorted as any });
            }
          } catch (err) {
            toast.error(`Target collection failed: ${err}`);
          }
        },
      },
      show_quick_collection: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const next = !lib.showQuickCollectionOnly;
          lib.setLibrary({
            showQuickCollectionOnly: next,
            showPreviousImportOnly: next ? false : lib.showPreviousImportOnly,
            activeAlbumId: next ? null : lib.activeAlbumId,
          });
        },
      },


      clear_filters: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // Full replace (setFilterCriteria merges — would leave stale fields)
          s.library.setLibrary({
            filterCriteria: {
              colors: [],
              rating: 0,
              rawStatus: 'all',
              editedStatus: 'all',
              flagStatus: 'all',
              hasGps: 'all',
              hasCaption: 'all',
              hasLocation: 'all',
              orientation: 'all',
              hasStack: 'all',
              hasKeywords: 'all',
              virtualCopies: 'all',
            },
            showPreviousImportOnly: false,
            showQuickCollectionOnly: false,
            showSelectedOnly: false,
          });
          toast.info('Filters cleared');
        },
      },
      save_filter_preset: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const criteria = s.library.filterCriteria || {};
          const name = window.prompt('Name this filter preset', 'My filter');
          if (!name || !name.trim()) return;
          const preset = {
            id: `fp_${Date.now().toString(36)}`,
            name: name.trim(),
            criteria: { ...criteria },
          };
          const prev = Array.isArray(settings.libraryFilterPresets)
            ? settings.libraryFilterPresets
            : [];
          await s.settings.handleSettingsChange({
            ...settings,
            libraryFilterPresets: [...prev, preset].slice(-20),
          });
          toast.success(`Saved filter preset “${preset.name}”`);
        },
      },
      add_picks_to_target: {
        shouldFire: (s: any) => !s.editor.selectedImage || true,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const lib = s.library;
          const picks = (lib.imageList || [])
            .filter((img: ImageFile) =>
              (img.tags || []).some(
                (tg: string) => tg === 'flag:pick' || tg.endsWith(':pick'),
              ),
            )
            .map((img: ImageFile) => img.path);
          if (!picks.length) {
            toast.info('No picks in current view');
            return;
          }
          const targetId = lib.targetCollectionId;
          if (!targetId) {
            // Quick Collection
            const current = new Set(lib.quickCollectionPaths || []);
            picks.forEach((p: string) => current.add(p));
            lib.setLibrary({ quickCollectionPaths: Array.from(current) });
            toast.success(`Added ${picks.length} pick(s) to Quick Collection`);
            return;
          }
          try {
            const tree = structuredClone(lib.albumTree || []);
            const find = (nodes: any[]): any => {
              for (const n of nodes) {
                if (n.id === targetId && n.type === 'album') return n;
                if (n.type === 'group') {
                  const f = find(n.children || []);
                  if (f) return f;
                }
              }
              return null;
            };
            const album = find(tree);
            if (!album) {
              toast.error('Target collection not found');
              return;
            }
            const imgs: string[] = album.images || [];
            const set = new Set(imgs);
            picks.forEach((p: string) => set.add(p));
            album.images = Array.from(set);
            await invoke(Invokes.SaveAlbums, { tree });
            const sorted = await invoke(Invokes.GetAlbums);
            lib.setLibrary({ albumTree: sorted as any });
            toast.success(`Added ${picks.length} pick(s) to target collection`);
          } catch (err) {
            toast.error(`Failed to add picks: ${err}`);
          }
        },
      },
      clear_quick_collection: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          useLibraryStore.getState().setLibrary({
            quickCollectionPaths: [],
            showQuickCollectionOnly: false,
          });
        },
      },
      cycle_virtual_copy_next: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          const path =
            ed.selectedImage?.path || lib.libraryActivePath || (lib.multiSelectedPaths || [])[0];
          if (!path) return;
          const stack = findVirtualCopyStack(lib.imageList || [], path);
          if (stack.length < 2) return;
          const idx = stack.findIndex((img) => img.path === path);
          const next = stack[(idx < 0 ? 0 : idx + 1) % stack.length];
          lib.setLibrary({
            multiSelectedPaths: [next.path],
            libraryActivePath: next.path,
            selectionAnchorPath: next.path,
          });
          if (ed.selectedImage) {
            handleImageSelect(next.path);
          }
        },
      },
      cycle_virtual_copy_prev: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          const path =
            ed.selectedImage?.path || lib.libraryActivePath || (lib.multiSelectedPaths || [])[0];
          if (!path) return;
          const stack = findVirtualCopyStack(lib.imageList || [], path);
          if (stack.length < 2) return;
          const idx = stack.findIndex((img) => img.path === path);
          const prev = stack[(idx < 0 ? 0 : idx - 1 + stack.length) % stack.length];
          lib.setLibrary({
            multiSelectedPaths: [prev.path],
            libraryActivePath: prev.path,
            selectionAnchorPath: prev.path,
          });
          if (ed.selectedImage) {
            handleImageSelect(prev.path);
          }
        },
      },
      create_virtual_copy: {
        shouldFire: () => {
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          if ((lib.multiSelectedPaths?.length || 0) >= 1) return true;
          return !!(ed.selectedImage?.path || lib.libraryActivePath);
        },
        execute: async (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          const paths: string[] =
            (lib.multiSelectedPaths?.length || 0) > 0
              ? [...lib.multiSelectedPaths]
              : ed.selectedImage?.path
                ? [ed.selectedImage.path]
                : lib.libraryActivePath
                  ? [lib.libraryActivePath]
                  : [];
          if (!paths.length) return;
          try {
            const created: string[] = [];
            let imageList = [...(useLibraryStore.getState().imageList || [])];
            for (const path of paths) {
              const newPath: string = await invoke(Invokes.CreateVirtualCopy, {
                sourceVirtualPath: path,
                targetAlbumId: lib.activeAlbumId || null,
              });
              created.push(newPath);
              const src = imageList.find((i) => i.path === path);
              if (src && !imageList.some((i) => i.path === newPath)) {
                imageList = [
                  ...imageList,
                  {
                    ...src,
                    path: newPath,
                    is_virtual_copy: true,
                    is_edited: src.is_edited,
                  },
                ];
              }
            }
            useLibraryStore.getState().setLibrary({
              imageList,
              multiSelectedPaths: created.length ? created : lib.multiSelectedPaths,
              libraryActivePath: created.length
                ? created[created.length - 1]
                : lib.libraryActivePath,
            });
            toast.success(
              created.length === 1
                ? 'Virtual copy created'
                : `${created.length} virtual copies created`,
            );
          } catch (err) {
            toast.error(`Virtual copy failed: ${err}`);
          }
        },
      },

      select_flagged_picks: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const picks = list
            .filter((img: ImageFile) => (img.tags || []).some((tg: string) => tg === 'flag:pick'))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: picks,
            libraryActivePath: picks.length ? picks[picks.length - 1] : null,
            selectionAnchorPath: picks.length ? picks[0] : null,
            showSelectedOnly: false,
          });
        },
      },
      select_flagged_rejects: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const rejects = list
            .filter((img: ImageFile) => (img.tags || []).some((tg: string) => tg === 'flag:reject'))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: rejects,
            libraryActivePath: rejects.length ? rejects[rejects.length - 1] : null,
            selectionAnchorPath: rejects.length ? rejects[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_flagged_any: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) =>
              (img.tags || []).some(
                (tg: string) =>
                  tg === 'flag:pick' ||
                  tg === 'flag:reject' ||
                  tg.endsWith(':pick') ||
                  tg.endsWith(':reject'),
              ),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No flagged photos in view');
          else toast.info(`Selected ${paths.length} flagged (P+X)`);
        },
      },

      select_unrated: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const ratings = useLibraryStore.getState().imageRatings || {};
          const paths = list
            .filter((img: ImageFile) => !(ratings[img.path] || img.rating || 0))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },
      select_five_star: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const ratings = useLibraryStore.getState().imageRatings || {};
          const paths = list
            .filter((img: ImageFile) => (Number(ratings[img.path] ?? img.rating) || 0) === 5)
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No 5★ photos in view');
          else toast.info(`Selected ${paths.length} · 5★`);
        },
      },
      select_zero_star: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const ratings = useLibraryStore.getState().imageRatings || {};
          const paths = list
            .filter((img: ImageFile) => (Number(ratings[img.path] ?? img.rating) || 0) <= 0)
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No unrated photos in view');
          else toast.info(`Selected ${paths.length} unrated`);
        },
      },

      select_rated: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const ratings = useLibraryStore.getState().imageRatings || {};
          const paths = list
            .filter((img: ImageFile) => (ratings[img.path] || img.rating || 0) > 0)
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No rated photos in view');
        },
      },
      select_same_rating: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const ratings = lib.imageRatings || {};
          const activePath =
            lib.libraryActivePath ||
            (lib.multiSelectedPaths && lib.multiSelectedPaths[0]);
          if (!activePath) return;
          const activeImg = list.find((img: ImageFile) => img.path === activePath);
          const key = Number(ratings[activePath] ?? activeImg?.rating ?? 0) || 0;
          const paths = list
            .filter((img: ImageFile) => (Number(ratings[img.path] ?? img.rating) || 0) === key)
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (paths.length) {
            toast.info(
              key === 0
                ? `Selected ${paths.length} unrated`
                : `Selected ${paths.length} with ${key}★`,
            );
          }
        },
      },
      select_same_orientation: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const activePath =
            lib.libraryActivePath ||
            (lib.multiSelectedPaths && lib.multiSelectedPaths[0]);
          if (!activePath) return;
          const orientOf = (img: ImageFile | undefined): 'landscape' | 'portrait' | 'square' | null => {
            if (!img) return null;
            const e = img.exif || {};
            const w =
              Number(img.width) ||
              parseFloat(String(e.ImageWidth || e.PixelXDimension || e.ExifImageWidth || '0')) ||
              0;
            const h =
              Number(img.height) ||
              parseFloat(String(e.ImageHeight || e.PixelYDimension || e.ExifImageHeight || '0')) ||
              0;
            if (!(w > 0 && h > 0)) return null;
            const ratio = w / h;
            if (ratio > 1.02) return 'landscape';
            if (ratio < 0.98) return 'portrait';
            return 'square';
          };
          const active = list.find((img: ImageFile) => img.path === activePath);
          const key = orientOf(active);
          if (!key) {
            toast.info('Active photo has no dimensions');
            return;
          }
          const paths = list
            .filter((img: ImageFile) => orientOf(img) === key)
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (paths.length) toast.info(`Selected ${paths.length} ${key}`);
        },
      },

      go_to_map_selection: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const path =
            s.editor.selectedImage?.path ||
            lib.libraryActivePath ||
            lib.multiSelectedPaths?.[0];
          if (path && !(lib.multiSelectedPaths || []).length) {
            lib.setLibrary({
              multiSelectedPaths: [path],
              libraryActivePath: path,
            });
          }
          if (s.editor.selectedImage) handleBackToLibrary();
          s.ui.setUI({ activeView: 'map' });
        },
      },

      select_gps: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const lat = img.exif?.GPSLatitude;
              const lon = img.exif?.GPSLongitude;
              if (lat == null || lon == null || lat === '' || lon === '') return false;
              return (
                Number.isFinite(parseFloat(String(lat))) &&
                Number.isFinite(parseFloat(String(lon)))
              );
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No GPS-tagged photos in view');
        },
      },
      select_has_caption: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const ex = img.exif || {};
              const hay = [
                ex.ImageDescription,
                ex.XPComment,
                ex.XPTitle,
                ex.Description,
                ex.Caption,
                ex['Caption-Abstract'],
              ]
                .filter(Boolean)
                .join(' ')
                .trim();
              return hay.length > 0;
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with captions in view');
          else toast.info(`Selected ${paths.length} with caption`);
        },
      },
      select_has_location: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const e = img.exif || {};
              return !!(
                (e.City && String(e.City).trim()) ||
                (e.Country && String(e.Country).trim()) ||
                (e.Location && String(e.Location).trim()) ||
                (e.SubLocation && String(e.SubLocation).trim()) ||
                (e.State && String(e.State).trim()) ||
                (e.Province && String(e.Province).trim())
              );
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with location in view');
          else toast.info(`Selected ${paths.length} with location`);
        },
      },
      cycle_library_display: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const order = [
            LibraryDisplayMode.Grid,
            LibraryDisplayMode.List,
            LibraryDisplayMode.Loupe,
            LibraryDisplayMode.Compare,
            LibraryDisplayMode.Survey,
            LibraryDisplayMode.Cull,
          ];
          const cur = settings.libraryDisplayMode || LibraryDisplayMode.Grid;
          const idx = order.indexOf(cur);
          const next = order[(idx < 0 ? 0 : idx + 1) % order.length];
          await s.settings.handleSettingsChange({ ...settings, libraryDisplayMode: next });
          const labels: Record<string, string> = {
            [LibraryDisplayMode.Grid]: 'Grid',
            [LibraryDisplayMode.List]: 'List',
            [LibraryDisplayMode.Loupe]: 'Loupe',
            [LibraryDisplayMode.Compare]: 'Compare',
            [LibraryDisplayMode.Survey]: 'Survey',
            [LibraryDisplayMode.Cull]: 'Cull',
          };
          toast.info(`Library view: ${labels[next] || next}`);
        },
      },

      show_in_finder: {
        shouldFire: (s: any) =>
          !!(
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0])
          ),
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const path =
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          if (!path) return;
          const physical = String(path).split('?vc=')[0];
          try {
            await invoke(Invokes.ShowInFinder, { path: physical });
          } catch (err) {
            toast.error(`Show in folder failed: ${err}`);
          }
        },
      },
      copy_filename: {
        shouldFire: (s: any) =>
          !!(
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0])
          ),
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : [
                  s.editor.selectedImage?.path ||
                    s.library.libraryActivePath,
                ].filter(Boolean);
          if (!paths.length) return;
          const names = paths.map((p: string) => {
            const physical = String(p).split('?vc=')[0];
            return physical.split(/[/\\]/).pop() || physical;
          });
          try {
            await navigator.clipboard.writeText(names.join('\n'));
            toast.success(
              names.length === 1
                ? 'Filename copied'
                : `${names.length} filenames copied`,
            );
          } catch (err) {
            toast.error(`Copy failed: ${err}`);
          }
        },
      },
      copy_file_path: {
        shouldFire: (s: any) =>
          !!(
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0])
          ),
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : [
                  s.editor.selectedImage?.path ||
                    s.library.libraryActivePath,
                ].filter(Boolean);
          if (!paths.length) return;
          const physicals = paths.map((p: string) => String(p).split('?vc=')[0]);
          try {
            await navigator.clipboard.writeText(physicals.join('\n'));
            toast.success(
              physicals.length === 1
                ? 'Path copied'
                : `${physicals.length} paths copied`,
            );
          } catch (err) {
            toast.error(`Copy failed: ${err}`);
          }
        },
      },

      select_unflagged: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !(img.tags || []).some((tg: string) => tg === 'flag:pick' || tg === 'flag:reject'),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_edited: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list.filter((img: ImageFile) => !!img.is_edited).map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },
      select_unedited: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list.filter((img: ImageFile) => !img.is_edited).map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_raw: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list.filter((img: ImageFile) => !!img.is_raw).map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No RAW photos in view');
          else toast.info(`Selected ${paths.length} RAW`);
        },
      },
      select_non_raw: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list.filter((img: ImageFile) => !img.is_raw).map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No non-RAW photos in view');
          else toast.info(`Selected ${paths.length} non-RAW`);
        },
      },

      select_virtual_copies: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !!img.is_virtual_copy || String(img.path || '').includes('?vc='),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No virtual copies in view');
          else toast.info(`Selected ${paths.length} virtual copies`);
        },
      },

      select_masters: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !img.is_virtual_copy && !String(img.path || '').includes('?vc='),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No master photos in view');
          else toast.info(`Selected ${paths.length} masters`);
        },
      },

      select_has_keywords: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) =>
              (img.tags || []).some((tg: string) => {
                if (tg.startsWith('user:')) return true;
                if (
                  tg.startsWith('flag:') ||
                  tg.startsWith('color:') ||
                  tg.startsWith('stack:')
                )
                  return false;
                return !tg.includes(':') && tg.trim().length > 0;
              }),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with keywords in view');
          else toast.info(`Selected ${paths.length} with keywords`);
        },
      },

      select_without_keywords: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !(img.tags || []).some((tg: string) => {
                  if (tg.startsWith('user:')) return true;
                  if (
                    tg.startsWith('flag:') ||
                    tg.startsWith('color:') ||
                    tg.startsWith('stack:')
                  )
                    return false;
                  return !tg.includes(':') && tg.trim().length > 0;
                }),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without keywords in view');
          else toast.info(`Selected ${paths.length} without keywords`);
        },
      },

      select_has_people: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
              return !!(pe && String(pe).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with people tags in view');
          else toast.info(`Selected ${paths.length} with people`);
        },
      },
      select_without_people: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const pe = img.exif?.PersonInImage || img.exif?.['Person In Image'];
              return !(pe && String(pe).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without people in view');
          else toast.info(`Selected ${paths.length} without people`);
        },
      },

      select_has_event: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const ev = img.exif?.Event;
              return !!(ev && String(ev).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with event tags in view');
          else toast.info(`Selected ${paths.length} with event`);
        },
      },

      select_without_event: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const ev = img.exif?.Event;
              return !(ev && String(ev).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without event in view');
          else toast.info(`Selected ${paths.length} without event`);
        },
      },
      select_has_scene: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const sc = img.exif?.Scene;
              return !!(sc && String(sc).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with scene tags in view');
          else toast.info(`Selected ${paths.length} with scene`);
        },
      },
      select_without_scene: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const sc = img.exif?.Scene;
              return !(sc && String(sc).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without scene in view');
          else toast.info(`Selected ${paths.length} without scene`);
        },
      },

      select_has_genre: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const g =
                img.exif?.IntellectualGenre || img.exif?.['Intellectual Genre'] || '';
              return !!(g && String(g).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with genre in view');
          else toast.info(`Selected ${paths.length} with genre`);
        },
      },
      select_without_genre: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const g =
                img.exif?.IntellectualGenre || img.exif?.['Intellectual Genre'] || '';
              return !(g && String(g).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without genre in view');
          else toast.info(`Selected ${paths.length} without genre`);
        },
      },

      select_has_subject_code: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const sc = img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
              return !!(sc && String(sc).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with subject code in view');
          else toast.info(`Selected ${paths.length} with subject code`);
        },
      },
      select_without_subject_code: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const sc = img.exif?.SubjectCode || img.exif?.['Subject Code'] || '';
              return !(sc && String(sc).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without subject code in view');
          else toast.info(`Selected ${paths.length} without subject code`);
        },
      },
      select_has_job_id: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const j =
                img.exif?.JobIdentifier ||
                img.exif?.JobID ||
                img.exif?.['Job Identifier'] ||
                '';
              return !!(j && String(j).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with job ID in view');
          else toast.info(`Selected ${paths.length} with job ID`);
        },
      },

      select_high_urgency: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const n = parseInt(String(img.exif?.Urgency || ''), 10);
              return Number.isFinite(n) && n >= 1 && n <= 2;
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No high-urgency photos in view');
          else toast.info(`Selected ${paths.length} high urgency (1–2)`);
        },
      },
      select_has_urgency: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const n = parseInt(String(img.exif?.Urgency || ''), 10);
              return Number.isFinite(n) && n >= 1 && n <= 8;
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with urgency in view');
          else toast.info(`Selected ${paths.length} with urgency`);
        },
      },
      select_without_urgency: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const n = parseInt(String(img.exif?.Urgency || ''), 10);
              return !(Number.isFinite(n) && n >= 1 && n <= 8);
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without urgency in view');
          else toast.info(`Selected ${paths.length} without urgency`);
        },
      },
      select_has_category: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const c = img.exif?.Category;
              return !!(c && String(c).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with category in view');
          else toast.info(`Selected ${paths.length} with category`);
        },
      },
      select_without_category: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const c = img.exif?.Category;
              return !(c && String(c).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without category in view');
          else toast.info(`Selected ${paths.length} without category`);
        },
      },
      select_without_job_id: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const j =
                img.exif?.JobIdentifier ||
                img.exif?.JobID ||
                img.exif?.['Job Identifier'] ||
                '';
              return !(j && String(j).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without job ID in view');
          else toast.info(`Selected ${paths.length} without job ID`);
        },
      },

      select_has_caption_writer: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const w =
                img.exif?.CaptionWriter ||
                img.exif?.['Caption Writer'] ||
                img.exif?.Writer ||
                '';
              return !!(w && String(w).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with caption writer in view');
          else toast.info(`Selected ${paths.length} with caption writer`);
        },
      },
      select_without_caption_writer: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const w =
                img.exif?.CaptionWriter ||
                img.exif?.['Caption Writer'] ||
                img.exif?.Writer ||
                '';
              return !(w && String(w).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without caption writer in view');
          else toast.info(`Selected ${paths.length} without caption writer`);
        },
      },
      select_has_digital_source: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const d =
                img.exif?.DigitalSourceType ||
                img.exif?.['Digital Source Type'] ||
                '';
              return !!(d && String(d).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with digital source type in view');
          else toast.info(`Selected ${paths.length} with digital source type`);
        },
      },
      select_without_digital_source: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const d =
                img.exif?.DigitalSourceType ||
                img.exif?.['Digital Source Type'] ||
                '';
              return !(d && String(d).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without digital source type in view');
          else toast.info(`Selected ${paths.length} without digital source type`);
        },
      },

      select_has_headline: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => !!(img.exif?.Headline && String(img.exif.Headline).trim()))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with headline in view');
          else toast.info(`Selected ${paths.length} with headline`);
        },
      },
      select_has_title: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const title = img.exif?.XPTitle || img.exif?.Title || '';
              return !!(title && String(title).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with title in view');
          else toast.info(`Selected ${paths.length} with title`);
        },
      },
      select_has_credit: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => !!(img.exif?.Credit && String(img.exif.Credit).trim()))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with credit in view');
          else toast.info(`Selected ${paths.length} with credit`);
        },
      },

      select_has_source: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => !!(img.exif?.Source && String(img.exif.Source).trim()))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with source in view');
          else toast.info(`Selected ${paths.length} with source`);
        },
      },
      select_has_instructions: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !!(img.exif?.Instructions && String(img.exif.Instructions).trim()),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with instructions in view');
          else toast.info(`Selected ${paths.length} with instructions`);
        },
      },

      select_has_creator: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const c = img.exif?.Artist || img.exif?.Creator || '';
              return !!(c && String(c).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with creator in view');
          else toast.info(`Selected ${paths.length} with creator`);
        },
      },
      select_has_rights: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const r =
                img.exif?.Copyright ||
                img.exif?.Rights ||
                img.exif?.UsageTerms ||
                img.exif?.['Usage Terms'] ||
                '';
              return !!(r && String(r).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with rights/copyright in view');
          else toast.info(`Selected ${paths.length} with rights`);
        },
      },

      select_has_job_title: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const j =
                img.exif?.AuthorsPosition || img.exif?.['Authors Position'] || '';
              return !!(j && String(j).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with job title in view');
          else toast.info(`Selected ${paths.length} with job title`);
        },
      },

      select_has_city: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => !!(img.exif?.City && String(img.exif.City).trim()))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with city in view');
          else toast.info(`Selected ${paths.length} with city`);
        },
      },
      select_has_country: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => !!(img.exif?.Country && String(img.exif.Country).trim()))
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with country in view');
          else toast.info(`Selected ${paths.length} with country`);
        },
      },

      select_has_state: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const s = img.exif?.State || img.exif?.Province || '';
              return !!(s && String(s).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with state/province in view');
          else toast.info(`Selected ${paths.length} with state`);
        },
      },

      select_has_sublocation: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const s = img.exif?.Location || img.exif?.SubLocation || '';
              return !!(s && String(s).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with sub-location in view');
          else toast.info(`Selected ${paths.length} with sub-location`);
        },
      },

      select_has_country_code: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const c =
                img.exif?.CountryCode || img.exif?.['Country Code'] || '';
              return !!(c && String(c).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with country code in view');
          else toast.info(`Selected ${paths.length} with country code`);
        },
      },
      select_has_usage_terms: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const u =
                img.exif?.UsageTerms || img.exif?.['Usage Terms'] || '';
              return !!(u && String(u).trim());
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos with usage terms in view');
          else toast.info(`Selected ${paths.length} with usage terms`);
        },
      },

      select_without_caption: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const ex = img.exif || {};
              const hay = [
                ex.ImageDescription,
                ex.XPComment,
                ex.XPTitle,
                ex.Description,
                ex.Caption,
                ex['Caption-Abstract'],
              ]
                .filter(Boolean)
                .join(' ')
                .trim();
              return hay.length === 0;
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without caption in view');
          else toast.info(`Selected ${paths.length} without caption`);
        },
      },
      select_without_location: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const ex = img.exif || {};
              return !(
                (ex.City && String(ex.City).trim()) ||
                (ex.Country && String(ex.Country).trim()) ||
                (ex.Location && String(ex.Location).trim()) ||
                (ex.SubLocation && String(ex.SubLocation).trim()) ||
                (ex.State && String(ex.State).trim()) ||
                (ex.Province && String(ex.Province).trim())
              );
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without location in view');
          else toast.info(`Selected ${paths.length} without location`);
        },
      },

      select_without_gps: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) => {
              const lat = img.exif?.GPSLatitude;
              const lon = img.exif?.GPSLongitude;
              if (lat == null || lon == null || lat === '' || lon === '') return true;
              return !(
                Number.isFinite(parseFloat(String(lat))) &&
                Number.isFinite(parseFloat(String(lon)))
              );
            })
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No photos without GPS in view');
          else toast.info(`Selected ${paths.length} without GPS`);
        },
      },
      select_stacked: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter((img: ImageFile) =>
              (img.tags || []).some((tg: string) => tg.startsWith('stack:')),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No stacked photos in view');
          else toast.info(`Selected ${paths.length} stacked`);
        },
      },
      select_unstacked: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const list = sortedListRef.current || [];
          const paths = list
            .filter(
              (img: ImageFile) =>
                !(img.tags || []).some((tg: string) => tg.startsWith('stack:')),
            )
            .map((img: ImageFile) => img.path);
          useLibraryStore.getState().setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : null,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          if (!paths.length) toast.info('No unstacked photos in view');
          else toast.info(`Selected ${paths.length} unstacked`);
        },
      },

      select_same_camera: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const key = `${active.exif.Make || ''} ${active.exif.Model || ''}`.toLowerCase().trim();
          if (!key) return;
          const paths = list
            .filter((img: ImageFile) => {
              const cam = `${img.exif?.Make || ''} ${img.exif?.Model || ''}`.toLowerCase().trim();
              return cam && cam === key;
            })
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },
      select_same_lens: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const key = `${active.exif.LensModel || active.exif.Lens || ''}`.toLowerCase().trim();
          if (!key) return;
          const paths = list
            .filter((img: ImageFile) => {
              const lens = `${img.exif?.LensModel || img.exif?.Lens || ''}`.toLowerCase().trim();
              return lens && lens === key;
            })
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_color: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) return;
          const color =
            (active.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6) || '';
          const paths = list
            .filter((img: ImageFile) => {
              const c =
                (img.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6) || '';
              return color ? c === color : !c;
            })
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_day: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) return;
          const dayOf = (img: ImageFile) => {
            const raw = String(img.exif?.DateTimeOriginal || img.exif?.DateTime || '').trim();
            // EXIF often "YYYY:MM:DD HH:MM:SS" or ISO
            const m = raw.match(/(\d{4})[:\-](\d{2})[:\-](\d{2})/);
            if (m) return `${m[1]}-${m[2]}-${m[3]}`;
            if (img.modified) {
              const d = new Date(img.modified * (img.modified < 1e12 ? 1000 : 1));
              if (!Number.isNaN(d.getTime())) {
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              }
            }
            return '';
          };
          const key = dayOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => dayOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_stack: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) {
            toast.info('Select a photo first');
            return;
          }
          const sid = stackIdFromTags(active.tags || []);
          const gid = effectiveGroupId(active);
          if (!sid && !gid) {
            toast.info('Active photo is not stacked');
            return;
          }
          const paths = list
            .filter((img: ImageFile) => {
              if (sid) return stackIdFromTags(img.tags || []) === sid;
              return effectiveGroupId(img) === gid;
            })
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          toast.info(`Selected ${paths.length} in stack`);
        },
      },

      select_same_filename_base: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) {
            toast.info('Select a photo first');
            return;
          }
          const baseOf = (path: string) => {
            const physical = String(path || '').split('?')[0];
            const name = physical.split(/[/\\]/).pop() || physical;
            const dot = name.lastIndexOf('.');
            return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
          };
          const key = baseOf(active.path);
          if (!key) return;
          const paths = list
            .filter((img: ImageFile) => baseOf(img.path) === key)
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          toast.info(
            paths.length > 1
              ? `Selected ${paths.length} with base “${key}” (e.g. RAW+JPEG)`
              : `Only one file with base “${key}”`,
          );
        },
      },
      select_same_extension: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) {
            toast.info('Select a photo first');
            return;
          }
          const extOf = (path: string) => {
            const physical = String(path || '').split('?')[0];
            const name = physical.split(/[/\\]/).pop() || physical;
            const dot = name.lastIndexOf('.');
            return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
          };
          const key = extOf(active.path);
          if (!key) {
            toast.info('Active photo has no extension');
            return;
          }
          const paths = list
            .filter((img: ImageFile) => extOf(img.path) === key)
            .map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
          toast.info(`Selected ${paths.length} .${key}`);
        },
      },
      cycle_filter_preset: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          const presets = Array.isArray(settings?.libraryFilterPresets)
            ? settings.libraryFilterPresets
            : [];
          if (!presets.length) {
            toast.info('No saved filter presets (save from Library view options)');
            return;
          }
          const lib = useLibraryStore.getState();
          const cur = lib.filterCriteria || {};
          // Find matching preset index by shallow criteria equality
          const critKey = (c: any) =>
            JSON.stringify({
              colors: c?.colors || [],
              rating: c?.rating ?? 0,
              rawStatus: c?.rawStatus,
              editedStatus: c?.editedStatus,
              flagStatus: c?.flagStatus,
              hasGps: c?.hasGps,
              hasCaption: c?.hasCaption,
              hasLocation: c?.hasLocation,
              orientation: c?.orientation,
              hasStack: c?.hasStack,
              hasKeywords: c?.hasKeywords,
              virtualCopies: c?.virtualCopies,
            });
          const curKey = critKey(cur);
          let idx = presets.findIndex((p: any) => critKey(p?.criteria) === curKey);
          if (e.shiftKey) {
            idx = idx <= 0 ? presets.length - 1 : idx - 1;
          } else {
            idx = idx < 0 ? 0 : (idx + 1) % presets.length;
          }
          const next = presets[idx];
          if (next?.criteria) {
            lib.setLibrary({
              filterCriteria: { ...next.criteria } as any,
              showPreviousImportOnly: false,
              showQuickCollectionOnly: false,
              showSelectedOnly: false,
            });
            toast.info(`Filter preset: ${next.name || idx + 1}`);
          }
        },
      },

      select_same_keyword: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) return;
          const userTags = (active.tags || [])
            .filter((tg: string) => tg.startsWith('user:'))
            .map((tg: string) => tg.slice(5).toLowerCase())
            .filter(Boolean);
          if (!userTags.length) return;
          // Prefer first keyword; if filter already set to one of them, cycle
          const currentFilter = String(lib.filterCriteria?.keyword || '').trim().toLowerCase();
          let pick = userTags[0];
          if (currentFilter && userTags.includes(currentFilter)) {
            const i = userTags.indexOf(currentFilter);
            pick = userTags[(i + 1) % userTags.length];
          }
          const paths = list
            .filter((img: ImageFile) =>
              (img.tags || []).some(
                (tg: string) =>
                  tg.toLowerCase() === `user:${pick}` ||
                  tg.toLowerCase().replace(/^user:/, '') === pick,
              ),
            )
            .map((img: ImageFile) => img.path);
          lib.setFilterCriteria((prev: any) => ({ ...prev, keyword: pick }));
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },


      select_same_iso: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const isoOf = (img: ImageFile) => {
            const raw = String(
              img.exif?.PhotographicSensitivity || img.exif?.ISOSpeedRatings || img.exif?.ISO || '',
            ).trim();
            const n = parseInt(raw, 10);
            return Number.isFinite(n) && n > 0 ? n : 0;
          };
          const key = isoOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => isoOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },
      select_same_aperture: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const aperOf = (img: ImageFile) => {
            const raw = String(img.exif?.FNumber || '').trim().toLowerCase().replace(/^f\/?/, '');
            const n = parseFloat(raw);
            return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
          };
          const key = aperOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => aperOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_focal: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const focalOf = (img: ImageFile) => {
            const raw = String(
              img.exif?.FocalLengthIn35mmFilm || img.exif?.FocalLength || '',
            )
              .trim()
              .toLowerCase()
              .replace(/\s*mm$/, '');
            const n = parseFloat(raw);
            return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
          };
          const key = focalOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => focalOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_shutter: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const shutterOf = (img: ImageFile) => {
            const raw = String(img.exif?.ExposureTime || '').trim().toLowerCase();
            if (!raw) return '';
            // Normalize "1/250" / "1/250s" / "0.004"
            return raw.replace(/\s*s$/, '').replace(/\s+/g, '');
          };
          const key = shutterOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => shutterOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_city: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const city = String(active.exif.City || '').trim().toLowerCase();
          if (!city) return;
          const paths = list
            .filter((img: ImageFile) => String(img.exif?.City || '').trim().toLowerCase() === city)
            .map((img: ImageFile) => img.path);
          lib.setFilterCriteria((prev: any) => ({ ...prev, city: active.exif?.City || city }));
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_country: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const country = String(active.exif.Country || '').trim().toLowerCase();
          if (!country) return;
          const paths = list
            .filter((img: ImageFile) => String(img.exif?.Country || '').trim().toLowerCase() === country)
            .map((img: ImageFile) => img.path);
          lib.setFilterCriteria((prev: any) => ({
            ...prev,
            country: active.exif?.Country || country,
          }));
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_location: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active?.exif) return;
          const locOf = (img: ImageFile) =>
            String(img.exif?.Location || img.exif?.SubLocation || '')
              .trim()
              .toLowerCase();
          const key = locOf(active);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => locOf(img) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },

      select_same_folder: {
        shouldFire: () => !useEditorStore.getState().selectedImage,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const list = sortedListRef.current || [];
          const active =
            list.find((img: ImageFile) => img.path === lib.libraryActivePath) ||
            list.find((img: ImageFile) => (lib.multiSelectedPaths || []).includes(img.path));
          if (!active) return;
          const folderOf = (p: string) => {
            const physical = String(p || '').split('?vc=')[0];
            const i = Math.max(physical.lastIndexOf('/'), physical.lastIndexOf('\\'));
            return i > 0 ? physical.slice(0, i) : '';
          };
          const key = folderOf(active.path);
          if (!key) return;
          const paths = list.filter((img: ImageFile) => folderOf(img.path) === key).map((img: ImageFile) => img.path);
          lib.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths.length ? paths[paths.length - 1] : lib.libraryActivePath,
            selectionAnchorPath: paths.length ? paths[0] : null,
            showSelectedOnly: false,
          });
        },
      },


      stack_photos: {
        shouldFire: (s: any) => !s.editor.selectedImage && (s.library.multiSelectedPaths?.length || 0) >= 2,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths: string[] = s.library.multiSelectedPaths || [];
          if (paths.length < 2) return;
          const list = s.library.imageList || [];
          // Reuse existing stack id if any selected photo is already stacked
          let sid: string | null = null;
          for (const p of paths) {
            const img = list.find((i: ImageFile) => i.path === p);
            const existing = stackIdFromTags(img?.tags);
            if (existing) {
              sid = existing;
              break;
            }
          }
          if (!sid) sid = newStackId();
          const tag = stackTag(sid);
          try {
            // Remove other stack tags first, then add new
            for (const p of paths) {
              const img = list.find((i: ImageFile) => i.path === p);
              const old = stackIdFromTags(img?.tags);
              if (old && old !== sid) {
                await invoke(Invokes.RemoveTagForPaths, { paths: [p], tag: stackTag(old) });
              }
            }
            await invoke(Invokes.AddTagForPaths, { paths, tag });
            s.library.setLibrary({
              imageList: list.map((img: ImageFile) => {
                if (!paths.includes(img.path)) return img;
                const tags = (img.tags || []).filter((tg: string) => !tg.startsWith(STACK_TAG_PREFIX));
                tags.push(tag);
                return { ...img, tags };
              }),
            });
          } catch (err) {
            console.error('stack failed', err);
          }
        },
      },
      unstack_photos: {
        shouldFire: (s: any) => {
          if (s.editor.selectedImage) return false; // leave soft-proof gamut for develop
          const paths = s.library.multiSelectedPaths?.length
            ? s.library.multiSelectedPaths
            : s.library.libraryActivePath
              ? [s.library.libraryActivePath]
              : [];
          if (!paths.length) return false;
          const list = s.library.imageList || [];
          return paths.some((p: string) => {
            const img = list.find((i: ImageFile) => i.path === p);
            return !!stackIdFromTags(img?.tags);
          });
        },
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths: string[] = s.library.multiSelectedPaths?.length
            ? s.library.multiSelectedPaths
            : s.library.libraryActivePath
              ? [s.library.libraryActivePath]
              : [];
          const list = s.library.imageList || [];
          // Expand to full stacks for any selected member
          const toUnstack = new Set<string>();
          const tagsToRemove = new Set<string>();
          for (const p of paths) {
            const stack = findManualStack(list, p);
            for (const img of stack) {
              toUnstack.add(img.path);
              const sid = stackIdFromTags(img.tags);
              if (sid) tagsToRemove.add(stackTag(sid));
            }
          }
          if (!toUnstack.size) return;
          try {
            for (const tag of tagsToRemove) {
              await invoke(Invokes.RemoveTagForPaths, { paths: Array.from(toUnstack), tag });
            }
            s.library.setLibrary({
              imageList: list.map((img: ImageFile) => {
                if (!toUnstack.has(img.path)) return img;
                return {
                  ...img,
                  tags: (img.tags || []).filter((tg: string) => !tg.startsWith(STACK_TAG_PREFIX)),
                };
              }),
            });
          } catch (err) {
            console.error('unstack failed', err);
          }
        },
      },

      auto_stack_by_time: {
        shouldFire: (s: any) => !s.editor.selectedImage && (s.library.multiSelectedPaths?.length || 0) >= 2,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const paths: string[] = s.library.multiSelectedPaths || [];
          const list = s.library.imageList || [];
          const groups = groupPathsByCaptureTime(list, paths);
          let stackedGroups = 0;
          try {
            for (const [, groupPaths] of groups) {
              if (groupPaths.length < 2) continue;
              // Reuse stack id if any member already stacked
              let sid: string | null = null;
              for (const p of groupPaths) {
                const img = list.find((i: ImageFile) => i.path === p);
                const existing = stackIdFromTags(img?.tags);
                if (existing) {
                  sid = existing;
                  break;
                }
              }
              if (!sid) sid = newStackId();
              const tag = stackTag(sid);
              for (const p of groupPaths) {
                const img = list.find((i: ImageFile) => i.path === p);
                const old = stackIdFromTags(img?.tags);
                if (old && old !== sid) {
                  await invoke(Invokes.RemoveTagForPaths, { paths: [p], tag: stackTag(old) });
                }
              }
              await invoke(Invokes.AddTagForPaths, { paths: groupPaths, tag });
              stackedGroups += 1;
              // update local list for subsequent groups
              for (const p of groupPaths) {
                const img = list.find((i: ImageFile) => i.path === p);
                if (!img) continue;
                const tags = (img.tags || []).filter((tg: string) => !tg.startsWith(STACK_TAG_PREFIX));
                tags.push(tag);
                img.tags = tags;
              }
            }
            s.library.setLibrary({ imageList: [...list] });
            if (stackedGroups > 0) {
              toast.success(
                stackedGroups === 1
                  ? 'Stacked photos by capture time'
                  : `Created ${stackedGroups} stacks by capture time`,
              );
            } else {
              toast.info('No burst groups found (need ≥2 photos with the same capture second)');
            }
          } catch (err) {
            console.error('auto stack failed', err);
          }
        },
      },
      select_same_capture_time: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const list = s.library.imageList || [];
          // Prefer sorted list from library display - use full imageList
          const active =
            list.find((img: ImageFile) => img.path === s.library.libraryActivePath) ||
            list.find((img: ImageFile) => (s.library.multiSelectedPaths || []).includes(img.path));
          if (!active) return;
          const key = captureTimeKey(active);
          if (!key) return;
          // Use currently visible sorted list if available via multi - filter imageList
          // Prefer matching within same folder-filtered list: imageList is current folder
          const paths = list
            .filter((img: ImageFile) => captureTimeKey(img) === key)
            .map((img: ImageFile) => img.path);
          if (!paths.length) return;
          s.library.setLibrary({
            multiSelectedPaths: paths,
            libraryActivePath: paths[paths.length - 1],
            selectionAnchorPath: paths[0],
            showSelectedOnly: false,
          });
        },
      },

      cycle_stack: {
        shouldFire: (s: any) => {
          if (s.editor.selectedImage) return false;
          const path =
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          if (!path) return false;
          const list = s.library.imageList || [];
          const img = list.find((i: ImageFile) => i.path === path);
          if (stackIdFromTags(img?.tags)) return true;
          // also RAW/JPEG groups
          return !!(img?.group_id);
        },
        execute: (e: any, s: any) => {
          e.preventDefault();
          const path =
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          if (!path) return;
          const list = s.library.imageList || [];
          const img = list.find((i: ImageFile) => i.path === path);
          let stack: ImageFile[] = [];
          const sid = stackIdFromTags(img?.tags);
          if (sid) {
            stack = list.filter((i: ImageFile) => stackIdFromTags(i.tags) === sid);
          } else if (img?.group_id) {
            stack = list.filter(
              (i: ImageFile) => i.group_id === img.group_id && !i.is_virtual_copy,
            );
          }
          if (stack.length < 2) return;
          const idx = stack.findIndex((i) => i.path === path);
          const next = stack[(idx < 0 ? 0 : idx + 1) % stack.length];
          s.library.setLibrary({
            libraryActivePath: next.path,
            multiSelectedPaths: [next.path],
            selectionAnchorPath: next.path,
          });
        },
      },
      toggle_expand_stack: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const path =
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          if (!path) return;
          const list = s.library.imageList || [];
          const img = list.find((i: ImageFile) => i.path === path);
          if (!img) return;
          const gid = effectiveGroupId(img);
          if (!gid) {
            toast.info('Active photo is not in a stack');
            return;
          }
          const cur = new Set(s.library.expandedStackIds || []);
          if (cur.has(gid)) {
            cur.delete(gid);
            toast.info('Stack collapsed');
          } else {
            cur.add(gid);
            toast.info('Stack expanded');
          }
          s.library.setLibrary({ expandedStackIds: Array.from(cur) });
        },
      },
      collapse_all_stacks: {
        shouldFire: (s: any) => !s.editor.selectedImage && (s.library.expandedStackIds?.length || 0) > 0,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.library.setLibrary({ expandedStackIds: [] });
          toast.info('All stacks collapsed');
        },
      },





      toggle_previous_import: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const lib = s.library;
          const has = (lib.lastImportedPaths || []).length > 0;
          if (!has) {
            toast.info('No previous import batch');
            return;
          }
          const next = !lib.showPreviousImportOnly;
          lib.setLibrary({
            showPreviousImportOnly: next,
            showQuickCollectionOnly: false,
            showSelectedOnly: false,
            activeAlbumId: null,
          });
          toast.info(next ? 'Showing Previous Import' : 'Showing all photos');
        },
      },
      toggle_library_recursive: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const cur = settings.libraryViewMode || 'flat';
          const next = cur === 'recursive' ? 'flat' : 'recursive';
          await s.settings.handleSettingsChange({ ...settings, libraryViewMode: next });
          toast.info(
            next === 'recursive'
              ? 'Library: show photos in subfolders'
              : 'Library: current folder only',
          );
          try {
            window.dispatchEvent(new CustomEvent('rustroom:library-refresh'));
          } catch {
            /* ignore */
          }
        },
      },
      go_to_parent_folder: {
        shouldFire: (s: any) => !s.editor.selectedImage && !!s.library.currentFolderPath,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const path = String(s.library.currentFolderPath || '');
          if (!path || path.startsWith('Album: ')) {
            toast.info('No parent folder');
            return;
          }
          const norm = path.replace(/\\/g, '/');
          // Strip trailing slash
          const trimmed = norm.replace(/\/+$/, '');
          const parts = trimmed.split('/').filter(Boolean);
          if (parts.length <= 1) {
            // At root (e.g. /Users or C:)
            toast.info('Already at top of path');
            return;
          }
          let parent: string;
          if (path.startsWith('/')) {
            parent = '/' + parts.slice(0, -1).join('/');
          } else if (parts[0].endsWith(':')) {
            // Windows C:/Users/foo -> C:/Users
            parent =
              parts.length === 2
                ? parts[0] + '/'
                : parts[0] + '/' + parts.slice(1, -1).join('/');
          } else {
            parent = parts.slice(0, -1).join('/');
          }
          // Restore native separators
          if (path.includes('\\')) parent = parent.replace(/\//g, '\\');
          // Prefer a known root if parent is outside roots? Still navigate.
          window.dispatchEvent(
            new CustomEvent('rustroom:navigate-folder', {
              detail: { path: parent, fromHistory: false },
            }),
          );
        },
      },
      folder_back: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const hist: string[] = s.library.folderHistory || [];
          let idx = s.library.folderHistoryIndex ?? -1;
          if (idx <= 0 || hist.length < 2) {
            toast.info('No previous folder');
            return;
          }
          idx -= 1;
          const path = hist[idx];
          s.library.setLibrary({ folderHistoryIndex: idx });
          window.dispatchEvent(
            new CustomEvent('rustroom:navigate-folder', {
              detail: { path, fromHistory: true },
            }),
          );
        },
      },
      folder_forward: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const hist: string[] = s.library.folderHistory || [];
          let idx = s.library.folderHistoryIndex ?? -1;
          if (idx < 0 || idx >= hist.length - 1) {
            toast.info('No next folder');
            return;
          }
          idx += 1;
          const path = hist[idx];
          s.library.setLibrary({ folderHistoryIndex: idx });
          window.dispatchEvent(
            new CustomEvent('rustroom:navigate-folder', {
              detail: { path, fromHistory: true },
            }),
          );
        },
      },
      create_collection_from_selection: {
        shouldFire: (s: any) => {
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.library.libraryActivePath
                ? [s.library.libraryActivePath]
                : [];
          return paths.length > 0;
        },
        execute: (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? [...s.library.multiSelectedPaths]
              : s.library.libraryActivePath
                ? [s.library.libraryActivePath]
                : [];
          if (!paths.length) return;
          s.ui.setUI({
            pendingAlbumSeedPaths: paths,
            isCreateAlbumModalOpen: true,
          });
        },
      },
      toggle_hide_rejected: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const next = !settings.hideRejectedPhotos;
          await s.settings.handleSettingsChange({ ...settings, hideRejectedPhotos: next });
          toast.info(next ? 'Hiding rejected photos' : 'Showing rejected photos');
        },
      },
      delete_rejected: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const list = s.library.imageList || [];
          const rejected = list
            .filter((img: ImageFile) =>
              (img.tags || []).some(
                (tg: string) => tg === 'flag:reject' || tg.endsWith(':reject'),
              ),
            )
            .map((img: ImageFile) => img.path);
          if (!rejected.length) {
            toast.info('No rejected photos to delete');
            return;
          }
          s.ui.setUI({
            confirmModalState: {
              confirmText: `Delete ${rejected.length} Rejected`,
              confirmVariant: 'destructive',
              isOpen: true,
              message: `Permanently delete ${rejected.length} rejected photo(s)? This cannot be undone.`,
              title: 'Delete Rejected Photos',
              onConfirm: () => {
                window.dispatchEvent(
                  new CustomEvent('rustroom:delete-paths', { detail: { paths: rejected } }),
                );
              },
            },
          });
        },
      },

      copy_metadata: {
        shouldFire: (s: any) => {
          const path =
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          return !!path;
        },
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const path =
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          if (!path) return;
          try {
            const meta: any = await invoke(Invokes.LoadMetadata, { path });
            const exif = meta?.exif || {};
            const fields = [
              'ImageDescription',
              'XPTitle',
              'Caption',
              'Headline',
              'Artist',
              'Creator',
              'Copyright',
              'UserComment',
              'City',
              'State',
              'Country',
              'Location',
              'SubLocation',
              'Province',
            ];
            const clip: Record<string, string> = {};
            for (const k of fields) {
              const v = exif[k];
              if (v != null && String(v).trim() !== '') clip[k] = String(v);
            }
            // Also copy user keywords (not flags/colors/stacks)
            const tags = (meta?.tags || []) as string[];
            const userKws = tags
              .filter((tg) => tg.startsWith('user:'))
              .map((tg) => tg.slice(5));
            if (userKws.length) clip.__keywords = userKws.join('\n');
            useLibraryStore.getState().setLibrary({ copiedMetadata: clip });
            const n = Object.keys(clip).filter((k) => k !== '__keywords').length;
            toast.success(
              n || userKws.length
                ? `Copied metadata (${n} fields${userKws.length ? ` + ${userKws.length} keywords` : ''})`
                : 'No IPTC fields to copy',
            );
          } catch (err) {
            toast.error(`Copy metadata failed: ${err}`);
          }
        },
      },
      paste_metadata: {
        shouldFire: (s: any) => {
          const clip = s.library.copiedMetadata;
          if (!clip || !Object.keys(clip).length) return false;
          const paths =
            s.editor.selectedImage?.path
              ? [s.editor.selectedImage.path]
              : s.library.multiSelectedPaths?.length
                ? s.library.multiSelectedPaths
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          return paths.length > 0;
        },
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const clip = { ...(s.library.copiedMetadata || {}) };
          if (!Object.keys(clip).length) {
            toast.info('No metadata on clipboard — copy with Ctrl+Alt+Shift+J');
            return;
          }
          const paths: string[] = s.editor.selectedImage?.path
            ? [s.editor.selectedImage.path]
            : s.library.multiSelectedPaths?.length
              ? s.library.multiSelectedPaths
              : s.library.libraryActivePath
                ? [s.library.libraryActivePath]
                : [];
          if (!paths.length) return;
          const kwRaw = clip.__keywords;
          delete clip.__keywords;
          try {
            if (Object.keys(clip).length) {
              await invoke(Invokes.UpdateExifFields, { paths, updates: clip });
              // Update local imageList exif
              s.library.setLibrary({
                imageList: (s.library.imageList || []).map((img: ImageFile) => {
                  if (!paths.includes(img.path)) return img;
                  return { ...img, exif: { ...(img.exif || {}), ...clip } };
                }),
              });
            }
            if (kwRaw) {
              const kws = String(kwRaw)
                .split('\n')
                .map((k) => k.trim())
                .filter(Boolean);
              for (const kw of kws) {
                const tag = kw.startsWith('user:') ? kw : `user:${kw.toLowerCase()}`;
                await invoke(Invokes.AddTagForPaths, { paths, tag });
              }
              s.library.setLibrary({
                imageList: (s.library.imageList || []).map((img: ImageFile) => {
                  if (!paths.includes(img.path)) return img;
                  const tags = [...(img.tags || [])];
                  for (const kw of kws) {
                    const tag = kw.startsWith('user:') ? kw : `user:${kw.toLowerCase()}`;
                    if (!tags.includes(tag)) tags.push(tag);
                  }
                  return { ...img, tags };
                }),
              });
            }
            toast.success(`Metadata pasted to ${paths.length} photo(s)`);
          } catch (err) {
            toast.error(`Paste metadata failed: ${err}`);
          }
        },
      },

      go_to_folder: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          const lib = useLibraryStore.getState();
          const ed = useEditorStore.getState();
          const path =
            ed.selectedImage?.path ||
            lib.libraryActivePath ||
            (lib.multiSelectedPaths || [])[0];
          if (!path) return;
          const physical = String(path).split('?vc=')[0];
          const sep = physical.includes('/') ? '/' : '\\';
          const last = physical.lastIndexOf(sep);
          if (last <= 0) return;
          const folder = physical.substring(0, last);
          lib.setLibrary({
            showPreviousImportOnly: false,
            showQuickCollectionOnly: false,
            showSelectedOnly: false,
            activeAlbumId: null,
          });
          // Dispatch so App/navigation can select folder with expand parents
          try {
            window.dispatchEvent(
              new CustomEvent('rustroom:go-to-folder', { detail: { folder, path } }),
            );
          } catch {
            lib.setLibrary({ currentFolderPath: folder });
          }
        },
      },


      toggle_adjustments: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Adjustments);
        },
      },
      toggle_crop_panel: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Crop);
        },
      },
      toggle_masks: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Masks);
        },
      },
      toggle_ai: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Ai);
        },
      },
      toggle_presets: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          // Presets moved to the Develop left panel; the shortcut opens the Preset Browser modal
          s.ui.setUI({ isPresetBrowserOpen: !s.ui.isPresetBrowserOpen });
        },
      },
      cycle_develop_info: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const cur = s.editor.developInfoMode || 'off';
          const order = ['off', 'basic', 'full'] as const;
          const idx = order.indexOf(cur);
          const next = order[(idx < 0 ? 0 : idx + 1) % order.length];
          s.editor.setEditor({ developInfoMode: next });
        },
      },

      toggle_grid_filenames: {
        shouldFire: () => true,
        execute: async (e: any, s: any) => {
          e.preventDefault();
          const settings = s.settings.appSettings;
          if (!settings) return;
          const next = settings.showGridFilenames === false;
          await s.settings.handleSettingsChange({ ...settings, showGridFilenames: next });
          toast.info(next ? 'Grid filenames: on' : 'Grid filenames: off');
        },
      },
      toggle_metadata: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Metadata);
        },
      },
      toggle_analytics: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.editor.setEditor({ isWaveformVisible: !s.editor.isWaveformVisible });
        },
      },
      export_previous: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          // Open export panel; flag so ExportPanel runs after mount (event alone can race)
          try {
            sessionStorage.setItem('rustroom.export.previous', '1');
          } catch {
            /* ignore */
          }
          useUIStore.getState().setUI({ isExportModalOpen: true, isLibraryExportPanelVisible: false });
          window.setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent('rustroom:export-previous'));
            } catch {
              /* ignore */
            }
          }, 120);
        },
      },
      toggle_export: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setUI({ isExportModalOpen: true });
        },
      },
      toggle_library_exif: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const current = s.settings.appSettings?.exifOverlay || ExifOverlay.Off;
          const nextState = {
            [ExifOverlay.Off]: ExifOverlay.Hover,
            [ExifOverlay.Hover]: ExifOverlay.Always,
            [ExifOverlay.Always]: ExifOverlay.Off,
          }[current as ExifOverlay];
          s.settings.handleSettingsChange({ ...s.settings.appSettings, exifOverlay: nextState });
        },
      },
      open_settings: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.setUI({ isSettingsOpen: true });
        },
      },
      focus_search: {
        shouldFire: (s: any) => !s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          s.ui.requestSearchFocus();
        },
      },
      toggle_crop: {
        shouldFire: (s: any) => !!s.editor.selectedImage,
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (s.ui.activeRightPanel === Panel.Crop) {
            s.editor.setEditor({ isStraightenActive: !s.editor.isStraightenActive });
          } else {
            s.ui.setRightPanel(Panel.Crop);
            s.editor.setEditor({ isStraightenActive: true });
          }
        },
      },
      rate_0: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleRate(0);
        },
      },
      rate_1: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleRate(1);
          advanceCullSelection(s);
        },
      },
      rate_2: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleRate(2);
          advanceCullSelection(s);
        },
      },
      rate_3: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleRate(3);
          advanceCullSelection(s);
        },
      },
      rate_4: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleRate(4);
          advanceCullSelection(s);
        },
      },
      rate_5: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleRate(5);
          advanceCullSelection(s);
        },
      },

      cycle_flag: {
        shouldFire: (s: any) =>
          !!(
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0])
          ),
        execute: (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          if (!paths.length) return;
          // Cycle based on primary: none → pick → reject → none
          const list = s.library.imageList || [];
          const primary = list.find((img: ImageFile) => img.path === paths[0]);
          const cur =
            (primary?.tags || []).find((tg: string) => tg.startsWith('flag:'))?.substring(5) || null;
          const next =
            cur === null || cur === undefined
              ? 'pick'
              : cur === 'pick'
                ? 'reject'
                : null;
          handleSetFlag(next);
        },
      },
      flag_pick: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage?.path || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (isLibraryCheckMode(s)) return setActiveChecked(s, true);
          handleSetFlag('pick');
          advanceCullSelection(s);
        },
      },
      flag_reject: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage?.path || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: (e: any, s: any) => {
          e.preventDefault();
          if (isLibraryCheckMode(s)) return setActiveChecked(s, false);
          handleSetFlag('reject');
          advanceCullSelection(s);
        },
      },
      flag_unflag: {
        shouldFire: (s: any) =>
          !!(s.editor.selectedImage?.path || s.library.libraryActivePath || s.library.multiSelectedPaths?.[0]),
        execute: (e: any) => {
          e.preventDefault();
          handleSetFlag(null);
        },
      },
      color_label_none: {
        shouldFire: () => true,
        execute: (e: any) => {
          e.preventDefault();
          handleSetColorLabel(null);
        },
      },

      cycle_color_label: {
        shouldFire: (s: any) =>
          !!(
            s.editor.selectedImage?.path ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0])
          ),
        execute: (e: any, s: any) => {
          e.preventDefault();
          const paths =
            s.library.multiSelectedPaths?.length > 0
              ? s.library.multiSelectedPaths
              : s.editor.selectedImage?.path
                ? [s.editor.selectedImage.path]
                : s.library.libraryActivePath
                  ? [s.library.libraryActivePath]
                  : [];
          if (!paths.length) return;
          const list = s.library.imageList || [];
          const primary = list.find((img: ImageFile) => img.path === paths[0]);
          const cur =
            (primary?.tags || [])
              .find((tg: string) => tg.startsWith('color:'))
              ?.substring(6)
              ?.toLowerCase() || null;
          const order = COLOR_LABELS.map((c: any) => c.name);
          let next: string | null = order[0];
          if (cur) {
            const idx = order.indexOf(cur);
            if (idx < 0 || idx >= order.length - 1) next = null;
            else next = order[idx + 1];
          }
          handleSetColorLabel(next);
        },
      },
      color_label_red: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetColorLabel('red');
          advanceCullSelection(s);
        },
      },
      color_label_yellow: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetColorLabel('yellow');
          advanceCullSelection(s);
        },
      },
      color_label_green: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetColorLabel('green');
          advanceCullSelection(s);
        },
      },
      color_label_blue: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetColorLabel('blue');
          advanceCullSelection(s);
        },
      },
      color_label_purple: {
        shouldFire: () => true,
        execute: (e: any, s: any) => {
          e.preventDefault();
          handleSetColorLabel('purple');
          advanceCullSelection(s);
        },
      },
      brush_size_up: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const newSize = Math.min((s.editor.brushSettings.size || 50) + 10, 200);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, size: newSize } });
        },
      },
      brush_size_down: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const newSize = Math.max((s.editor.brushSettings.size || 50) - 10, 1);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, size: newSize } });
        },
      },
      brush_feather_up: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const feather = Math.min((s.editor.brushSettings.feather ?? 50) + 5, 100);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, feather } });
        },
      },
      brush_feather_down: {
        shouldFire: (s: any) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e: any, s: any) => {
          e.preventDefault();
          const feather = Math.max((s.editor.brushSettings.feather ?? 50) - 5, 0);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, feather } });
        },
      },
    };

    const builtinShortcuts = [
      {
        match: (e: KeyboardEvent) => e.code === 'Escape',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          if ((s.ui.lightsOut ?? 0) > 0) {
            const vis = s.ui.uiVisibility || {};
            s.ui.setUI({
              lightsOut: 0,
              uiVisibility: {
                ...vis,
                folderTree: true,
                developLeft: true,
                libraryRight: true,
                filmstrip: true,
              },
              activeRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
              renderedRightPanel: s.ui.renderedRightPanel || Panel.Adjustments,
            });
            return;
          }
          if (s.editor.softProofing) {
            s.editor.setEditor({ softProofing: false });
            return;
          }
          if (s.editor.isWbPickerActive || s.editor.isPointColorPickerActive) {
            s.editor.setEditor({ isWbPickerActive: false, isPointColorPickerActive: false });
            return;
          }
          // LR Keyword Painter: Esc exits paint mode
          if (s.library?.libraryPainter || s.library?.keywordPaintTag) {
            s.library.setLibrary({ libraryPainter: null, keywordPaintTag: null });
            return;
          }
          if (s.editor.isStraightenActive) s.editor.setEditor({ isStraightenActive: false });
          else if (s.editor.isGuidedUprightActive) s.editor.setEditor({ isGuidedUprightActive: false });
          else if (s.ui.customEscapeHandler) s.ui.customEscapeHandler();
          else if (s.editor.activeAiSubMaskId) s.editor.setEditor({ activeAiSubMaskId: null });
          else if (s.editor.activeAiPatchContainerId) s.editor.setEditor({ activeAiPatchContainerId: null });
          else if (s.editor.activeMaskId) s.editor.setEditor({ activeMaskId: null });
          else if (s.editor.activeMaskContainerId) s.editor.setEditor({ activeMaskContainerId: null });
          else if (s.ui.activeRightPanel === Panel.Crop) s.ui.setRightPanel(Panel.Adjustments);
          else if (s.ui.isFullScreen) handleToggleFullScreen();
          else if (s.editor.selectedImage) handleBackToLibrary();
          else if (
            // LR Library: Esc clears multi-selection / selected-only filter
            !s.editor.selectedImage &&
            ((s.library.multiSelectedPaths && s.library.multiSelectedPaths.length > 0) ||
              s.library.showSelectedOnly ||
              s.library.showPreviousImportOnly ||
              s.library.showQuickCollectionOnly)
          ) {
            s.library.setLibrary({
              multiSelectedPaths: [],
              libraryActivePath: s.library.libraryActivePath,
              selectionAnchorPath: null,
              showSelectedOnly: false,
              showPreviousImportOnly: false,
              showQuickCollectionOnly: false,
            });
          }
        },
      },
      {
        match: (e: KeyboardEvent, s: any) => {
          const isDeleteKey = s.settings.osPlatform === 'macos' ? e.code === 'Backspace' : e.code === 'Delete';
          return isDeleteKey && (!!s.editor.activeMaskContainerId || !!s.editor.activeAiPatchContainerId);
        },
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          if (s.editor.activeMaskContainerId) {
            s.editor.setEditor((state: any) => ({
              adjustments: {
                ...state.adjustments,
                masks: state.adjustments.masks.filter((c: any) => c.id !== s.editor.activeMaskContainerId),
              },
              activeMaskContainerId: null,
              activeMaskId: null,
            }));
          } else if (s.editor.activeAiPatchContainerId) {
            s.editor.setEditor((state: any) => ({
              adjustments: {
                ...state.adjustments,
                aiPatches: state.adjustments.aiPatches.filter((c: any) => c.id !== s.editor.activeAiPatchContainerId),
              },
              activeAiPatchContainerId: null,
              activeAiSubMaskId: null,
            }));
          }
        },
      },
      // LR Masks: O toggles mask overlay preview (steals show-original O while Masks is open)
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyO',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const cur = s.editor.showMaskOverlay !== false;
          s.editor.setEditor({ showMaskOverlay: !cur });
        },
      },
      // LR Masks: Ctrl/Cmd+Alt+D duplicate active mask container
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          !!s.editor.activeMaskContainerId &&
          (e.ctrlKey || e.metaKey) &&
          e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyD',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:duplicate-mask'));
          } catch {
            /* ignore */
          }
        },
      },
      // LR Masks: Ctrl/Cmd+Alt+C copy active mask container
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          !!s.editor.activeMaskContainerId &&
          (e.ctrlKey || e.metaKey) &&
          e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyC',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:copy-mask'));
          } catch {
            /* ignore */
          }
        },
      },
      // LR Masks: Ctrl/Cmd+Alt+V paste mask container
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          (e.ctrlKey || e.metaKey) &&
          e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyV',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          try {
            window.dispatchEvent(new CustomEvent('rustroom:paste-mask'));
          } catch {
            /* ignore */
          }
        },
      },
      // LR Masks: H toggles active mask visibility (steals flip H while Masks is open)
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          !!s.editor.activeMaskContainerId &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyH',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const id = s.editor.activeMaskContainerId;
          const prev = s.editor.adjustments || {};
          if (!id || !Array.isArray(prev.masks)) return;
          const nextMasks = prev.masks.map((m: any) =>
            m.id === id ? { ...m, visible: m.visible === false ? true : false } : m,
          );
          s.editor.setEditor({ adjustments: { ...prev, masks: nextMasks } });
        },
      },
      // LR Masks: Shift+[ / ] cycle active mask container
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          Array.isArray(s.editor.adjustments?.masks) &&
          s.editor.adjustments.masks.length > 0 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          e.shiftKey &&
          (e.code === 'BracketLeft' || e.code === 'BracketRight'),
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const masks = s.editor.adjustments.masks as any[];
          const curId = s.editor.activeMaskContainerId;
          let idx = masks.findIndex((m) => m.id === curId);
          if (idx < 0) idx = 0;
          const nextIdx =
            e.code === 'BracketRight'
              ? (idx + 1) % masks.length
              : (idx - 1 + masks.length) % masks.length;
          const next = masks[nextIdx];
          if (!next) return;
          s.editor.setEditor({
            activeMaskContainerId: next.id,
            activeMaskId: next.subMasks?.[0]?.id ?? null,
          });
        },
      },
      // LR Masks: E toggles Brush ↔ Eraser (steals KeyE export while Masks is open)
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          !!s.editor.brushSettings &&
          s.ui.activeRightPanel === Panel.Masks &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyE',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const cur = s.editor.brushSettings.tool;
          const next = cur === ToolType.Eraser ? ToolType.Brush : ToolType.Eraser;
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, tool: next } });
        },
      },
      // LR Masks: I inverts the active mask container
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          s.ui.activeRightPanel === Panel.Masks &&
          !!s.editor.activeMaskContainerId &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          e.code === 'KeyI',
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const id = s.editor.activeMaskContainerId;
          const masks = s.editor.adjustments?.masks;
          if (!id || !Array.isArray(masks)) return;
          const prev = s.editor.adjustments || {};
          const nextMasks = (prev.masks || []).map((m: any) =>
            m.id === id ? { ...m, invert: !m.invert } : m,
          );
          s.editor.setEditor({ adjustments: { ...prev, masks: nextMasks } });
        },
      },
      // LR Masks: [ / ] resize brush (takes priority over rotate while Masks panel is open)
      {
        match: (e: KeyboardEvent, s: any) =>
          !!s.editor.selectedImage &&
          !!s.editor.brushSettings &&
          s.ui.activeRightPanel === Panel.Masks &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey &&
          (e.code === 'BracketLeft' || e.code === 'BracketRight'),
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const cur = s.editor.brushSettings.size || 50;
          const next =
            e.code === 'BracketRight' ? Math.min(cur + 10, 200) : Math.max(cur - 10, 1);
          s.editor.setEditor({ brushSettings: { ...s.editor.brushSettings, size: next } });
        },
      },
      {
        match: (e: KeyboardEvent, s: any) =>
          !s.editor.selectedImage &&
          !e.altKey &&
          !e.metaKey &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code),
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const list = sortedListRef.current;
          if (!list.length) return;
          const isNext = e.code === 'ArrowRight' || e.code === 'ArrowDown';
          // Ctrl/Cmd+Arrow: jump by page (~10 photos) without wrapping
          const step = e.ctrlKey ? 10 : 1;
          const activePath =
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[s.library.multiSelectedPaths.length - 1]);
          let currentIndex = activePath
            ? list.findIndex((img: ImageFile) => img.path === activePath)
            : -1;
          if (currentIndex === -1) currentIndex = isNext ? -1 : 0;
          let nextIndex = isNext ? currentIndex + step : currentIndex - step;
          if (e.ctrlKey) {
            nextIndex = Math.max(0, Math.min(list.length - 1, nextIndex));
          } else {
            if (nextIndex >= list.length) nextIndex = 0;
            if (nextIndex < 0) nextIndex = list.length - 1;
          }
          const nextImage = list[nextIndex];
          if (!nextImage) return;

          // Shift+Arrow: extend selection from anchor (LR grid/filmstrip range select)
          if (e.shiftKey) {
            const anchor =
              s.library.selectionAnchorPath ||
              s.library.libraryActivePath ||
              activePath;
            let anchorIndex = anchor
              ? list.findIndex((img: ImageFile) => img.path === anchor)
              : currentIndex;
            if (anchorIndex < 0) anchorIndex = currentIndex;
            const start = Math.min(anchorIndex, nextIndex);
            const end = Math.max(anchorIndex, nextIndex);
            const range = list.slice(start, end + 1).map((img: ImageFile) => img.path);
            s.library.setLibrary({
              multiSelectedPaths: range,
              libraryActivePath: nextImage.path,
              // keep original anchor so further Shift+Arrow extends from start
              selectionAnchorPath: list[anchorIndex]?.path || nextImage.path,
            });
            return;
          }

          // Arrows move the active photo only; checked (selected) photos stay checked.
          s.library.setLibrary({
            libraryActivePath: nextImage.path,
            selectionAnchorPath: nextImage.path,
          });
        },
      },
      {
        match: (e: KeyboardEvent, s: any) =>
          !s.editor.selectedImage &&
          e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          (e.code === 'Home' || e.code === 'End'),
        execute: (e: KeyboardEvent, s: any) => {
          e.preventDefault();
          const list = sortedListRef.current;
          if (!list.length) return;
          const targetIndex = e.code === 'Home' ? 0 : list.length - 1;
          const target = list[targetIndex];
          const anchor =
            s.library.selectionAnchorPath ||
            s.library.libraryActivePath ||
            (s.library.multiSelectedPaths && s.library.multiSelectedPaths[0]);
          let anchorIndex = anchor
            ? list.findIndex((img: ImageFile) => img.path === anchor)
            : targetIndex;
          if (anchorIndex < 0) anchorIndex = targetIndex;
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const range = list.slice(start, end + 1).map((img: ImageFile) => img.path);
          s.library.setLibrary({
            multiSelectedPaths: range,
            libraryActivePath: target.path,
            selectionAnchorPath: list[anchorIndex]?.path || target.path,
          });
        },
      },

    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      const state = getStoreState();

      const isModalOpen =
        state.ui.isCreateFolderModalOpen ||
        state.ui.isRenameFolderModalOpen ||
        state.ui.isRenameFileModalOpen ||
        state.ui.isImportModalOpen ||
        state.ui.isCopyPasteSettingsModalOpen ||
        state.ui.confirmModalState.isOpen ||
        state.ui.panoramaModalState.isOpen ||
        state.ui.cullingModalState.isOpen ||
        state.ui.collageModalState.isOpen ||
        state.ui.denoiseModalState.isOpen ||
        state.ui.negativeModalState.isOpen;

      if (isModalOpen) return;

      if (state.ui.isSettingsOpen) {
        if (event.code === 'Escape') {
          event.preventDefault();
          state.ui.setUI({ isSettingsOpen: false });
        }
        return;
      }

      const isInputFocused =
        document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      if (isInputFocused) return;

      for (const builtin of builtinShortcuts) {
        if (builtin.match(event, state)) {
          builtin.execute(event, state);
          return;
        }
      }

      const normalized = normalizeCombo(event, state.settings.osPlatform);
      const action = comboMap.get(normalized.join('+'));

      if (action) {
        const handler = actions[action];
        if (handler && (!handler.shouldFire || handler.shouldFire(state))) {
          handler.execute(event, state);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    handleBackToLibrary,
    handleDeleteSelected,
    handleImageSelect,
    handlePasteFiles,
    handleToggleFullScreen,
    handleZoomChange,
    handleRotate,
    handleAutoAdjustments,
    handleResetAdjustments,
    setAdjustments,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleMatchPrevious,
    handleSyncSettings,
    handleRate,
    handleSetColorLabel,
    handleSetFlag,
    t,
  ]);
};
