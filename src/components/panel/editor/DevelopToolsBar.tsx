import clsx from 'clsx';
import type { ComponentType } from 'react';
import { Crop, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InpaintIcon, MaskIcon } from '../../icons/DevelopToolIcons';
import { Panel } from '../../ui/AppProperties';
import { useUIStore } from '../../../store/useUIStore';
import { useShallow } from 'zustand/react/shallow';

type BarIcon = ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
}>;

interface ToolDef {
  id: Panel;
  icon: BarIcon;
  labelKey: string;
  short: string;
}

/** Histogram strip: Adjustments · Crop · Inpaint · Mask. */
const TOOLS: ToolDef[] = [
  { id: Panel.Adjustments, icon: SlidersHorizontal, labelKey: 'editor.switcher.tooltips.adjust', short: 'Basic' },
  { id: Panel.Crop, icon: Crop, labelKey: 'editor.switcher.tooltips.crop', short: 'Crop' },
  { id: Panel.Ai, icon: InpaintIcon, labelKey: 'editor.switcher.tooltips.inpaint', short: 'Healing' },
  { id: Panel.Masks, icon: MaskIcon, labelKey: 'editor.switcher.tooltips.masks', short: 'Masking' },
];

interface DevelopToolsBarProps {
  onPanelSelect(id: Panel): void;
  isInstantTransition?: boolean;
}

export default function DevelopToolsBar({ onPanelSelect, isInstantTransition }: DevelopToolsBarProps) {
  const { t } = useTranslation();
  const { activeRightPanel } = useUIStore(useShallow((s) => ({ activeRightPanel: s.activeRightPanel })));

  return (
    <div
      className={clsx(
        'flex items-center justify-center h-8 shrink-0 px-1.5 gap-1 border-b border-border-color/40',
        !isInstantTransition && 'transition-colors duration-150',
      )}
      role="toolbar"
      aria-label="Develop tools"
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const active = activeRightPanel === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onPanelSelect(tool.id)}
            data-tooltip={t(tool.labelKey as any)}
            className={clsx(
              'relative flex items-center justify-center w-8 h-7 rounded',
              'transition-colors duration-100',
              active
                ? 'bg-card-active text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/70',
            )}
          >
            <Icon size={15} strokeWidth={active ? 2.25 : 1.75} />
          </button>
        );
      })}
    </div>
  );
}
