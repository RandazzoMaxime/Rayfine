import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { Printer, CopyPlus } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'react-toastify';
import { invoke } from '@tauri-apps/api/core';
import { SOFT_PROOF_PROFILES } from '../../../utils/softProofProfiles';
import { Invokes } from '../../ui/AppProperties';

const PROFILES = SOFT_PROOF_PROFILES;

/**
 * Lightroom Classic–style Soft Proofing chrome (public layout).
 * Profile / intent / paper / gamut warning — original RustROOM UI (not full ICC).
 */
export default function SoftProofBar() {
  const { t } = useTranslation();
  const {
    softProofing,
    softProofProfile,
    softProofIntent,
    softProofSimulatePaper,
    softProofShowGamutWarning,
    beforeAfterSplit,
    selectedImage,
    adjustments,
    setEditor,
  } = useEditorStore(
    useShallow((s) => ({
      softProofing: s.softProofing,
      softProofProfile: s.softProofProfile,
      softProofIntent: s.softProofIntent,
      softProofSimulatePaper: s.softProofSimulatePaper,
      softProofShowGamutWarning: s.softProofShowGamutWarning,
      beforeAfterSplit: s.beforeAfterSplit,
      selectedImage: s.selectedImage,
      adjustments: s.adjustments,
      setEditor: s.setEditor,
    })),
  );


  const createProofCopyRef = useRef<null | (() => void | Promise<void>)>(null);

  const createProofCopy = useCallback(async () => {
    const path = selectedImage?.path;
    if (!path) {
      toast.info(
        t('editor.softProof.needImage' as any, { defaultValue: 'Open a photo to create a proof copy' }),
      );
      return;
    }
    try {
      const lib = useLibraryStore.getState();
      const newPath: string = await invoke(Invokes.CreateVirtualCopy, {
        sourceVirtualPath: path,
        targetAlbumId: lib.activeAlbumId || null,
      });

      // Tag proof metadata on the VC via lookName (XMP interop) + local snapshot note
      const proofLabel = `Proof · ${softProofProfile || 'sRGB'} · ${softProofIntent || 'relative'}${
        softProofSimulatePaper ? ' · paper' : ''
      }`;
      const nextAdj = {
        ...adjustments,
        lookName: proofLabel,
      };
      try {
        await invoke(Invokes.SaveMetadataAndUpdateThumbnail, {
          path: newPath,
          adjustments: nextAdj,
        });
      } catch {
        /* sidecar write best-effort */
      }

      // Named develop snapshot on the proof copy (LR-style proof state)
      try {
        const snapKey = `rustroom.develop.snapshots.v1:${newPath}`;
        const snap = {
          id: `proof-${Date.now()}`,
          name: proofLabel,
          createdAt: Date.now(),
          adjustments: structuredClone(nextAdj),
        };
        let list: any[] = [];
        try {
          const raw = localStorage.getItem(snapKey);
          if (raw) list = JSON.parse(raw) || [];
        } catch {
          list = [];
        }
        if (!Array.isArray(list)) list = [];
        list = [snap, ...list].slice(0, 50);
        localStorage.setItem(snapKey, JSON.stringify(list));
        try {
          await invoke(Invokes.SaveImageSnapshots, { path: newPath, snapshots: list });
        } catch {
          /* sidecar best-effort */
        }
      } catch {
        /* ignore snapshot failures */
      }

      const { imageList, setLibrary } = useLibraryStore.getState();
      const src = imageList.find((i) => i.path === path);
      if (src && !imageList.some((i) => i.path === newPath)) {
        setLibrary({
          imageList: [
            ...imageList,
            {
              ...src,
              path: newPath,
              is_virtual_copy: true,
              is_edited: true,
            },
          ],
          multiSelectedPaths: [newPath],
          libraryActivePath: newPath,
        });
      } else {
        setLibrary({ multiSelectedPaths: [newPath], libraryActivePath: newPath });
      }

      toast.success(
        t('editor.softProof.proofCopyCreated' as any, {
          defaultValue: 'Proof copy created ({{label}})',
          label: proofLabel,
        }),
      );
      // Open the proof copy in Develop (LR Create Proof Copy stays in Develop on the VC)
      try {
        window.dispatchEvent(
          new CustomEvent('rustroom:open-image', { detail: { path: newPath } }),
        );
      } catch {
        /* ignore */
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [
    selectedImage?.path,
    softProofProfile,
    softProofIntent,
    softProofSimulatePaper,
    adjustments,
    t,
  ]);

  useEffect(() => {
    createProofCopyRef.current = createProofCopy;
  }, [createProofCopy]);

  useEffect(() => {
    const onCreate = () => {
      createProofCopyRef.current?.();
    };
    window.addEventListener('rustroom:create-proof-copy', onCreate as EventListener);
    return () => window.removeEventListener('rustroom:create-proof-copy', onCreate as EventListener);
  }, []);

  if (!softProofing) return null;

  return (
    <div className="shrink-0 h-8 px-3 flex items-center gap-2 border-b border-amber-500/30 bg-amber-950/40 text-amber-100/90 overflow-x-auto">
      <Printer size={13} className="opacity-80 shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] shrink-0">
        {t('editor.softProof.title' as any, { defaultValue: 'Soft Proofing' })}
      </span>
      <select
        className="h-6 px-1.5 rounded bg-black/30 border border-amber-500/25 text-[11px] text-amber-50 outline-none shrink-0 max-w-[11rem]"
        value={softProofProfile}
        onChange={(e) => setEditor({ softProofProfile: e.target.value })}
        data-tooltip={t('editor.softProof.profile' as any, { defaultValue: 'Profile' })}
      >
        <optgroup label={t('editor.softProof.rgbProfiles' as any, { defaultValue: 'RGB' })}>
          {PROFILES.filter(
            (p) =>
              !/japan|swop|fogra|cmyk/i.test(p) && !/gray/i.test(p),
          ).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('editor.softProof.grayProfiles' as any, { defaultValue: 'Gray' })}>
          {PROFILES.filter((p) => /gray/i.test(p)).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('editor.softProof.cmykProfiles' as any, { defaultValue: 'CMYK (shell)' })}>
          {PROFILES.filter((p) => /japan|swop|fogra|cmyk/i.test(p)).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </optgroup>
      </select>
      <select
        className="h-6 px-1.5 rounded bg-black/30 border border-amber-500/25 text-[11px] text-amber-50 outline-none shrink-0"
        value={softProofIntent}
        onChange={(e) => setEditor({ softProofIntent: e.target.value as 'perceptual' | 'relative' | 'absolute' })}
        data-tooltip={t('editor.softProof.intent' as any, { defaultValue: 'Rendering intent' })}
      >
        <option value="relative">
          {t('editor.softProof.relative' as any, { defaultValue: 'Relative' })}
        </option>
        <option value="perceptual">
          {t('editor.softProof.perceptual' as any, { defaultValue: 'Perceptual' })}
        </option>
        <option value="absolute">
          {t('editor.softProof.absolute' as any, { defaultValue: 'Absolute' })}
        </option>
      </select>
      <button
        type="button"
        onClick={() => setEditor({ softProofSimulatePaper: !softProofSimulatePaper })}
        className={clsx(
          'h-6 px-2 rounded text-[10px] uppercase tracking-wide border shrink-0',
          softProofSimulatePaper
            ? 'bg-amber-500/25 border-amber-400/40 text-amber-50'
            : 'bg-black/20 border-amber-500/20 text-amber-200/60 hover:bg-amber-500/15',
        )}
        data-tooltip={t('editor.softProof.paperTip' as any, {
          defaultValue: 'Simulate paper & ink',
        })}
      >
        {t('editor.softProof.paper' as any, { defaultValue: 'Paper' })}
      </button>
      <button
        type="button"
        onClick={() => setEditor({ softProofShowGamutWarning: !softProofShowGamutWarning })}
        className={clsx(
          'h-6 px-2 rounded text-[10px] uppercase tracking-wide border shrink-0',
          softProofShowGamutWarning
            ? 'bg-red-500/30 border-red-400/50 text-red-100'
            : 'bg-black/20 border-amber-500/20 text-amber-200/60 hover:bg-amber-500/15',
        )}
        data-tooltip={t('editor.softProof.gamutTip' as any, {
          defaultValue: 'Show destination gamut warning (approx.)',
        })}
      >
        {t('editor.softProof.gamut' as any, { defaultValue: 'Gamut' })}
      </button>
      <button
        type="button"
        onClick={() =>
          setEditor({
            beforeAfterSplit: !beforeAfterSplit,
            showOriginal: false,
          })
        }
        className={clsx(
          'h-6 px-2 rounded text-[10px] uppercase tracking-wide border shrink-0',
          beforeAfterSplit
            ? 'bg-amber-500/25 border-amber-400/40 text-amber-50'
            : 'bg-black/20 border-amber-500/20 text-amber-200/60 hover:bg-amber-500/15',
        )}
        data-tooltip={t('editor.softProof.baTip' as any, {
          defaultValue: 'Before / Proof split (\\)',
        })}
      >
        {t('editor.softProof.ba' as any, { defaultValue: 'B/A' })}
      </button>
      <button
        type="button"
        onClick={createProofCopy}
        disabled={!selectedImage}
        className="h-6 px-2 rounded text-[10px] uppercase tracking-wide border shrink-0 flex items-center gap-1 bg-black/20 border-amber-500/25 text-amber-100/90 hover:bg-amber-500/20 disabled:opacity-40"
        data-tooltip={t('editor.softProof.createProofCopyTip' as any, {
          defaultValue: 'Create virtual copy tagged with proof profile (LR Create Proof Copy)',
        })}
      >
        <CopyPlus size={12} />
        <span className="hidden sm:inline">
          {t('editor.softProof.createProofCopy' as any, { defaultValue: 'Proof Copy' })}
        </span>
      </button>
      <span
        className="hidden md:inline-flex items-center gap-1 px-1.5 h-5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 border border-amber-400/25 text-amber-100/80 shrink-0"
        data-tooltip={t('editor.softProof.simTip' as any, {
          defaultValue:
            'Approximate CSS soft-proof (not full ICC). Useful for layout/intent preview only.',
        })}
      >
        {t('editor.softProof.sim' as any, { defaultValue: 'Sim' })}
      </span>
      <span className="text-[10px] text-amber-200/40 hidden xl:inline truncate max-w-[14rem]">
        {softProofProfile || 'sRGB'}
        {' · '}
        {softProofIntent || 'relative'}
        {softProofSimulatePaper ? ' · paper' : ''}
        {softProofShowGamutWarning ? ' · gamut' : ''}
      </span>
      <button
        type="button"
        className="ml-auto text-[10px] uppercase tracking-wide px-2 h-6 rounded hover:bg-amber-500/20 shrink-0"
        onClick={() => setEditor({ softProofing: false })}
      >
        {t('editor.softProof.close' as any, { defaultValue: 'Close' })}
      </button>
    </div>
  );
}
