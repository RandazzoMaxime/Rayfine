import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Aperture,
  Check,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Edit,
  FileEdit,
  FileInput,
  FileOutput,
  Folder,
  FolderInput,
  FolderPlus,
  Images,
  LayoutTemplate,
  Redo,
  RefreshCw,
  RotateCcw,
  Star,
  SquaresUnite,
  Palette,
  Tag,
  Trash2,
  Undo,
  X,
  Pin,
  PinOff,
  Users,
  Gauge,
  Grip,
  Film,
  Home,
  Plane,
  Mountain,
  Sun,
  Camera,
  Map,
  Heart,
  Car,
  Briefcase,
  User,
  Album as AlbumIcon,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useContextMenu } from '../context/ContextMenuContext';
import { useEditorStore } from '../store/useEditorStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useProcessStore } from '../store/useProcessStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { Invokes, Option, OPTION_SEPARATOR, Panel, AlbumItem, Album, AlbumGroup } from '../components/ui/AppProperties';
import { Color, COLOR_LABELS, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../utils/adjustments';
import TaggingSubMenu from '../context/TaggingSubMenu';
import { useEditorActions } from './useEditorActions';
import { useLibraryActions } from './useLibraryActions';
import { globalImageCache } from '../utils/ImageLRUCache';
import { reimportDevelopFromXmpPath, reimportDevelopFromXmpPaths, exportDevelopToXmpPath, exportDevelopToXmpPaths } from '../utils/reimportXmp';
import { findVirtualCopyStack, newStackId, stackTag, stackIdFromTags, STACK_TAG_PREFIX, findManualStack, captureTimeKey, groupPathsByCaptureTime, effectiveGroupId } from '../utils/imageGrouping';


export interface UseAppContextMenusProps {
  handleImageSelect: (path: string) => void;
  handleBackToLibrary: () => void;
  handleRenameFiles: (paths: string[]) => void;
  handleImportClick: (path: string) => void;
  handleLibraryRefresh: () => Promise<void>;
  refreshAllFolderTrees: () => Promise<void>;
  refreshImageList: () => Promise<void>;
  executeDelete: (paths: string[], options: any) => Promise<void>;
  handleTogglePinFolder: (path: string) => Promise<void>;
  /** Navigate Library folder tree to a path (expand parents). */
  handleSelectSubfolder?: (
    path: string | null,
    isNewRoot?: boolean,
    preloadedImages?: any[],
    expandParents?: boolean,
    preserveEditor?: boolean,
  ) => Promise<void> | void;
}

export function useAppContextMenus(props: UseAppContextMenusProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();

  const { handleAutoAdjustments, handleResetAdjustments, handleCopyAdjustments, handlePasteAdjustments } =
    useEditorActions();
  const { handleRate, handleSetColorLabel, handleTagsChanged } = useLibraryActions();

  const albumIcons = useMemo(
    () => [
      { label: t('contextMenus.albumIcons.default'), value: undefined, icon: Folder },
      { label: t('contextMenus.albumIcons.travel'), value: 'plane', icon: Plane },
      { label: t('contextMenus.albumIcons.nature'), value: 'mountain', icon: Mountain },
      { label: t('contextMenus.albumIcons.summer'), value: 'sun', icon: Sun },
      { label: t('contextMenus.albumIcons.photography'), value: 'camera', icon: Camera },
      { label: t('contextMenus.albumIcons.locations'), value: 'map', icon: Map },
      { label: t('contextMenus.albumIcons.favorites'), value: 'heart', icon: Heart },
      { label: t('contextMenus.albumIcons.featured'), value: 'star', icon: Star },
      { label: t('contextMenus.albumIcons.people'), value: 'users', icon: Users },
      { label: t('contextMenus.albumIcons.person'), value: 'user', icon: User },
      { label: t('contextMenus.albumIcons.automotive'), value: 'car', icon: Car },
      { label: t('contextMenus.albumIcons.portfolio'), value: 'briefcase', icon: Briefcase },
    ],
    [t],
  );

  const getCommonTags = useCallback((paths: string[]): { tag: string; isUser: boolean }[] => {
    const { imageList } = useLibraryStore.getState();
    if (paths.length === 0) return [];
    const imageFiles = imageList.filter((img) => paths.includes(img.path));
    if (imageFiles.length === 0) return [];

    const allTagsSets = imageFiles.map((img) => {
      const tagsWithPrefix = (img.tags || []).filter((t: string) => !t.startsWith('color:'));
      return new Set(tagsWithPrefix);
    });

    if (allTagsSets.length === 0) return [];

    const commonTagsWithPrefix = allTagsSets.reduce((intersection, currentSet) => {
      return new Set([...intersection].filter((tag) => currentSet.has(tag)));
    });

    return Array.from(commonTagsWithPrefix)
      .map((tag: string) => ({
        tag: tag.startsWith('user:') ? tag.substring(5) : tag,
        isUser: tag.startsWith('user:'),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, []);

  const buildAddToAlbumMenu = useCallback(
    (items: AlbumItem[], pathsToAdd: string[]): Option[] => {
      return items.map((item) => {
        const customIconDef = item.icon ? albumIcons.find((i) => i.value === item.icon) : null;
        const ResolvedIcon = customIconDef?.icon || (item.type === 'group' ? Folder : AlbumIcon);

        if (item.type === 'group') {
          return {
            label: item.name,
            icon: ResolvedIcon,
            submenu:
              (item as AlbumGroup).children.length > 0
                ? buildAddToAlbumMenu((item as AlbumGroup).children, pathsToAdd)
                : [{ label: t('contextMenus.album.emptyGroup'), disabled: true }],
          };
        } else {
          return {
            label: item.name,
            icon: ResolvedIcon,
            onClick: () => {
              invoke(Invokes.AddToAlbum, { albumId: item.id, paths: pathsToAdd })
                .then(() => {
                  console.log(`Added image(s) to ${item.name}`);
                  invoke(Invokes.GetAlbums).then((res: any) =>
                    useLibraryStore.getState().setLibrary({ albumTree: res }),
                  );
                })
                .catch((err) => toast.error(t('contextMenus.toasts.failedAddToAlbum', { err })));
            },
          };
        }
      });
    },
    [albumIcons, t],
  );

  const handleEditorContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      event.stopPropagation();

      const { selectedImage, history, historyIndex, undo, redo, resetHistory, copiedAdjustments, setEditor } =
        useEditorStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setRightPanel, setUI } = useUIStore.getState();

      if (!selectedImage) return;

      const canUndo = historyIndex > 0;
      const canRedo = historyIndex < history.length - 1;
      const commonTags = getCommonTags([selectedImage.path]);

      const options: Array<Option> = [
        {
          label: t('contextMenus.editor.exportImage'),
          icon: FileInput,
          onClick: () => setRightPanel(Panel.Export),
        },
        { type: OPTION_SEPARATOR },
        { label: t('contextMenus.editor.undo'), icon: Undo, onClick: undo, disabled: !canUndo },
        { label: t('contextMenus.editor.redo'), icon: Redo, onClick: redo, disabled: !canRedo },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.copyAdjustments'),
          icon: Copy,
          onClick: () => handleCopyAdjustments(),
        },
        {
          label: t('contextMenus.editor.pasteAdjustments'),
          icon: ClipboardPaste,
          onClick: () => handlePasteAdjustments(),
          disabled: copiedAdjustments === null,
        },
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            {
              label: t('contextMenus.editor.autoAdjust'),
              icon: Aperture,
              onClick: handleAutoAdjustments,
              disabled: !selectedImage?.isReady,
            },
            {
              label: t('contextMenus.editor.denoise'),
              icon: Grip,
              onClick: () => {
                setUI({
                  denoiseModalState: {
                    isOpen: true,
                    isProcessing: false,
                    previewBase64: null,
                    error: null,
                    targetPaths: [selectedImage.path],
                    progressMessage: null,
                    isRaw: selectedImage?.isRaw || false,
                  },
                });
              },
            },
            {
              label: t('contextMenus.editor.convertNegative'),
              icon: Film,
              onClick: () => {
                if (selectedImage) {
                  setUI({ negativeModalState: { isOpen: true, targetPaths: [selectedImage.path] } });
                }
              },
            },
            { disabled: true, icon: SquaresUnite, label: t('contextMenus.editor.stitchPanorama') },
            { disabled: true, icon: Images, label: t('contextMenus.editor.mergeHdr') },
            {
              icon: LayoutTemplate,
              label: t('contextMenus.editor.frameImage'),
              onClick: () => {
                setUI({ collageModalState: { isOpen: true, sourceImages: [selectedImage] } });
              },
            },
            { label: t('contextMenus.editor.cullImage'), icon: Users, disabled: true },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.rating'),
          icon: Star,
          submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
            label:
              rating === 0
                ? t('contextMenus.editor.noRating')
                : t('contextMenus.editor.ratingLabel', { count: rating }),
            onClick: () => handleRate(rating),
          })),
        },
        {
          label: t('contextMenus.editor.colorLabel'),
          icon: Palette,
          submenu: [
            { label: t('contextMenus.editor.noLabel'), onClick: () => handleSetColorLabel(null) },
            ...COLOR_LABELS.map((label: Color) => ({
              label: t(`contextMenus.colors.${label.name}`),
              color: label.color,
              onClick: () => handleSetColorLabel(label.name),
            })),
          ],
        },
        {
          label: t('contextMenus.editor.tagging'),
          icon: Tag,
          submenu: [
            {
              customComponent: TaggingSubMenu,
              customProps: {
                paths: [selectedImage.path],
                initialTags: commonTags,
                onTagsChanged: handleTagsChanged,
                appSettings,
              },
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.editor.reimportXmp'),
          icon: FileInput,
          onClick: async () => {
            if (!selectedImage?.path) return;
            try {
              await reimportDevelopFromXmpPath(selectedImage.path);
              toast.success(t('contextMenus.toasts.reimportedXmp'));
            } catch (err) {
              toast.error(String(err));
            }
          },
        },
        {
          label: t('contextMenus.editor.exportDevelopXmp'),
          icon: FileOutput,
          onClick: async () => {
            if (!selectedImage?.path) return;
            try {
              await exportDevelopToXmpPath(selectedImage.path);
              toast.success(t('contextMenus.toasts.exportedDevelopXmp'));
            } catch (err) {
              toast.error(String(err));
            }
          },
        },
        {
          label: t('contextMenus.editor.showXmp'),
          icon: Folder,
          onClick: () => {
            if (!selectedImage?.path) return;
            invoke(Invokes.ShowXmpSidecar, { path: selectedImage.path }).catch(() =>
              toast.error(t('contextMenus.toasts.xmpNotFound')),
            );
          },
        },
        {
          label: t('contextMenus.editor.resetAdjustments'),
          icon: RotateCcw,
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('contextMenus.editor.confirmReset'),
              icon: Check,
              isDestructive: true,
              onClick: () => {
                const originalAspectRatio =
                  selectedImage.width && selectedImage.height ? selectedImage.width / selectedImage.height : null;
                resetHistory({
                  ...INITIAL_ADJUSTMENTS,
                  aspectRatio: originalAspectRatio,
                  aiPatches: [],
                });
                setEditor({ adjustments: { ...INITIAL_ADJUSTMENTS, aspectRatio: originalAspectRatio, aiPatches: [] } });
              },
            },
          ],
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      getCommonTags,
      handleCopyAdjustments,
      handlePasteAdjustments,
      handleAutoAdjustments,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      showContextMenu,
      t,
    ],
  );

  const handleThumbnailContextMenu = useCallback(
    (event: any, path: string, forceSingleSelection: boolean = false) => {
      event.preventDefault();
      event.stopPropagation();

      const { selectedImage, copiedAdjustments, setEditor } = useEditorStore.getState();
      const { multiSelectedPaths, imageList, libraryActivePath, albumTree, activeAlbumId, setLibrary } =
        useLibraryStore.getState();
      const { appSettings } = useSettingsStore.getState();
      const { setUI, setRightPanel } = useUIStore.getState();
      const { setProcess } = useProcessStore.getState();

      const isTargetInSelection = multiSelectedPaths.includes(path);
      let finalSelection: string[];

      if (forceSingleSelection) {
        finalSelection = [path];
      } else if (!isTargetInSelection) {
        finalSelection = [path];
        setLibrary({ multiSelectedPaths: [path] });
        if (!selectedImage) {
          setLibrary({ libraryActivePath: path });
        }
      } else {
        finalSelection = multiSelectedPaths;
      }

      const commonTags = getCommonTags(finalSelection);

      const selectionCount = finalSelection.length;
      const isSingleSelection = selectionCount === 1;
      const isEditingThisImage = selectedImage?.path === path;
      const deleteLabel = t('contextMenus.thumbnail.deleteImage', { count: selectionCount });
      const exportLabel = t('contextMenus.thumbnail.exportImage', { count: selectionCount });

      const isSingleVirtualCopy =
        isSingleSelection &&
        (finalSelection[0].includes('?vc=') ||
          !!imageList.find((img) => img.path === finalSelection[0])?.is_virtual_copy);

      const masterHasVirtualCopies =
        isSingleSelection &&
        !finalSelection[0].includes('?vc=') &&
        imageList.some((image) => image.path.startsWith(`${finalSelection[0]}?vc=`));

      const hasAssociatedFiles = finalSelection.some((selectedPath) => {
        const image = imageList.find((img) => img.path === selectedPath);
        if (image?.group_id != null) return true;

        const getBasePath = (p: string) => {
          const qMark = p.indexOf('?');
          const clean = qMark === -1 ? p : p.substring(0, qMark);
          const dot = clean.lastIndexOf('.');
          return dot === -1 ? clean : clean.substring(0, dot);
        };
        const basePath = getBasePath(selectedPath);

        return imageList.some((img) => img.path !== selectedPath && getBasePath(img.path) === basePath);
      });

      let deleteSubmenu;
      if (isSingleVirtualCopy) {
        // VC only — never delete the master
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.confirmDeleteVc' as any, {
              defaultValue: 'Delete virtual copy only',
            }),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
        ];
      } else if (masterHasVirtualCopies) {
        // Master with VCs — delete all (master + copies) or master only still removes file
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.confirmDeleteMasterAndVcs' as any, {
              defaultValue: 'Delete image and all virtual copies',
            }),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
        ];
      } else if (hasAssociatedFiles) {
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.deleteSelected'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
          {
            label: t('contextMenus.thumbnail.deleteAssociated'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: true }),
          },
        ];
      } else {
        deleteSubmenu = [
          { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
          {
            label: t('contextMenus.thumbnail.confirmDelete'),
            icon: Check,
            isDestructive: true,
            onClick: () => props.executeDelete(finalSelection, { includeAssociated: false }),
          },
        ];
      }

      const pasteLabel = t('contextMenus.thumbnail.pasteAdjustments', { count: selectionCount });
      const resetLabel = t('contextMenus.thumbnail.resetAdjustments', { count: selectionCount });
      const copyLabel = t('contextMenus.thumbnail.copyImage', { count: selectionCount });
      const autoAdjustLabel = t('contextMenus.thumbnail.autoAdjust', { count: selectionCount });
      const renameLabel = t('contextMenus.thumbnail.renameImage', { count: selectionCount });
      const cullLabel = t('contextMenus.thumbnail.cullImage', { count: selectionCount });
      const collageLabel = t('contextMenus.thumbnail.collage', { count: selectionCount });
      const stitchLabel = t('contextMenus.editor.stitchPanorama');
      const conversionLabel = t('contextMenus.thumbnail.convertNegative', { count: selectionCount });
      const denoiseLabel = t('contextMenus.thumbnail.denoise', { count: selectionCount });
      const mergeLabel = t('contextMenus.editor.mergeHdr');

      const handleCreateVirtualCopy = async (sourcePaths: string | string[]) => {
        const paths = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
        if (!paths.length) return;
        try {
          for (const sourcePath of paths) {
            await invoke(Invokes.CreateVirtualCopy, {
              sourceVirtualPath: sourcePath,
              targetAlbumId: activeAlbumId || null,
            });
          }
          if (activeAlbumId) {
            const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
            setLibrary({ albumTree: sortedTree });
          }
          await props.refreshImageList();
          if (paths.length > 1) {
            toast.success(
              t('contextMenus.toasts.virtualCopiesCreated' as any, {
                defaultValue: '{{count}} virtual copies created',
                count: paths.length,
              }),
            );
          }
        } catch (err) {
          toast.error(t('contextMenus.toasts.failedCreateVirtualCopy', { err }));
        }
      };

      const handleApplyAutoAdjustmentsToSelection = () => {
        if (finalSelection.length === 0) return;
        finalSelection.forEach((p) => globalImageCache.delete(p));

        invoke(Invokes.ApplyAutoAdjustmentsToPaths, { paths: finalSelection })
          .then(async () => {
            if (selectedImage && finalSelection.includes(selectedImage.path)) {
              const metadata: any = await invoke(Invokes.LoadMetadata, { path: selectedImage.path });
              if (metadata.adjustments && !metadata.adjustments.is_null) {
                const normalized = normalizeLoadedAdjustments(metadata.adjustments);
                setEditor({ adjustments: normalized });
                useEditorStore.getState().resetHistory(normalized);
              }
            }
            if (libraryActivePath && finalSelection.includes(libraryActivePath)) {
              const metadata: any = await invoke(Invokes.LoadMetadata, { path: libraryActivePath });
              if (metadata.adjustments && !metadata.adjustments.is_null) {
                const normalized = normalizeLoadedAdjustments(metadata.adjustments);
                setLibrary({ libraryActiveAdjustments: normalized });
              }
            }
          })
          .catch((err) => {
            console.error('Failed to apply auto adjustments to paths:', err);
            toast.error(t('contextMenus.toasts.failedApplyAuto', { err }));
          });
      };

      const onExportClick = () => {
        if (selectedImage) {
          if (selectedImage.path !== path) {
            props.handleImageSelect(path);
          }
          setLibrary({ multiSelectedPaths: finalSelection });
          setRightPanel(Panel.Export);
        } else {
          setLibrary({ multiSelectedPaths: finalSelection });
          setUI({ isLibraryExportPanelVisible: true });
        }
      };

      const handleRemoveFromAlbum = async () => {
        if (!activeAlbumId) return;
        const newTree = JSON.parse(JSON.stringify(albumTree));

        const removeImages = (nodes: AlbumItem[]): boolean => {
          for (const n of nodes) {
            if (n.id === activeAlbumId && n.type === 'album') {
              (n as Album).images = (n as Album).images.filter((p) => !finalSelection.includes(p));
              return true;
            } else if (n.type === 'group') {
              if (removeImages(n.children)) return true;
            }
          }
          return false;
        };

        if (removeImages(newTree)) {
          try {
            await invoke(Invokes.SaveAlbums, { tree: newTree });
            const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
            setLibrary({ albumTree: sortedTree });

            const albumObj = sortedTree.reduce((acc: any, cur: any) => {
              const find = (n: any): any =>
                n.id === activeAlbumId
                  ? n
                  : n.type === 'group'
                    ? n.children.reduce((a: any, c: any) => a || find(c), null)
                    : null;
              return acc || find(cur);
            }, null) as Album;

            if (albumObj) {
              setLibrary({ imageList: imageList.filter((i) => albumObj.images.includes(i.path)) });
            }
          } catch (e) {
            toast.error(t('contextMenus.toasts.failedRemoveImages', { err: e }));
          }
        }
      };

      const options = [
        ...(!isEditingThisImage
          ? [
              {
                disabled: !isSingleSelection,
                icon: Edit,
                label: t('contextMenus.editor.editImage'),
                onClick: () => props.handleImageSelect(finalSelection[0]),
              },
              { icon: FileInput, label: exportLabel, onClick: onExportClick },
              { type: OPTION_SEPARATOR },
            ]
          : [{ icon: FileInput, label: exportLabel, onClick: onExportClick }, { type: OPTION_SEPARATOR }]),
        {
          disabled: !isSingleSelection,
          icon: Copy,
          label: t('contextMenus.editor.copyAdjustments'),
          onClick: () => handleCopyAdjustments(finalSelection[0]),
        },
        {
          disabled: copiedAdjustments === null,
          icon: ClipboardPaste,
          label: pasteLabel,
          onClick: () => handlePasteAdjustments(finalSelection),
        },
        {
          label: t('contextMenus.editor.productivity'),
          icon: Gauge,
          submenu: [
            { label: autoAdjustLabel, icon: Aperture, onClick: handleApplyAutoAdjustmentsToSelection },
            {
              label: denoiseLabel,
              icon: Grip,
              disabled: finalSelection.length === 0,
              onClick: () => {
                setUI({
                  denoiseModalState: {
                    isOpen: true,
                    isProcessing: false,
                    previewBase64: null,
                    error: null,
                    targetPaths: finalSelection,
                    progressMessage: null,
                    isRaw: selectedImage?.isRaw || false,
                  },
                });
              },
            },
            {
              label: conversionLabel,
              icon: Film,
              disabled: selectionCount === 0,
              onClick: () => {
                setUI({ negativeModalState: { isOpen: true, targetPaths: finalSelection } });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 30,
              icon: SquaresUnite,
              label: stitchLabel,
              onClick: () => {
                setUI({
                  panoramaModalState: {
                    error: null,
                    finalImageBase64: null,
                    isOpen: true,
                    isProcessing: false,
                    progressMessage: null,
                    stitchingSourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              disabled: selectionCount < 2 || selectionCount > 9,
              icon: Images,
              label: mergeLabel,
              onClick: () => {
                setUI({
                  hdrModalState: {
                    error: null,
                    finalImageBase64: null,
                    isOpen: true,
                    isProcessing: false,
                    progressMessage: null,
                    stitchingSourcePaths: finalSelection,
                  },
                });
              },
            },
            {
              icon: LayoutTemplate,
              label: collageLabel,
              onClick: () => {
                const imagesForCollage = imageList.filter((img) => finalSelection.includes(img.path));
                setUI({ collageModalState: { isOpen: true, sourceImages: imagesForCollage } });
              },
              disabled: selectionCount === 0 || selectionCount > 9,
            },
            {
              label: cullLabel,
              icon: Users,
              onClick: () =>
                setUI({
                  cullingModalState: {
                    isOpen: true,
                    progress: null,
                    suggestions: null,
                    error: null,
                    pathsToCull: finalSelection,
                  },
                }),
              disabled: selectionCount < 2,
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: copyLabel,
          icon: Copy,
          onClick: () => {
            setProcess({ copiedFilePaths: finalSelection, isCopied: true });
          },
        },
        {
          icon: CopyPlus,
          label: t('contextMenus.thumbnail.duplicateImage'),
          disabled: !isSingleSelection,
          submenu: [
            {
              label: t('contextMenus.thumbnail.physicalCopy'),
              icon: Copy,
              onClick: async () => {
                try {
                  await invoke(Invokes.DuplicateFile, {
                    path: finalSelection[0],
                    targetAlbumId: activeAlbumId || null,
                  });
                  if (activeAlbumId) {
                    const sortedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
                    setLibrary({ albumTree: sortedTree });
                  }
                  await props.refreshImageList();
                } catch (err) {
                  console.error('Failed to duplicate file:', err);
                  toast.error(t('contextMenus.toasts.failedDuplicate', { err }));
                }
              },
            },
            {
              label: t('contextMenus.thumbnail.virtualCopy' as any, {
                defaultValue:
                  finalSelection.length > 1
                    ? `Create ${finalSelection.length} virtual copies`
                    : 'Create virtual copy',
              }),
              icon: CopyPlus,
              disabled: finalSelection.length === 0,
              onClick: () => handleCreateVirtualCopy(finalSelection),
            },
            {
              disabled: !isSingleSelection || findVirtualCopyStack(imageList, finalSelection[0]).length < 2,
              label: t('contextMenus.thumbnail.nextVirtualCopy' as any, {
                defaultValue: 'Next virtual copy',
              }),
              onClick: () => {
                const stack = findVirtualCopyStack(imageList, finalSelection[0]);
                if (stack.length < 2) return;
                const idx = stack.findIndex((img: any) => img.path === finalSelection[0]);
                const next = stack[(idx < 0 ? 0 : idx + 1) % stack.length];
                setLibrary({
                  multiSelectedPaths: [next.path],
                  libraryActivePath: next.path,
                  selectionAnchorPath: next.path,
                });
                // Develop: open path
                try {
                  window.dispatchEvent(
                    new CustomEvent('rustroom:open-image', { detail: { path: next.path } }),
                  );
                } catch {
                  /* ignore */
                }
              },
            },
            {
              disabled: !isSingleSelection || findVirtualCopyStack(imageList, finalSelection[0]).length < 2,
              label: t('contextMenus.thumbnail.prevVirtualCopy' as any, {
                defaultValue: 'Previous virtual copy',
              }),
              onClick: () => {
                const stack = findVirtualCopyStack(imageList, finalSelection[0]);
                if (stack.length < 2) return;
                const idx = stack.findIndex((img: any) => img.path === finalSelection[0]);
                const prev = stack[(idx < 0 ? 0 : idx - 1 + stack.length) % stack.length];
                setLibrary({
                  multiSelectedPaths: [prev.path],
                  libraryActivePath: prev.path,
                  selectionAnchorPath: prev.path,
                });
                try {
                  window.dispatchEvent(
                    new CustomEvent('rustroom:open-image', { detail: { path: prev.path } }),
                  );
                } catch {
                  /* ignore */
                }
              },
            },
          ],
        },
        { icon: FileEdit, label: renameLabel, onClick: () => props.handleRenameFiles(finalSelection) },
        { type: OPTION_SEPARATOR },
        {
          icon: Star,
          label: t('contextMenus.editor.rating'),
          submenu: [0, 1, 2, 3, 4, 5].map((rating: number) => ({
            label:
              rating === 0
                ? t('contextMenus.editor.noRating')
                : t('contextMenus.editor.ratingLabel', { count: rating }),
            onClick: () => handleRate(rating, finalSelection),
          })),
        },
        {
          label: t('contextMenus.editor.colorLabel'),
          icon: Palette,
          submenu: [
            { label: t('contextMenus.editor.noLabel'), onClick: () => handleSetColorLabel(null, finalSelection) },
            ...COLOR_LABELS.map((label: Color) => ({
              label: t(`contextMenus.colors.${label.name}`),
              color: label.color,
              onClick: () => handleSetColorLabel(label.name, finalSelection),
            })),
          ],
        },
        {
          label: t('contextMenus.editor.tagging'),
          icon: Tag,
          submenu: [
            {
              customComponent: TaggingSubMenu,
              customProps: {
                paths: finalSelection,
                initialTags: commonTags,
                onTagsChanged: handleTagsChanged,
                appSettings,
              },
            },
          ],
        },
        { type: OPTION_SEPARATOR },
        {
          label: t('contextMenus.thumbnail.quickCollection' as any, {
            defaultValue: 'Quick Collection',
          }),
          icon: Star,
          submenu: [
            {
              label: t('contextMenus.thumbnail.addToQuickCollection' as any, {
                defaultValue: 'Add to Quick Collection',
              }),
              onClick: () => {
                const lib = useLibraryStore.getState();
                const set = new Set(lib.quickCollectionPaths || []);
                finalSelection.forEach((p) => set.add(p));
                lib.setLibrary({ quickCollectionPaths: Array.from(set) });
              },
            },
            {
              label: t('contextMenus.thumbnail.removeFromQuickCollection' as any, {
                defaultValue: 'Remove from Quick Collection',
              }),
              onClick: () => {
                const lib = useLibraryStore.getState();
                const set = new Set(lib.quickCollectionPaths || []);
                finalSelection.forEach((p) => set.delete(p));
                lib.setLibrary({
                  quickCollectionPaths: Array.from(set),
                  showQuickCollectionOnly:
                    lib.showQuickCollectionOnly && set.size > 0 ? lib.showQuickCollectionOnly : false,
                });
              },
            },
            {
              label: t('contextMenus.thumbnail.showQuickCollection' as any, {
                defaultValue: 'Show Quick Collection',
              }),
              onClick: () => {
                useLibraryStore.getState().setLibrary({
                  showQuickCollectionOnly: true,
                  showPreviousImportOnly: false,
                  activeAlbumId: null,
                });
              },
            },
            {
              label: t('contextMenus.thumbnail.clearQuickCollection' as any, {
                defaultValue: 'Clear Quick Collection',
              }),
              onClick: () => {
                useLibraryStore.getState().setLibrary({
                  quickCollectionPaths: [],
                  showQuickCollectionOnly: false,
                });
              },
            },
          ],
        },
        {
          label: t('contextMenus.thumbnail.addAllPicksToTarget' as any, {
            defaultValue: 'Add all picks to target collection',
          }),
          onClick: async () => {
            const lib = useLibraryStore.getState();
            const picks = (lib.imageList || [])
              .filter((img: any) =>
                (img.tags || []).some(
                  (tg: string) => tg === 'flag:pick' || String(tg).endsWith(':pick'),
                ),
              )
              .map((img: any) => img.path);
            if (!picks.length) {
              toast.info(
                t('contextMenus.toasts.noPicks' as any, { defaultValue: 'No picks in current view' }),
              );
              return;
            }
            const targetId = lib.targetCollectionId;
            if (!targetId) {
              const current = new Set(lib.quickCollectionPaths || []);
              picks.forEach((p: string) => current.add(p));
              lib.setLibrary({ quickCollectionPaths: Array.from(current) });
              toast.success(
                t('contextMenus.toasts.picksAddedQc' as any, {
                  defaultValue: 'Added {{count}} pick(s) to Quick Collection',
                  count: picks.length,
                }),
              );
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
              const set = new Set(album.images || []);
              picks.forEach((p: string) => set.add(p));
              album.images = Array.from(set);
              await invoke(Invokes.SaveAlbums, { tree });
              const sorted = await invoke(Invokes.GetAlbums);
              lib.setLibrary({ albumTree: sorted as any });
              toast.success(
                t('contextMenus.toasts.picksAddedTarget' as any, {
                  defaultValue: 'Added {{count}} pick(s) to target collection',
                  count: picks.length,
                }),
              );
            } catch (err) {
              toast.error(`Failed: ${err}`);
            }
          },
        },

        {
          label: t('contextMenus.thumbnail.addToAlbum'),
          icon: FolderPlus,
          submenu:
            albumTree.length > 0
              ? buildAddToAlbumMenu(albumTree, finalSelection)
              : [{ label: t('contextMenus.thumbnail.noAlbums'), disabled: true }],
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.createCollectionFromSelection' as any, {
            defaultValue: 'Create Collection from Selection…',
          }),
          icon: FolderPlus,
          onClick: () => {
            setUI({
              albumActionTarget: null,
              pendingAlbumSeedPaths: [...finalSelection],
              isCreateAlbumModalOpen: true,
            });
          },
        },
        ...(activeAlbumId
          ? [
              {
                label: t('contextMenus.thumbnail.removeFromAlbum', { count: selectionCount }),
                icon: Trash2,
                isDestructive: true,
                onClick: handleRemoveFromAlbum,
              },
            ]
          : []),
        { type: OPTION_SEPARATOR },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameCamera' as any, {
            defaultValue: 'Select same camera',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const key = `${active.exif.Make || ''} ${active.exif.Model || ''}`.toLowerCase().trim();
            if (!key) return;
            const paths = imageList
              .filter((img: any) => {
                const cam = `${img.exif?.Make || ''} ${img.exif?.Model || ''}`.toLowerCase().trim();
                return cam && cam === key;
              })
              .map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameLens' as any, {
            defaultValue: 'Select same lens',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const key = `${active.exif.LensModel || active.exif.Lens || ''}`.toLowerCase().trim();
            if (!key) return;
            const paths = imageList
              .filter((img: any) => {
                const lens = `${img.exif?.LensModel || img.exif?.Lens || ''}`.toLowerCase().trim();
                return lens && lens === key;
              })
              .map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },

        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameColor' as any, {
            defaultValue: 'Select same color label',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active) return;
            const color =
              (active.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6) || '';
            const paths = imageList
              .filter((img: any) => {
                const c =
                  (img.tags || []).find((tag: string) => tag.startsWith('color:'))?.substring(6) || '';
                return color ? c === color : !c;
              })
              .map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameDay' as any, {
            defaultValue: 'Select same capture day',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active) return;
            const dayOf = (img: any) => {
              const raw = String(img.exif?.DateTimeOriginal || img.exif?.DateTime || '').trim();
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
            const paths = imageList.filter((img: any) => dayOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameKeyword' as any, {
            defaultValue: 'Select same keyword',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active) return;
            const userTags = (active.tags || [])
              .filter((tg: string) => tg.startsWith('user:'))
              .map((tg: string) => tg.slice(5).toLowerCase())
              .filter(Boolean);
            if (!userTags.length) return;
            const pick = userTags[0];
            const paths = imageList
              .filter((img: any) =>
                (img.tags || []).some(
                  (tg: string) =>
                    tg.toLowerCase() === `user:${pick}` ||
                    tg.toLowerCase().replace(/^user:/, '') === pick,
                ),
              )
              .map((img: any) => img.path);
            useLibraryStore.getState().setFilterCriteria((prev: any) => ({ ...prev, keyword: pick }));
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameIso' as any, {
            defaultValue: 'Select same ISO',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const isoOf = (img: any) => {
              const raw = String(
                img.exif?.PhotographicSensitivity || img.exif?.ISOSpeedRatings || img.exif?.ISO || '',
              ).trim();
              const n = parseInt(raw, 10);
              return Number.isFinite(n) && n > 0 ? n : 0;
            };
            const key = isoOf(active);
            if (!key) return;
            const paths = imageList.filter((img: any) => isoOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameAperture' as any, {
            defaultValue: 'Select same aperture',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const aperOf = (img: any) => {
              const raw = String(img.exif?.FNumber || '')
                .trim()
                .toLowerCase()
                .replace(/^f\/?/, '');
              const n = parseFloat(raw);
              return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0;
            };
            const key = aperOf(active);
            if (!key) return;
            const paths = imageList.filter((img: any) => aperOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameFocal' as any, {
            defaultValue: 'Select same focal length',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const focalOf = (img: any) => {
              const raw = String(img.exif?.FocalLengthIn35mmFilm || img.exif?.FocalLength || '')
                .trim()
                .toLowerCase()
                .replace(/\s*mm$/, '');
              const n = parseFloat(raw);
              return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
            };
            const key = focalOf(active);
            if (!key) return;
            const paths = imageList.filter((img: any) => focalOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameShutter' as any, {
            defaultValue: 'Select same shutter speed',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const shutterOf = (img: any) => {
              const raw = String(img.exif?.ExposureTime || '')
                .trim()
                .toLowerCase()
                .replace(/\s*s$/, '')
                .replace(/\s+/g, '');
              return raw;
            };
            const key = shutterOf(active);
            if (!key) return;
            const paths = imageList.filter((img: any) => shutterOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameCity' as any, {
            defaultValue: 'Select same city',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const city = String(active.exif.City || '').trim();
            if (!city) return;
            const key = city.toLowerCase();
            const paths = imageList
              .filter((img: any) => String(img.exif?.City || '').trim().toLowerCase() === key)
              .map((img: any) => img.path);
            useLibraryStore.getState().setFilterCriteria((prev: any) => ({ ...prev, city }));
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameCountry' as any, {
            defaultValue: 'Select same country',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const country = String(active.exif.Country || '').trim();
            if (!country) return;
            const key = country.toLowerCase();
            const paths = imageList
              .filter((img: any) => String(img.exif?.Country || '').trim().toLowerCase() === key)
              .map((img: any) => img.path);
            useLibraryStore.getState().setFilterCriteria((prev: any) => ({ ...prev, country }));
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameLocation' as any, {
            defaultValue: 'Select same location',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active?.exif) return;
            const locOf = (img: any) =>
              String(img.exif?.Location || img.exif?.SubLocation || '')
                .trim()
                .toLowerCase();
            const key = locOf(active);
            if (!key) return;
            const paths = imageList.filter((img: any) => locOf(img) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: finalSelection.length < 2,
          label: t('contextMenus.thumbnail.stackPhotos' as any, {
            defaultValue: 'Stack photos',
          }),
          onClick: async () => {
            const paths = finalSelection.slice();
            if (paths.length < 2) return;
            const list = imageList || [];
            let sid: string | null = null;
            for (const p of paths) {
              const img = list.find((i: any) => i.path === p);
              const existing = stackIdFromTags(img?.tags);
              if (existing) {
                sid = existing;
                break;
              }
            }
            if (!sid) sid = newStackId();
            const tag = stackTag(sid);
            try {
              for (const p of paths) {
                const img = list.find((i: any) => i.path === p);
                const old = stackIdFromTags(img?.tags);
                if (old && old !== sid) {
                  await invoke(Invokes.RemoveTagForPaths, { paths: [p], tag: stackTag(old) });
                }
              }
              await invoke(Invokes.AddTagForPaths, { paths, tag });
              setLibrary({
                imageList: list.map((img: any) => {
                  if (!paths.includes(img.path)) return img;
                  const tags = (img.tags || []).filter((tg: string) => !String(tg).startsWith(STACK_TAG_PREFIX));
                  tags.push(tag);
                  return { ...img, tags };
                }),
              });
            } catch (err) {
              console.error('stack failed', err);
            }
          },
        },
        {
          disabled: !finalSelection.some((p: string) => {
            const img = imageList.find((i: any) => i.path === p);
            return !!stackIdFromTags(img?.tags);
          }),
          label: t('contextMenus.thumbnail.unstackPhotos' as any, {
            defaultValue: 'Unstack photos',
          }),
          onClick: async () => {
            const list = imageList || [];
            const toUnstack = new Set<string>();
            const tagsToRemove = new Set<string>();
            for (const p of finalSelection) {
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
              setLibrary({
                imageList: list.map((img: any) => {
                  if (!toUnstack.has(img.path)) return img;
                  return {
                    ...img,
                    tags: (img.tags || []).filter((tg: string) => !String(tg).startsWith(STACK_TAG_PREFIX)),
                  };
                }),
              });
            } catch (err) {
              console.error('unstack failed', err);
            }
          },
        },
        {
          disabled: !finalSelection.some((p: string) => {
            const img = imageList.find((i: any) => i.path === p);
            return !!(img && effectiveGroupId(img));
          }),
          label: t('contextMenus.thumbnail.toggleExpandStack' as any, {
            defaultValue: 'Expand/collapse stack',
          }),
          onClick: () => {
            const path = finalSelection[0];
            const img = imageList.find((i: any) => i.path === path);
            if (!img) return;
            const gid = effectiveGroupId(img);
            if (!gid) return;
            const cur = new Set(useLibraryStore.getState().expandedStackIds || []);
            if (cur.has(gid)) cur.delete(gid);
            else cur.add(gid);
            setLibrary({ expandedStackIds: Array.from(cur) });
          },
        },
        {
          label: t('contextMenus.thumbnail.toggleHideRejected' as any, {
            defaultValue: useSettingsStore.getState().appSettings?.hideRejectedPhotos
              ? 'Show rejected photos'
              : 'Hide rejected photos',
          } as any),
          onClick: async () => {
            const settings = useSettingsStore.getState().appSettings;
            if (!settings) return;
            const next = !settings.hideRejectedPhotos;
            await useSettingsStore.getState().handleSettingsChange({
              ...settings,
              hideRejectedPhotos: next,
            });
          },
        },
        {
          disabled: !(imageList || []).some((img: any) =>
            (img.tags || []).some((tg: string) => tg === 'flag:reject' || String(tg).endsWith(':reject')),
          ),
          label: t('contextMenus.thumbnail.deleteAllRejected' as any, {
            defaultValue: 'Delete all rejected…',
          }),
          onClick: () => {
            const rejected = (imageList || [])
              .filter((img: any) =>
                (img.tags || []).some(
                  (tg: string) => tg === 'flag:reject' || String(tg).endsWith(':reject'),
                ),
              )
              .map((img: any) => img.path);
            if (!rejected.length) return;
            useUIStore.getState().setUI({
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


        {
          disabled: finalSelection.length < 2,
          label: t('contextMenus.thumbnail.autoStackByTime' as any, {
            defaultValue: 'Auto-stack by capture time',
          }),
          onClick: async () => {
            const paths = finalSelection.slice();
            const list = imageList || [];
            const groups = groupPathsByCaptureTime(list, paths);
            let stackedGroups = 0;
            const nextList = list.map((img: any) => ({ ...img, tags: [...(img.tags || [])] }));
            try {
              for (const [, groupPaths] of groups) {
                if (groupPaths.length < 2) continue;
                let sid: string | null = null;
                for (const p of groupPaths) {
                  const img = nextList.find((i: any) => i.path === p);
                  const existing = stackIdFromTags(img?.tags);
                  if (existing) {
                    sid = existing;
                    break;
                  }
                }
                if (!sid) sid = newStackId();
                const tag = stackTag(sid);
                for (const p of groupPaths) {
                  const img = nextList.find((i: any) => i.path === p);
                  const old = stackIdFromTags(img?.tags);
                  if (old && old !== sid) {
                    await invoke(Invokes.RemoveTagForPaths, { paths: [p], tag: stackTag(old) });
                  }
                }
                await invoke(Invokes.AddTagForPaths, { paths: groupPaths, tag });
                stackedGroups += 1;
                for (const p of groupPaths) {
                  const img = nextList.find((i: any) => i.path === p);
                  if (!img) continue;
                  img.tags = (img.tags || []).filter((tg: string) => !String(tg).startsWith(STACK_TAG_PREFIX));
                  img.tags.push(tag);
                }
              }
              setLibrary({ imageList: nextList });
            } catch (err) {
              console.error('auto stack failed', err);
            }
          },
        },
        {
          disabled: !isSingleSelection && finalSelection.length === 0,
          label: t('contextMenus.thumbnail.selectSameCaptureTime' as any, {
            defaultValue: 'Select same capture time',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active) return;
            const key = captureTimeKey(active);
            if (!key) return;
            const paths = imageList
              .filter((img: any) => captureTimeKey(img) === key)
              .map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.copyMetadata' as any, {
            defaultValue: 'Copy metadata',
          }),
          onClick: async () => {
            const path = finalSelection[0];
            if (!path) return;
            try {
              const meta: any = await invoke(Invokes.LoadMetadata, { path });
              const exif = meta?.exif || {};
              const fields = [
                'ImageDescription', 'XPTitle', 'Caption', 'Headline',
                'Artist', 'Creator', 'Copyright', 'UserComment',
                'City', 'State', 'Country', 'Location', 'SubLocation', 'Province',
              ];
              const clip: Record<string, string> = {};
              for (const k of fields) {
                const v = exif[k];
                if (v != null && String(v).trim() !== '') clip[k] = String(v);
              }
              const tags = (meta?.tags || []) as string[];
              const userKws = tags.filter((tg) => tg.startsWith('user:')).map((tg) => tg.slice(5));
              if (userKws.length) clip.__keywords = userKws.join('\n');
              setLibrary({ copiedMetadata: clip });
            } catch (err) {
              console.error('copy metadata', err);
            }
          },
        },
        {
          disabled: !useLibraryStore.getState().copiedMetadata || finalSelection.length === 0,
          label: t('contextMenus.thumbnail.pasteMetadata' as any, {
            defaultValue: 'Paste metadata',
          }),
          onClick: async () => {
            const clip = { ...(useLibraryStore.getState().copiedMetadata || {}) };
            if (!Object.keys(clip).length) return;
            const paths = finalSelection.slice();
            const kwRaw = clip.__keywords;
            delete clip.__keywords;
            try {
              if (Object.keys(clip).length) {
                await invoke(Invokes.UpdateExifFields, { paths, updates: clip });
                setLibrary({
                  imageList: imageList.map((img: any) => {
                    if (!paths.includes(img.path)) return img;
                    return { ...img, exif: { ...(img.exif || {}), ...clip } };
                  }),
                });
              }
              if (kwRaw) {
                const kws = String(kwRaw).split('\n').map((k) => k.trim()).filter(Boolean);
                for (const kw of kws) {
                  const tag = kw.startsWith('user:') ? kw : `user:${kw.toLowerCase()}`;
                  await invoke(Invokes.AddTagForPaths, { paths, tag });
                }
                setLibrary({
                  imageList: (useLibraryStore.getState().imageList || []).map((img: any) => {
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
            } catch (err) {
              console.error('paste metadata', err);
            }
          },
        },


        {
          disabled: !isSingleSelection,
          label: t('contextMenus.thumbnail.selectSameFolder' as any, {
            defaultValue: 'Select same folder',
          }),
          onClick: () => {
            const active = imageList.find((i: any) => i.path === finalSelection[0]);
            if (!active) return;
            const folderOf = (p: string) => {
              const physical = String(p || '').split('?vc=')[0];
              const i = Math.max(physical.lastIndexOf('/'), physical.lastIndexOf('\\'));
              return i > 0 ? physical.slice(0, i) : '';
            };
            const key = folderOf(active.path);
            if (!key) return;
            const paths = imageList.filter((img: any) => folderOf(img.path) === key).map((img: any) => img.path);
            setLibrary({
              multiSelectedPaths: paths,
              libraryActivePath: paths.length ? paths[paths.length - 1] : finalSelection[0],
              selectionAnchorPath: paths.length ? paths[0] : null,
              showSelectedOnly: false,
            });
          },
        },
        {
          disabled: !isSingleSelection,
          icon: Folder,
          label: t('contextMenus.thumbnail.goToFolder' as any, {
            defaultValue: 'Go to Folder in Library',
          }),
          onClick: () => {
            const filePath = finalSelection[0];
            const physical = String(filePath || '').split('?vc=')[0];
            const sep = physical.includes('/') ? '/' : '\\';
            const last = physical.lastIndexOf(sep);
            if (last <= 0) return;
            const folder = physical.substring(0, last);
            // Clear catalog-only scopes so the folder contents show
            useLibraryStore.getState().setLibrary({
              showPreviousImportOnly: false,
              showQuickCollectionOnly: false,
              showSelectedOnly: false,
              activeAlbumId: null,
            });
            useLibraryStore.getState().setFilterCriteria((prev: any) => ({
              ...prev,
              // keep rating/colors etc.; clear date smart-collection ranges only if needed — leave filters
            }));
            if (props.handleSelectSubfolder) {
              Promise.resolve(props.handleSelectSubfolder(folder, false, undefined, true, false)).catch(
                (err) => toast.error(String(err)),
              );
            } else {
              // Fallback: set current folder path only
              useLibraryStore.getState().setLibrary({ currentFolderPath: folder });
            }
            props.handleBackToLibrary();
          },
        },
        {
          disabled: !isSingleSelection,
          icon: Folder,
          label: t('contextMenus.thumbnail.showExplorer'),
          onClick: () => {
            invoke(Invokes.ShowInFinder, { path: finalSelection[0] }).catch((err) =>
              toast.error(t('contextMenus.toasts.couldNotShowExplorer', { err })),
            );
          },
        },
        {
          disabled:
            finalSelection.length === 0 ||
            !finalSelection.some((p: string) => {
              const img = imageList.find((i: any) => i.path === p);
              const lat = img?.exif?.GPSLatitude;
              const lon = img?.exif?.GPSLongitude;
              return (
                lat != null &&
                lon != null &&
                lat !== '' &&
                lon !== '' &&
                Number.isFinite(parseFloat(String(lat))) &&
                Number.isFinite(parseFloat(String(lon)))
              );
            }),
          label: t('contextMenus.thumbnail.openInMap' as any, {
            defaultValue: 'Open in Map',
          }),
          onClick: () => {
            const gpsPaths = finalSelection.filter((p: string) => {
              const img = imageList.find((i: any) => i.path === p);
              const lat = img?.exif?.GPSLatitude;
              const lon = img?.exif?.GPSLongitude;
              return (
                lat != null &&
                lon != null &&
                lat !== '' &&
                lon !== '' &&
                Number.isFinite(parseFloat(String(lat))) &&
                Number.isFinite(parseFloat(String(lon)))
              );
            });
            if (!gpsPaths.length) return;
            setLibrary({
              multiSelectedPaths: gpsPaths,
              libraryActivePath: gpsPaths[gpsPaths.length - 1],
              selectionAnchorPath: gpsPaths[0],
            });
            useUIStore.getState().setUI({ activeView: 'map' });
          },
        },

        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.copyFilename' as any, {
            defaultValue:
              finalSelection.length > 1 ? 'Copy filenames' : 'Copy filename',
          }),
          onClick: async () => {
            const names = finalSelection.map((p: string) => {
              const physical = String(p).split('?vc=')[0];
              return physical.split(/[/\\]/).pop() || physical;
            });
            try {
              await navigator.clipboard.writeText(names.join('\n'));
              toast.success(
                names.length === 1
                  ? t('contextMenus.toasts.filenameCopied' as any, {
                      defaultValue: 'Filename copied',
                    })
                  : t('contextMenus.toasts.filenamesCopied' as any, {
                      defaultValue: '{{count}} filenames copied',
                      count: names.length,
                    }),
              );
            } catch (err) {
              toast.error(String(err));
            }
          },
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.copyFilePath' as any, {
            defaultValue: finalSelection.length > 1 ? 'Copy paths' : 'Copy path',
          }),
          onClick: async () => {
            const paths = finalSelection.map((p: string) => String(p).split('?vc=')[0]);
            try {
              await navigator.clipboard.writeText(paths.join('\n'));
              toast.success(
                paths.length === 1
                  ? t('contextMenus.toasts.pathCopied' as any, {
                      defaultValue: 'Path copied',
                    })
                  : t('contextMenus.toasts.pathsCopied' as any, {
                      defaultValue: '{{count}} paths copied',
                      count: paths.length,
                    }),
              );
            } catch (err) {
              toast.error(String(err));
            }
          },
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.clearKeywords' as any, {
            defaultValue: 'Clear keywords',
          }),
          onClick: async () => {
            const paths = finalSelection.slice();
            try {
              for (const path of paths) {
                const img = imageList.find((i: any) => i.path === path);
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
                }
              }
              setLibrary({
                imageList: imageList.map((img: any) => {
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
                t('contextMenus.toasts.keywordsCleared' as any, {
                  defaultValue: 'Keywords cleared',
                }),
              );
            } catch (err) {
              toast.error(String(err));
            }
          },
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.thumbnail.addKeyword' as any, {
            defaultValue: 'Add keyword…',
          }),
          onClick: async () => {
            const paths = finalSelection.slice();
            const raw = window.prompt(
              paths.length > 1
                ? `Add keyword to ${paths.length} photos (parent/child for hierarchy)`
                : 'Add keyword (parent/child for hierarchy)',
              '',
            );
            if (raw == null || !String(raw).trim()) return;
            const cleaned = String(raw)
              .trim()
              .toLowerCase()
              .replace(/^user:/, '')
              .replace(/\s*>\s*/g, '/')
              .replace(/\/+/g, '/')
              .replace(/^\/|\/$/g, '');
            if (!cleaned) return;
            const parts = cleaned.split('/').map((p: string) => p.trim()).filter(Boolean);
            const segments: string[] = [];
            let acc = '';
            for (const part of parts) {
              acc = acc ? `${acc}/${part}` : part;
              segments.push(acc);
            }
            try {
              for (const seg of segments) {
                await invoke(Invokes.AddTagForPaths, { paths, tag: `user:${seg}` });
              }
              setLibrary({
                imageList: imageList.map((img: any) => {
                  if (!paths.includes(img.path)) return img;
                  const tags = [...(img.tags || [])];
                  for (const seg of segments) {
                    const tag = `user:${seg}`;
                    if (!tags.includes(tag)) tags.push(tag);
                  }
                  return { ...img, tags };
                }),
              });
            } catch (err) {
              toast.error(String(err));
            }
          },
        },


        {
          label: t('contextMenus.editor.reimportXmp'),
          icon: FileInput,
          onClick: async () => {
            const { ok, fail } = await reimportDevelopFromXmpPaths(finalSelection);
            if (ok > 0) toast.success(t('contextMenus.toasts.reimportedXmpCount', { count: ok }));
            if (fail > 0) toast.error(t('contextMenus.toasts.reimportXmpFailed', { count: fail }));
            await props.refreshImageList();
          },
        },
        {
          disabled: finalSelection.length === 0,
          label: t('contextMenus.editor.exportDevelopXmp'),
          icon: FileOutput,
          onClick: async () => {
            try {
              const { ok, fail } = await exportDevelopToXmpPaths(finalSelection);
              if (ok > 0) {
                toast.success(
                  finalSelection.length === 1
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
        {
          disabled: !isSingleSelection,
          label: t('contextMenus.editor.showXmp'),
          icon: Folder,
          onClick: () => {
            invoke(Invokes.ShowXmpSidecar, { path: finalSelection[0] }).catch(() =>
              toast.error(t('contextMenus.toasts.xmpNotFound')),
            );
          },
        },
        {
          label: resetLabel,
          icon: RotateCcw,
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('contextMenus.editor.confirmReset'),
              icon: Check,
              isDestructive: true,
              onClick: () => handleResetAdjustments(finalSelection),
            },
          ],
        },
        {
          label: deleteLabel,
          icon: Trash2,
          isDestructive: true,
          submenu: deleteSubmenu,
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [
      getCommonTags,
      buildAddToAlbumMenu,
      handleCopyAdjustments,
      handlePasteAdjustments,
      handleRate,
      handleSetColorLabel,
      handleTagsChanged,
      handleResetAdjustments,
      showContextMenu,
      props,
      t,
    ],
  );

  const handleFolderTreeContextMenu = useCallback(
    (event: any, path: string | null, isCurrentlyPinned?: boolean) => {
      event.preventDefault();
      event.stopPropagation();

      if (!path) {
        showContextMenu(event.clientX, event.clientY, [
          {
            icon: RefreshCw,
            label: t('contextMenus.folders.refresh'),
            onClick: () => props.refreshAllFolderTrees(),
          },
        ]);
        return;
      }

      const { rootPaths, currentFolderPath, folderTrees, setLibrary } = useLibraryStore.getState();
      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      const { setUI } = useUIStore.getState();
      const targetPath = path;
      const isRoot = rootPaths.includes(targetPath);
      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });

      const pinOption = isCurrentlyPinned
        ? {
            icon: PinOff,
            label: t('contextMenus.folders.unpin'),
            onClick: () => props.handleTogglePinFolder(targetPath),
          }
        : { icon: Pin, label: t('contextMenus.folders.pin'), onClick: () => props.handleTogglePinFolder(targetPath) };

      const options = [
        ...(isRoot
          ? [
              {
                icon: Trash2,
                label: t('contextMenus.folders.removeRoot'),
                isDestructive: true,
                onClick: () => {
                  const newRoots = rootPaths.filter((r: string) => r !== targetPath);
                  const newFolderTrees = folderTrees.filter((t: any) => t.path !== targetPath);

                  const isCurrentInTarget =
                    currentFolderPath === targetPath ||
                    currentFolderPath?.startsWith(targetPath + '/') ||
                    currentFolderPath?.startsWith(targetPath + '\\');

                  const updates: any = {
                    rootPaths: newRoots,
                    folderTrees: newFolderTrees,
                  };

                  if (isCurrentInTarget) {
                    updates.currentFolderPath = null;
                    updates.imageList = [];
                    updates.libraryActivePath = null;
                    updates.multiSelectedPaths = [];
                    updates.selectionAnchorPath = null;
                    props.handleBackToLibrary();
                  }

                  setLibrary(updates);

                  const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                  if (appSettings) {
                    const newSettings = { ...appSettings, rootFolders: newRoots } as any;
                    if (newRoots.length === 0) {
                      newSettings.lastRootPath = null;
                      newSettings.lastFolderState = null;
                    } else if (newSettings.lastRootPath === targetPath) {
                      newSettings.lastRootPath = newRoots[0];
                    }

                    if (isCurrentInTarget) {
                      newSettings.lastFolderState = null;
                    }

                    handleSettingsChange(newSettings);
                  }
                },
              },
              { type: OPTION_SEPARATOR },
            ]
          : []),
        pinOption,
        { type: OPTION_SEPARATOR },
        {
          icon: FolderPlus,
          label: t('contextMenus.folders.newFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isCreateFolderModalOpen: true });
          },
        },
        {
          disabled: isRoot,
          icon: FileEdit,
          label: t('contextMenus.folders.renameFolder'),
          onClick: () => {
            setUI({ folderActionTarget: targetPath, isRenameFolderModalOpen: true });
          },
        },
        {
          label: t('contextMenus.folders.changeIcon'),
          icon: Palette,
          submenu: albumIcons.map((iconDef) => ({
            label: iconDef.label,
            icon: iconDef.icon,
            onClick: () => {
              if (appSettings) {
                const currentIcons = appSettings.folderIcons || {};
                const newIcons = { ...currentIcons };

                if (iconDef.value) {
                  newIcons[targetPath] = iconDef.value;
                } else {
                  delete newIcons[targetPath];
                }

                handleSettingsChange({ ...appSettings, folderIcons: newIcons });
              }
            },
          })),
        },
        { type: OPTION_SEPARATOR },
        {
          disabled: copiedFilePaths.length === 0,
          icon: ClipboardPaste,
          label: t('contextMenus.folders.paste'),
          submenu: [
            {
              label: copyPastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.CopyFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  if (targetPath === currentFolderPath) props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedCopy', { err }));
                }
              },
            },
            {
              label: movePastedLabel,
              onClick: async () => {
                try {
                  await invoke(Invokes.MoveFiles, { sourcePaths: copiedFilePaths, destinationFolder: targetPath });
                  setProcess({ copiedFilePaths: [] });
                  setLibrary({ multiSelectedPaths: [] });
                  props.refreshAllFolderTrees();
                  props.handleLibraryRefresh();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedMove', { err }));
                }
              },
            },
          ],
        },
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => props.handleImportClick(targetPath),
        },
        { type: OPTION_SEPARATOR },
        {
          icon: Folder,
          label: t('contextMenus.folders.showExplorer'),
          onClick: () =>
            invoke(Invokes.ShowInFinder, { path: targetPath }).catch((err) =>
              toast.error(t('contextMenus.toasts.couldNotShowFolder', { err })),
            ),
        },
        {
          icon: RefreshCw,
          label: t('contextMenus.folders.refresh'),
          onClick: () => props.refreshAllFolderTrees(),
        },
        {
          disabled: isRoot,
          icon: Trash2,
          isDestructive: true,
          label: t('contextMenus.folders.deleteFolder'),
          submenu: [
            { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
            {
              label: t('contextMenus.folders.confirm'),
              icon: Check,
              isDestructive: true,
              onClick: async () => {
                try {
                  await invoke(Invokes.DeleteFolder, { path: targetPath });

                  const isCurrentInTarget =
                    currentFolderPath === targetPath ||
                    currentFolderPath?.startsWith(targetPath + '/') ||
                    currentFolderPath?.startsWith(targetPath + '\\');

                  if (isCurrentInTarget) {
                    props.handleBackToLibrary();
                    setLibrary({
                      currentFolderPath: null,
                      imageList: [],
                      libraryActivePath: null,
                      multiSelectedPaths: [],
                      selectionAnchorPath: null,
                    });

                    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
                    if (appSettings) {
                      handleSettingsChange({ ...appSettings, lastFolderState: null } as any);
                    }
                  }

                  props.refreshAllFolderTrees();
                } catch (err) {
                  toast.error(t('contextMenus.toasts.failedDeleteFolder', { err }));
                }
              },
            },
          ],
        },
      ];
      showContextMenu(event.clientX, event.clientY, options);
    },
    [props, showContextMenu, albumIcons, t],
  );

  const handleAlbumTreeContextMenu = useCallback(
    (event: any, item: AlbumItem | null) => {
      event.preventDefault();
      event.stopPropagation();

      const { setUI } = useUIStore.getState();
      const { albumTree, setLibrary } = useLibraryStore.getState();

      const findParentId = (
        nodes: AlbumItem[],
        childId: string,
        parentId: string | null = null,
      ): string | null | undefined => {
        for (const n of nodes) {
          if (n.id === childId) return parentId;
          if (n.type === 'group') {
            const found = findParentId((n as AlbumGroup).children, childId, n.id);
            if (found !== undefined) return found;
          }
        }
        return undefined;
      };

      const currentParentId = item ? findParentId(albumTree, item.id) : undefined;

      const handleMove = (targetId: string | null) => {
        if (!item) return;
        const newTree = structuredClone(albumTree);
        let extractedItem: AlbumItem | null = null;

        const removeAndGet = (nodes: AlbumItem[], id: string): AlbumItem | null => {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === id) return nodes.splice(i, 1)[0];
            if (nodes[i].type === 'group') {
              const res = removeAndGet((nodes[i] as AlbumGroup).children, id);
              if (res) return res;
            }
          }
          return null;
        };

        extractedItem = removeAndGet(newTree, item.id);
        if (!extractedItem) return;

        if (!targetId) {
          newTree.push(extractedItem);
        } else {
          let inserted = false;

          const insert = (nodes: AlbumItem[]) => {
            for (const n of nodes) {
              if (n.id === targetId && n.type === 'group') {
                n.children.push(extractedItem!);
                inserted = true;
                return;
              } else if (n.type === 'group') {
                insert(n.children);
                if (inserted) return;
              }
            }
          };

          insert(newTree);

          if (!inserted) {
            toast.error(t('contextMenus.toasts.failedMoveInvalid'));
            return;
          }
        }

        invoke(Invokes.SaveAlbums, { tree: newTree })
          .then(() => invoke(Invokes.GetAlbums))
          .then((sortedTree: any) => setLibrary({ albumTree: sortedTree }))
          .catch((err) => toast.error(t('contextMenus.toasts.failedMoveError', { err })));
      };

      const buildMoveSubmenu = (nodes: AlbumItem[]): Option[] => {
        let opts: Option[] = [];
        nodes.forEach((n) => {
          if (n.type === 'group' && n.id !== item?.id) {
            const isCurrentParent = n.id === currentParentId;
            const subOpts = buildMoveSubmenu((n as AlbumGroup).children);

            const customIconDef = n.icon ? albumIcons.find((i) => i.value === n.icon) : null;
            const ResolvedIcon = customIconDef?.icon || Folder;

            if (subOpts.length > 0) {
              opts.push({
                label: n.name,
                icon: ResolvedIcon,
                submenu: [
                  {
                    label: isCurrentParent ? t('contextMenus.albums.alreadyHere') : t('contextMenus.albums.moveHere'),
                    icon: Check,
                    disabled: isCurrentParent,
                    onClick: isCurrentParent ? undefined : () => handleMove(n.id),
                  },
                  { type: OPTION_SEPARATOR },
                  ...subOpts,
                ],
              });
            } else {
              opts.push({
                label: isCurrentParent ? `${n.name} (Current)` : n.name,
                icon: ResolvedIcon,
                disabled: isCurrentParent,
                onClick: isCurrentParent ? undefined : () => handleMove(n.id),
              });
            }
          }
        });
        return opts;
      };

      const moveOptions = buildMoveSubmenu(albumTree);
      const isAtRoot = currentParentId === null;
      const isMoveDisabled = moveOptions.length === 0 && isAtRoot;

      const options: Option[] = [
        {
          label: t('contextMenus.albums.newAlbum'),
          icon: Images,
          onClick: () => setUI({ albumActionTarget: item?.id || null, isCreateAlbumModalOpen: true }),
        },
        {
          label: t('contextMenus.albums.newGroup'),
          icon: FolderPlus,
          onClick: () => setUI({ albumActionTarget: item?.id || null, isCreateAlbumGroupModalOpen: true }),
        },
        ...(item
          ? [
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.renameGroup') : t('contextMenus.albums.renameAlbum'),
                icon: FileEdit,
                onClick: () => setUI({ albumActionTarget: item.id, isRenameAlbumModalOpen: true }),
              },
              ...(item.type === 'album'
                ? [
                    {
                      label: t('contextMenus.albums.setAsTarget' as any, {
                        defaultValue: 'Set as Target Collection',
                      }),
                      icon: Star,
                      onClick: () => {
                        const lib = useLibraryStore.getState();
                        const isAlready = lib.targetCollectionId === item.id;
                        lib.setLibrary({ targetCollectionId: isAlready ? null : item.id });
                        toast.success(
                          isAlready
                            ? t('contextMenus.albums.targetIsQuick' as any, {
                                defaultValue: 'Target is Quick Collection',
                              })
                            : t('contextMenus.albums.targetSet' as any, {
                                defaultValue: 'Target: {{name}} (B adds photos)',
                                name: item.name,
                              }),
                        );
                      },
                    },
                  ]
                : []),
              {
                label: t('contextMenus.folders.changeIcon'),
                icon: Palette,
                submenu: albumIcons.map((iconDef) => ({
                  label: iconDef.label,
                  icon: iconDef.icon,
                  onClick: () => {
                    const newTree = structuredClone(albumTree);
                    const updateIcon = (nodes: AlbumItem[]) => {
                      for (const n of nodes) {
                        if (n.id === item.id) {
                          n.icon = iconDef.value;
                          return true;
                        }
                        if (n.type === 'group' && updateIcon((n as AlbumGroup).children)) return true;
                      }
                      return false;
                    };

                    if (updateIcon(newTree)) {
                      invoke(Invokes.SaveAlbums, { tree: newTree })
                        .then(() => invoke(Invokes.GetAlbums))
                        .then((sorted: any) => setLibrary({ albumTree: sorted }))
                        .catch((err) => toast.error(t('contextMenus.toasts.failedChangeIcon', { err })));
                    }
                  },
                })),
              },
              {
                label: t('contextMenus.albums.moveTo'),
                icon: FolderInput,
                disabled: isMoveDisabled,
                submenu: isMoveDisabled
                  ? []
                  : [
                      {
                        label: isAtRoot ? t('contextMenus.albums.alreadyAtRoot') : t('contextMenus.albums.rootDir'),
                        icon: Home,
                        disabled: isAtRoot,
                        onClick: isAtRoot ? undefined : () => handleMove(null),
                      },
                      ...(moveOptions.length > 0 ? [{ type: OPTION_SEPARATOR }, ...moveOptions] : []),
                    ],
              },
              { type: OPTION_SEPARATOR },
              {
                label:
                  item.type === 'group' ? t('contextMenus.albums.deleteGroup') : t('contextMenus.albums.deleteAlbum'),
                icon: Trash2,
                isDestructive: true,
                submenu: [
                  { label: t('contextMenus.editor.cancel'), icon: X, onClick: () => {} },
                  {
                    label:
                      item.type === 'album'
                        ? t('contextMenus.albums.confirmDeleteAlbum')
                        : (item as AlbumGroup).children.length > 0
                          ? t('contextMenus.albums.confirmDeleteGroupNested')
                          : t('contextMenus.albums.confirmDeleteGroupEmpty'),
                    icon: Check,
                    isDestructive: true,
                    onClick: () => {
                      const newTree = structuredClone(albumTree);
                      const del = (nodes: AlbumItem[]) => {
                        const idx = nodes.findIndex((n) => n.id === item.id);
                        if (idx !== -1) nodes.splice(idx, 1);
                        else
                          nodes.forEach((n) => {
                            if (n.type === 'group') del((n as AlbumGroup).children);
                          });
                      };
                      del(newTree);
                      invoke(Invokes.SaveAlbums, { tree: newTree })
                        .then(() => invoke(Invokes.GetAlbums))
                        .then((sorted: any) => setLibrary({ albumTree: sorted }))
                        .catch((err) => toast.error(t('contextMenus.toasts.failedDelete', { err })));
                    },
                  },
                ],
              },
            ]
          : []),
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [showContextMenu, albumIcons, t],
  );

  const handleMainLibraryContextMenu = useCallback(
    (event: any) => {
      event.preventDefault();
      event.stopPropagation();

      const { copiedFilePaths, setProcess } = useProcessStore.getState();
      const { currentFolderPath, activeAlbumId, setLibrary } = useLibraryStore.getState();

      const numCopied = copiedFilePaths.length;
      const copyPastedLabel = t('contextMenus.folders.copyHere', { count: numCopied });
      const movePastedLabel = t('contextMenus.folders.moveHere', { count: numCopied });
      const addCopiedToAlbumLabel = t('contextMenus.library.addCopiedToAlbum', { count: numCopied });

      const isAlbumView = !!activeAlbumId;

      const pasteOption = isAlbumView
        ? {
            label: addCopiedToAlbumLabel,
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0,
            onClick: async () => {
              try {
                await invoke(Invokes.AddToAlbum, { albumId: activeAlbumId, paths: copiedFilePaths });
                console.log(`Added ${numCopied} image(s) to album`);
                const updatedTree = await invoke<AlbumItem[]>(Invokes.GetAlbums);
                setLibrary({ albumTree: updatedTree });
                await props.refreshImageList();
              } catch (err) {
                toast.error(t('contextMenus.toasts.failedAddToAlbum', { err }));
              }
            },
          }
        : {
            label: t('contextMenus.folders.paste'),
            icon: ClipboardPaste,
            disabled: copiedFilePaths.length === 0,
            submenu: [
              {
                label: copyPastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.CopyFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedCopy', { err }));
                  }
                },
              },
              {
                label: movePastedLabel,
                onClick: async () => {
                  try {
                    await invoke(Invokes.MoveFiles, {
                      sourcePaths: copiedFilePaths,
                      destinationFolder: currentFolderPath,
                    });
                    setProcess({ copiedFilePaths: [] });
                    setLibrary({ multiSelectedPaths: [] });
                    props.refreshAllFolderTrees();
                    props.handleLibraryRefresh();
                  } catch (err) {
                    toast.error(t('contextMenus.toasts.failedMove', { err }));
                  }
                },
              },
            ],
          };

      const options = [
        { label: t('contextMenus.library.refreshView'), icon: RefreshCw, onClick: props.handleLibraryRefresh },
        { type: OPTION_SEPARATOR },
        pasteOption,
        {
          icon: FolderInput,
          label: t('contextMenus.folders.importImages'),
          onClick: () => props.handleImportClick(currentFolderPath as string),
          disabled: !currentFolderPath || isAlbumView,
        },
      ];

      showContextMenu(event.clientX, event.clientY, options);
    },
    [props, showContextMenu, t],
  );

  return {
    handleEditorContextMenu,
    handleThumbnailContextMenu,
    handleFolderTreeContextMenu,
    handleAlbumTreeContextMenu,
    handleMainLibraryContextMenu,
  };
}
