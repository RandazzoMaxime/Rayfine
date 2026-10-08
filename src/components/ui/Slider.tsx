import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GLOBAL_KEYS } from './AppProperties';

type SliderChangeEvent =
  | React.ChangeEvent<HTMLInputElement>
  | {
      target: {
        value: number | string;
      };
    };

interface SliderProps {
  defaultValue?: number;
  disabled?: boolean;
  label: React.ReactNode;
  max: number;
  min: number;
  onChange(event: SliderChangeEvent): void;
  onDragStateChange?(state: boolean): void;
  step: number;
  value: number;
  trackClassName?: string;
  fillOrigin?: 'min' | 'default';
  suffix?: string;
  emphasized?: boolean;
  formatValue?(value: number): string;
  parseValue?(text: string): number | null;
  /** Stacked: label + value on one row, full-width track below. */
  layout?: 'inline' | 'stacked';
  /** Dark = white text (Develop). Light = dark text on a white panel. Theme = CSS vars. */
  tone?: 'dark' | 'light' | 'theme';
  /** Taller track — color-grading hue/sat/lum under the wheels. */
  thick?: boolean;
}

const DOUBLE_CLICK_THRESHOLD_MS = 300;
const FINE_ADJUSTMENT_MULTIPLIER = 0.2;
const TOUCH_DRAG_THRESHOLD_PX = 10;
const TOUCH_THUMB_HIT_RADIUS_PX = 24;

const hasFineAdjustmentModifier = (event: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) =>
  'shiftKey' in event && (event.shiftKey || event.altKey);

