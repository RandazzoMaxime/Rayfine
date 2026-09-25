import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';

export interface PanelSelectOption {
  label: string;
  value: string;
}

interface PanelSelectProps {
  value: string;
  options: PanelSelectOption[];
  onChange(value: string): void;
  className?: string;
  disabled?: boolean;
  /** sm = compact (Develop). md = export dialog. */
  size?: 'sm' | 'md';
}

/** Compact custom select — native <option> menus ignore CSS (white-on-white on Windows). */
export default function PanelSelect({ value, options, onChange, className, disabled, size = 'sm' }: PanelSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={clsx('relative min-w-0', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'w-full px-1.5 rounded flex items-center gap-1 text-left',
          size === 'md' ? 'h-7' : 'h-6',
          'bg-bg-primary border border-border-color/50 text-[11px] text-text-primary',
          'hover:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <span className="flex-1 min-w-0 truncate">{selected?.label ?? ''}</span>
        <ChevronDown size={12} className={clsx('shrink-0 text-text-secondary', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-50 left-0 right-0 top-full mt-0.5 max-h-56 overflow-y-auto custom-scrollbar rounded-md border border-border-color bg-bg-secondary shadow-xl py-0.5"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={clsx(
                  'w-full px-2 py-1 text-left text-[11px] flex items-center gap-1.5',
                  active
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-primary hover:bg-card-active/70',
                )}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="w-3 shrink-0">
                  {active ? <Check size={11} className="text-text-primary" /> : null}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
