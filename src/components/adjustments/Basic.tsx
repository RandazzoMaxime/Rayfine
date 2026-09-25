import clsx from 'clsx';
import { Pipette } from 'lucide-react';
import Slider from '../ui/Slider';
import { Adjustments, BasicAdjustment, ColorAdjustment, DetailsAdjustment } from '../../utils/adjustments';
import { useTranslation } from 'react-i18next';

interface BasicAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
  appSettings?: any;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
}

const WB_PRESETS: Record<string, { temperature: number; tint: number } | null> = {
  // RapidRAW temp/tint are relative to as-shot (approx. −100…+100): named illuminants are gentle offsets.
  'As Shot': { temperature: 0, tint: 0 },
  Auto: { temperature: 0, tint: 0 },
  Daylight: { temperature: 5, tint: 2 },
  Cloudy: { temperature: 18, tint: 5 },
  Shade: { temperature: 32, tint: 8 },
  Tungsten: { temperature: -55, tint: -8 },
  Fluorescent: { temperature: -22, tint: 28 },
  Flash: { temperature: 8, tint: 0 },
  Custom: null,
};

const CAMERA_PROFILES = [
  'Adobe Standard',
  'Camera Standard',
  'Camera Landscape',
  'Camera Portrait',
  'Camera Vivid',
  'Camera Neutral',
  'Camera Faithful',
  'Embedded',
];

function RowSelect({
  label,
  value,
  options,
  onChange,
  children,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="w-16 shrink-0 text-xs text-text-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 h-7 px-1.5 rounded bg-surface border border-border-color/40 text-xs text-text-primary outline-none focus:border-white/30"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {children}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 mb-0.5 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">{children}</div>
  );
}

