import { useState } from 'react';
import clsx from 'clsx';
import Slider from '../ui/Slider';
import { Adjustments, LensAdjustment, TransformAdjustment } from '../../utils/adjustments';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import LensCorrectionModal from '../modals/LensCorrectionModal';
import { useEditorStore } from '../../store/useEditorStore';

interface LensPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

const LATEST_PROCESS_VERSION = '15.4';

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex items-center gap-2 py-1 min-h-[28px] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded-sm accent-accent shrink-0"
      />
      <span className="text-[11px] leading-5 text-text-primary">{label}</span>
    </label>
  );
}

/** Two thumbs on one hue ramp — Lightroom Optics Manual (Teinte violette / verte). */
function DualHueSlider({
  label,
  lo,
  hi,
  min,
  max,
  gradient,
  onChange,
  onDragStateChange,
}: {
  label: string;
  lo: number;
  hi: number;
  min: number;
  max: number;
  gradient: string;
  onChange(next: { lo: number; hi: number }): void;
  onDragStateChange?: (isDragging: boolean) => void;
}) {
  const span = max - min || 1;
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;
  const setLo = (raw: number) => onChange({ lo: Math.min(raw, hi), hi });
  const setHi = (raw: number) => onChange({ lo, hi: Math.max(raw, lo) });
  const thumb =
    'absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow slider-input';
  return (
    <div className="mb-0.5 grid grid-cols-[7.25rem_minmax(0,1fr)_2.75rem] items-center gap-x-1 min-h-[28px] py-1">
      <div className="min-w-0 text-right">
        <span className="text-[11px] font-medium text-text-primary leading-5 py-px truncate select-none">{label}</span>
      </div>
      <div className="relative h-5">
        <div
          className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ background: gradient }}
        />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ring-1 ring-white/70 pointer-events-none"
          style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))}
          onMouseDown={() => onDragStateChange?.(true)}
          onMouseUp={() => onDragStateChange?.(false)}
          className={thumb}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          onMouseDown={() => onDragStateChange?.(true)}
          onMouseUp={() => onDragStateChange?.(false)}
          className={thumb}
        />
      </div>
      <div className="min-w-0 text-right tabular-nums whitespace-nowrap text-[11px] leading-5 text-text-primary">
        {Math.round(lo)}/{Math.round(hi)}
      </div>
    </div>
  );
}

