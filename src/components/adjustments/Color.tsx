import { useState, useEffect, useMemo } from 'react';
import { Pipette, Sliders } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import ColorWheel from '../ui/ColorWheel';
import { ColorAdjustment, ColorCalibration, HueSatLum, INITIAL_ADJUSTMENTS } from '../../utils/adjustments';
import { Adjustments, ColorGrading } from '../../utils/adjustments';
import { AppSettings } from '../ui/AppProperties';
import { useEditorStore } from '../../store/useEditorStore';
import Text from '../ui/Text';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import { asShotKelvinFrom, kelvinToRelativeTemp, relativeTempToKelvin } from '../../utils/whiteBalance';

interface ColorProps {
  color: string;
  name: string;
  label: string;
}

interface ColorPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  appSettings: AppSettings | null;
  isForMask?: boolean;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
  onDragStateChange?: (isDragging: boolean) => void;
  panel?: 'mixer' | 'grading';
}

interface ColorSwatchProps {
  color: string;
  isActive: boolean;
  name: string;
  ariaLabel: string;
  onClick: (name: string) => void;
}

const ColorSwatch = ({ color, name, isActive, ariaLabel, onClick }: ColorSwatchProps) => {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseDown = () => {
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleMouseLeave = () => {
    setIsPressed(false);
    setIsHovered(false);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleClick = () => {
    onClick(name);
  };

  const getTransform = () => {
    if (isPressed) return 'scale(0.95)';
    if (isActive) return 'scale(1.1)';
    if (isHovered) return 'scale(1.08)';
    return 'scale(1)';
  };

  return (
    <button
      aria-label={ariaLabel}
      className="relative w-6 h-6 focus:outline-hidden group"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    >
      <div
        className={`absolute inset-0 rounded-full border-2 transition-all duration-200 ease-out ${
          isActive ? 'border-white opacity-100' : 'scale-100 border-transparent opacity-0'
        }`}
        style={{
          transform: isActive ? (isPressed ? 'scale(1.1)' : 'scale(1.25)') : undefined,
          transition: isPressed
            ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-out'
            : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out',
        }}
      />

      <div
        className={`absolute inset-0 rounded-full transition-all duration-150 ease-out ${
          isActive ? 'shadow-lg' : 'shadow-md'
        }`}
        style={{
          backgroundColor: color,
          transform: getTransform(),
          transition: isPressed
            ? 'transform 100ms cubic-bezier(0.4, 0, 0.2, 1)'
            : 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  );
};

export const ColorGradingPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'3way' | 'global'>('3way');
  const [isExpanded, setIsExpanded] = useState(false);
  const colorGrading = adjustments.colorGrading || INITIAL_ADJUSTMENTS.colorGrading;

  const handleChange = (grading: ColorGrading, newValue: HueSatLum) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorGrading: {
        ...(prev.colorGrading || INITIAL_ADJUSTMENTS.colorGrading),
        [grading]: newValue,
      },
    }));
  };

  const handleColorGradingSliderChange = (grading: ColorGrading, value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorGrading: {
        ...(prev.colorGrading || INITIAL_ADJUSTMENTS.colorGrading),
        [grading]: parseFloat(value),
      },
    }));
  };

  const tabs = useMemo(
    () => [
      {
        id: '3way',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="6" r="4.5" />
            <circle cx="5" cy="18" r="4.5" />
            <circle cx="19" cy="18" r="4.5" />
          </svg>
        ),
      },
      {
        id: 'global',
        icon: (
          <div className="w-3.5 h-3.5 rounded-full" style={{ background: 'linear-gradient(to top, #666, #fff)' }} />
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div className="flex items-center justify-start gap-2 mb-2 mt-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as '3way' | 'global')}
              className={`w-7 h-7 rounded-full flex items-center justify-center focus:outline-none
                ${
                  isActive
                    ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent text-text-primary'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
                }`}
            >
              {tab.icon}
            </button>
          );
        })}

        <div className="w-px h-5 bg-text-secondary/20 mx-1" />

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-7 h-7 rounded-full flex items-center justify-center focus:outline-none
            ${
              isExpanded
                ? 'bg-accent text-button-text'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-secondary/80'
            }`}
          data-tooltip={t('adjustments.color.toggleSliders')}
        >
          <Sliders size={14} />
        </button>
      </div>

      <div className="relative w-full mb-2">
        {activeTab === '3way' ? (
          <div className="w-full">
            <div className="flex justify-center mb-2">
              <div className="w-24">
                <ColorWheel
                  defaultValue={INITIAL_ADJUSTMENTS.colorGrading.midtones}
                  label={t('adjustments.color.grading.midtones')}
                  onChange={(val: HueSatLum) => handleChange(ColorGrading.Midtones, val)}
                  value={colorGrading.midtones}
                  onDragStateChange={onDragStateChange}
                  isExpanded={isExpanded}
                />
              </div>
            </div>
            <div className="flex justify-center mb-1 gap-6">
              <div className="w-24">
                <ColorWheel
                  defaultValue={INITIAL_ADJUSTMENTS.colorGrading.shadows}
                  label={t('adjustments.color.grading.shadows')}
                  onChange={(val: HueSatLum) => handleChange(ColorGrading.Shadows, val)}
                  value={colorGrading.shadows}
                  onDragStateChange={onDragStateChange}
                  isExpanded={isExpanded}
                />
              </div>
              <div className="w-24">
                <ColorWheel
                  defaultValue={INITIAL_ADJUSTMENTS.colorGrading.highlights}
                  label={t('adjustments.color.grading.highlights')}
                  onChange={(val: HueSatLum) => handleChange(ColorGrading.Highlights, val)}
                  value={colorGrading.highlights}
                  onDragStateChange={onDragStateChange}
                  isExpanded={isExpanded}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex justify-center pb-1">
            <div className="w-28">
              <ColorWheel
                defaultValue={INITIAL_ADJUSTMENTS.colorGrading.global}
                label={t('adjustments.color.grading.global')}
                onChange={(val: HueSatLum) => handleChange(ColorGrading.Global, val)}
                value={colorGrading.global || INITIAL_ADJUSTMENTS.colorGrading.global}
                onDragStateChange={onDragStateChange}
                isExpanded={isExpanded}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <Slider
          defaultValue={50}
          label={t('adjustments.color.grading.blending')}
          max={100}
          min={0}
          onChange={(e: any) => handleColorGradingSliderChange(ColorGrading.Blending, e.target.value)}
          step={1}
          value={colorGrading.blending}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={0}
          label={t('adjustments.color.grading.balance')}
          max={100}
          min={-100}
          onChange={(e: any) => handleColorGradingSliderChange(ColorGrading.Balance, e.target.value)}
          step={1}
          value={colorGrading.balance}
          onDragStateChange={onDragStateChange}
        />
      </div>
    </div>
  );
};

export const ColorCalibrationPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activePrimary, setActivePrimary] = useState('red');
  const colorCalibration = adjustments.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration;

  const PRIMARY_COLORS = useMemo(
    () => [
      { name: 'red', color: '#f87171', label: t('adjustments.color.calibration.colors.red') },
      { name: 'green', color: '#4ade80', label: t('adjustments.color.calibration.colors.green') },
      { name: 'blue', color: '#60a5fa', label: t('adjustments.color.calibration.colors.blue') },
    ],
    [t],
  );

  const handleShadowsChange = (value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorCalibration: {
        ...(prev.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration),
        shadowsTint: parseFloat(value),
      },
    }));
  };

  const handlePrimaryChange = (key: 'Hue' | 'Saturation', value: string) => {
    const fullKey = `${activePrimary}${key}` as keyof ColorCalibration;
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      colorCalibration: {
        ...(prev.colorCalibration || INITIAL_ADJUSTMENTS.colorCalibration),
        [fullKey]: parseFloat(value),
      },
    }));
  };

  const currentValues = {
    hue: colorCalibration[`${activePrimary}Hue` as keyof ColorCalibration] || 0,
    saturation: colorCalibration[`${activePrimary}Saturation` as keyof ColorCalibration] || 0,
  };

  return (
    <div className="pt-1 mt-1 border-t border-white/15">
      <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
        {t('adjustments.color.calibration.title')}
      </Text>
      <div>
        <Text color={TextColors.primary} weight={TextWeights.medium} className="mb-1">
          {t('adjustments.color.calibration.shadows')}
        </Text>
        <Slider
          label={t('adjustments.color.calibration.tint')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={colorCalibration.shadowsTint}
          onChange={(e: any) => handleShadowsChange(e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName="calibration-tint-gradient-track"
        />
      </div>
      <div className="mt-3">
        <Text color={TextColors.primary} weight={TextWeights.medium} className="mb-1.5">
          {t('adjustments.color.calibration.primaries')}
        </Text>
        <div className="flex justify-center gap-4 mb-2 px-1">
          {PRIMARY_COLORS.map(({ name, color, label }) => (
            <ColorSwatch
              color={color}
              isActive={activePrimary === name}
              key={name}
              name={name}
              onClick={setActivePrimary}
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
            />
          ))}
        </div>
        <Slider
          label={t('adjustments.color.calibration.hue')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.hue}
          onChange={(e: any) => handlePrimaryChange('Hue', e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName={`calibration-hue-${activePrimary}`}
        />
        <Slider
          label={t('adjustments.color.calibration.saturation')}
          min={-100}
          max={100}
          step={1}
          defaultValue={0}
          value={currentValues.saturation}
          onChange={(e: any) => handlePrimaryChange('Saturation', e.target.value)}
          onDragStateChange={onDragStateChange}
          trackClassName={`calibration-saturation-${activePrimary}`}
        />
      </div>
    </div>
  );
};


const GRAY_MIXER_CHANNELS: { key: string; labelKey: string; color: string }[] = [
  { key: 'reds', labelKey: 'adjustments.color.reds', color: '#ef4444' },
  { key: 'oranges', labelKey: 'adjustments.color.oranges', color: '#f97316' },
  { key: 'yellows', labelKey: 'adjustments.color.yellows', color: '#eab308' },
  { key: 'greens', labelKey: 'adjustments.color.greens', color: '#22c55e' },
  { key: 'aquas', labelKey: 'adjustments.color.aquas', color: '#14b8a6' },
  { key: 'blues', labelKey: 'adjustments.color.blues', color: '#3b82f6' },
  { key: 'purples', labelKey: 'adjustments.color.purples', color: '#a855f7' },
  { key: 'magentas', labelKey: 'adjustments.color.magentas', color: '#ec4899' },
];

/** Lightroom-style TSL controls for the monochrome mix. */
const GrayMixerPanel = ({ adjustments, setAdjustments, onDragStateChange }: ColorPanelProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'hue' | 'saturation' | 'luminance' | 'all'>('saturation');
  const gm = (adjustments as any).grayMixer || {};
  const hsl = (adjustments as any).hsl || {};
  const setChannel = (key: string, field: 'hue' | 'saturation' | 'luminance', value: number) => {
    const prevGm = ((adjustments as any).grayMixer || {}) as Record<string, number>;
    if (field !== 'saturation') {
      setAdjustments((prev: any) => ({
        ...prev,
        hsl: { ...(prev.hsl || {}), [key]: { ...(prev.hsl?.[key] || {}), [field]: value } },
      }));
      return;
    }
    setAdjustments({
      convertToGrayscale: true,
      cameraProfile: 'Monochrome',
      grayMixer: { ...prevGm, [key]: value },
    } as any);
  };
  const tabs = [
    ['hue', t('adjustments.color.hue', { defaultValue: 'Teinte' })],
    ['saturation', t('adjustments.color.saturation', { defaultValue: 'Saturation' })],
    ['luminance', t('adjustments.color.luminance', { defaultValue: 'Luminance' })],
    ['all', t('adjustments.color.all', { defaultValue: 'Tout' })],
  ] as const;
  return (
    <div className="pt-1 mt-1 border-t border-white/15 space-y-0.5">
      <div className="flex items-center justify-center gap-3 border-b border-white/15 pb-1 mb-1 text-[10px]">
        {tabs.map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={activeTab === id ? 'text-text-primary font-semibold' : 'text-text-secondary hover:text-text-primary'}>{label}</button>)}
      </div>
      {GRAY_MIXER_CHANNELS.map(({ key, labelKey, color }) => {
        const values = activeTab === 'all' ? (['hue', 'saturation', 'luminance'] as const) : [activeTab];
        return values.map((field) => (
          <Slider
            key={`${key}-${field}`}
            label={<span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />{t(labelKey as any)}</span>}
            max={100} min={-100} step={1}
            value={field === 'saturation' ? (gm[key] ?? 0) : (hsl[key]?.[field] ?? 0)}
            onChange={(e: any) => setChannel(key, field, parseFloat(e.target.value))}
            onDragStateChange={onDragStateChange}
          />
        ));
      })}
    </div>
  );
};

export default function ColorPanel({
  adjustments,
  setAdjustments,
  appSettings,
  isForMask = false,
  isWbPickerActive = false,
  toggleWbPicker,
  onDragStateChange,
  panel = 'mixer',
}: ColorPanelProps) {
  const { t } = useTranslation();
  const isPointColorPickerActive = useEditorStore((s) => s.isPointColorPickerActive);
  const setEditor = useEditorStore((s) => s.setEditor);
  const [activeColor, setActiveColor] = useState('reds');
  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};
  const isWgpuEnabled = appSettings?.useWgpuRenderer !== false;

  const HSL_COLORS = useMemo<Array<ColorProps>>(
    () => [
      { name: 'reds', color: '#f87171', label: t('adjustments.color.mixerColors.reds') },
      { name: 'oranges', color: '#fb923c', label: t('adjustments.color.mixerColors.oranges') },
      { name: 'yellows', color: '#facc15', label: t('adjustments.color.mixerColors.yellows') },
      { name: 'greens', color: '#4ade80', label: t('adjustments.color.mixerColors.greens') },
      { name: 'aquas', color: '#2dd4bf', label: t('adjustments.color.mixerColors.aquas') },
      { name: 'blues', color: '#60a5fa', label: t('adjustments.color.mixerColors.blues') },
      { name: 'purples', color: '#a78bfa', label: t('adjustments.color.mixerColors.purples') },
      { name: 'magentas', color: '#f472b6', label: t('adjustments.color.mixerColors.magentas') },
    ],
    [t],
  );

  const colorHueMap = useMemo<Record<string, number>>(
    () => ({
      reds: 0,
      oranges: 30,
      yellows: 60,
      greens: 120,
      aquas: 180,
      blues: 240,
      purples: 300,
      magentas: 340,
    }),
    [],
  );

  const currentHsl = adjustments?.hsl?.[activeColor] || { hue: 0, saturation: 0, luminance: 0 };
  const baseHue = colorHueMap[activeColor] || 0;
  const effectiveHue = baseHue + (currentHsl.hue || 0);

  useEffect(() => {
    const normalizedHue = ((effectiveHue % 360) + 360) % 360;
    const effectiveSaturation = (currentHsl.saturation + 100) / 2;

    document.documentElement.style.setProperty(`--hsl-mixer-hue-${activeColor}`, normalizedHue.toString());
    document.documentElement.style.setProperty(`--hsl-mixer-sat-${activeColor}`, `${effectiveSaturation}%`);
  }, [effectiveHue, currentHsl.saturation, activeColor]);

  const handleAdjustmentChange = (key: ColorAdjustment, value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => {
      const next: Partial<Adjustments> = { ...prev, [key]: parseFloat(value) };
      if ((key as string) === 'temperature' || (key as string) === 'tint') {
        (next as any).whiteBalance = 'Custom';
      }
      return next;
    });
  };

  const handleHslChange = (key: ColorAdjustment, value: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      hsl: {
        ...(prev.hsl || {}),
        [activeColor]: {
          ...(prev.hsl?.[activeColor] || {}),
          [key]: parseFloat(value),
        },
      },
    }));
  };

  const hue_slider = `hue-slider-${activeColor}`;
  const saturation_slider = `sat-slider-${activeColor}`;
  const luminance_slider = `lum-slider-${activeColor}`;

  if (panel === 'grading') {
    return (
      <ColorGradingPanel
        adjustments={adjustments}
        setAdjustments={setAdjustments}
        appSettings={appSettings}
        onDragStateChange={onDragStateChange}
      />
    );
  }

  return (
    <div className="space-y-1">
      {/* Global WB + Presence live in Basic (Lightroom Classic layout); masks keep them here. */}
      {isForMask && (
        <>
      {!(adjustments as any).convertToGrayscale && <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
        <div className="flex justify-between items-center mb-2">
          <Text variant={TextVariants.heading} className="text-[11px] text-text-primary">{t('adjustments.color.whiteBalance')}</Text>
          {!isForMask && toggleWbPicker && (
            <button
              onClick={toggleWbPicker}
              disabled={isWgpuEnabled}
              className={`p-1.5 rounded-md transition-colors ${
                isWgpuEnabled
                  ? 'cursor-not-allowed text-text-secondary hover:bg-transparent'
                  : isWbPickerActive
                    ? 'bg-accent text-button-text'
                    : 'hover:bg-bg-secondary text-text-secondary'
              }`}
              data-tooltip={
                isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
              }
            >
              <Pipette size={16} />
            </button>
          )}
        </div>
        {(adjustments as any).cameraProfile ? (
          <div
            className="mb-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-secondary/90 truncate"
            title={String((adjustments as any).cameraProfile)}
          >
            {String((adjustments as any).cameraProfile)}
          </div>
        ) : null}
        <Slider
          label={t('adjustments.color.temperature')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Temperature, e.target.value)}
          step={1}
          value={adjustments.temperature || 0}
          trackClassName="temperature-gradient-track"
          onDragStateChange={onDragStateChange}
          formatValue={(n) => String(relativeTempToKelvin(n, asShotKelvinFrom(adjustments as any)))}
          parseValue={(text) => {
            const k = parseFloat(String(text).replace(',', '.').replace('+', ''));
            if (isNaN(k)) return null;
            return kelvinToRelativeTemp(k, asShotKelvinFrom(adjustments as any));
          }}
        />
        <Slider
          label={t('adjustments.color.tint')}
          max={100}
          min={-100}
          onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Tint, e.target.value)}
          step={1}
          value={adjustments.tint || 0}
          trackClassName="tint-gradient-track"
          onDragStateChange={onDragStateChange}
        />
      </div>}

      <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
        <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
          {t('adjustments.color.presence')}
        </Text>
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
      </div>

        </>
      )}

      <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
        <Text variant={TextVariants.heading} className="mb-0.5 text-[11px] text-text-primary">
          {isForMask ? t('adjustments.color.localHue') : t('adjustments.color.hue')}
        </Text>
        <Slider
          label={t('adjustments.color.hue')}
          max={180}
          min={-180}
          onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Hue, e.target.value)}
          step={1}
          value={adjustments.hue || 0}
          trackClassName="hue-range-track"
          onDragStateChange={onDragStateChange}
        />
      </div>

      <div className="pt-1 mt-1 border-t border-white/15 first:mt-0 first:pt-0 first:border-t-0">
        <Text variant={TextVariants.heading} className="mb-1 text-[11px] text-text-primary">
          {t('adjustments.color.colorMixer')}
        </Text>
        <div className="flex justify-between mb-1 px-1">
          {HSL_COLORS.map(({ name, color, label }) => (
            <ColorSwatch
              color={color}
              isActive={activeColor === name}
              key={name}
              name={name}
              onClick={setActiveColor}
              ariaLabel={t('adjustments.color.ariaSelectColor', { name: label })}
            />
          ))}
        </div>
        <Slider
          label={t('adjustments.color.hue')}
          max={100}
          min={-100}
          onChange={(e: any) => handleHslChange(ColorAdjustment.Hue, e.target.value)}
          step={1}
          value={currentHsl.hue}
          trackClassName={hue_slider}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.color.saturation')}
          max={100}
          min={-100}
          onChange={(e: any) => handleHslChange(ColorAdjustment.Saturation, e.target.value)}
          step={1}
          value={currentHsl.saturation}
          trackClassName={saturation_slider}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.color.luminance')}
          max={100}
          min={-100}
          onChange={(e: any) => handleHslChange(ColorAdjustment.Luminance, e.target.value)}
          step={1}
          value={currentHsl.luminance}
          trackClassName={luminance_slider}
          onDragStateChange={onDragStateChange}
        />
      </div>

      {/* LR Point Color (modern mixer) — list + variance from XMP crs:PointColors / ColorVariance */}
      {!isForMask && (
        <div className="pt-1 mt-1 border-t border-white/15 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Text variant={TextVariants.heading} className="text-[11px] text-text-primary">
              {t('adjustments.color.pointColor' as any, { defaultValue: 'Point Color' })}
            </Text>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`p-1.5 rounded-md transition-colors ${
                  isPointColorPickerActive
                    ? 'bg-accent text-button-text'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
                onClick={() =>
                  setEditor({
                    isPointColorPickerActive: !isPointColorPickerActive,
                    isWbPickerActive: false,
                  })
                }
                data-tooltip={t('adjustments.color.pointColorPickTip' as any, {
                  defaultValue: 'Pick source color on image (Esc cancel)',
                })}
              >
                <Pipette size={14} />
              </button>
              <button
                type="button"
                className="text-[10px] uppercase tracking-wide text-text-secondary hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-surface"
                onClick={() =>
                  setAdjustments((prev: any) => {
                    const rows = Array.isArray(prev.pointColors) ? [...prev.pointColors] : [];
                    rows.push([0, 0.5, 0.5, 0, 0]);
                    const variance = Array.isArray(prev.colorVariance) ? [...prev.colorVariance] : [];
                    variance.push(0);
                    return { ...prev, pointColors: rows, colorVariance: variance };
                  })
                }
              >
                {t('adjustments.color.addPointColor' as any, { defaultValue: '+ Pin' })}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-text-secondary/60 leading-snug">
            {isPointColorPickerActive
              ? t('adjustments.color.pointColorPickActive' as any, {
                  defaultValue: 'Click the image to sample a source color for a new pin. Esc cancels.',
                })
              : t('adjustments.color.pointColorHint' as any, {
                  defaultValue:
                    'XMP Point Colors: pick on image or set source HSL + hue/sat shift + range.',
                })}
          </p>

          {Array.isArray((adjustments as any).pointColors) &&
          (adjustments as any).pointColors.length > 0 ? (
            <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {((adjustments as any).pointColors as any[]).map((row: any, idx: number) => {
                const r = Array.isArray(row) ? row.map(Number) : [0, 0, 0, 0, 0];
                while (r.length < 5) r.push(0);
                const variance = Array.isArray((adjustments as any).colorVariance)
                  ? Number((adjustments as any).colorVariance[idx] ?? 0)
                  : 0;
                const setRow = (col: number, value: number) => {
                  setAdjustments((prev: any) => {
                    const rows = (Array.isArray(prev.pointColors) ? prev.pointColors : []).map(
                      (rr: any, i: number) => {
                        const copy = Array.isArray(rr) ? [...rr] : [0, 0, 0, 0, 0];
                        while (copy.length < 5) copy.push(0);
                        if (i === idx) copy[col] = value;
                        return copy;
                      },
                    );
                    return { ...prev, pointColors: rows };
                  });
                };
                const setVar = (value: number) => {
                  setAdjustments((prev: any) => {
                    const v = Array.isArray(prev.colorVariance) ? [...prev.colorVariance] : [];
                    while (v.length <= idx) v.push(0);
                    v[idx] = value;
                    return { ...prev, colorVariance: v };
                  });
                };
                return (
                  <li
                    key={idx}
                    className="rounded border border-border-color/25 bg-bg-primary/40 p-1.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide flex items-center gap-1.5">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-black/30 shrink-0"
                          style={{
                            background: `hsl(${((r[0] ?? 0) * 0.5 + 0.5) * 360}, ${Math.min(100, Math.max(0, (r[1] ?? 0.5) * 100))}%, ${Math.min(100, Math.max(0, (r[2] ?? 0.5) * 100))}%)`,
                          }}
                          title="Source color (approx.)"
                        />
                        {t('adjustments.color.pointColorN' as any, {
                          defaultValue: 'Pin {{n}}',
                          n: idx + 1,
                        })}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="text-[10px] text-text-secondary hover:text-text-primary px-1"
                          onClick={() =>
                            setAdjustments((prev: any) => {
                              const rows = Array.isArray(prev.pointColors) ? [...prev.pointColors] : [];
                              const copy = Array.isArray(rows[idx]) ? [...rows[idx]] : [0, 0.5, 0.5, 0, 0];
                              rows.splice(idx + 1, 0, copy);
                              const v = Array.isArray(prev.colorVariance) ? [...prev.colorVariance] : [];
                              const vv = v[idx] ?? 0;
                              v.splice(idx + 1, 0, vv);
                              return { ...prev, pointColors: rows, colorVariance: v };
                            })
                          }
                        >
                          {t('adjustments.color.dupPointColor' as any, { defaultValue: 'Dup' })}
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-red-400/90 hover:text-red-300 px-1"
                          onClick={() =>
                            setAdjustments((prev: any) => {
                              const rows = (Array.isArray(prev.pointColors) ? prev.pointColors : []).filter(
                                (_: any, i: number) => i !== idx,
                              );
                              const v = (Array.isArray(prev.colorVariance) ? prev.colorVariance : []).filter(
                                (_: any, i: number) => i !== idx,
                              );
                              return { ...prev, pointColors: rows, colorVariance: v };
                            })
                          }
                        >
                          {t('adjustments.color.removePointColor' as any, { defaultValue: 'Remove' })}
                        </button>
                      </div>
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-text-secondary/50 pt-0.5">
                      {t('adjustments.color.pointColorSource' as any, { defaultValue: 'Source' })}
                    </div>
                    <Slider
                      label={t('adjustments.color.hue')}
                      min={-1}
                      max={1}
                      step={0.01}
                      value={r[0] ?? 0}
                      onChange={(e: any) => setRow(0, parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0}
                    />
                    <Slider
                      label={t('adjustments.color.saturation')}
                      min={0}
                      max={1}
                      step={0.01}
                      value={r[1] ?? 0.5}
                      onChange={(e: any) => setRow(1, parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0.5}
                    />
                    <Slider
                      label={t('adjustments.color.luminance')}
                      min={0}
                      max={1}
                      step={0.01}
                      value={r[2] ?? 0.5}
                      onChange={(e: any) => setRow(2, parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0.5}
                    />
                    <div className="text-[9px] uppercase tracking-wider text-text-secondary/50 pt-0.5">
                      {t('adjustments.color.pointColorShift' as any, { defaultValue: 'Shift' })}
                    </div>
                    <Slider
                      label={t('adjustments.color.hue')}
                      min={-100}
                      max={100}
                      step={0.5}
                      value={r[3] ?? 0}
                      onChange={(e: any) => setRow(3, parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0}
                    />
                    <Slider
                      label={t('adjustments.color.saturation')}
                      min={-100}
                      max={100}
                      step={0.5}
                      value={r[4] ?? 0}
                      onChange={(e: any) => setRow(4, parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0}
                    />
                    <Slider
                      label={t('adjustments.color.colorVariance' as any, { defaultValue: 'Range' })}
                      min={-100}
                      max={100}
                      step={1}
                      value={variance}
                      onChange={(e: any) => setVar(parseFloat(e.target.value))}
                      onDragStateChange={onDragStateChange}
                      defaultValue={0}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[10px] text-text-secondary/50">
              {t('adjustments.color.noPointColors' as any, {
                defaultValue: 'No point colors — import from XMP or add a pin.',
              })}
            </p>
          )}
        </div>
      )}

      {!isForMask && !!(adjustments as any).convertToGrayscale && (
          <GrayMixerPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        )}
    </div>
  );
}
