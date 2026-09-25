import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import { Adjustments, LensAdjustment } from '../../utils/adjustments';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface LensPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments> | ((prev: Adjustments) => Adjustments)): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function LensPanel({ adjustments, setAdjustments, onDragStateChange }: LensPanelProps) {
  const { t } = useTranslation();

  const set = (key: string, value: any) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  };

  const num = (e: any) => parseFloat(e.target.value);
  const adj: any = adjustments;

  return (
    <div className="space-y-1">
      <Text variant={TextVariants.small} className="text-text-secondary uppercase tracking-wide text-[10px] mb-1">
        {t('adjustments.lens.profile' as any)}
      </Text>
      {adj.lensProfileName ? (
        <div
          className="mb-1 px-2 py-1 rounded bg-bg-tertiary text-[10px] text-text-secondary truncate"
          title={String(adj.lensProfileName)}
        >
          {String(adj.lensProfileName)}
        </div>
      ) : null}
      {adj.lensProfileSetup ? (
        <div className="mb-1 text-[9px] uppercase tracking-wide text-text-secondary/70 truncate" title={String(adj.lensProfileSetup)}>
          {String(adj.lensProfileSetup)}
        </div>
      ) : null}
      {adj.lensProfileFilename ? (
        <div className="mb-1 text-[9px] text-text-secondary/60 truncate" title={String(adj.lensProfileFilename)}>
          {String(adj.lensProfileFilename).split(/[/\\]/).pop()}
        </div>
      ) : null}
      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
        {t('adjustments.lens.processVersion' as any, { defaultValue: 'Process Version' })}
      </div>
      <div className="flex flex-wrap gap-0.5 mb-2">
        {(
          [
            ['5.0', '2010'],
            ['6.7', '2012'],
            ['11.0', '2015+'],
            ['15.4', 'v15'],
          ] as const
        ).map(([value, label]) => {
          const cur = String(adj.processVersion || '11.0');
          const isOn = cur === value;
          return (
            <button
              key={value}
              type="button"
              className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide transition-colors ${
                isOn
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface/80'
              }`}
              onClick={() => set('processVersion', value)}
              data-tooltip={t('adjustments.lens.processVersionTip' as any, {
                defaultValue: 'crs:ProcessVersion for XMP interop ({{v}})',
                v: value,
              })}
            >
              PV {label}
            </button>
          );
        })}
      </div>
      {adj.processVersion ? (
        <div className="mb-1 text-[9px] text-text-secondary/60 font-mono truncate" title={String(adj.processVersion)}>
          {String(adj.processVersion)}
        </div>
      ) : null}
      {/* LR Optics: Enable Profile Corrections (drives distortion + vignette flags / crs:LensProfileEnable) */}
      <Switch
        label={t('adjustments.lens.enableProfileCorrections' as any, {
          defaultValue: 'Enable Profile Corrections',
        })}
        checked={!!(adjustments.lensDistortionEnabled || adjustments.lensVignetteEnabled)}
        onChange={(v: boolean) => {
          set(LensAdjustment.LensDistortionEnabled, v);
          set(LensAdjustment.LensVignetteEnabled, v);
        }}
      />
      <div className="pl-2 border-l border-border-color/25 space-y-0.5 mb-1">
        <Switch
          label={t('adjustments.lens.enableDistortion' as any)}
          checked={!!adjustments.lensDistortionEnabled}
          onChange={(v: boolean) => set(LensAdjustment.LensDistortionEnabled, v)}
        />
        <Switch
          label={t('adjustments.lens.enableVignette' as any)}
          checked={!!adjustments.lensVignetteEnabled}
          onChange={(v: boolean) => set(LensAdjustment.LensVignetteEnabled, v)}
        />
      </div>
      <Switch
        label={t('adjustments.lens.removeChromaticAberration' as any, {
          defaultValue: 'Remove Chromatic Aberration',
        })}
        checked={!!adjustments.lensTcaEnabled}
        onChange={(v: boolean) => set(LensAdjustment.LensTcaEnabled, v)}
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
      <Slider
        label={t('adjustments.lens.tca' as any)}
        min={0}
        max={200}
        step={1}
        value={adjustments.lensTcaAmount ?? 100}
        onChange={(e) => set(LensAdjustment.LensTcaAmount, num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={100}
      />

      {(adj.lensProfileName || adj.lensProfileDistortionScale != null || adj.lensProfileVignettingScale != null) && (
        <>
          <Text
            variant={TextVariants.small}
            className="text-text-secondary uppercase tracking-wide text-[10px] mt-2 mb-1"
          >
            {t('adjustments.lens.profileScale' as any)}
          </Text>
          <Slider
            label={t('adjustments.lens.profileDistortionScale' as any)}
            min={0}
            max={200}
            step={1}
            value={adj.lensProfileDistortionScale ?? 100}
            onChange={(e) => set('lensProfileDistortionScale', num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={100}
          />
          <Slider
            label={t('adjustments.lens.profileVignetteScale' as any)}
            min={0}
            max={200}
            step={1}
            value={adj.lensProfileVignettingScale ?? 100}
            onChange={(e) => set('lensProfileVignettingScale', num(e))}
            onDragStateChange={onDragStateChange}
            defaultValue={100}
          />
        </>
      )}

      <Text
        variant={TextVariants.small}
        className="text-text-secondary uppercase tracking-wide text-[10px] mt-2 mb-1"
      >
        {t('adjustments.lens.manualCa' as any)}
      </Text>
      <Slider
        label={t('adjustments.details.redCyan' as any)}
        min={-100}
        max={100}
        step={1}
        value={adj.chromaticAberrationRedCyan ?? 0}
        onChange={(e) => set('chromaticAberrationRedCyan', num(e))}
        onDragStateChange={onDragStateChange}
      />
      <Slider
        label={t('adjustments.details.blueYellow' as any)}
        min={-100}
        max={100}
        step={1}
        value={adj.chromaticAberrationBlueYellow ?? 0}
        onChange={(e) => set('chromaticAberrationBlueYellow', num(e))}
        onDragStateChange={onDragStateChange}
      />

      {/* Defringe (maps to crs:Defringe* — classic Optics panel) */}
      <Text
        variant={TextVariants.small}
        className="text-text-secondary uppercase tracking-wide text-[10px] mt-2 mb-1"
      >
        {t('adjustments.lens.defringe' as any)}
      </Text>
      <Slider
        label={t('adjustments.lens.defringePurple' as any)}
        min={0}
        max={20}
        step={1}
        value={adj.defringePurpleAmount ?? 0}
        onChange={(e) => set('defringePurpleAmount', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={0}
        fillOrigin="min"
      />
      <Slider
        label={t('adjustments.lens.defringePurpleHueLo' as any)}
        min={0}
        max={90}
        step={1}
        value={adj.defringePurpleHueLo ?? 30}
        onChange={(e) => set('defringePurpleHueLo', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={30}
        fillOrigin="min"
      />
      <Slider
        label={t('adjustments.lens.defringePurpleHueHi' as any)}
        min={0}
        max={90}
        step={1}
        value={adj.defringePurpleHueHi ?? 70}
        onChange={(e) => set('defringePurpleHueHi', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={70}
        fillOrigin="min"
      />
      <Slider
        label={t('adjustments.lens.defringeGreen' as any)}
        min={0}
        max={20}
        step={1}
        value={adj.defringeGreenAmount ?? 0}
        onChange={(e) => set('defringeGreenAmount', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={0}
        fillOrigin="min"
      />
      <Slider
        label={t('adjustments.lens.defringeGreenHueLo' as any)}
        min={0}
        max={100}
        step={1}
        value={adj.defringeGreenHueLo ?? 40}
        onChange={(e) => set('defringeGreenHueLo', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={40}
        fillOrigin="min"
      />
      <Slider
        label={t('adjustments.lens.defringeGreenHueHi' as any)}
        min={0}
        max={100}
        step={1}
        value={adj.defringeGreenHueHi ?? 60}
        onChange={(e) => set('defringeGreenHueHi', num(e))}
        onDragStateChange={onDragStateChange}
        defaultValue={60}
        fillOrigin="min"
      />
    </div>
  );
}
