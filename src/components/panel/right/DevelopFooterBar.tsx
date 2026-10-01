import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { INITIAL_ADJUSTMENTS } from '../../../utils/adjustments';
import { useEditorStore } from '../../../store/useEditorStore';

/** Lightroom Develop right-rail footer: Previous (undo) + Reset to original. */
export default function DevelopFooterBar() {
  const { t } = useTranslation();
  const { historyIndex, selectedImage, undo, pushHistory, setEditor } = useEditorStore(
    useShallow((s) => ({
      historyIndex: s.historyIndex,
      selectedImage: s.selectedImage,
      undo: s.undo,
      pushHistory: s.pushHistory,
      setEditor: s.setEditor,
    })),
  );

  const canUndo = historyIndex > 0 && !!selectedImage;
  const canReset = !!selectedImage;

  const handleReset = () => {
    if (!selectedImage) return;
    const aspect =
      selectedImage.width && selectedImage.height ? selectedImage.width / selectedImage.height : null;
    const resetData = {
      ...INITIAL_ADJUSTMENTS,
      aspectRatio: aspect,
      aiPatches: [] as any[],
    };
    setEditor({ adjustments: resetData });
    pushHistory(resetData);
  };

  const btn =
    'flex h-8 w-full min-w-0 items-center justify-center px-2 text-center text-[12px] text-text-primary bg-surface/80 hover:bg-card-active disabled:opacity-40 disabled:hover:bg-surface/80 border-border-color/40';

  return (
    <div className="grid w-full shrink-0 grid-cols-2 border-t border-border-color/50">
      <button
        type="button"
        className={`${btn} border-r`}
        disabled={!canUndo}
        onClick={() => undo()}
        data-tooltip="Ctrl+Z"
      >
        {t('editor.adjustments.rightFooter.previous' as any, { defaultValue: 'Previous' })}
      </button>
      <button
        type="button"
        className={btn}
        disabled={!canReset}
        onClick={handleReset}
        data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
      >
        {t('editor.adjustments.rightFooter.reset' as any, { defaultValue: 'Reset' })}
      </button>
    </div>
  );
}
