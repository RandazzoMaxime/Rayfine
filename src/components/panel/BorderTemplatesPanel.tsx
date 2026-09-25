import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants, TextWeights } from '../../types/typography';
import {
  BORDER_LAYOUTS,
  BORDER_MAX_PHOTOS,
  computeCellRects,
  type BorderAspect,
  type TemplateRef,
} from '../../utils/borderLayout';

interface BorderTemplatesPanelProps {
  width: number;
  aspect: BorderAspect;
  active: TemplateRef;
  onSelect(ref: TemplateRef): void;
  onHide(): void;
  isInstantTransition?: boolean;
}

/** Schematic template preview in the current canvas aspect ratio. */
function TemplateThumb({ aspect, layout }: { aspect: BorderAspect; layout: TemplateRef }) {
  const max = Math.max(aspect.w, aspect.h);
  const W = (100 * aspect.w) / max;
  const H = (100 * aspect.h) / max;
  const rects = computeCellRects(BORDER_LAYOUTS[layout.count][layout.index], W, H, 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
      <rect x={0} y={0} width={W} height={H} fill="currentColor" opacity={0.18} />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="currentColor" opacity={0.75} />
      ))}
    </svg>
  );
}

/**
 * Border module left column — same chrome as the Develop left panel, with layout templates
 * grouped by photo count.
 */
export default function BorderTemplatesPanel({
  width,
  aspect,
  active,
  onSelect,
  onHide,
  isInstantTransition,
}: BorderTemplatesPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div
      className={clsx(
        'h-full flex flex-col shrink-0 bg-bg-secondary rounded-lg overflow-hidden border border-border-color/30',
        !isInstantTransition && 'transition-[width] duration-200',
      )}
      style={{ width }}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-border-color/40 shrink-0">
        <Text variant={TextVariants.small} weight={TextWeights.semibold} className="uppercase tracking-wider text-[10px]">
          {t('ui.moduleBar.border' as any, { defaultValue: 'Border' })}
        </Text>
        <button
          type="button"
          className="p-1 rounded hover:bg-card-active text-text-secondary"
          data-tooltip={t('ui.developLeft.hide' as any)}
          onClick={onHide}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-card-active shrink-0"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            <LayoutGrid size={12} />
            {t('ui.border.templates' as any, { defaultValue: 'Templates' })}
          </span>
          <ChevronDown size={14} className={clsx('text-text-secondary transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-2 pb-3 space-y-3">
            {Array.from({ length: BORDER_MAX_PHOTOS }, (_, i) => i + 1).map((count) => (
              <section key={count} className="space-y-1.5">
                <div className="px-0.5 text-[10px] uppercase tracking-wider text-text-secondary">
                  {count === 1
                    ? t('ui.border.onePhoto' as any, { defaultValue: '1 photo' })
                    : t('ui.border.nPhotos' as any, { defaultValue: '{{count}} photos', count })}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {BORDER_LAYOUTS[count].map((_, index) => {
                    const isActive = active.count === count && active.index === index;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => onSelect({ count, index })}
                        aria-pressed={isActive}
                        className={clsx(
                          'h-14 rounded p-1.5 flex items-center justify-center border transition-colors',
                          isActive
                            ? 'bg-card-active border-white/60 text-text-primary'
                            : 'border-transparent text-text-secondary hover:bg-card-active hover:text-text-primary',
                        )}
                      >
                        <TemplateThumb aspect={aspect} layout={{ count, index }} />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsed rail to re-show the Border templates column (mirrors DevelopLeftRail). */
export function BorderTemplatesRail({ onShow }: { onShow(): void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onShow}
      className="h-full w-8 shrink-0 flex flex-col items-center justify-start pt-2 gap-2 bg-bg-secondary rounded-lg border border-border-color/30 text-text-secondary hover:text-text-primary"
      data-tooltip={t('ui.border.showTemplates' as any, { defaultValue: 'Show templates' })}
    >
      <ChevronRight size={14} />
      <LayoutGrid size={14} />
    </button>
  );
}
