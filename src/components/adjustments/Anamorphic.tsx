import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import { Adjustments } from '../../utils/adjustments';
import {
  ANAMORPHIC_MAX,
  ANAMORPHIC_MIN,
  ANAMORPHIC_PRESETS,
  anamorphicSqueezeOf,
  isAnamorphicPreset,
} from '../../utils/anamorphic';

interface AnamorphicPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function AnamorphicPanel({
  adjustments,
  setAdjustments,
  onDragStateChange,
}: AnamorphicPanelProps) {
  const { t } = useTranslation();
  const squeeze = anamorphicSqueezeOf((adjustments as any).anamorphicSqueeze);
  const custom = squeeze > 1.01 && !isAnamorphicPreset(squeeze);

  const setSqueeze = (ratio: number) => {
    const next = anamorphicSqueezeOf(ratio);
    setAdjustments((prev) => ({ ...prev, anamorphicSqueeze: next }));
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] leading-5 text-text-secondary">
        {t('adjustments.anamorphic.hint' as any, {
          defaultValue: 'Unsqueeze a squeezed anamorphic capture by stretching width.',
        })}
      </p>
      <div className="flex flex-wrap gap-0.5">
        {ANAMORPHIC_PRESETS.map((p) => {
          const active = !custom && Math.abs(squeeze - p.ratio) < 0.005;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setSqueeze(p.ratio)}
              className={clsx(
                'px-1.5 py-1 min-h-[28px] rounded text-[11px] leading-5 font-medium',
                active
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface',
              )}
            >
              {p.id === 'off'
                ? t('adjustments.anamorphic.off' as any, { defaultValue: 'Off' })
                : p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSqueeze(custom ? squeeze : 1.8)}
          className={clsx(
            'px-1.5 py-1 min-h-[28px] rounded text-[11px] leading-5 font-medium',
            custom
              ? 'bg-card-active text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface',
          )}
        >
          {t('adjustments.anamorphic.custom' as any, { defaultValue: 'Custom' })}
        </button>
      </div>
      {custom && (
        <Slider
          label={t('adjustments.anamorphic.ratio' as any, { defaultValue: 'Ratio' })}
          min={ANAMORPHIC_MIN}
          max={ANAMORPHIC_MAX}
          step={0.01}
          defaultValue={1}
          value={squeeze}
          onChange={(e) => setSqueeze(Number(e.target.value))}
          onDragStateChange={onDragStateChange}
          fillOrigin="min"
        />
      )}
    </div>
  );
}
