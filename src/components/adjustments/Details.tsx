import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import { Adjustments, DetailsAdjustment } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface DetailsPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function DetailsPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  onDragStateChange,
}: DetailsPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-1">
      {adjustmentVisibility.sharpening !== false && (
        <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
          <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
            {t('adjustments.details.sharpening')}
          </Text>
          <Slider
            label={t('adjustments.details.sharpness')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Sharpness, e.target.value)}
            step={1}
            value={adjustments.sharpness}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <Slider
                label={t('adjustments.details.radius' as any)}
                max={3}
                min={0.5}
                onChange={(e: any) => handleAdjustmentChange('sharpenRadius', e.target.value)}
                step={0.1}
                value={(adjustments as any).sharpenRadius ?? 1.0}
                onDragStateChange={onDragStateChange}
                defaultValue={1}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.sharpenDetail' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('sharpenDetail', e.target.value)}
                step={1}
                value={(adjustments as any).sharpenDetail ?? 25}
                onDragStateChange={onDragStateChange}
                defaultValue={25}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.masking' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('sharpenMasking', e.target.value)}
                step={1}
                value={(adjustments as any).sharpenMasking ?? 0}
                onDragStateChange={onDragStateChange}
                defaultValue={0}
                fillOrigin="min"
              />
            </>
          )}
          <Slider
            label={t('adjustments.details.threshold')}
            max={80}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.SharpnessThreshold, e.target.value)}
            step={1}
            value={adjustments.sharpnessThreshold ?? 15}
            onDragStateChange={onDragStateChange}
            defaultValue={15}
            fillOrigin="min"
          />
        </div>
      )}

      {adjustmentVisibility.presence !== false && (
        <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
          <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
            {t('adjustments.details.presence')}
          </Text>
          <Slider
            label={t('adjustments.details.texture' as any, { defaultValue: 'Texture' })}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Structure, e.target.value)}
            step={1}
            value={adjustments.structure}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Clarity, e.target.value)}
            step={1}
            value={adjustments.clarity}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Dehaze, e.target.value)}
            step={1}
            value={adjustments.dehaze}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <Slider
              label={t('adjustments.details.centre')}
              max={100}
              min={-100}
              onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Centré, e.target.value)}
              step={1}
              value={adjustments.centré}
              onDragStateChange={onDragStateChange}
            />
          )}
        </div>
      )}

      {adjustmentVisibility.noiseReduction !== false && (
        <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
          <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
            {t('adjustments.details.noiseReduction')}
          </Text>
          <Slider
            label={t('adjustments.details.luminance')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.LumaNoiseReduction, e.target.value)}
            step={1}
            value={adjustments.lumaNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <Slider
                label={t('adjustments.details.luminanceDetail' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('lumaNoiseDetail', e.target.value)}
                step={1}
                value={(adjustments as any).lumaNoiseDetail ?? 50}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.luminanceContrast' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('lumaNoiseContrast', e.target.value)}
                step={1}
                value={(adjustments as any).lumaNoiseContrast ?? 0}
                onDragStateChange={onDragStateChange}
                defaultValue={0}
                fillOrigin="min"
              />
            </>
          )}
          <Slider
            label={t('adjustments.details.color')}
            max={100}
            min={isForMask ? -100 : 0}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.ColorNoiseReduction, e.target.value)}
            step={1}
            value={adjustments.colorNoiseReduction}
            onDragStateChange={onDragStateChange}
          />
          {!isForMask && (
            <>
              <Slider
                label={t('adjustments.details.colorDetail' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('colorNoiseDetail', e.target.value)}
                step={1}
                value={(adjustments as any).colorNoiseDetail ?? 50}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.details.colorSmoothness' as any)}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange('colorNoiseSmoothness', e.target.value)}
                step={1}
                value={(adjustments as any).colorNoiseSmoothness ?? 50}
                onDragStateChange={onDragStateChange}
                defaultValue={50}
                fillOrigin="min"
              />
            </>
          )}
        </div>
      )}

      {!isForMask && adjustmentVisibility.chromaticAberration !== false && (
        <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
          <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
            {t('adjustments.details.chromaticAberration')}
          </Text>
          <Slider
            label={t('adjustments.details.redCyan')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationRedCyan, e.target.value)}
            step={1}
            value={adjustments.chromaticAberrationRedCyan}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.blueYellow')}
            max={100}
            min={-100}
            onChange={(e: any) =>
              handleAdjustmentChange(DetailsAdjustment.ChromaticAberrationBlueYellow, e.target.value)
            }
            step={1}
            value={adjustments.chromaticAberrationBlueYellow}
            onDragStateChange={onDragStateChange}
          />
        </div>
      )}
    </div>
  );
}
