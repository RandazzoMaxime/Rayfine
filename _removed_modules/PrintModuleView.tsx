import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { Printer, LayoutTemplate, Rows3, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { ImageFile, Invokes } from '../ui/AppProperties';

interface Props {
  onBackToLibrary(): void;
}

type PrintTemplate = 'single' | 'contact' | 'package2x2';

/**
 * Lightroom Classic–style Print module (public layout).
 * Live page preview from library selection + browser print.
 * Original RustROOM chrome — not Adobe assets / not a full RIP.
 */
export default function PrintModuleView({ onBackToLibrary }: Props) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<PrintTemplate>('single');
  const [marginMm, setMarginMm] = useState(12);
  const [showGuides, setShowGuides] = useState(true);
  const [paper, setPaper] = useState<'A4' | 'Letter' | '5x7'>('A4');
  const [exporting, setExporting] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);

  const { imageList, multiSelectedPaths, libraryActivePath } = useLibraryStore(
    useShallow((s) => ({
      imageList: s.imageList,
      multiSelectedPaths: s.multiSelectedPaths,
      libraryActivePath: s.libraryActivePath,
    })),
  );

  const thumbs = useProcessStore((s) => s.thumbnails);

  const selected = useMemo(() => {
    const paths =
      multiSelectedPaths.length > 0
        ? multiSelectedPaths
        : libraryActivePath
          ? [libraryActivePath]
          : imageList.slice(0, 1).map((i: ImageFile) => i.path);
    return paths
      .map((p) => imageList.find((i: ImageFile) => i.path === p))
      .filter(Boolean) as ImageFile[];
  }, [multiSelectedPaths, libraryActivePath, imageList]);

  useEffect(() => {
    const paths = selected.map((i) => i.path);
    if (paths.length === 0) return;
    invoke('update_thumbnail_queue', { paths }).catch(() => {});
  }, [selected]);

  const cells = useMemo(() => {
    if (template === 'single') return selected.slice(0, 1);
    if (template === 'package2x2') {
      const base = selected.length ? selected : [];
      const out: (ImageFile | null)[] = [];
      for (let i = 0; i < 4; i++) out.push(base[i % Math.max(1, base.length)] || null);
      return out;
    }
    // contact: up to 12
    const list = selected.length ? selected : imageList.slice(0, 12);
    return list.slice(0, 12);
  }, [template, selected, imageList]);

  const aspect = paper === 'Letter' ? 8.5 / 11 : paper === '5x7' ? 5 / 7 : 210 / 297;

  const gridClass =
    template === 'single'
      ? 'grid-cols-1 grid-rows-1'
      : template === 'package2x2'
        ? 'grid-cols-2 grid-rows-2'
        : 'grid-cols-3 grid-rows-4';

  const handlePrint = () => {
    window.print();
  };


  const handleExportHtml = async () => {
    const list = (cells as (ImageFile | null)[]).filter(Boolean) as ImageFile[];
    if (list.length === 0 && selected.length === 0) {
      toast.info(t('ui.print.noSelection' as any, { defaultValue: 'No photos selected' }));
      return;
    }
    setExporting(true);
    try {
      const filePath = await saveDialog({
        defaultPath: `print-${template}.html`,
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
        title: t('ui.print.exportHtml' as any, { defaultValue: 'Export print HTML' }),
      });
      if (!filePath) return;
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const aspectCss = paper === 'Letter' ? '8.5/11' : paper === '5x7' ? '5/7' : '210/297';
      const gridCss =
        template === 'single'
          ? 'grid-template-columns:1fr;grid-template-rows:1fr;'
          : template === 'package2x2'
            ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;'
            : 'grid-template-columns:1fr 1fr 1fr;grid-template-rows:repeat(4,1fr);';
      const cellHtml = (cells as (ImageFile | null)[])
        .map((img, idx) => {
          if (!img) return `<div class="cell empty">Empty</div>`;
          const n = img.path.split(/[\\/]/).pop()?.split('?')[0] || '';
          const src = thumbs[img.path] || '';
          const portable =
            src && (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://'))
              ? src
              : '';
          const imgTag = portable
            ? `<img src="${portable}" alt="${esc(n)}"/>`
            : `<div class="ph">${esc(n)}</div>`;
          const cap =
            template === 'contact' ? `<div class="cap">${esc(n)}</div>` : '';
          return `<div class="cell">${imgTag}${cap}</div>`;
        })
        .join('\n');
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Print</title>
<style>
@page{margin:10mm}
*{box-sizing:border-box}
body{margin:0;background:#444;font-family:system-ui,sans-serif}
.page{width:min(100%,520px);margin:1rem auto;aspect-ratio:${aspectCss};background:#fff;padding:${marginMm * 0.35}%;display:grid;gap:6px;${gridCss}box-shadow:0 8px 24px rgba(0,0,0,.35)}
.cell{background:#f5f5f5;border:1px solid #e5e5e5;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;position:relative}
.cell img{max-width:100%;max-height:100%;object-fit:contain}
.cell .ph,.cell.empty{color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:4px;text-align:center}
.cap{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media print{body{background:#fff}.page{box-shadow:none;width:100%;margin:0;min-height:100vh;aspect-ratio:auto}}
</style></head><body>
<div class="page">
${cellHtml}
</div>
</body></html>`;
      await invoke(Invokes.WriteTextFile, { path: filePath, contents: html });
      setLastExportPath(filePath);
      toast.success(t('ui.print.exportDone' as any, { defaultValue: 'Print HTML saved' }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  /** Multi-file package: folder/index.html + images/* for offline print layouts */
  const handleExportPackage = async () => {
    const list = (cells as (ImageFile | null)[]).filter(Boolean) as ImageFile[];
    const sources =
      list.length > 0
        ? list
        : selected.length
          ? selected
          : [];
    if (sources.length === 0) {
      toast.info(t('ui.print.noSelection' as any, { defaultValue: 'No photos selected' }));
      return;
    }
    setExporting(true);
    try {
      const parentDir = await openDialog({
        directory: true,
        multiple: false,
        title: t('ui.print.exportPackagePick' as any, {
          defaultValue: 'Choose folder for print package',
        }),
      });
      if (!parentDir || typeof parentDir !== 'string') return;

      const packageRoot = `${parentDir.replace(/[\\/]+$/, '')}/print-${template}`;
      const imagesDir = `${packageRoot}/images`;
      await invoke(Invokes.CreateFolder, { path: imagesDir });

      // Unique disk names for all unique source paths in cells (preserve cell order)
      const used = new Map<string, number>();
      const pathToDisk = new Map<string, string>();
      for (const img of sources) {
        if (pathToDisk.has(img.path)) continue;
        const base = img.path.split(/[\\/]/).pop()?.split('?')[0] || 'photo.jpg';
        const lower = base.toLowerCase();
        let diskName = base;
        if (used.has(lower)) {
          const n = (used.get(lower) || 1) + 1;
          used.set(lower, n);
          const dot = base.lastIndexOf('.');
          const stem = dot > 0 ? base.slice(0, dot) : base;
          const ext = dot > 0 ? base.slice(dot) : '';
          diskName = `${stem}_${n}${ext}`;
        } else {
          used.set(lower, 1);
        }
        pathToDisk.set(img.path, diskName);
        await invoke(Invokes.CopyFileTo, {
          sourcePath: img.path,
          destinationPath: `${imagesDir}/${diskName}`,
        });
      }

      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const aspectCss = paper === 'Letter' ? '8.5/11' : paper === '5x7' ? '5/7' : '210/297';
      const gridCss =
        template === 'single'
          ? 'grid-template-columns:1fr;grid-template-rows:1fr;'
          : template === 'package2x2'
            ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;'
            : 'grid-template-columns:1fr 1fr 1fr;grid-template-rows:repeat(4,1fr);';
      const cellHtml = (cells as (ImageFile | null)[])
        .map((img) => {
          if (!img) return `<div class="cell empty">Empty</div>`;
          const n = img.path.split(/[\\/]/).pop()?.split('?')[0] || '';
          const disk = pathToDisk.get(img.path);
          const imgTag = disk
            ? `<img src="images/${disk}" alt="${esc(n)}"/>`
            : `<div class="ph">${esc(n)}</div>`;
          const cap = template === 'contact' ? `<div class="cap">${esc(n)}</div>` : '';
          return `<div class="cell">${imgTag}${cap}</div>`;
        })
        .join('\n');
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Print</title>
<style>
@page{margin:10mm}
*{box-sizing:border-box}
body{margin:0;background:#444;font-family:system-ui,sans-serif}
.page{width:min(100%,520px);margin:1rem auto;aspect-ratio:${aspectCss};background:#fff;padding:${marginMm * 0.35}%;display:grid;gap:6px;${gridCss}box-shadow:0 8px 24px rgba(0,0,0,.35)}
.cell{background:#f5f5f5;border:1px solid #e5e5e5;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;position:relative}
.cell img{max-width:100%;max-height:100%;object-fit:contain}
.cell .ph,.cell.empty{color:#aaa;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:4px;text-align:center}
.cap{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media print{body{background:#fff}.page{box-shadow:none;width:100%;margin:0;min-height:100vh;aspect-ratio:auto}}
</style></head><body>
<div class="page">
${cellHtml}
</div>
</body></html>`;
      await invoke(Invokes.WriteTextFile, { path: `${packageRoot}/index.html`, contents: html });
      setLastExportPath(packageRoot);
      toast.success(
        t('ui.print.exportPackageDone' as any, {
          defaultValue: 'Print package saved ({{count}} images + index.html)',
          count: pathToDisk.size,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  // LR Print: Ctrl/Cmd+P opens system print dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <ModuleShell
      moduleId="print"
      title={t('ui.moduleBar.print' as any)}
      subtitle={t('ui.moduleShell.printSubtitle' as any, {
        defaultValue: 'Print layouts and page preview from the current selection.',
      })}
      icon={Printer}
      onBackToLibrary={onBackToLibrary}
      left={
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35">
            {t('ui.print.templates' as any, { defaultValue: 'Template browser' })}
          </div>
          {(
            [
              ['single', t('ui.print.single' as any, { defaultValue: 'Single image' }), Square],
              ['contact', t('ui.print.contact' as any, { defaultValue: 'Contact sheet' }), Rows3],
              ['package2x2', t('ui.print.package' as any, { defaultValue: '2×2 package' }), LayoutTemplate],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTemplate(id)}
              className={`w-full text-left px-2 py-1.5 rounded text-[12px] flex items-center gap-2 ${
                template === id ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
              }`}
            >
              <Icon size={13} className="opacity-70" />
              {label}
            </button>
          ))}
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35 mt-3">
            {t('ui.print.selection' as any, { defaultValue: 'Selection' })}
          </div>
          <div className="px-2 text-[11px] text-white/50">
            {selected.length === 0
              ? t('ui.print.noSelection' as any, { defaultValue: 'No photos selected — using folder head.' })
              : t('ui.print.selectedCount' as any, {
                  defaultValue: '{{count}} photo(s)',
                  count: selected.length,
                })}
          </div>
        </>
      }
      right={
        <>
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/35">
              {t('ui.print.layout' as any, { defaultValue: 'Layout' })}
            </div>
            <label className="block text-[11px] text-white/60">
              {t('ui.print.paper' as any, { defaultValue: 'Paper' })}
              <select
                className="mt-1 w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-white/80"
                value={paper}
                onChange={(e) => setPaper(e.target.value as any)}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="5x7">5×7</option>
              </select>
            </label>
            <label className="block text-[11px] text-white/60">
              {t('ui.print.margins' as any, { defaultValue: 'Margins (mm)' })}
              <input
                type="range"
                min={4}
                max={40}
                value={marginMm}
                onChange={(e) => setMarginMm(Number(e.target.value))}
                className="mt-1 w-full"
              />
              <span className="text-white/40 tabular-nums">{marginMm} mm</span>
            </label>
            <label className="h-8 rounded bg-white/5 border border-white/10 px-2 flex items-center gap-2 text-[11px] text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={showGuides}
                onChange={(e) => setShowGuides(e.target.checked)}
                className="accent-white"
              />
              {t('ui.print.guides' as any, { defaultValue: 'Show guides' })}
            </label>
          </section>
          <section className="space-y-2 mt-4">
            <div className="text-[10px] uppercase tracking-wider text-white/35">
              {t('ui.print.job' as any, { defaultValue: 'Print job' })}
            </div>
            <button
              type="button"
              onClick={handlePrint}
              className="w-full h-9 rounded bg-white/15 hover:bg-white/25 text-white text-[12px] font-semibold uppercase tracking-wide flex items-center justify-center gap-2"
            >
              <Printer size={14} />
              {t('ui.print.print' as any, { defaultValue: 'Print…' })}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportHtml}
              className="w-full h-8 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-[11px] font-semibold uppercase tracking-wide"
            >
              {exporting
                ? t('ui.print.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.print.exportHtml' as any, { defaultValue: 'Export HTML' })}
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportPackage}
              className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 text-button-text text-[11px] font-semibold uppercase tracking-wide"
              data-tooltip={t('ui.print.exportPackageTip' as any, {
                defaultValue: 'Folder with images/ + index.html (print layout package)',
              })}
            >
              {exporting
                ? t('ui.print.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.print.exportPackage' as any, { defaultValue: 'Export package…' })}
            </button>
            {lastExportPath && (
              <button
                type="button"
                className="w-full h-8 rounded border border-white/15 text-[12px] text-white/75 hover:bg-white/5"
                onClick={() => {
                  invoke(Invokes.ShowInFinder, { path: lastExportPath }).catch(() => {});
                }}
              >
                {t('ui.moduleShell.showInFolder' as any, { defaultValue: 'Show in folder' })}
              </button>
            )}
            <p className="text-[10px] text-white/35 leading-relaxed">
              {t('ui.print.note' as any, {
                defaultValue:
                  'Ctrl/Cmd+P or Print… opens the system dialog. Package exports images/ + index.html. For developed files, use Library Export.',
              })}
            </p>
          </section>
        </>
      }
    >
      <div className="w-full h-full flex items-center justify-center p-4 overflow-auto">
        <div
          id="rustroom-print-page"
          className="relative bg-white shadow-2xl border border-black/15 print:shadow-none print:border-0"
          style={{
            width: 'min(100%, 420px)',
            aspectRatio: String(aspect),
            padding: `${marginMm * 0.35}%`,
          }}
        >
          {showGuides && (
            <div
              className="absolute inset-0 pointer-events-none border border-dashed border-sky-400/40 print:hidden"
              style={{ margin: `${marginMm * 0.35}%` }}
            />
          )}
          <div className={`w-full h-full grid gap-1.5 ${gridClass}`}>
            {(cells as (ImageFile | null)[]).map((img, idx) => {
              const src = img ? thumbs[img.path] : undefined;
              const name = img?.path.split(/[\\/]/).pop()?.split('?')[0];
              return (
                <div
                  key={img?.path ? `${img.path}-${idx}` : `empty-${idx}`}
                  className="relative min-h-0 bg-neutral-100 border border-neutral-200 overflow-hidden flex items-center justify-center"
                >
                  {src ? (
                    <img src={src} alt={name || ''} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-neutral-400 uppercase tracking-wider">
                      {t('ui.print.emptyCell' as any, { defaultValue: 'Empty' })}
                    </span>
                  )}
                  {template === 'contact' && name && (
                    <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/50 text-white truncate px-0.5 print:bg-neutral-200 print:text-black">
                      {name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #rustroom-print-page, #rustroom-print-page * { visibility: visible !important; }
          #rustroom-print-page {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            aspect-ratio: auto !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </ModuleShell>
  );
}
