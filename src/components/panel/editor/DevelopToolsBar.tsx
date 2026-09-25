import clsx from 'clsx';
import {
  Crop,
  Layers,
  Paintbrush,
  SlidersHorizontal,
  Info,
  FileInput,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../../ui/AppProperties';
import { useUIStore } from '../../../store/useUIStore';
import { useShallow } from 'zustand/react/shallow';

interface ToolDef {
  id: Panel;
  icon: LucideIcon;
  labelKey: string;
  short: string;
}

/** Icon tool strip under the Develop histogram (Lightroom Classic layout). */
const TOOLS: ToolDef[] = [
  { id: Panel.Adjustments, icon: SlidersHorizontal, labelKey: 'editor.switcher.tooltips.adjust', short: 'Basic' },
  { id: Panel.Crop, icon: Crop, labelKey: 'editor.switcher.tooltips.crop', short: 'Crop' },
  { id: Panel.Masks, icon: Layers, labelKey: 'editor.switcher.tooltips.masks', short: 'Masking' },
  { id: Panel.Ai, icon: Paintbrush, labelKey: 'editor.switcher.tooltips.inpaint', short: 'Healing' },
  { id: Panel.Metadata, icon: Info, labelKey: 'editor.switcher.tooltips.info', short: 'Metadata' },
  { id: Panel.Export, icon: FileInput, labelKey: 'editor.switcher.tooltips.export', short: 'Export' },
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
        'flex items-center justify-between h-8 shrink-0 px-1.5 border-b border-border-color/40',
        !isInstantTransition && 'transition-colors duration-150',
      )}
      role="toolbar"
      aria-label="Develop tools"
    >
      {TOOLS.map((tool, idx) => {
        const Icon = tool.icon;
        const active = activeRightPanel === tool.id;
        const sepAfter = tool.id === Panel.Crop || tool.id === Panel.Ai;
        return (
          <span key={tool.id} className="contents">
          <button
            type="button"
            onClick={() => onPanelSelect(tool.id)}
            data-tooltip={t(tool.labelKey as any)}
            className={clsx(
              'relative flex items-center justify-center w-7 h-7 rounded',
              'transition-colors duration-100',
              active
                ? 'bg-card-active text-text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/70',
            )}
          >
            <Icon size={15} strokeWidth={active ? 2.25 : 1.75} />
          </button>
          {sepAfter && <span className="w-px h-4 mx-0.5 bg-border-color/50" aria-hidden />}
          </span>
        );
      })}
    </div>
  );
}
