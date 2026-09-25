import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Status } from '../components/ui/ExportImportProperties';
import { useProcessStore } from '../store/useProcessStore';
import { useEditorStore } from '../store/useEditorStore';
import { useUIStore } from '../store/useUIStore';
import { useLibraryStore } from '../store/useLibraryStore';

interface TauriListenerProps {
  refreshAllFolderTrees: () => void;
  handleSelectSubfolder: (path: string, isNewRoot?: boolean, preloadedImages?: any[], expandParents?: boolean) => void;
  refreshImageList: () => void;
  markGenerated: (path: string) => void;
}

export function useTauriListeners({
  refreshAllFolderTrees,
  handleSelectSubfolder,
  refreshImageList,
  markGenerated,
}: TauriListenerProps) {
  const refs = useRef({ refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated });

  useEffect(() => {
    refs.current = { refreshAllFolderTrees, handleSelectSubfolder, refreshImageList, markGenerated };
  });

  const thumbnailBuffer = useRef<Record<string, string>>({});
  const ratingBuffer = useRef<Record<string, number>>({});
  const editStatusBuffer = useRef<Record<string, boolean>>({});
  const flushHandle = useRef<number | null>(null);

  useEffect(() => {
    let isEffectActive = true;

    const flushThumbnailBatch = () => {
      flushHandle.current = null;
      if (!isEffectActive) return;

      const pendingThumbs = thumbnailBuffer.current;
      const pendingRatings = ratingBuffer.current;
      const pendingEdits = editStatusBuffer.current;

      thumbnailBuffer.current = {};
      ratingBuffer.current = {};
      editStatusBuffer.current = {};

      if (Object.keys(pendingThumbs).length > 0) {
        useProcessStore.getState().setProcess((state) => ({
          thumbnails: { ...state.thumbnails, ...pendingThumbs },
        }));
      }

      if (Object.keys(pendingRatings).length > 0 || Object.keys(pendingEdits).length > 0) {
        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, ...pendingRatings },
          imageList:
            Object.keys(pendingEdits).length > 0
              ? state.imageList.map((img) =>
                  pendingEdits[img.path] !== undefined ? { ...img, is_edited: pendingEdits[img.path] } : img,
                )
              : state.imageList,
        }));
      }
    };

    const scheduleFlush = () => {
      if (flushHandle.current !== null) return;
      flushHandle.current = requestAnimationFrame(flushThumbnailBatch);
    };

    const listeners = [
      listen('preview-update-uncropped', (event: any) => {
        if (isEffectActive) useEditorStore.getState().setEditor({ uncroppedAdjustedPreviewUrl: event.payload });
      }),
      listen('analytics-update', (event: any) => {
        if (isEffectActive && event.payload.path === useEditorStore.getState().selectedImage?.path) {
          const update: { histogram?: any; waveform?: any } = {};
          if (event.payload.histogram != null) update.histogram = event.payload.histogram;
          if (event.payload.waveform != null) update.waveform = event.payload.waveform;
          useEditorStore.getState().setEditor(update);
        }
      }),
      listen('image-enhanced', (event: any) => {
        const editor = useEditorStore.getState();
        if (isEffectActive && event.payload?.path === editor.selectedImage?.path) {
          editor.setEditor((state) => ({ imageRevision: state.imageRevision + 1 }));
        }
      }),
      listen('open-with-file', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ initialFileToOpen: event.payload as string });
      }),
      listen('external-edit-session', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ externalEditSession: event.payload });
      }),
      listen('thumbnail-progress', (event: any) => {
        if (isEffectActive)
          useProcessStore
            .getState()
            .setProcess({ thumbnailProgress: { current: event.payload.current, total: event.payload.total } });
      }),
      listen('thumbnail-generation-complete', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ thumbnailProgress: { current: 0, total: 0 } });
      }),
      listen('thumbnail-generated', (event: any) => {
        if (!isEffectActive) return;
        const { path, thumbnailPath, rating, is_edited, data } = event.payload;

        if (thumbnailPath) {
          thumbnailBuffer.current[path] = convertFileSrc(thumbnailPath.replace(/\\/g, '/'));
          refs.current.markGenerated(path);
        } else if (data) {
          thumbnailBuffer.current[path] = data;
          refs.current.markGenerated(path);
        }
        if (rating !== undefined) {
          ratingBuffer.current[path] = rating;
        }
        if (is_edited !== undefined) {
          editStatusBuffer.current[path] = is_edited;
        }
        if (thumbnailPath || data || rating !== undefined || is_edited !== undefined) {
          scheduleFlush();
        }
      }),
      listen('image-metadata-loaded', (event: any) => {
        if (!isEffectActive) return;
        const { path, rating, is_edited, tags } = event.payload;

        useLibraryStore.getState().setLibrary((state) => ({
          imageRatings: { ...state.imageRatings, [path]: rating },
          imageList: state.imageList.map((img) =>
            img.path === path ? { ...img, is_edited, tags: tags ?? img.tags } : img,
          ),
        }));
      }),
      listen('ai-model-download-start', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: event.payload });
      }),
      listen('ai-model-download-finish', () => {
        if (isEffectActive) useProcessStore.getState().setProcess({ aiModelDownloadStatus: null });
      }),
      listen('indexing-started', () => {
        if (isEffectActive)
          useProcessStore.getState().setProcess({ isIndexing: true, indexingProgress: { current: 0, total: 0 } });
      }),
      listen('indexing-progress', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setProcess({ indexingProgress: event.payload });
      }),
      listen('indexing-finished', () => {
        if (isEffectActive) {
          useProcessStore.getState().setProcess({ isIndexing: false, indexingProgress: { current: 0, total: 0 } });
          const currentPath = useLibraryStore.getState().currentFolderPath;
          if (currentPath) {
            refs.current.refreshImageList();
          }
        }
      }),
      listen('batch-export-progress', (event: any) => {
        if (isEffectActive) useProcessStore.getState().setExportState({ progress: event.payload });
      }),
      listen('export-complete', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Success });
      }),
      listen('export-error', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setExportState({
            status: Status.Error,
            errorMessage: typeof event.payload === 'string' ? event.payload : 'Unknown error',
          });
      }),
      listen('export-cancelling', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Cancelling });
      }),
      listen('export-cancelled', () => {
        if (isEffectActive) useProcessStore.getState().setExportState({ status: Status.Cancelled });
      }),
      listen('import-start', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            errorMessage: '',
            path: '',
            progress: { current: 0, total: event.payload.total },
            status: Status.Importing,
          });
      }),
      listen('import-progress', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            path: event.payload.path,
            progress: { current: event.payload.current, total: event.payload.total },
          });
      }),
      listen('import-complete', async (event: any) => {
        if (!isEffectActive) return;
        useProcessStore.getState().setImportState({ status: Status.Success });
        refs.current.refreshAllFolderTrees();
        const currentPath = useLibraryStore.getState().currentFolderPath;
        const destinationFolder =
          event?.payload?.destinationFolder || currentPath;
        if (destinationFolder) {
          refs.current.handleSelectSubfolder(destinationFolder, false);
        } else if (currentPath) {
          refs.current.handleSelectSubfolder(currentPath, false);
        }

        // Optional: apply a develop preset only to the files just imported (not the whole folder)
        const developPresetId = event?.payload?.developPresetId as string | null | undefined;
        const importedPaths = (event?.payload?.importedPaths as string[] | undefined) || [];
        const buildPreviews = event?.payload?.buildPreviews as boolean | undefined;
        const keywords = (event?.payload?.keywords as string[] | undefined) || [];
        const importCreator = (event?.payload?.creator as string | null | undefined) || '';
        const importCopyright = (event?.payload?.copyright as string | null | undefined) || '';
        const importCaption = (event?.payload?.caption as string | null | undefined) || '';
        const copyAsDng = !!(event?.payload?.copyAsDng);
        if (copyAsDng) {
          const { toast } = await import('react-toastify');
          const passthrough = Number(event?.payload?.dngPassthrough ?? 0);
          const deferred = Number(event?.payload?.dngDeferred ?? 0);
          if (passthrough > 0 && deferred === 0) {
            toast.success(
              `Copy as DNG: ${passthrough} file(s) already DNG — kept as .dng.`,
            );
          } else if (passthrough > 0 && deferred > 0) {
            toast.info(
              `Copy as DNG: ${passthrough} already DNG kept as .dng; ${deferred} RAW kept as originals (conversion deferred).`,
            );
          } else {
            toast.info(
              `Copy as DNG: ${deferred || 'files'} imported as originals (RAW→DNG conversion not enabled yet).`,
            );
          }
        }
        if (importedPaths.length > 0) {
          useLibraryStore.getState().setLibrary({
            lastImportedPaths: importedPaths,
            showPreviousImportOnly: false,
          });
          // LR-style import summary: click toast → Previous Import scope
          try {
            const { toast } = await import('react-toastify');
            const n = importedPaths.length;
            toast.success(
              n === 1
                ? 'Import complete — 1 photo · click to view'
                : `Import complete — ${n} photos · click to view`,
              {
                autoClose: 7000,
                onClick: () => {
                  useLibraryStore.getState().setLibrary({
                    showPreviousImportOnly: true,
                    showQuickCollectionOnly: false,
                    showSelectedOnly: false,
                    activeAlbumId: null,
                    multiSelectedPaths: [...importedPaths],
                    libraryActivePath: importedPaths[importedPaths.length - 1],
                    selectionAnchorPath: importedPaths[0],
                  });
                },
              },
            );
          } catch {
            /* toast optional */
          }
        }
        const hasIptc = !!(importCreator || importCopyright || importCaption);
        if ((developPresetId || buildPreviews || keywords.length > 0 || hasIptc) && importedPaths.length > 0) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { Invokes } = await import('../components/ui/AppProperties');
            if (developPresetId) {
              const presetItems: any[] = await invoke(Invokes.LoadPresets);
              let presetAdj: any = null;
              for (const item of presetItems) {
                if (item.preset?.id === developPresetId) {
                  presetAdj = item.preset.adjustments;
                  break;
                }
                if (item.folder?.children) {
                  const child = item.folder.children.find((c: any) => c.id === developPresetId);
                  if (child) {
                    presetAdj = child.adjustments;
                    break;
                  }
                }
              }
              if (presetAdj) {
                await invoke(Invokes.ApplyAdjustmentsToPaths, {
                  paths: importedPaths,
                  adjustments: presetAdj,
                });
              }
            }
            // LR-style "Build Previews" on import: queue thumbnail generation for new files
            if (keywords.length > 0) {
              // Expand hierarchical keywords (travel/paris → travel + travel/paris)
              const expanded = new Set<string>();
              for (const kw of keywords) {
                const bare = String(kw)
                  .trim()
                  .toLowerCase()
                  .replace(/^user:/, '')
                  .replace(/\s*>\s*/g, '/')
                  .replace(/\s*\|\s*/g, '/');
                if (!bare) continue;
                const parts = bare.split('/').map((p) => p.trim()).filter(Boolean);
                let acc = '';
                for (const part of parts) {
                  acc = acc ? `${acc}/${part}` : part;
                  expanded.add(`user:${acc}`);
                }
              }
              for (const tag of expanded) {
                try {
                  await invoke(Invokes.AddTagForPaths, { paths: importedPaths, tag });
                } catch (e) {
                  console.warn('import keyword failed', tag, e);
                }
              }
            }
            if (hasIptc) {
              const updates: Record<string, string> = {};
              if (importCreator) {
                updates.Artist = importCreator;
                updates.Creator = importCreator;
              }
              if (importCopyright) {
                updates.Copyright = importCopyright;
              }
              if (importCaption) {
                updates.ImageDescription = importCaption;
                updates.XPTitle = importCaption;
              }
              try {
                await invoke(Invokes.UpdateExifFields, { paths: importedPaths, updates });
              } catch (e) {
                console.warn('import IPTC failed', e);
              }
            }
            if (buildPreviews) {
              await invoke('update_thumbnail_queue', { paths: importedPaths });
            }
          } catch (err) {
            console.error('Failed post-import develop/preview work:', err);
          }
        }
      }),
      listen('import-error', (event: any) => {
        if (isEffectActive)
          useProcessStore.getState().setImportState({
            status: Status.Error,
            errorMessage: typeof event.payload === 'string' ? event.payload : 'Unknown error',
          });
      }),
      listen('denoise-progress', (event: any) => {
        if (isEffectActive)
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: { ...state.denoiseModalState, progressMessage: event.payload as string },
          }));
      }),
      listen('denoise-complete', (event: any) => {
        if (isEffectActive) {
          const payload = event.payload;
          const isObject = typeof payload === 'object' && payload !== null;
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              previewBase64: isObject ? payload.denoised : payload,
              originalBase64: isObject ? payload.original : null,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('denoise-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            denoiseModalState: {
              ...state.denoiseModalState,
              isProcessing: false,
              error: String(event.payload),
              progressMessage: null,
            },
          }));
        }
      }),
      listen('wgpu-frame-ready', (event: any) => {
        if (isEffectActive && event.payload?.path === useEditorStore.getState().selectedImage?.path) {
          useEditorStore.getState().setEditor({ hasRenderedFirstFrame: true });
        }
      }),
      listen('panorama-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => {
            if (state.panoramaModalState.finalImageBase64 || state.panoramaModalState.error) return state;
            return { panoramaModalState: { ...state.panoramaModalState, progressMessage: event.payload } };
          });
        }
      }),
      listen('panorama-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: null,
              finalImageBase64: event.payload.base64,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('panorama-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            panoramaModalState: {
              ...state.panoramaModalState,
              error: String(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: null,
            },
          }));
        }
      }),
      listen('hdr-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: null,
              isOpen: true,
              progressMessage: event.payload,
            },
          }));
        }
      }),
      listen('hdr-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: null,
              finalImageBase64: event.payload.base64,
              isProcessing: false,
              progressMessage: 'Hdr Ready',
            },
          }));
        }
      }),
      listen('hdr-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            hdrModalState: {
              ...state.hdrModalState,
              error: String(event.payload),
              finalImageBase64: null,
              isProcessing: false,
              progressMessage: 'An error occurred.',
            },
          }));
        }
      }),
      listen('culling-start', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: {
              ...state.cullingModalState,
              isOpen: true,
              progress: { current: 0, total: event.payload, stage: 'Initializing...' },
              suggestions: null,
              error: null,
            },
          }));
        }
      }),
      listen('culling-progress', (event: any) => {
        if (isEffectActive) {
          useUIStore
            .getState()
            .setUI((state) => ({ cullingModalState: { ...state.cullingModalState, progress: event.payload } }));
        }
      }),
      listen('culling-complete', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, suggestions: event.payload },
          }));
        }
      }),
      listen('culling-error', (event: any) => {
        if (isEffectActive) {
          useUIStore.getState().setUI((state) => ({
            cullingModalState: { ...state.cullingModalState, progress: null, error: String(event.payload) },
          }));
        }
      }),
    ];

    return () => {
      isEffectActive = false;
      if (flushHandle.current !== null) {
        cancelAnimationFrame(flushHandle.current);
        flushHandle.current = null;
      }
      thumbnailBuffer.current = {};
      ratingBuffer.current = {};
      listeners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, []);
}
