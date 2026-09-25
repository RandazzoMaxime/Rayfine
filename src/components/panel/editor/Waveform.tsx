import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WaveformData } from '../../ui/AppProperties';
import { DisplayMode } from '../../../utils/adjustments';

export type HistogramToneRegion = 'blacks' | 'shadows' | 'exposure' | 'highlights' | 'whites';

interface WaveformProps {
  waveformData: WaveformData | null;
  histogram?: any;
  displayMode: string;
  setDisplayMode: (mode: string) => void;
  showShadowClipping?: boolean;
  showHighlightClipping?: boolean;
  onToggleShadowClipping?: () => void;
  onToggleHighlightClipping?: () => void;
  onHistogramDrag?: (region: HistogramToneRegion, deltaX: number, dragging: boolean) => void;
  onHistogramRegionChange?: (region: HistogramToneRegion | null) => void;
  theme?: string;
}

const TONE_REGIONS: { id: HistogramToneRegion; start: number; end: number }[] = [
  { id: 'blacks', start: 0, end: 0.12 },
  { id: 'shadows', start: 0.12, end: 0.32 },
  { id: 'exposure', start: 0.32, end: 0.68 },
  { id: 'highlights', start: 0.68, end: 0.88 },
  { id: 'whites', start: 0.88, end: 1 },
];

function regionAt(xNorm: number): HistogramToneRegion {
  const x = Math.min(1, Math.max(0, xNorm));
  for (const r of TONE_REGIONS) {
    if (x < r.end || r.id === 'whites') return r.id;
  }
  return 'whites';
}