export default function BasicAdjustments({
  adjustments,
  setAdjustments,
  isForMask = false,
  onDragStateChange,
  appSettings,
  isWbPickerActive = false,
  toggleWbPicker,
}: BasicAdjustmentsProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: BasicAdjustment | ColorAdjustment | string, value: any) => {
    const numericValue = parseFloat(value);
    setAdjustments((prev: Partial<Adjustments>) => {
      const next: Partial<Adjustments> = { ...prev, [key]: numericValue };
      // Moving temp/tint leaves named illuminant → Custom (LR behavior)
      if (
        key === ColorAdjustment.Temperature ||
        key === ColorAdjustment.Tint ||
        key === 'temperature' ||
        key === 'tint'
      ) {
        (next as any).whiteBalance = 'Custom';
      }
      return next;
    });
  };

  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;
  const isBlackAndWhite = !!(adjustments as any).convertToGrayscale;
  const setTreatment = (bw: boolean) =>
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      convertToGrayscale: bw,
      saturation: bw ? -100 : prev.saturation === -100 ? 0 : prev.saturation,
    }));

  const currentWb = String((adjustments as any).whiteBalance || 'As Shot');
  const wbValue = Object.keys(WB_PRESETS).find((k) => k.toLowerCase() === currentWb.toLowerCase()) || 'Custom';
  const currentProfile = String((adjustments as any).cameraProfile || 'Adobe Standard');

  return (
    <div>
      {/* Lightroom Classic Basic: Treatment · Profile · WB → Tone → Presence */}
      {!isForMask && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-16 shrink-0 text-xs text-text-secondary">
              {t('adjustments.basic.treatment' as any, { defaultValue: 'Treatment' })}
            </span>
            <div className="flex flex-1 rounded bg-surface border border-border-color/40 p-0.5">
              {[
                [false, t('adjustments.basic.treatmentColor' as any, { defaultValue: 'Color' })],
                [true, t('adjustments.basic.blackAndWhite' as any)],
              ].map(([bw, label]) => (
                <button
                  key={String(bw)}
                  type="button"
                  onClick={() => setTreatment(bw as boolean)}
                  className={clsx(
                    'flex-1 h-6 rounded text-[11px] transition-colors',
                    isBlackAndWhite === bw
                      ? 'bg-card-active text-text-primary'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {label as string}
                </button>
              ))}
            </div>
          </div>

          <RowSelect
            label={t('adjustments.color.cameraProfile' as any, { defaultValue: 'Profile' })}
            value={CAMERA_PROFILES.find((p) => p.toLowerCase() === currentProfile.toLowerCase()) || CAMERA_PROFILES[0]}
            options={CAMERA_PROFILES}
            onChange={(name) => setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, cameraProfile: name }))}
          />

          <RowSelect
            label={t('adjustments.color.wbShort' as any, { defaultValue: 'WB' })}
            value={wbValue}
            options={Object.keys(WB_PRESETS)}
            onChange={(name) =>
              setAdjustments((prev: Partial<Adjustments>) => {
                const off = WB_PRESETS[name];
                return {
                  ...prev,
                  whiteBalance: name,
                  temperature: off ? off.temperature : (prev.temperature ?? 0),
                  tint: off ? off.tint : (prev.tint ?? 0),
                };
              })
            }
          >
            {toggleWbPicker && (
              <button
                type="button"
                onClick={toggleWbPicker}
                disabled={isWgpuEnabled}
                className={clsx(
                  'h-7 w-7 shrink-0 flex items-center justify-center rounded transition-colors',
                  isWgpuEnabled
                    ? 'cursor-not-allowed text-text-secondary/40'
                    : isWbPickerActive
                      ? 'bg-accent text-button-text'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary',
                )}
                data-tooltip={
                  isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
                }
              >
                <Pipette size={14} />
              </button>
            )}
          </RowSelect>
          <Slider
            label={t('adjustments.color.temperature')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Temperature, e.target.value)}
            step={1}
            value={adjustments.temperature || 0}
            onDragStateChange={onDragStateChange}
            trackClassName="temperature-gradient-track"
          />
          <Slider
            label={t('adjustments.color.tint')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Tint, e.target.value)}
            step={1}
            value={adjustments.tint || 0}
            onDragStateChange={onDragStateChange}
            trackClassName="tint-gradient-track"
          />
        </>
      )}

      <SubHeading>{t('adjustments.basic.tone' as any)}</SubHeading>
      <Slider
        label={t('adjustments.basic.exposure')}
        max={5}
        min={-5}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Brightness, e.target.value)}
        step={0.01}
        value={adjustments.brightness}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.basic.contrast')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Contrast, e.target.value)}
        step={1}
        value={adjustments.contrast}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.basic.highlights')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Highlights, e.target.value)}
        step={1}
        value={adjustments.highlights}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.basic.shadows')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Shadows, e.target.value)}
        step={1}
        value={adjustments.shadows}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.basic.whites')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Whites, e.target.value)}
        step={1}
        value={adjustments.whites}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.basic.blacks')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Blacks, e.target.value)}
        step={1}
        value={adjustments.blacks}
        onDragStateChange={onDragStateChange}
      />

      {!isForMask && (
        <>
          <SubHeading>{t('adjustments.basic.presence' as any)}</SubHeading>
          {/* LR Basic Presence order: Texture → Clarity → Dehaze (structure maps to crs:Texture) */}
          <Slider
            label={t('adjustments.details.texture' as any, { defaultValue: 'Texture' })}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Structure, e.target.value)}
            step={1}
            value={adjustments.structure ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.clarity')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Clarity, e.target.value)}
            step={1}
            value={adjustments.clarity ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.details.dehaze')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(DetailsAdjustment.Dehaze, e.target.value)}
            step={1}
            value={adjustments.dehaze ?? 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.color.vibrance')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Vibrance, e.target.value)}
            step={1}
            value={adjustments.vibrance || 0}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.color.saturation')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Saturation, e.target.value)}
            step={1}
            value={adjustments.saturation || 0}
            onDragStateChange={onDragStateChange}
          />
        </>
      )}
    </div>
  );
}
