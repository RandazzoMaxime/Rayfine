import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Globe,
  Images,
  Frame,
  Map as MapIcon,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { useEditorStore } from '../../store/useEditorStore';
import { useUIStore } from '../../store/useUIStore';
import { useShallow } from 'zustand/react/shallow';

export type AppModule = 'library' | 'develop' | 'map' | 'border' | 'web';

/** Map/Border/Web — live layout shells (not pure stubs). Book/Slideshow modules were removed; Print became Border. */
const SHELL_MODULES: AppModule[] = ['map', 'border', 'web'];
/** @deprecated use SHELL_MODULES */
const STUB_MODULES = SHELL_MODULES;

interface ModuleDef {
  id: AppModule;
  labelKey: string;
  tooltipKey: string;
  icon: typeof Images;
  /** full = Library/Develop; shell = Map/Border/Web with ModuleShell content */
  kind: 'full' | 'shell';
}

/** Module order mirrors Lightroom Classic's top module picker (public UI structure). */
const MODULES: ModuleDef[] = [
  {
    id: 'library',
    labelKey: 'ui.moduleBar.library',
    tooltipKey: 'ui.moduleBar.tooltips.library',
    icon: Images,
    kind: 'full',
  },
  {
    id: 'develop',
    labelKey: 'ui.moduleBar.develop',
    tooltipKey: 'ui.moduleBar.tooltips.develop',
    icon: SlidersHorizontal,
    kind: 'full',
  },
  {
    id: 'map',
    labelKey: 'ui.moduleBar.map',
    tooltipKey: 'ui.moduleBar.tooltips.map',
    icon: MapIcon,
    kind: 'shell',
  },
  {
    id: 'border',
    labelKey: 'ui.moduleBar.border',
    tooltipKey: 'ui.moduleBar.tooltips.border',
    icon: Frame,
    kind: 'shell',
  },
  {
    id: 'web',
    labelKey: 'ui.moduleBar.web',
    tooltipKey: 'ui.moduleBar.tooltips.web',
    icon: Globe,
    kind: 'shell',
  },
];

interface ModuleBarProps {
  onBackToLibrary(): void;
  onOpenDevelop(path: string | null): void;
  isInstantTransition?: boolean;
}

/**
 * Top module strip inspired by Lightroom Classic's public module bar layout
 * (Library | Develop | Map | Border | Web), with original
 * RustROOM styling — no Adobe trademarks or assets.
 */
export default function ModuleBar({ onBackToLibrary, onOpenDevelop, isInstantTransition }: ModuleBarProps) {
  const { t } = useTranslation();
  const { selectedImage } = useEditorStore(useShallow((s) => ({ selectedImage: s.selectedImage })));
  const { activeView, setUI } = useUIStore(
    useShallow((s) => ({
      activeView: s.activeView,
      setUI: s.setUI,
    })),
  );

  // Prefer explicit module views; otherwise Develop when an image is open, else Library.
  const activeModule: AppModule = (STUB_MODULES as string[]).includes(activeView)
    ? (activeView as AppModule)
    : activeView === 'develop' || selectedImage
      ? 'develop'
      : 'library';

  const handleSelect = (mod: ModuleDef) => {
    if (mod.id === 'library') {
      setUI({ activeView: 'library' });
      if (selectedImage) onBackToLibrary();
      return;
    }
    if (mod.id === 'develop') {
      setUI({ activeView: 'develop' });
      const path = selectedImage?.path ?? null;
      onOpenDevelop(path);
      return;
    }
    // Map / Border / Web — layout shells (LR public structure)
    setUI({ activeView: mod.id });
  };

  return (
    <div
      className={clsx(
        'relative flex items-center justify-between h-9 px-3 shrink-0 border-b border-border-color/50',
        'bg-bg-secondary text-text-primary select-none',
        !isInstantTransition && 'transition-colors duration-200',
      )}
      role="navigation"
      aria-label="Modules"
    >
      <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-text-secondary">Rayfine</span>

      <div className="flex items-stretch h-full ml-auto">
        <button
          type="button"
          className="relative flex items-center px-2 h-full text-text-secondary hover:text-text-primary"
          data-tooltip={t('ui.moduleBar.tooltips.settings' as any, { defaultValue: 'Paramètres' })}
          aria-label={t('ui.moduleBar.tooltips.settings' as any, { defaultValue: 'Paramètres' })}
          onClick={() => setUI({ isCustomizeModalOpen: true })}
        >
          <Settings size={14} strokeWidth={1.8} />
        </button>
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          const isActive = activeModule === mod.id;
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => handleSelect(mod)}
              data-tooltip={t(mod.tooltipKey as any)}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'relative flex items-center gap-1.5 px-3 h-full text-[11px] font-semibold tracking-[0.08em] uppercase',
                'transition-colors duration-150',
                isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon size={12} strokeWidth={isActive ? 2.3 : 1.6} className="opacity-90" />
              <span>{t(mod.labelKey as any)}</span>
              {isActive && (
                <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-accent" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { SHELL_MODULES, STUB_MODULES, MODULES };