export default function LensPanel({ adjustments, setAdjustments, onDragStateChange }: LensPanelProps) {
  const { t } = useTranslation();
  const adj: any = adjustments;
  const [tab, setTab] = useState<'profile' | 'manual'>('profile');
  const [isCorrectionModalOpen, setCorrectionModalOpen] = useState(false);
  const selectedImage = useEditorStore((s) => s.selectedImage);

  const set = (key: string, value: any) => {
    const extra = key === 'processVersion' ? {} : { processVersion: LATEST_PROCESS_VERSION };
    setAdjustments((prev) => ({ ...prev, ...extra, [key]: value }));
  };
  const num = (e: any) => parseFloat(e.target.value);
  const headingFirst =
    'text-center text-text-primary/80 tracking-wide text-[10px] leading-5 mb-1 mt-0.5';
  const heading =
    'text-center text-text-primary/80 tracking-wide text-[10px] leading-5 mb-1 mt-2 pt-1.5 border-t border-border-color/40';

  return (
    <div className="space-y-1">
      <div className="flex text-[11px] font-medium mb-1.5 border-b border-border-color/40">
        {(
          [
            ['profile', t('adjustments.lens.tabProfile' as any, { defaultValue: 'Profile' })],
            ['manual', t('adjustments.lens.tabManual' as any, { defaultValue: 'Manual' })],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={clsx(
              'flex-1 py-1 border-b-2 -mb-px',
              tab === id
                ? 'border-text-primary text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <button
            type="button"
            className="w-full mb-1 px-2 py-1 rounded border border-border-color/40 text-[10px] text-text-primary hover:bg-card-active"
            onClick={() => setCorrectionModalOpen(true)}
          >
            {t('adjustments.lens.configureProfile' as any, { defaultValue: 'Choisir le profil automatique ou manuel…' })}
          </button>
          {adj.lensProfileName ? (
            <div
              className="mb-1 px-2 py-1 rounded bg-bg-tertiary text-[10px] text-text-secondary truncate"
              title={String(adj.lensProfileName)}
            >
              {String(adj.lensProfileName)}
            </div>
          ) : null}
          <CheckRow
            label={t('adjustments.lens.enableProfileCorrections' as any, {
              defaultValue: 'Enable Profile Corrections',
            })}
            checked={!!(adjustments.lensDistortionEnabled || adjustments.lensVignetteEnabled)}
            onChange={(v) => {
              set(LensAdjustment.LensDistortionEnabled, v);
              set(LensAdjustment.LensVignetteEnabled, v);
            }}
          />
          <CheckRow
            label={t('adjustments.lens.removeChromaticAberration' as any, {
              defaultValue: 'Remove Chromatic Aberration',
            })}
            checked={!!adjustments.lensTcaEnabled}
            onChange={(v) => set(LensAdjustment.LensTcaEnabled, v)}
          />
          <Slider
            label={t('adjustments.lens.distortion' as any)}
            min={0}
            max={200}
            step={1}
            value={adjustments.lensDistortionAmount ?? 100}
            onChange={(e) => set(LensAdjustment.LensDistortionAmount, num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={100}
          />
          <Slider
            label={t('adjustments.lens.vignette' as any)}
            min={0}
            max={200}
            step={1}
            value={adjustments.lensVignetteAmount ?? 100}
            onChange={(e) => set(LensAdjustment.LensVignetteAmount, num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={100}
          />
        </>
      )}

      {tab === 'manual' && (
        <>
          <Text variant={TextVariants.small} className={headingFirst}>
            {t('adjustments.lens.manualDistortion' as any, { defaultValue: 'Distortion' })}
          </Text>
          <Slider
            label={t('adjustments.lens.distortionAmount' as any, { defaultValue: 'Amount' })}
            min={-100}
            max={100}
            step={1}
            value={adjustments.transformDistortion ?? 0}
            onChange={(e) => set(TransformAdjustment.TransformDistortion, num(e))}
            onDragStateChange={onDragStateChange}
          />

          <Text variant={TextVariants.small} className={heading}>
            {t('adjustments.lens.defringe' as any, { defaultValue: 'Defringe' })}
          </Text>
          <Slider
            label={t('adjustments.lens.defringeAmount' as any, { defaultValue: 'Amount' })}
            min={0}
            max={20}
            step={1}
            value={adj.defringePurpleAmount ?? 0}
            onChange={(e) => set('defringePurpleAmount', num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={0}
            fillOrigin="min"
          />
          <DualHueSlider
            label={t('adjustments.lens.defringePurpleHue' as any, { defaultValue: 'Purple Hue' })}
            lo={adj.defringePurpleHueLo ?? 30}
            hi={adj.defringePurpleHueHi ?? 70}
            min={0}
            max={90}
            gradient="linear-gradient(to right, #3b82f6, #a855f7, #ef4444)"
            onDragStateChange={onDragStateChange}
            onChange={({ lo, hi }) =>
              setAdjustments((prev) => ({
                ...prev,
                processVersion: LATEST_PROCESS_VERSION,
                defringePurpleHueLo: lo,
                defringePurpleHueHi: hi,
              }))
            }
          />
          <Slider
            label={t('adjustments.lens.defringeAmount' as any, { defaultValue: 'Amount' })}
            min={0}
            max={20}
            step={1}
            value={adj.defringeGreenAmount ?? 0}
            onChange={(e) => set('defringeGreenAmount', num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={0}
            fillOrigin="min"
          />
          <DualHueSlider
            label={t('adjustments.lens.defringeGreenHue' as any, { defaultValue: 'Green Hue' })}
            lo={adj.defringeGreenHueLo ?? 40}
            hi={adj.defringeGreenHueHi ?? 60}
            min={0}
            max={100}
            gradient="linear-gradient(to right, #22d3ee, #22c55e, #eab308)"
            onDragStateChange={onDragStateChange}
            onChange={({ lo, hi }) =>
              setAdjustments((prev) => ({
                ...prev,
                processVersion: LATEST_PROCESS_VERSION,
                defringeGreenHueLo: lo,
                defringeGreenHueHi: hi,
              }))
            }
          />

          <Text variant={TextVariants.small} className={heading}>
            {t('adjustments.lens.manualVignette' as any, { defaultValue: 'Vignetting' })}
          </Text>
          <Slider
            label={t('adjustments.lens.defringeAmount' as any, { defaultValue: 'Amount' })}
            min={-100}
            max={100}
            step={1}
            value={adj.lensManualVignetteAmount ?? 0}
            onChange={(e) => set('lensManualVignetteAmount', num(e))}
            onDragStateChange={onDragStateChange}
          />
          <Slider
            label={t('adjustments.lens.midpoint' as any, { defaultValue: 'Midpoint' })}
            min={0}
            max={100}
            step={1}
            defaultValue={50}
            value={adj.lensVignetteMidpoint ?? 50}
            onChange={(e) => set('lensVignetteMidpoint', num(e))}
            onDragStateChange={onDragStateChange}
            fillOrigin="min"
          />
        </>
      )}
      <LensCorrectionModal
        isOpen={isCorrectionModalOpen}
        onClose={() => setCorrectionModalOpen(false)}
        onApply={(nextParams: any) => setAdjustments((prev: any) => ({ ...prev, ...nextParams }))}
        currentAdjustments={adjustments}
        selectedImage={selectedImage as any}
      />
    </div>
  );
}
