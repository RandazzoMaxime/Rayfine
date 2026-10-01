import { motion, LayoutGroup } from 'framer-motion';
import type { ComponentType } from 'react';
import { SlidersHorizontal, Crop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InpaintIcon, MaskIcon } from '../../icons/DevelopToolIcons';
import { Panel } from '../../ui/AppProperties';

type BarIcon = ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  className?: string;
}>;

interface PanelOptions {
  icon: BarIcon;
  id: Panel;
  title: string;
}

interface RightPanelSwitcherProps {
  activePanel: Panel | null;
  onPanelSelect(id: Panel): void;
  isInstantTransition: boolean;
  layout?: 'horizontal' | 'vertical';
}

const panelGroups: Array<Array<PanelOptions>> = [
  [
    { id: Panel.Adjustments, icon: SlidersHorizontal, title: 'editor.switcher.tooltips.adjust' },
    { id: Panel.Crop, icon: Crop, title: 'editor.switcher.tooltips.crop' },
    { id: Panel.Ai, icon: InpaintIcon, title: 'editor.switcher.tooltips.inpaint' },
    { id: Panel.Masks, icon: MaskIcon, title: 'editor.switcher.tooltips.masks' },
  ],
];

export default function RightPanelSwitcher({
  activePanel,
  onPanelSelect,
  isInstantTransition,
  layout = 'vertical',
}: RightPanelSwitcherProps) {
  const { t } = useTranslation();
  const isHorizontal = layout === 'horizontal';

  return (
    <LayoutGroup id="right-panel-switcher">
    <div className={isHorizontal ? 'flex items-center justify-center overflow-x-auto p-1 gap-1' : 'flex flex-col items-center p-1 gap-1 h-full'}>
      {panelGroups.map((group, groupIndex) => (
        <div key={groupIndex} className={isHorizontal ? 'flex items-center gap-1' : 'flex flex-col gap-1'}>
          {groupIndex > 0 && (
            <div
              className={isHorizontal ? 'w-px h-6 bg-surface self-stretch my-auto' : 'w-6 h-px bg-surface self-center'}
            />
          )}
          {group.map(({ id, icon: Icon, title }) => (
            <button
              className={`relative rounded-md transition-colors duration-150 ${isHorizontal ? 'p-1.5 shrink-0' : 'p-1.5'} ${
                activePanel === id
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary'
              }`}
              key={id}
              onClick={() => onPanelSelect(id)}
              data-tooltip={t(title)}
            >
              {activePanel === id && (
                <motion.div
                  layoutId="active-panel-indicator"
                  className="absolute inset-0 bg-surface rounded-md"
                  transition={isInstantTransition ? { duration: 0 } : { type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <Icon size={20} className="relative z-10" />
            </button>
          ))}
        </div>
      ))}
    </div>
    </LayoutGroup>
  );
}
