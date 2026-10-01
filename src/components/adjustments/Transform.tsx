import Slider from '../ui/Slider';
import { Adjustments, TransformAdjustment } from '../../utils/adjustments';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';

interface TransformPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function TransformPanel({ adjustments, setAdjustments, onDragStateChange }: TransformPanelProps) {
  const { t } = useTranslation();
  const isGuidedUprightActive = useEditorStore((s) => s.isGuidedUprightActive);
  const setEditor = useEditorStore((s) => s.setEditor);

  const set = (key: string, value: number | boolean) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };
  const num = (e: any) => parseFloat(e.target.value);

  const upright = Number((adjustments as any).perspectiveUpright ?? 0);
  const uprightModes: { value: number; label: string }[] = [
    { value: 0, label: t('adjustments.transform.uprightOff' as any) },
    { value: 1, label: t('adjustments.transform.uprightAuto' as any) },
    { value: 2, label: t('adjustments.transform.uprightLevel' as any) },
    { value: 3, label: t('adjustments.transform.uprightVertical' as any) },
    { value: 4, label: t('adjustments.transform.uprightFull' as any) },
  ];
  const guideCount = Array.isArray((adjustments as any).guidedUprightLines)
    ? (adjustments as any).guidedUprightLines.length
    : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-2">
        <button
          type="button"
          aria-pressed={isGuidedUprightActive}
          title={t('adjustments.transform.drawGuides' as any, { defaultValue: 'Place guides' })}
          className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
            isGuidedUprightActive
              ? 'bg-card-active border-text-primary/70 text-text-primary'
              : 'bg-surface border-border-color text-text-secondary hover:bg-card-active hover:text-text-primary'
          }`}
          onClick={() => {
            const next = !isGuidedUprightActive;
            setEditor({
              isGuidedUprightActive: next,
              isStraightenActive: false,
              isPointColorPickerActive: false,
              isWbPickerActive: false,
            });
            if (next) set('perspectiveUpright', 5);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M7 1.1v3.1M7 9.8v3.1M1.1 7h3.1M9.8 7h3.1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
          </svg>
        </button>
        {uprightModes.map((m) => {
          const active = upright === m.value;
          return (
            <button
              key={m.value}
              type="button"
              className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide transition-colors ${
                active
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface/80'
              }`}
              onClick={() => {
                set('perspectiveUpright', m.value);
                setEditor({ isGuidedUprightActive: false });
              }}
            >
              {m.label}
            </button>
          );
        })}
        {guideCount > 0 && (
          <button
            type="button"
            className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide text-text-secondary hover:text-text-primary hover:bg-surface/80"
            onClick={() =>
              setAdjustments((prev) => ({
                ...prev,
                guidedUprightLines: [],
                transformVertical: 0,
                transformHorizontal: 0,
                transformRotate: 0,
              }))
            }
          >
            {t('adjustments.transform.clearGuides' as any, { defaultValue: 'Clear' })}
          </button>
        )}
      </div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
        {t('adjustments.transform.geometry' as any)}
      </div>
      <Slider
        label={t('adjustments.transform.vertical' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformVertical ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformVertical, num(e))}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.transform.horizontal' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformHorizontal ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformHorizontal, num(e))}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.transform.rotate' as any)}
        min={-10}
        max={10}
        step={0.1}
        value={adjustments.transformRotate ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformRotate, num(e))}
        onDragStateChange={onDragStateChange}
      />
      <div className="mt-1.5 mb-0.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
        {t('adjustments.transform.aspectScale' as any)}
      </div>
      <Slider
        label={t('adjustments.transform.aspect' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformAspect ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformAspect, num(e))}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.transform.scale' as any)}
        min={50}
        max={150}
        step={1}
        value={adjustments.transformScale ?? 100}
        onChange={(e) => set(TransformAdjustment.TransformScale, num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={100}
      />
      <Slider
        label={t('adjustments.transform.xOffset' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformXOffset ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformXOffset, num(e))}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.transform.yOffset' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformYOffset ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformYOffset, num(e))}
        onDragStateChange={onDragStateChange}
      />
    </div>
  );
}
