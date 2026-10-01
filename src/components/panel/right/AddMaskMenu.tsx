import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type AddMaskAction =
  | 'subject'
  | 'sky'
  | 'background'
  | 'foreground'
  | 'brush'
  | 'flow'
  | 'linear'
  | 'radial'
  | 'color'
  | 'luminance'
  | 'depth'
  | 'all';

type Anchor = { left: number; top: number; bottom: number };

interface AddMaskMenuProps {
  anchor: Anchor;
  onClose(): void;
  onPick(action: AddMaskAction): void;
  title?: string;
}

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

function SubjectGlyph({ size = 28 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.6 1.8" />
      <rect x="2.2" y="2.2" width="3.2" height="3.2" rx="0.4" fill="currentColor" />
      <rect x="18.6" y="2.2" width="3.2" height="3.2" rx="0.4" fill="currentColor" />
      <rect x="2.2" y="18.6" width="3.2" height="3.2" rx="0.4" fill="currentColor" />
      <rect x="18.6" y="18.6" width="3.2" height="3.2" rx="0.4" fill="currentColor" />
      <circle cx="12" cy="10" r="2.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.1 17.2c.7-2.1 2.1-3.1 3.9-3.1s3.2 1 3.9 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </Glyph>
  );
}

function SkyGlyph({ size = 28 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 15.2 8.2 11.4 12 14.2 16.2 9.2 20 14.2V19.2H4Z" fill="currentColor" opacity="0.85" />
      <path d="M6.2 6.4h11.6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.5 1.5" strokeLinecap="round" />
    </Glyph>
  );
}

function BackgroundGlyph({ size = 28 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.6 1.8" />
      <circle cx="12" cy="10" r="2.1" fill="currentColor" />
      <path d="M8.1 17.4c.7-2.1 2.1-3.2 3.9-3.2s3.2 1.1 3.9 3.2" fill="currentColor" />
    </Glyph>
  );
}

function LandscapeGlyph() {
  return (
    <Glyph>
      <path d="M3 17.5 8.2 10l3.3 3.6L15.2 8 21 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M3 19.2h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Glyph>
  );
}

function ObjectsGlyph() {
  return (
    <Glyph>
      <rect x="3.5" y="6.5" width="11" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="3.5" width="11" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
    </Glyph>
  );
}

function BrushGlyph() {
  return (
    <Glyph>
      <path d="M14.2 4.2 19.8 9.8 9.2 20.2H4.2V15.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12.6 5.8 18.2 11.4" stroke="currentColor" strokeWidth="1.5" />
    </Glyph>
  );
}

function LinearGlyph() {
  const id = useId().replace(/:/g, '');
  return (
    <Glyph>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="16" height="16" rx="1.5" fill={`url(#${id})`} stroke="currentColor" strokeWidth="1.3" />
    </Glyph>
  );
}

function RadialGlyph() {
  const id = useId().replace(/:/g, '');
  return (
    <Glyph>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.12" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="8" fill={`url(#${id})`} stroke="currentColor" strokeWidth="1.3" />
    </Glyph>
  );
}

function RangeGlyph() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M12 4.2v2.4M12 17.4v2.4M4.2 12h2.4M17.4 12h2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Glyph>
  );
}

type Row = {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  action?: AddMaskAction;
  children?: Array<{ id: string; label: string; action: AddMaskAction }>;
};

export default function AddMaskMenu({ anchor, onClose, onPick, title }: AddMaskMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  const tiles: Array<{ action: AddMaskAction; label: string; icon: ReactNode }> = [
    { action: 'subject', label: t('masks.types.subject'), icon: <SubjectGlyph /> },
    { action: 'sky', label: t('masks.types.sky'), icon: <SkyGlyph /> },
    { action: 'background', label: t('editor.masks.addMenu.background'), icon: <BackgroundGlyph /> },
  ];

  const rows: Row[] = [
    {
      id: 'landscape',
      label: t('editor.masks.addMenu.landscape'),
      icon: <LandscapeGlyph />,
      children: [{ id: 'sky', label: t('masks.types.sky'), action: 'sky' }],
    },
    {
      id: 'objects',
      label: t('editor.masks.addMenu.objects'),
      icon: <ObjectsGlyph />,
      children: [
        { id: 'foreground', label: t('masks.types.foreground'), action: 'foreground' },
        { id: 'all', label: t('masks.types.all'), action: 'all' },
      ],
    },
    { id: 'brush', label: t('masks.types.brush'), icon: <BrushGlyph />, shortcut: 'K', action: 'brush' },
    { id: 'flow', label: t('masks.types.flow'), icon: <BrushGlyph />, action: 'flow' },
    { id: 'linear', label: t('editor.masks.addMenu.linear'), icon: <LinearGlyph />, shortcut: 'M', action: 'linear' },
    {
      id: 'radial',
      label: t('editor.masks.addMenu.radial'),
      icon: <RadialGlyph />,
      shortcut: t('editor.masks.addMenu.shiftM'),
      action: 'radial',
    },
    {
      id: 'range',
      label: t('editor.masks.addMenu.range'),
      icon: <RangeGlyph />,
      children: [
        { id: 'color', label: t('masks.types.color'), action: 'color' },
        { id: 'luminance', label: t('masks.types.luminance'), action: 'luminance' },
        { id: 'depth', label: t('masks.types.depth'), action: 'depth' },
      ],
    },
  ];

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  const width = 292;
  const estimatedHeight = 430;
  let left = anchor.left;
  let top = anchor.bottom + 6;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  if (top + estimatedHeight > window.innerHeight - 8) top = Math.max(8, anchor.top - estimatedHeight - 6);
  const openLeft = left > 220;

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenId(null), 160);
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[70] w-[292px] rounded-lg border border-border-color/50 bg-surface p-3 shadow-xl"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="px-1 pb-2 text-sm text-text-primary">{title || t('editor.masks.addMenu.title')}</div>
      <div className="grid grid-cols-3 gap-2 px-1">
        {tiles.map((tile) => (
          <button
            key={tile.action}
            type="button"
            className="flex flex-col items-center gap-1.5 rounded-md py-1 text-text-secondary hover:bg-card-active hover:text-text-primary"
            onClick={() => onPick(tile.action)}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-md border border-border-color/70">
              {tile.icon}
            </span>
            <span className="text-xs">{tile.label}</span>
          </button>
        ))}
      </div>
      <div className="mx-1 my-2 h-px bg-border-color/60" />
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.id}
            className="relative"
            onMouseEnter={() => {
              cancelClose();
              setOpenId(row.children ? row.id : null);
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-text-primary hover:bg-card-active"
              onClick={() => {
                if (row.action) onPick(row.action);
                else if (row.children) setOpenId((current) => (current === row.id ? null : row.id));
              }}
            >
              <span className="text-text-secondary">{row.icon}</span>
              <span className="flex-1">{row.label}</span>
              {row.shortcut && <span className="text-xs text-text-secondary">{row.shortcut}</span>}
              {row.children && <ChevronRight size={14} className="text-text-secondary" />}
            </button>
            {row.children && openId === row.id && (
              <div
                className={`absolute top-0 z-10 min-w-40 rounded-lg border border-border-color/50 bg-surface p-1 shadow-xl ${
                  openLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onMouseEnter={cancelClose}
              >
                {row.children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-text-primary hover:bg-card-active"
                    onClick={() => onPick(child.action)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
