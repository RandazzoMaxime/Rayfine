import clsx from 'clsx';
import { useEffect } from 'react';
import { LayoutGrid, Pipette } from 'lucide-react';
import Slider from '../ui/Slider';
import PanelSelect from '../ui/PanelSelect';
import { Adjustments, BasicAdjustment, ColorAdjustment, DetailsAdjustment } from '../../utils/adjustments';
import { useTranslation } from 'react-i18next';
import { useEditorActions } from '../../hooks/useEditorActions';
import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';
import { ALL_CAMERA_PROFILES, normalizeCameraProfile } from '../../utils/cameraProfiles';
import { asShotKelvinFrom, kelvinToRelativeTemp, relativeTempToKelvin } from '../../utils/whiteBalance';

interface BasicAdjustmentsProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  isForMask?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
  appSettings?: any;
  isWbPickerActive?: boolean;
  toggleWbPicker?: () => void;
  detectedCameraProfile?: string;
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

const CAMERA_PROFILES = ALL_CAMERA_PROFILES.map((p) => p.name);

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 mb-1 pt-1.5 border-t border-border-color/40 text-[10px] font-medium leading-5 text-text-primary/80">{children}</div>
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
  detectedCameraProfile,
}: BasicAdjustmentsProps) {
  const { t } = useTranslation();
  const { handleAutoAdjustments } = useEditorActions();
  const setUI = useUIStore((s) => s.setUI);
  const histogramToneRegion = useEditorStore((s) => s.histogramToneRegion);

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
  const rawProfile = String((adjustments as any).cameraProfile || '');
  const asShotK = asShotKelvinFrom(adjustments as any);
  const setTreatment = (bw: boolean) =>
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      convertToGrayscale: bw,
      cameraProfile: bw ? 'Monochrome' : detectedCameraProfile || 'Standard',
    }));

  const currentWb = String((adjustments as any).whiteBalance || 'As Shot');
  const wbValue = Object.keys(WB_PRESETS).find((k) => k.toLowerCase() === currentWb.toLowerCase()) || 'Custom';
  const currentProfile = normalizeCameraProfile((adjustments as any).cameraProfile);
  const cameraProfileOptions = detectedCameraProfile ? [...CAMERA_PROFILES, detectedCameraProfile] : CAMERA_PROFILES;
  const selectedProfile = currentProfile === 'Monochrome'
    ? 'Monochrome'
    : ((adjustments as any).cameraProfile === detectedCameraProfile && detectedCameraProfile ? detectedCameraProfile : 'Standard');

  useEffect(() => {
    if (detectedCameraProfile && (!rawProfile || rawProfile.toLowerCase() === 'adobe standard')) {
      setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, cameraProfile: detectedCameraProfile }));
    }
  }, [detectedCameraProfile, rawProfile, setAdjustments]);
  const isHdr = !!(adjustments as any).hdrEditMode;

  return (
    <div>
      {/* LR Classic Basic: Auto / B&W / HDR · Profile · WB → Tone → Presence */}
      {!isForMask && (
        <>
          <div className="flex items-center justify-end gap-px mb-1">
            <button
              type="button"
              onClick={() => handleAutoAdjustments()}
              className={clsx(
                'h-5 px-1.5 rounded text-[10px]',
                (adjustments as any).autoTone
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface',
              )}
            >
              {t('adjustments.basic.auto' as any, { defaultValue: 'Auto' })}
            </button>
            <button
              type="button"
              onClick={() => setTreatment(!isBlackAndWhite)}
              className={clsx(
                'h-5 px-1.5 rounded text-[10px]',
                isBlackAndWhite
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface',
              )}
            >
              {t('adjustments.basic.blackAndWhite' as any, { defaultValue: 'N&B' })}
            </button>
            <span className="w-px h-3 mx-0.5 bg-border-color/50" />
            <button
              type="button"
              onClick={() =>
                setAdjustments((prev: any) => ({ ...prev, hdrEditMode: prev.hdrEditMode ? 0 : 1 }))
              }
              className={clsx(
                'h-5 px-1.5 rounded text-[10px]',
                isHdr
                  ? 'bg-card-active text-text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface',
              )}
            >
              HDR
            </button>
          </div>

          <div className="grid grid-cols-[7rem_minmax(0,1fr)_2.35rem] items-center gap-x-1 mb-1">
            <span className="text-[11px] font-medium text-text-primary text-right leading-5 py-px truncate">
              {t('adjustments.color.cameraProfile' as any, { defaultValue: 'Profil' })}
            </span>
            <PanelSelect
              value={selectedProfile}
              options={cameraProfileOptions.map((o) => ({ label: o, value: o }))}
              onChange={(v) => setAdjustments((prev: Partial<Adjustments>) => ({
                ...prev,
                cameraProfile: v,
                convertToGrayscale: v === 'Monochrome',
              }))}
            />
            <button
              type="button"
              className="h-6 w-full flex items-center justify-center rounded text-text-primary/80 hover:text-text-primary hover:bg-card-active"
              data-tooltip={t('adjustments.profile.explorer' as any, { defaultValue: 'Explorateur de profils' })}
              onClick={() => setUI({ isProfileBrowserOpen: true })}
            >
              <LayoutGrid size={13} />
            </button>
          </div>

          <div className="grid grid-cols-[7rem_minmax(0,1fr)_2.35rem] items-center gap-x-1 mb-1">
            <div className="flex items-center justify-end gap-0.5 min-w-0">
              {toggleWbPicker && (
                <button
                  type="button"
                  onClick={toggleWbPicker}
                  disabled={isWgpuEnabled}
                  className={clsx(
                    'h-5 w-5 shrink-0 flex items-center justify-center rounded transition-colors',
                    isWgpuEnabled
                      ? 'cursor-not-allowed text-text-secondary/40'
                      : isWbPickerActive
                        ? 'bg-accent text-button-text'
                        : 'text-text-primary/80 hover:bg-card-active hover:text-text-primary',
                  )}
                  data-tooltip={
                    isWgpuEnabled ? t('adjustments.color.wbPickerWgpuDisabled') : t('adjustments.color.wbPickerTooltip')
                  }
                >
                  <Pipette size={12} />
                </button>
              )}
              <span className="text-[11px] font-medium text-text-primary text-right leading-5 py-px truncate">
                {t('adjustments.color.wbShort' as any, { defaultValue: 'BB' })}
              </span>
            </div>
            <PanelSelect
              className="col-span-2"
              value={wbValue}
              options={Object.keys(WB_PRESETS).map((o) => ({ label: o, value: o }))}
              onChange={(name) => {
                setAdjustments((prev: Partial<Adjustments>) => {
                  const off = WB_PRESETS[name];
                  return {
                    ...prev,
                    whiteBalance: name,
                    temperature: off ? off.temperature : (prev.temperature ?? 0),
                    tint: off ? off.tint : (prev.tint ?? 0),
                  };
                });
              }}
            />
          </div>
          <Slider
            label={t('adjustments.color.temperature')}
            max={100}
            min={-100}
            onChange={(e: any) => handleAdjustmentChange(ColorAdjustment.Temperature, e.target.value)}
            step={1}
            value={adjustments.temperature || 0}
            onDragStateChange={onDragStateChange}
            trackClassName="temperature-gradient-track"
            formatValue={(n) => String(relativeTempToKelvin(n, asShotK))}
            parseValue={(text) => {
              const k = parseFloat(String(text).replace(',', '.').replace('+', ''));
              if (isNaN(k)) return null;
              return kelvinToRelativeTemp(k, asShotK);
            }}
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
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Exposure, e.target.value)}
        step={0.01}
        value={adjustments.exposure}
        onDragStateChange={onDragStateChange}
        emphasized={histogramToneRegion === 'exposure'}
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
        emphasized={histogramToneRegion === 'highlights'}
      />
      <Slider
        label={t('adjustments.basic.shadows')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Shadows, e.target.value)}
        step={1}
        value={adjustments.shadows}
        onDragStateChange={onDragStateChange}
        emphasized={histogramToneRegion === 'shadows'}
      />
      <Slider
        label={t('adjustments.basic.whites')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Whites, e.target.value)}
        step={1}
        value={adjustments.whites}
        onDragStateChange={onDragStateChange}
        emphasized={histogramToneRegion === 'whites'}
      />
      <Slider
        label={t('adjustments.basic.blacks')}
        max={100}
        min={-100}
        onChange={(e: any) => handleAdjustmentChange(BasicAdjustment.Blacks, e.target.value)}
        step={1}
        value={adjustments.blacks}
        onDragStateChange={onDragStateChange}
        emphasized={histogramToneRegion === 'blacks'}
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