const modeButtons = [
  {
    mode: DisplayMode.Luma,
    label: 'L',
    tooltip: 'ui.waveform.tooltips.luma',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Rgb,
    label: 'RGB',
    tooltip: 'ui.waveform.tooltips.rgb',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Parade,
    label: 'P',
    tooltip: 'ui.waveform.tooltips.parade',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Vectorscope,
    label: 'V',
    tooltip: 'ui.waveform.tooltips.vectorscope',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
  {
    mode: DisplayMode.Histogram,
    label: 'H',
    tooltip: 'ui.waveform.tooltips.histogram',
    bgClass: 'bg-accent',
    textActiveClass: 'text-button-text',
  },
];

const HistogramView = ({
  histogram,
  activeRegion,
}: {
  histogram: any;
  activeRegion: HistogramToneRegion | null;
}) => {
  if (!histogram || !histogram.red || !histogram.green || !histogram.blue) return null;

  const redMax = Math.max(...(histogram.red || [0]));
  const greenMax = Math.max(...(histogram.green || [0]));
  const blueMax = Math.max(...(histogram.blue || [0]));
  const globalMax = Math.max(redMax, greenMax, blueMax, 1) / 0.9;

  const getFill = (data: number[]) => {
    const pathData = data.map((val, i) => `${(i / 255) * 255},${255 - (val / globalMax) * 255}`).join(' L');
    return `M0,255 L${pathData} L255,255 Z`;
  };

  const getLine = (data: number[]) => {
    return 'M' + data.map((val, i) => `${(i / 255) * 255},${255 - (val / globalMax) * 255}`).join(' L');
  };

  const channels = [
    { key: 'red', color: '#FF6B6B', data: histogram.red },
    { key: 'green', color: '#6BCB77', data: histogram.green },
    { key: 'blue', color: '#4D96FF', data: histogram.blue },
  ];

  const zone = TONE_REGIONS.find((r) => r.id === activeRegion);

  return (
    <svg
      viewBox="0 0 255 255"
      className="w-full h-full overflow-visible pointer-events-none"
      preserveAspectRatio="none"
    >
      {zone && (
        <rect
          x={zone.start * 255}
          y={0}
          width={(zone.end - zone.start) * 255}
          height={255}
          fill="rgba(255,255,255,0.08)"
        />
      )}
      {channels.map((ch) => {
        if (!ch.data || ch.data.length === 0) return null;
        return (
          <g key={ch.key} style={{ mixBlendMode: 'lighten' }}>
            <path d={getFill(ch.data)} fill={ch.color} fillOpacity={0.4} />
            <path
              d={getLine(ch.data)}
              fill="none"
              stroke={ch.color}
              strokeWidth={1.5}
              strokeOpacity={1.8}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
};

function histogramHasClip(histogram: any, side: 'shadow' | 'highlight'): boolean {
  if (!histogram) return false;
  const channels = [histogram.red, histogram.green, histogram.blue, histogram.luma].filter(
    (d: any) => Array.isArray(d) && d.length > 0,
  );
  if (!channels.length) return false;
  for (const data of channels) {
    if (side === 'shadow') {
      if ((data[0] || 0) + (data[1] || 0) > 0) return true;
    } else {
      const n = data.length;
      if ((data[n - 1] || 0) + (data[n - 2] || 0) > 0) return true;
    }
  }
  return false;
}

const ClipTriangle = ({
  side,
  active,
  hasClip,
  onClick,
  tooltip,
}: {
  side: 'left' | 'right';
  active: boolean;
  hasClip: boolean;
  onClick: () => void;
  tooltip: string;
}) => {
  const fill = active ? (side === 'left' ? '#60a5fa' : '#f87171') : hasClip ? '#e5e7eb' : 'transparent';
  const stroke = active ? (side === 'left' ? '#93c5fd' : '#fca5a5') : hasClip ? '#e5e7eb' : 'rgba(255,255,255,0.45)';
  return (
    <button
      type="button"
      className={`absolute top-0 z-20 w-4 h-4 flex items-center justify-center ${side === 'left' ? 'left-0' : 'right-0'}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      data-tooltip={tooltip}
    >
      <svg width="10" height="8" viewBox="0 0 10 8" className="block">
        <path d="M5 0 L10 8 L0 8 Z" fill={fill} stroke={stroke} strokeWidth="1" />
      </svg>
    </button>
  );
};

const useRawRgbaCanvas = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  base64Data: string,
  width: number,
  height: number,
) => {
  useEffect(() => {
    if (!base64Data || !canvasRef.current || !width || !height) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const binary = atob(base64Data);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const imageData = new ImageData(bytes, width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [base64Data, width, height, canvasRef]);
};

const WaveformCanvas = ({
  base64Data,
  width,
  height,
  isVectorscope,
}: {
  base64Data: string;
  width: number;
  height: number;
  isVectorscope: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useRawRgbaCanvas(canvasRef, base64Data, width, height);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={`w-full h-full ${isVectorscope ? 'object-contain' : ''}`}
    />
  );
};

/** Static graticule drawn over the scope (DaVinci Resolve style): no motion, just reference lines. */
const Graticule = ({ mode }: { mode: string }) => {
  if (mode === DisplayMode.Vectorscope) {
    return (
      <svg viewBox="0 0 256 256" className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="xMidYMid meet">
        <circle cx="128" cy="128" r="127" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        <circle cx="128" cy="128" r="64" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        <line x1="128" y1="0" x2="128" y2="256" stroke="rgba(255,255,255,0.1)" />
        <line x1="0" y1="128" x2="256" y2="128" stroke="rgba(255,255,255,0.1)" />
        {/* skin-tone line */}
        <line x1="128" y1="128" x2="46" y2="3" stroke="rgba(255,200,150,0.35)" />
      </svg>
    );
  }
  const levels = mode === DisplayMode.Histogram ? [25, 50, 75] : [0, 25, 50, 75, 100];
  const vertical = mode === DisplayMode.Histogram;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {levels.map((l) => (
        <div
          key={l}
          className={vertical ? 'absolute top-0 bottom-0 border-l border-white/10' : 'absolute left-0 right-0 border-t border-white/10'}
          style={vertical ? { left: `${l}%` } : { bottom: `${l}%` }}
        >
          {!vertical && (
            <span className="absolute left-0.5 -top-3 text-[8px] leading-none text-white/35 tabular-nums">{l}</span>
          )}
        </div>
      ))}
      {mode === DisplayMode.Parade && (
        <>
          <div className="absolute top-0 bottom-0 border-l border-white/15" style={{ left: '33.333%' }} />
          <div className="absolute top-0 bottom-0 border-l border-white/15" style={{ left: '66.666%' }} />
        </>
      )}
    </div>
  );
};

export default function Waveform({
  waveformData,
  histogram,
  displayMode,
  setDisplayMode,
  showShadowClipping,
  showHighlightClipping,
  onToggleShadowClipping,
  onToggleHighlightClipping,
  onHistogramDrag,
  onHistogramRegionChange,
  theme,
}: WaveformProps) {
  const { t } = useTranslation();
  const isLightTheme = theme ? ['light', 'snow', 'arctic'].includes(theme) : false;
  const isHistogram = displayMode === DisplayMode.Histogram;
  const isVectorscope = displayMode === DisplayMode.Vectorscope;
  const width = waveformData?.width || 256;
  const height = waveformData?.height || 256;
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ region: HistogramToneRegion; lastX: number } | null>(null);
  const [hoverRegion, setHoverRegion] = useState<HistogramToneRegion | null>(null);

  const activeData = waveformData
    ? {
        [DisplayMode.Rgb]: waveformData.rgb,
        [DisplayMode.Luma]: waveformData.luma,
        [DisplayMode.Parade]: waveformData.parade,
        [DisplayMode.Vectorscope]: waveformData.vectorscope,
        [DisplayMode.Histogram]: undefined,
      }[displayMode as DisplayMode]
    : '';

  const shadowClip = histogramHasClip(histogram, 'shadow');
  const highlightClip = histogramHasClip(histogram, 'highlight');
  const hoverZone = hoverRegion ? TONE_REGIONS.find((r) => r.id === hoverRegion) : undefined;
  const hoverLabelLeft = hoverZone
    ? Math.min(88, Math.max(12, ((hoverZone.start + hoverZone.end) / 2) * 100))
    : 50;

  const xNormFromEvent = (e: React.PointerEvent) => {
    const el = plotRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return (e.clientX - rect.left) / rect.width;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isHistogram || !onHistogramDrag) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const region = regionAt(xNormFromEvent(e));
    dragRef.current = { region, lastX: e.clientX };
    setHoverRegion(region);
    onHistogramRegionChange?.(region);
    onHistogramDrag(region, 0, true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isHistogram) return;
    if (dragRef.current && onHistogramDrag) {
      const dx = e.clientX - dragRef.current.lastX;
      dragRef.current.lastX = e.clientX;
      onHistogramDrag(dragRef.current.region, dx, true);
      return;
    }
    const region = regionAt(xNormFromEvent(e));
    if (region !== hoverRegion) {
      setHoverRegion(region);
      onHistogramRegionChange?.(region);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current && onHistogramDrag) {
      onHistogramDrag(dragRef.current.region, 0, false);
    }
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-1">
      <div className="shrink-0 flex items-center gap-0.5">
        {modeButtons.map(({ mode, label, tooltip }) => (
          <button
            key={mode}
            type="button"
            onClick={() => setDisplayMode(mode)}
            data-tooltip={t(tooltip as any)}
            className={`flex-1 h-5 rounded text-[10px] font-semibold ${
              displayMode === mode ? 'bg-card-active text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="relative flex-1 min-h-0 bg-black rounded overflow-hidden border border-border-color/40"
        style={{ filter: isLightTheme ? 'invert(1) hue-rotate(180deg)' : undefined }}
      >
        {isHistogram && (
          <>
            <ClipTriangle
              side="left"
              active={!!showShadowClipping}
              hasClip={shadowClip}
              onClick={() => onToggleShadowClipping?.()}
              tooltip={t('ui.waveform.tooltips.shadowClipping' as any, {
                defaultValue: 'Shadow clipping',
              })}
            />
            <ClipTriangle
              side="right"
              active={!!showHighlightClipping}
              hasClip={highlightClip}
              onClick={() => onToggleHighlightClipping?.()}
              tooltip={t('ui.waveform.tooltips.highlightClipping' as any, {
                defaultValue: 'Highlight clipping',
              })}
            />
          </>
        )}
        <div className="absolute inset-x-1.5 top-3 bottom-1.5">
          {isHistogram ? (
            <div
              ref={plotRef}
              className="absolute inset-0 cursor-ew-resize"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerLeave={() => {
                if (!dragRef.current) {
                  setHoverRegion(null);
                  onHistogramRegionChange?.(null);
                }
              }}
            >
              <HistogramView histogram={histogram} activeRegion={hoverRegion} />
              {hoverRegion && (
                <div
                  className="absolute bottom-1 z-10 pointer-events-none -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] leading-none text-white whitespace-nowrap"
                  style={{ left: `${hoverLabelLeft}%` }}
                >
                  {t(`adjustments.basic.${hoverRegion}` as any)}
                </div>
              )}
            </div>
          ) : activeData ? (
            <div className="absolute inset-0">
              <WaveformCanvas base64Data={activeData} width={width} height={height} isVectorscope={isVectorscope} />
            </div>
          ) : null}
          <Graticule mode={displayMode} />
        </div>
      </div>
    </div>
  );
}
