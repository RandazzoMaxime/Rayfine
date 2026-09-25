import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { ImageFile, Invokes } from '../ui/AppProperties';

interface Props {
  onBackToLibrary(): void;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBookHtml(opts: {
  title: string;
  spread: 'single' | 'spread';
  photos: { name: string; src: string | null }[];
}): string {
  const { title, spread, photos } = opts;
  const perPage = spread === 'spread' ? 2 : 1;
  const pages: string[] = [];
  const n = Math.max(1, Math.ceil(Math.max(photos.length, 1) / perPage));
  for (let p = 0; p < n; p++) {
    const slice = photos.slice(p * perPage, p * perPage + perPage);
    const cells = Array.from({ length: perPage })
      .map((_, i) => {
        const ph = slice[i];
        if (!ph) {
          return `<div class="cell empty"><span>Empty</span></div>`;
        }
        const img = ph.src
          ? `<img src="${ph.src}" alt="${escapeHtml(ph.name)}" />`
          : `<div class="ph">${escapeHtml(ph.name)}</div>`;
        return `<div class="cell">${img}<div class="cap">${escapeHtml(ph.name)}</div></div>`;
      })
      .join('');
    const label = p === 0 ? 'Cover' : `Page ${p + 1}`;
    pages.push(
      `<section class="page ${spread === 'spread' ? 'spread' : 'single'}" data-label="${escapeHtml(label)}">${cells}</section>`,
    );
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  @page { size: auto; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #2a2a2a; color: #333; }
  header { color: #ccc; padding: 1rem 1.25rem 0.5rem; }
  h1 { margin: 0; font-size: 1.1rem; color: #eee; }
  .meta { font-size: 0.75rem; color: #888; margin-top: 0.25rem; }
  .book { padding: 1rem; display: flex; flex-direction: column; gap: 1.25rem; align-items: center; }
  .page { background: #f4f1ea; width: min(920px, 100%); aspect-ratio: 3/2; display: flex; box-shadow: 0 8px 28px rgba(0,0,0,.35); border: 1px solid #ccc; page-break-after: always; break-after: page; position: relative; overflow: hidden; }
  .page.spread { flex-direction: row; }
  .page.single { flex-direction: column; }
  .page.spread .cell { flex: 1; border-right: 1px solid #ddd; }
  .page.spread .cell:last-child { border-right: none; }
  .page.single .cell { flex: 1; }
  .cell { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; min-width: 0; min-height: 0; background: #f4f1ea; }
  .cell img { max-width: 100%; max-height: calc(100% - 1.2rem); object-fit: contain; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
  .cell .ph, .cell.empty span { color: #999; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; }
  .cap { margin-top: 0.4rem; font-size: 0.65rem; color: #666; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page::after { content: attr(data-label); position: absolute; bottom: 6px; right: 10px; font-size: 0.6rem; color: #aaa; }
  @media print {
    body { background: #fff; }
    header { display: none; }
    .book { padding: 0; gap: 0; }
    .page { box-shadow: none; width: 100%; min-height: 100vh; aspect-ratio: auto; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${photos.length} photo${photos.length === 1 ? '' : 's'} · ${n} page${n === 1 ? '' : 's'} · ${spread} · RustROOM Book</div>
</header>
<div class="book">
${pages.join('\n')}
</div>
</body>
</html>`;
}

/**
 * Lightroom Classic–style Book module with live preview + print-ready HTML export.
 */
export default function BookModuleView({ onBackToLibrary }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [spread, setSpread] = useState<'single' | 'spread'>('spread');
  const [bookTitle, setBookTitle] = useState('Photo Book');
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

  const photos = useMemo(() => {
    const paths =
      multiSelectedPaths.length > 0
        ? multiSelectedPaths
        : libraryActivePath
          ? [libraryActivePath]
          : imageList.slice(0, 8).map((i: ImageFile) => i.path);
    return paths
      .map((p) => imageList.find((i: ImageFile) => i.path === p))
      .filter(Boolean) as ImageFile[];
  }, [multiSelectedPaths, libraryActivePath, imageList]);

  useEffect(() => {
    const paths = photos.map((p) => p.path);
    if (paths.length) invoke('update_thumbnail_queue', { paths }).catch(() => {});
  }, [photos]);

  const perPage = spread === 'spread' ? 2 : 1;
  const pageCount = Math.max(1, Math.ceil(Math.max(photos.length, 1) / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const pagePhotos = photos.slice(safePage * perPage, safePage * perPage + perPage);

  const handleExportHtml = async () => {
    if (photos.length === 0) {
      toast.info(t('ui.book.noPhotos' as any, { defaultValue: 'Select photos for the book' }));
      return;
    }
    setExporting(true);
    try {
      const safe = (bookTitle || 'book').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'book';
      const filePath = await saveDialog({
        defaultPath: `${safe}.html`,
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
        title: t('ui.book.exportHtml' as any, { defaultValue: 'Export book HTML' }),
      });
      if (!filePath) return;
      const items = photos.map((img) => {
        const name = img.path.split(/[\\/]/).pop()?.split('?')[0] || img.path;
        const src = thumbs[img.path] || null;
        const portable =
          src && (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://'))
            ? src
            : null;
        return { name, src: portable };
      });
      const html = buildBookHtml({ title: bookTitle, spread, photos: items });
      await invoke(Invokes.WriteTextFile, { path: filePath, contents: html });
      setLastExportPath(filePath);
      toast.success(
        t('ui.book.exportDone' as any, {
          defaultValue: 'Book HTML saved ({{count}} photos, {{pages}} pages)',
          count: photos.length,
          pages: pageCount,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  /** Multi-file package: folder/index.html + images/* */
  const handleExportPackage = async () => {
    if (photos.length === 0) {
      toast.info(t('ui.book.noPhotos' as any, { defaultValue: 'Select photos for the book' }));
      return;
    }
    setExporting(true);
    try {
      const safe = (bookTitle || 'book').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'book';
      const parentDir = await openDialog({
        directory: true,
        multiple: false,
        title: t('ui.book.exportPackagePick' as any, {
          defaultValue: 'Choose folder for book package',
        }),
      });
      if (!parentDir || typeof parentDir !== 'string') return;

      const packageRoot = `${parentDir.replace(/[\\/]+$/, '')}/${safe}`;
      const imagesDir = `${packageRoot}/images`;
      await invoke(Invokes.CreateFolder, { path: imagesDir });

      const used = new Map<string, number>();
      const plan: { name: string; sourcePath: string; diskName: string }[] = [];
      for (const img of photos) {
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
        plan.push({ name: base, sourcePath: img.path, diskName });
      }

      for (const item of plan) {
        await invoke(Invokes.CopyFileTo, {
          sourcePath: item.sourcePath,
          destinationPath: `${imagesDir}/${item.diskName}`,
        });
      }

      const htmlItems = plan.map((item) => ({
        name: item.name,
        src: `images/${item.diskName}`,
      }));
      const html = buildBookHtml({ title: bookTitle, spread, photos: htmlItems });
      await invoke(Invokes.WriteTextFile, { path: `${packageRoot}/index.html`, contents: html });
      setLastExportPath(packageRoot);
      toast.success(
        t('ui.book.exportPackageDone' as any, {
          defaultValue: 'Book package saved ({{count}} photos, {{pages}} pages)',
          count: photos.length,
          pages: pageCount,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  // LR Book: ←/→ page · Home/End first/last
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setPage((p) => Math.min(pageCount - 1, p + 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPage(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPage(pageCount - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pageCount]);

  return (
    <ModuleShell
      moduleId="book"
      title={t('ui.moduleBar.book' as any)}
      subtitle={t('ui.moduleShell.bookSubtitle' as any, {
        defaultValue: 'Photo book page layouts from the current selection.',
      })}
      icon={BookOpen}
      onBackToLibrary={onBackToLibrary}
      left={
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35">
            {t('ui.book.collections' as any, { defaultValue: 'Collections' })}
          </div>
          <div className="px-2 py-1.5 rounded bg-white/5 text-[12px] text-white/80">
            {t('ui.book.bookPhotos' as any, { defaultValue: 'Book photos' })} ({photos.length})
          </div>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35 mt-3">
            {t('ui.book.pages' as any, { defaultValue: 'Pages' })}
          </div>
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              className={`w-full text-left px-2 py-1.5 rounded text-[12px] ${
                i === safePage ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
              }`}
            >
              {i === 0
                ? t('ui.book.cover' as any, { defaultValue: 'Cover' })
                : t('ui.book.pageN' as any, { defaultValue: 'Page {{n}}', n: i + 1 })}
            </button>
          ))}
        </>
      }
      right={
        <>
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/35">
              {t('ui.book.settings' as any, { defaultValue: 'Book settings' })}
            </div>
            <label className="block text-[11px] text-white/60">
              {t('ui.book.title' as any, { defaultValue: 'Title' })}
              <input
                className="mt-1 w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-white/90"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
              />
            </label>
            <label className="block text-[11px] text-white/60">
              {t('ui.book.layout' as any, { defaultValue: 'Page layout' })}
              <select
                className="mt-1 w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-white/80"
                value={spread}
                onChange={(e) => {
                  setSpread(e.target.value as any);
                  setPage(0);
                }}
              >
                <option value="spread">{t('ui.book.spread' as any, { defaultValue: 'Two-page spread' })}</option>
                <option value="single">{t('ui.book.single' as any, { defaultValue: 'Single page' })}</option>
              </select>
            </label>
            <button
              type="button"
              disabled={exporting || photos.length === 0}
              onClick={handleExportHtml}
              className="w-full h-8 rounded bg-white/15 hover:bg-white/25 disabled:opacity-40 text-[11px] text-white font-semibold uppercase tracking-wide"
            >
              {exporting
                ? t('ui.book.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.book.exportHtml' as any, { defaultValue: 'Export HTML' })}
            </button>
            <button
              type="button"
              disabled={exporting || photos.length === 0}
              onClick={handleExportPackage}
              className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 text-[11px] text-button-text font-semibold uppercase tracking-wide"
              data-tooltip={t('ui.book.exportPackageTip' as any, {
                defaultValue: 'Folder with images/ + index.html (print-ready multi-file package)',
              })}
            >
              {exporting
                ? t('ui.book.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.book.exportPackage' as any, { defaultValue: 'Export package…' })}
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
              {t('ui.book.note' as any, {
                defaultValue: 'Print-ready multi-page HTML. Open in a browser and Print to PDF.',
              })}
            </p>
          </section>
        </>
      }
    >
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4">
        <div
          className={`w-full max-w-4xl aspect-[3/2] rounded shadow-2xl bg-[#f4f1ea] border border-black/25 flex overflow-hidden ${
            spread === 'spread' ? 'divide-x divide-neutral-300' : ''
          }`}
        >
          {Array.from({ length: perPage }).map((_, i) => {
            const img = pagePhotos[i];
            const src = img ? thumbs[img.path] : undefined;
            return (
              <div key={i} className="flex-1 flex items-center justify-center bg-[#f4f1ea] p-3 min-w-0">
                {src ? (
                  <img src={src} alt="" className="max-w-full max-h-full object-contain shadow-md" />
                ) : (
                  <div className="text-center text-[#999] text-[11px] uppercase tracking-widest">
                    <BookOpen size={22} className="mx-auto mb-2 opacity-40" />
                    {t('ui.book.emptyCell' as any, { defaultValue: 'Drop photo' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 h-7 rounded bg-white/10 text-white/80 text-[11px] disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-[11px] text-white/50 tabular-nums">
            {safePage + 1} / {pageCount}
          </span>
          <span className="text-[10px] text-white/30">
            {t('ui.book.pageKeys' as any, { defaultValue: '←/→ pages · Home/End' })}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="px-3 h-7 rounded bg-white/10 text-white/80 text-[11px] disabled:opacity-30"
          >
            →
          </button>
        </div>
      </div>
    </ModuleShell>
  );
}
