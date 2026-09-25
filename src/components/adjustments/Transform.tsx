import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
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
    {
      value: 5,
      label: t('adjustments.transform.uprightGuided' as any, { defaultValue: 'Guided' }),
    },
  ];

  return (
    <div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
        {t('adjustments.transform.upright' as any)}
      </div>
      <div className="flex flex-wrap gap-0.5 mb-2">
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
                if (m.value === 5) {
                  setEditor({
                    isGuidedUprightActive: true,
                    isStraightenActive: false,
                    isPointColorPickerActive: false,
                    isWbPickerActive: false,
                  });
                } else {
                  setEditor({ isGuidedUprightActive: false });
                }
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {upright === 5 && (
        <div className="mb-2 space-y-1 rounded border border-border-color/40 bg-surface/40 p-1.5">
          <button
            type="button"
            className={`w-full px-2 py-1 rounded text-[10px] uppercase tracking-wide transition-colors ${
              isGuidedUprightActive
                ? 'bg-accent text-button-text'
                : 'bg-card-active text-text-primary hover:opacity-90'
            }`}
            onClick={() => {
              setEditor({
                isGuidedUprightActive: !isGuidedUprightActive,
                isStraightenActive: false,
                isPointColorPickerActive: false,
                isWbPickerActive: false,
              });
            }}
          >
            {t('adjustments.transform.drawGuides' as any, { defaultValue: 'Draw guides on image' })}
          </button>
          <p className="text-[9px] text-text-secondary/70 leading-snug">
            {t('adjustments.transform.guidedHint' as any, {
              defaultValue:
                'Draw 1–2 lines along edges that should be horizontal or vertical. Geometry is estimated from the guides.',
            })}
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              className="flex-1 px-1.5 py-0.5 rounded text-[9px] bg-surface hover:bg-card-active text-text-secondary"
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
              {t('adjustments.transform.clearGuides' as any, { defaultValue: 'Clear guides' })}
            </button>
            <span className="text-[9px] text-text-secondary/60 self-center tabular-nums">
              {Array.isArray((adjustments as any).guidedUprightLines)
                ? (adjustments as any).guidedUprightLines.length
                : 0}
              /2
            </span>
          </div>
        </div>
      )}
      <div className="mb-2">
        <Switch
          label={t('adjustments.transform.constrainToWarp' as any)}
          checked={!!(adjustments as any).cropConstrainToWarp}
          onChange={(v: boolean) => set('cropConstrainToWarp', v)}
        />
      </div>
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
        {t('adjustments.transform.geometry' as any)}
      </div>
      <Slider
        label={t('adjustments.transform.distortion' as any)}
        min={-100}
        max={100}
        step={1}
        value={adjustments.transformDistortion ?? 0}
        onChange={(e) => set(TransformAdjustment.TransformDistortion, num(e))}
        onDragStateChange={onDragStateChange}
      />
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
