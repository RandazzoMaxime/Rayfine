import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import Waveform, { HistogramToneRegion } from '../editor/Waveform';
import Resizer from '../../ui/Resizer';
import { Orientation } from '../../ui/AppProperties';
import { Adjustments } from '../../../utils/adjustments';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useWaveformControls } from '../../../hooks/useWaveformControls';

/** Develop right rail header: always-on scopes (histogram / waveform / parade / vectorscope), static like Resolve. */
export default function DevelopHistogram() {
  const { setActiveWaveformChannel, handleWaveformResize } = useWaveformControls();
  const { setAdjustments } = useEditorActions();
  const theme = useSettingsStore((s) => s.theme);
  const { adjustments, histogram, isWaveformVisible, waveform, activeWaveformChannel, waveformHeight, setEditor } =
    useEditorStore(
      useShallow((s) => ({
        adjustments: s.adjustments,
        histogram: s.histogram,
        isWaveformVisible: s.isWaveformVisible,
        waveform: s.waveform,
        activeWaveformChannel: s.activeWaveformChannel,
        waveformHeight: s.waveformHeight,
        setEditor: s.setEditor,
      })),
    );
  const exif = useEditorStore((s) => s.selectedImage?.exif) as Record<string, any> | null | undefined;
  const exifItems = formatShootingInfo(exif);
  const dragStartRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isWaveformVisible) setEditor({ isWaveformVisible: true });
  }, [isWaveformVisible, setEditor]);

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const handleHistogramDrag = useCallback(
    (region: HistogramToneRegion, deltaX: number, dragging: boolean) => {
      setEditor({ isSliderDragging: dragging });
      if (!dragging) {
        dragStartRef.current = {};
        return;
      }
      const key = region === 'exposure' ? 'brightness' : region;
      setAdjustments((prev: Adjustments) => {
        if (dragStartRef.current[key] === undefined) {
          dragStartRef.current[key] = Number((prev as any)[key] ?? 0);
        }
        const scale = key === 'brightness' ? 0.02 : 0.45;
        const min = key === 'brightness' ? -5 : -100;
        const max = key === 'brightness' ? 5 : 100;
        const next = clamp(dragStartRef.current[key] + deltaX * scale, min, max);
        dragStartRef.current[key] = next;
        return { ...prev, [key]: next };
      });
    },
    [setAdjustments, setEditor],
  );

  return (
    <div className="shrink-0 relative flex flex-col border-b border-border-color/40" style={{ height: Math.min(Math.max(waveformHeight || 150, 110), 200) }}>
      <div className="grow w-full h-full px-2 pt-2 pb-1 min-h-0">
        <Waveform
          waveformData={waveform || null}
          histogram={histogram}
          displayMode={activeWaveformChannel || 'histogram'}
          setDisplayMode={setActiveWaveformChannel}
          showShadowClipping={!!(adjustments.showShadowClipping || adjustments.showClipping)}
          showHighlightClipping={!!(adjustments.showHighlightClipping || adjustments.showClipping)}
          onToggleShadowClipping={() =>
            setAdjustments((prev: Adjustments) => ({
              ...prev,
              showShadowClipping: !prev.showShadowClipping,
              showClipping: false,
            }))
          }
          onToggleHighlightClipping={() =>
            setAdjustments((prev: Adjustments) => ({
              ...prev,
              showHighlightClipping: !prev.showHighlightClipping,
              showClipping: false,
            }))
          }
          onHistogramDrag={handleHistogramDrag}
          onHistogramRegionChange={(region) => setEditor({ histogramToneRegion: region })}
          theme={theme}
        />
      </div>
      {exifItems.length > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 pb-1.5 text-[10px] tabular-nums text-text-secondary">
          {exifItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
      <Resizer direction={Orientation.Horizontal} onMouseDown={handleWaveformResize} />
    </div>
  );
}

/** Lightroom-style shooting info under the histogram: ISO · focal length · aperture · shutter (only what exists). */
function formatShootingInfo(exif: Record<string, any> | null | undefined): string[] {
  if (!exif) return [];
  const clean = (v: any) => (v == null ? '' : String(v).trim());
  const iso = clean(exif.PhotographicSensitivity || exif.ISOSpeedRatings || exif.ISO);
  const focalRaw = clean(exif.FocalLength || exif.FocalLengthIn35mmFilm);
  const fRaw = clean(exif.FNumber);
  const shutterRaw = clean(exif.ExposureTime);
  const items: string[] = [];
  if (iso) items.push(`ISO ${iso}`);
  if (focalRaw) items.push(/mm$/i.test(focalRaw) ? focalRaw.replace(/\s*mm$/i, ' mm') : `${focalRaw} mm`);
  if (fRaw) items.push(/^f/i.test(fRaw) ? fRaw : `f/${fRaw}`);
  if (shutterRaw) items.push(/s(ec)?$/i.test(shutterRaw) ? shutterRaw : `${shutterRaw} s`);
  return items;
}
