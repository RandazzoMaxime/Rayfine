import { ReactNode } from 'react';
import clsx from 'clsx';
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
}: ModuleShellProps) {
  const { t } = useTranslation();

  const shell = (
    <div
      className="flex flex-1 min-h-0 min-w-0 w-full rounded-lg overflow-hidden border border-border-color/40 bg-bg-secondary"
      data-module={moduleId}
    >
      {/* Left rail — mirrors LR collections / preview / templates column */}
      {!leftPanel && (
        <aside className="w-[220px] shrink-0 border-r border-border-color/40 bg-[#3a3a3a] flex flex-col min-h-0">
          <div className="h-8 px-3 flex items-center border-b border-black/20 text-[10px] font-semibold tracking-[0.14em] uppercase text-white/50">
            {title}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 text-[12px] text-white/70">
            {left ?? (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35">
                  {t('ui.moduleShell.panels' as any, { defaultValue: 'Panels' })}
                </div>
                <div className="px-2 py-1.5 rounded bg-white/5 text-white/80">
                  {t('ui.moduleShell.preview' as any, { defaultValue: 'Preview' })}
                </div>
                <div className="px-2 py-1.5 rounded hover:bg-white/5 cursor-default">
                  {t('ui.moduleShell.templates' as any, { defaultValue: 'Templates' })}
                </div>
                <div className="px-2 py-1.5 rounded hover:bg-white/5 cursor-default">
                  {t('ui.moduleShell.collections' as any, { defaultValue: 'Collections' })}
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Center canvas */}
      <main className="flex-1 min-w-0 flex flex-col bg-[#2b2b2b]">
        <div className="h-9 px-4 flex items-center justify-between border-b border-black/25 shrink-0">
          <div className="flex items-center gap-2 text-white/85">
            <Icon size={15} strokeWidth={1.8} />
            <span className="text-[12px] font-semibold tracking-wide uppercase">{title}</span>
            <span className="text-[11px] text-white/40 hidden sm:inline">— {subtitle}</span>
          </div>
          {onBackToLibrary && (
            <button
              type="button"
              onClick={onBackToLibrary}
              className="text-[11px] uppercase tracking-wide text-white/55 hover:text-white px-2 py-1 rounded hover:bg-white/10"
            >
              {t('ui.moduleBar.library')}
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          {children ?? (
            <div className="max-w-md text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <Icon size={26} className="text-white/50" strokeWidth={1.5} />
              </div>
              <h2 className="text-[15px] font-semibold text-white/85 tracking-wide">{title}</h2>
              <p className="text-[12px] leading-relaxed text-white/45">{subtitle}</p>
              <p className="text-[11px] text-white/30">
                {t('ui.moduleShell.emptyNote' as any, {
                  defaultValue:
                    'Select photos in Library, then open this module. Original RustROOM chrome · public LR layout structure.',
                })}
              </p>
            </div>
          )}
        </div>
        {/* Bottom toolbar strip like LR module toolbars */}
        <div className="h-8 shrink-0 border-t border-black/25 bg-[#333] flex items-center px-3 gap-3 text-[10px] uppercase tracking-wider text-white/40">
          <span>{t('ui.moduleShell.toolbar' as any, { defaultValue: 'Toolbar' })}</span>
          <span className="w-px h-3 bg-white/15" />
          <span className="text-white/35 normal-case tracking-normal truncate">
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
      <aside className="w-[260px] shrink-0 border-l border-border-color/40 bg-[#3a3a3a] flex flex-col min-h-0">
        <div className="h-8 px-3 flex items-center border-b border-black/20 text-[10px] font-semibold tracking-[0.14em] uppercase text-white/50">
          {t('ui.moduleShell.options' as any, { defaultValue: 'Options' })}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 text-[12px] text-white/65">
          {right ?? (
            <>
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-white/35">
                  {t('ui.moduleShell.layout' as any, { defaultValue: 'Layout' })}
                </div>
                <div className="h-8 rounded bg-white/5 border border-white/10" />
                <div className="h-8 rounded bg-white/5 border border-white/10" />
              </section>
              <section className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-white/35">
                  {t('ui.moduleShell.output' as any, { defaultValue: 'Output' })}
                </div>
                <div className="h-8 rounded bg-white/5 border border-white/10" />
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