const SliderInner = ({
  defaultValue = 0,
  disabled = false,
  label,
  max,
  min,
  onChange,
  onDragStateChange = () => {},
  step = 1,
  value,
  trackClassName,
  fillOrigin = 'default',
  suffix = '',
  emphasized = false,
  formatValue,
  parseValue,
  layout = 'inline',
  tone = 'theme',
  thick = false,
}: SliderProps) => {
  const { t } = useTranslation();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const [isDragging, setIsDragging] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const dragFrameRef = useRef<number | undefined>(undefined);
  const pendingDragValueRef = useRef<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const [isLabelHovered, setIsLabelHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastUpTime = useRef(0);
  const lastPointerXRef = useRef<number>(0);
  const accumulatedValueRef = useRef<number>(0);
  const pendingTouchRef = useRef<{
    startX: number;
    startY: number;
    latestX: number;
    startValue: number;
  } | null>(null);
  const suppressTouchChangeRef = useRef(false);
  const isWheelActivelyChangingRef = useRef(false);
  const wheelTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (wheelTimeoutRef.current !== undefined) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, []);

  const fillPercentage = max !== min ? ((displayValue - min) / (max - min)) * 100 : 0;
  const originPercentage = useMemo(() => {
    if (fillOrigin === 'min') {
      return 0;
    }
    return max !== min ? ((defaultValue - min) / (max - min)) * 100 : 0;
  }, [fillOrigin, defaultValue, min, max]);

  const stepStr = String(step);
  const decimalPlaces = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;

  const snapToStep = useCallback(
    (val: number): number => {
      const snapped = Math.round((val - min) / step) * step + min;
      const clamped = Math.max(min, Math.min(max, snapped));
      return parseFloat(clamped.toFixed(decimalPlaces));
    },
    [min, max, step, decimalPlaces],
  );

  const onChangeRef = useRef(onChange);
  const snapToStepRef = useRef(snapToStep);
  const rangeRef = useRef({ min, max });

  onChangeRef.current = onChange;
  snapToStepRef.current = snapToStep;
  rangeRef.current = { min, max };

  useEffect(() => {
    onDragStateChange(isDragging);
  }, [isDragging, onDragStateChange]);

  useEffect(() => {
    if (!disabled) return;

    pendingTouchRef.current = null;
    suppressTouchChangeRef.current = false;
    isWheelActivelyChangingRef.current = false;

    if (wheelTimeoutRef.current !== undefined) {
      window.clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = undefined;
    }
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    setIsDragging(false);
    setIsEditing(false);
    setIsLabelHovered(false);
    setDisplayValue(value);
    setInputValue(String(value));
  }, [disabled, value]);

  useEffect(() => {
    const sliderElement = containerRef.current;
    if (!sliderElement) return;

    const handleWheel = (event: WheelEvent) => {
      if (disabled || !event.shiftKey) {
        return;
      }

      event.preventDefault();
      const direction = -Math.sign(event.deltaY || event.deltaX);
      const newValue = value + direction * step;
      const roundedNewValue = parseFloat(newValue.toFixed(decimalPlaces));

      const clampedValue = Math.max(min, Math.min(max, roundedNewValue));

      if (clampedValue !== value && !isNaN(clampedValue)) {
        isWheelActivelyChangingRef.current = true;
        setDisplayValue(clampedValue);

        if (wheelTimeoutRef.current !== undefined) {
          window.clearTimeout(wheelTimeoutRef.current);
        }
        wheelTimeoutRef.current = window.setTimeout(() => {
          isWheelActivelyChangingRef.current = false;
        }, 150);

        const syntheticEvent = {
          target: {
            value: clampedValue,
          },
        };
        onChange(syntheticEvent);
      }
    };

    sliderElement.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      sliderElement.removeEventListener('wheel', handleWheel);
    };
  }, [disabled, value, min, max, step, onChange, decimalPlaces]);

  // Handle Dragging
  useEffect(() => {
    if (!isDragging || disabled) return;

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;
    const sliderWidth = inputEl.getBoundingClientRect().width || 1;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX: number;
      let shiftKey: boolean;

      if ('touches' in e) {
        if (e.touches.length === 0) return;
        clientX = e.touches[0].clientX;
        shiftKey = hasFineAdjustmentModifier(e);
        if (e.cancelable) e.preventDefault();
      } else {
        clientX = (e as MouseEvent).clientX;
        shiftKey = hasFineAdjustmentModifier(e);
      }

      const deltaX = clientX - lastPointerXRef.current;
      const { min: curMin, max: curMax } = rangeRef.current;

      const multiplier = shiftKey ? FINE_ADJUSTMENT_MULTIPLIER : 1;
      const deltaValue = (deltaX / sliderWidth) * (curMax - curMin) * multiplier;

      const prevAccumulated = accumulatedValueRef.current;
      accumulatedValueRef.current = Math.max(curMin, Math.min(curMax, prevAccumulated + deltaValue));

      const actualDeltaValue = accumulatedValueRef.current - prevAccumulated;
      if (deltaValue !== 0) {
        lastPointerXRef.current += deltaX * (actualDeltaValue / deltaValue);
      } else {
        lastPointerXRef.current = clientX;
      }

      // One React update per frame: a high-rate mouse fires many moves per frame and
      // each one would otherwise re-render the whole Develop panel.
      pendingDragValueRef.current = snapToStepRef.current(accumulatedValueRef.current);
      if (dragFrameRef.current === undefined) {
        dragFrameRef.current = requestAnimationFrame(flushDragValue);
      }
    };

    const flushDragValue = () => {
      dragFrameRef.current = undefined;
      const pending = pendingDragValueRef.current;
      if (pending === null) return;
      pendingDragValueRef.current = null;
      setDisplayValue(pending);
      onChangeRef.current({ target: { value: pending } });
    };

    const handlePointerUp = () => {
      if (dragFrameRef.current !== undefined) {
        cancelAnimationFrame(dragFrameRef.current);
      }
      flushDragValue();
      lastUpTime.current = Date.now();
      pendingTouchRef.current = null;
      suppressTouchChangeRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('touchcancel', handlePointerUp);

    return () => {
      if (dragFrameRef.current !== undefined) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = undefined;
      }
      pendingDragValueRef.current = null;
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('touchcancel', handlePointerUp);
    };
  }, [disabled, isDragging]);

  useEffect(() => {
    if (isDragging) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    if (isWheelActivelyChangingRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setDisplayValue(value);
      return;
    }

    const startValue = displayValue;
    const endValue = value;
    const duration = 300;
    let startTime: number | null = null;

    const easeInOut = (t: number) => t * t * (3 - 2 * t);

    const animate = (timestamp: number) => {
      if (!startTime) {
        startTime = timestamp;
      }

      const progress = timestamp - startTime;
      const linearFraction = Math.min(progress / duration, 1);
      const easedFraction = easeInOut(linearFraction);
      const currentValue = startValue + (endValue - startValue) * easedFraction;
      setDisplayValue(currentValue);

      if (linearFraction < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [value, isDragging]);

  const formatNumber = useCallback(
    (n: number) => {
      if (formatValue) {
        return formatValue(n);
      }
      const rounded = decimalPlaces > 0 && n === 0 ? 0 : parseFloat(n.toFixed(decimalPlaces));
      const text = decimalPlaces > 0 && n === 0 ? '0' : rounded.toFixed(decimalPlaces);
      if (min < 0 && rounded > 0) {
        return `+${text}`;
      }
      return text;
    },
    [formatValue, decimalPlaces, min],
  );

  useEffect(() => {
    if (!isEditing) {
      setInputValue(formatNumber(value));
    }
  }, [value, isEditing, formatNumber]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleReset = () => {
    if (disabled) return;

    const syntheticEvent = {
      target: {
        value: defaultValue,
      },
    };
    onChange(syntheticEvent);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || suppressTouchChangeRef.current) {
      return;
    }

    if (!isDragging) {
      setDisplayValue(Number(e.target.value));
      onChange(e);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (Date.now() - lastUpTime.current < DOUBLE_CLICK_THRESHOLD_MS) {
      e.preventDefault();
      return;
    }
    e.preventDefault();

    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawValue = min + fraction * (max - min);
    const snappedValue = snapToStep(rawValue);

    accumulatedValueRef.current = rawValue;
    lastPointerXRef.current = e.clientX;

    setIsDragging(true);
    setDisplayValue(snappedValue);
    onChange({ target: { value: snappedValue } });
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.touches.length === 0) return;

    const touch = e.touches[0];
    suppressTouchChangeRef.current = true;

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;

    const rect = inputEl.getBoundingClientRect();
    const fraction = max !== min ? (displayValue - min) / (max - min) : 0;
    const thumbX = rect.left + Math.max(0, Math.min(1, fraction)) * rect.width;

    if (Math.abs(touch.clientX - thumbX) > TOUCH_THUMB_HIT_RADIUS_PX) {
      pendingTouchRef.current = null;
      return;
    }

    pendingTouchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      latestX: touch.clientX,
      startValue: displayValue,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (isDragging || !pendingTouchRef.current || e.touches.length === 0) return;

    const touch = e.touches[0];
    const pendingTouch = pendingTouchRef.current;
    pendingTouch.latestX = touch.clientX;

    const deltaX = touch.clientX - pendingTouch.startX;
    const deltaY = touch.clientY - pendingTouch.startY;

    if (Math.abs(deltaY) > TOUCH_DRAG_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      pendingTouchRef.current = null;
      return;
    }

    if (Math.abs(deltaX) < TOUCH_DRAG_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    const inputEl = rangeInputRef.current;
    if (!inputEl) return;

    const rect = inputEl.getBoundingClientRect();
    const multiplier = hasFineAdjustmentModifier(e) ? FINE_ADJUSTMENT_MULTIPLIER : 1;
    const rawValue = pendingTouch.startValue + (deltaX / rect.width) * (max - min) * multiplier;
    const snappedValue = snapToStep(rawValue);

    accumulatedValueRef.current = rawValue;
    lastPointerXRef.current = touch.clientX;
    pendingTouchRef.current = null;

    if (e.cancelable) {
      e.preventDefault();
    }

    setIsDragging(true);
    setDisplayValue(snappedValue);
    onChange({ target: { value: snappedValue } });
  };

  const handleTouchEnd = () => {
    pendingTouchRef.current = null;
    suppressTouchChangeRef.current = false;
  };

  const handleValueClick = () => {
    if (disabled) return;

    setIsEditing(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;

    const textVal = e.target.value;
    if (!/^[0-9.,+\-]*$/.test(textVal)) {
      return;
    }
    setInputValue(textVal);
    const parsedValue = parseValue
      ? parseValue(textVal)
      : parseFloat(textVal.replace(',', '.').replace('+', ''));
    if (parsedValue != null && !isNaN(parsedValue)) {
      const clampedValue = Math.max(min, Math.min(max, parsedValue));
      onChange({
        target: {
          value: clampedValue,
        },
      });
    }
  };

  const handleInputCommit = () => {
    if (disabled) {
      setInputValue(formatNumber(value));
      setIsEditing(false);
      return;
    }

    const parsed = parseValue
      ? parseValue(inputValue)
      : parseFloat(inputValue.replace(',', '.').replace('+', ''));
    const newValue =
      parsed == null || isNaN(parsed) ? value : Math.max(min, Math.min(max, parsed));
    const syntheticEvent = {
      target: {
        value: newValue,
      },
    };
    onChange(syntheticEvent);
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'Enter') {
      handleInputCommit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setInputValue(formatNumber(value));
      setIsEditing(false);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      let currentNum = parseValue
        ? parseValue(inputValue)
        : parseFloat(inputValue.replace(',', '.').replace('+', ''));
      if (currentNum == null || isNaN(currentNum)) {
        currentNum = value;
      }
      const direction = e.key === 'ArrowUp' ? 1 : -1;
      const newValue = currentNum + direction * step;
      const snappedNewValue = snapToStep(newValue);
      setInputValue(String(snappedNewValue));
      onChange({
        target: {
          value: snappedNewValue,
        },
      });
    }
  };

  const handleRangeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.currentTarget.blur();
      return;
    }
    if (GLOBAL_KEYS.includes(e.key)) {
      e.currentTarget.blur();
    }
  };

  const numericValue = isNaN(Number(value)) ? 0 : Number(value);
  const shownValue = formatNumber(isDragging ? displayValue : numericValue);
  const stacked = layout === 'stacked';
  const gradientTrack = !!trackClassName && (trackClassName.startsWith('cg-') || trackClassName.startsWith('calibration-'));
  const trackH = stacked ? (thick ? 'h-2.5' : 'h-1.5') : thick ? 'h-2' : 'h-1';
  const hitH = stacked ? (thick ? 'h-5' : 'h-4') : thick ? 'h-4' : 'h-3';
  const textCls =
    tone === 'light' ? 'text-neutral-800' : tone === 'theme' ? 'text-text-primary' : 'text-white';
  const inputCls =
    tone === 'light'
      ? 'text-neutral-800 bg-neutral-100 border-neutral-300'
      : tone === 'theme'
        ? 'text-text-primary bg-surface border-border-color'
        : 'text-white bg-card-active border-gray-500';
  const defaultTrack =
    tone === 'light' ? 'bg-neutral-200' : tone === 'theme' ? 'bg-card-active' : 'bg-card-active';

  return (
    <div
      className={
        stacked
          ? `mb-px group grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 ${thick ? 'gap-y-1' : 'gap-y-2'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${emphasized ? 'rounded bg-neutral-100' : ''}`
          : `mb-0.5 group grid grid-cols-[7.25rem_minmax(0,1fr)_2.75rem] items-center gap-x-1 min-h-[28px] py-1 ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${emphasized ? 'rounded bg-white/10' : ''}`
      }
      ref={containerRef}
    >
      <div
        className={`min-w-0 grid ${stacked ? 'text-left' : 'text-right'} ${typeof label === 'string' && !disabled ? 'cursor-pointer' : ''}`}
        onClick={typeof label === 'string' && !disabled ? handleReset : undefined}
        onDoubleClick={typeof label === 'string' && !disabled ? handleReset : undefined}
        onMouseEnter={typeof label === 'string' && !disabled ? () => setIsLabelHovered(true) : undefined}
        onMouseLeave={typeof label === 'string' && !disabled ? () => setIsLabelHovered(false) : undefined}
      >
        <span
          aria-hidden={isLabelHovered && typeof label === 'string'}
          className={`col-start-1 row-start-1 text-[11px] font-medium ${textCls} leading-5 py-px truncate select-none transition-opacity duration-200 ease-in-out ${
            isLabelHovered && typeof label === 'string' ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {label}
        </span>
        {typeof label === 'string' && (
          <span
            aria-hidden={!isLabelHovered}
            className={`col-start-1 row-start-1 text-[11px] font-medium ${textCls} leading-5 py-px truncate select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
              isLabelHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {t('ui.slider.reset')}
          </span>
        )}
      </div>

      <div className={`relative w-full ${hitH} ${stacked ? 'col-span-2 row-start-2' : ''}`}>
        <div
          className={`absolute top-1/2 left-0 w-full ${trackH} -translate-y-1/2 rounded-full pointer-events-none ${
            gradientTrack ? 'ring-1 ring-black/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]' : ''
          } ${trackClassName || defaultTrack}`}
        />
        {!gradientTrack && (
          <div
            className={`absolute top-1/2 ${trackH} -translate-y-1/2 rounded-full pointer-events-none bg-accent/25`}
            style={{
              left: `${Math.min(fillPercentage, originPercentage)}%`,
              width: `${Math.abs(fillPercentage - originPercentage)}%`,
            }}
          />
        )}
        <input
          ref={rangeInputRef}
          className={`absolute top-1/2 left-0 w-full ${trackH} appearance-none bg-transparent cursor-pointer m-0 p-0 slider-input z-10 ${
            gradientTrack ? 'slider-on-gradient' : ''
          } ${isDragging ? 'slider-thumb-active' : ''} ${disabled ? 'cursor-not-allowed' : ''}`}
          disabled={disabled}
          style={{ margin: 0, touchAction: isDragging ? 'none' : 'pan-y' }}
          max={String(max)}
          min={String(min)}
          onChange={handleChange}
          onDoubleClick={handleReset}
          onKeyDown={handleRangeKeyDown}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          step={String(step)}
          type="range"
          value={displayValue}
        />
      </div>

      <div className={`min-w-0 text-right tabular-nums whitespace-nowrap ${stacked ? 'col-start-2 row-start-1' : ''}`}>
        {isEditing ? (
          <input
            className={`w-full text-[11px] text-right ${inputCls} border rounded-sm px-0.5 py-0 outline-none focus:ring-1 focus:ring-blue-500`}
            disabled={disabled}
            max={max}
            min={min}
            onBlur={handleInputCommit}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            ref={inputRef}
            step={step}
            type="text"
            value={inputValue}
          />
        ) : (
          <span
            className={`inline-flex items-center justify-end gap-px text-[11px] leading-5 ${textCls} select-none ${disabled ? '' : 'cursor-text'}`}
            onClick={disabled ? undefined : handleValueClick}
            onDoubleClick={disabled ? undefined : handleReset}
            data-tooltip={disabled ? undefined : t('ui.slider.clickToEdit')}
          >
            <span className="tabular-nums leading-5">{shownValue}</span>
            {suffix ? <span className="text-[11px] leading-5">{suffix}</span> : null}
          </span>
        )}
      </div>
    </div>
  );
};

const MemoSliderInner = React.memo(SliderInner);

/**
 * Callers pass inline callbacks, so a plain memo would never hit. The callbacks are
 * routed through a ref (always the latest closure, never a stale one) and only the
 * data props decide whether a slider re-renders, so dragging one slider no longer
 * re-renders all the others. formatValue/parseValue pass through untouched: their
 * output depends on caller state (e.g. as-shot Kelvin), so they must stay reactive.
 */
const Slider = (props: SliderProps) => {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const stable = useMemo(
    () => ({
      onChange: (event: SliderChangeEvent) => latest.current.onChange(event),
      onDragStateChange: (state: boolean) => latest.current.onDragStateChange?.(state),
    }),
    [],
  );
  return (
    <MemoSliderInner
      {...props}
      onChange={stable.onChange}
      onDragStateChange={stable.onDragStateChange}
    />
  );
};

export default Slider;
