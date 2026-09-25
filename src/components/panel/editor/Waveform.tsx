import { useEffect, useRef } from 'react';
import { AlertOctagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WaveformData } from '../../ui/AppProperties';
import { DisplayMode } from '../../../utils/adjustments';

interface WaveformProps {
  waveformData: WaveformData | null;
  histogram?: any;
  displayMode: string;
  setDisplayMode: (mode: string) => void;
  showClipping?: boolean;
  onToggleClipping?: () => void;
  theme?: string;
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

const HistogramView = ({ histogram }: { histogram: any }) => {
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

  return (
    <svg
      viewBox="0 0 255 255"
      className="w-full h-full overflow-visible pointer-events-none"
      preserveAspectRatio="none"
    >
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
  showClipping,
  onToggleClipping,
  theme,
}: WaveformProps) {
  const { t } = useTranslation();
  const isLightTheme = theme ? ['light', 'snow', 'arctic'].includes(theme) : false;
  const isHistogram = displayMode === DisplayMode.Histogram;
  const isVectorscope = displayMode === DisplayMode.Vectorscope;
  const width = waveformData?.width || 256;
  const height = waveformData?.height || 256;

  const activeData = waveformData
    ? {
        [DisplayMode.Rgb]: waveformData.rgb,
        [DisplayMode.Luma]: waveformData.luma,
        [DisplayMode.Parade]: waveformData.parade,
        [DisplayMode.Vectorscope]: waveformData.vectorscope,
        [DisplayMode.Histogram]: undefined,
      }[displayMode as DisplayMode]
    : '';

  return (
    <div className="w-full h-full flex flex-col gap-1">
      {/* Scope selector — always visible, no animation */}
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
        {onToggleClipping && (
          <button
            type="button"
            onClick={onToggleClipping}
            data-tooltip={
              showClipping ? t('ui.waveform.tooltips.hideClipping') : t('ui.waveform.tooltips.showClipping')
            }
            className={`w-6 h-5 flex items-center justify-center rounded ${
              showClipping ? 'bg-accent text-button-text' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <AlertOctagon size={12} />
          </button>
        )}
      </div>
      <div
        className="relative flex-1 min-h-0 bg-black rounded overflow-hidden border border-border-color/40"
        style={{ filter: isLightTheme ? 'invert(1) hue-rotate(180deg)' : undefined }}
      >
        {/* Plot area inset so the top (100 %) line and peaks are never clipped. */}
        <div className="absolute inset-x-1.5 top-3 bottom-1.5">
          {isHistogram ? (
            <div className="absolute inset-0">
              <HistogramView histogram={histogram} />
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
