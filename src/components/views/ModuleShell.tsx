import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';

export type ModuleId = 'map' | 'border' | 'web';
/** @deprecated use ModuleId — modules are live shells, not pure stubs */
export type StubModuleId = ModuleId;

interface ModuleShellProps {
  moduleId: ModuleId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  left?: ReactNode;
  /** Standalone left panel (Develop-style card) rendered beside the shell instead of the built-in left rail. */
  leftPanel?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  onBackToLibrary?(): void;
  /** @deprecated unused — kept so HMR never hits a bare `rightTone` identifier */
  rightTone?: 'dark' | 'light';
}

/**
 * Lightroom Classic–style three-column module shell (public layout structure).
 * Original RustROOM chrome — not Adobe assets.
 *
 * Layout: left rail | center work area | right panels, with module identity header.
 */
export default function ModuleShell({
  moduleId,
  title,
  subtitle,
  icon: Icon,
  left,
  leftPanel,
  right,
  children,
  onBackToLibrary,
  rightTone: _rightTone = 'dark',
}: ModuleShellProps) {
  const { t } = useTranslation();

  const shell = (
    <div
      className="flex flex-1 min-h-0 min-w-0 w-full rounded-lg overflow-hidden border border-border-color/40 bg-bg-secondary"
      data-module={moduleId}
    >
      {/* Left rail — mirrors LR collections / preview / templates column */}
      {!leftPanel && (
        <aside className="w-[220px] shrink-0 border-r border-border-color/40 bg-bg-secondary flex flex-col min-h-0">
          <div className="h-8 px-3 flex items-center border-b border-border-color/40 text-[10px] font-semibold tracking-[0.14em] uppercase text-text-secondary">
            {title}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 text-[12px] text-text-primary">
            {left ?? (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-secondary">
                  {t('ui.moduleShell.panels' as any, { defaultValue: 'Panels' })}
                </div>
                <div className="px-2 py-1.5 rounded bg-card-active text-text-primary">
                  {t('ui.moduleShell.preview' as any, { defaultValue: 'Preview' })}
                </div>
                <div className="px-2 py-1.5 rounded hover:bg-card-active/60 cursor-default text-text-secondary">
                  {t('ui.moduleShell.templates' as any, { defaultValue: 'Templates' })}
                </div>
                <div className="px-2 py-1.5 rounded hover:bg-card-active/60 cursor-default text-text-secondary">
                  {t('ui.moduleShell.collections' as any, { defaultValue: 'Collections' })}
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Center canvas */}
      <main className="flex-1 min-w-0 flex flex-col bg-bg-primary">
        <div className="h-9 px-4 flex items-center justify-between border-b border-border-color/40 shrink-0 bg-bg-secondary">
          <div className="flex items-center gap-2 text-text-primary">
            <Icon size={15} strokeWidth={1.8} />
            <span className="text-[12px] font-semibold tracking-wide uppercase">{title}</span>
            <span className="text-[11px] text-text-secondary hidden sm:inline">— {subtitle}</span>
          </div>
          {onBackToLibrary && (
            <button
              type="button"
              onClick={onBackToLibrary}
              className="text-[11px] uppercase tracking-wide text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-card-active"
            >
              {t('ui.moduleBar.library')}
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          {children ?? (
            <div className="max-w-md text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-surface border border-border-color/40 flex items-center justify-center">
                <Icon size={26} className="text-text-secondary" strokeWidth={1.5} />
              </div>
              <h2 className="text-[15px] font-semibold text-text-primary tracking-wide">{title}</h2>
              <p className="text-[12px] leading-relaxed text-text-secondary">{subtitle}</p>
              <p className="text-[11px] text-text-secondary/70">
                {t('ui.moduleShell.emptyNote' as any, {
                  defaultValue:
                    'Select photos in Library, then open this module. Original RustROOM chrome · public LR layout structure.',
                })}
              </p>
            </div>
          )}
        </div>
        {/* Bottom toolbar strip like LR module toolbars */}
        <div className="h-8 shrink-0 border-t border-border-color/40 bg-surface flex items-center px-3 gap-3 text-[10px] uppercase tracking-wider text-text-secondary">
          <span>{t('ui.moduleShell.toolbar' as any, { defaultValue: 'Toolbar' })}</span>
          <span className="w-px h-3 bg-border-color" />
          <span className="text-text-secondary/80 normal-case tracking-normal truncate">
            {moduleId === 'map' &&
              t('ui.moduleShell.hintMap' as any, {
                defaultValue: '←/→ pins · Enter Develop · double-click pin',
              })}
            {moduleId === 'border' &&
              t('ui.moduleShell.hintBorder' as any, {
                defaultValue: 'Click thumbnails to add/remove · drag to swap · Export JPEG',
              })}
            {moduleId === 'web' &&
              t('ui.moduleShell.hintWeb' as any, {
                defaultValue: 'Templates · Export HTML gallery · lightbox',
              })}
          </span>
        </div>
      </main>

      {/* Right panels — settings / options */}
      <aside className="w-[260px] shrink-0 border-l border-border-color/40 bg-bg-secondary flex flex-col min-h-0">
        <div className="h-8 px-3 flex items-center border-b border-border-color/40 text-[10px] font-semibold tracking-[0.14em] uppercase text-text-secondary">
          {t('ui.moduleShell.options' as any, { defaultValue: 'Options' })}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 text-[12px] text-text-primary">
          {right ?? (
            <>
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-secondary">
                  {t('ui.moduleShell.layout' as any, { defaultValue: 'Layout' })}
                </div>
                <div className="h-8 rounded bg-surface border border-border-color/40" />
                <div className="h-8 rounded bg-surface border border-border-color/40" />
              </section>
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-text-secondary">
                  {t('ui.moduleShell.output' as any, { defaultValue: 'Output' })}
                </div>
                <div className="h-8 rounded bg-surface border border-border-color/40" />
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );

  if (!leftPanel) return shell;
  return (
    <div className="flex flex-1 min-h-0 w-full gap-2">
      {leftPanel}
      {shell}
    </div>
  );
}
