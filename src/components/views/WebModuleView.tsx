import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import MapCollectionsPanel from '../panel/MapCollectionsPanel';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useUIStore } from '../../store/useUIStore';
import { useModuleCollectionSource } from '../../hooks/useModuleCollectionSource';
import { ImageFile, Invokes } from '../ui/AppProperties';
import { isLightHex, normalizeHex } from '../../utils/appearance';
import { zipStore } from '../../utils/zipStore';

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

const GALLERY_BG_KEY = 'rustroom.webGalleryBg.v1';
const DEFAULT_GALLERY_BG = '#0d0d0d';
const GALLERY_SWATCHES = [
  { id: 'black', color: '#0d0d0d' },
  { id: 'darkGray', color: '#2a2a2a' },
  { id: 'white', color: '#f5f5f5' },
  { id: 'warm', color: '#ebe4d8' },
];

function loadGalleryBg(): string {
  try {
    const raw = localStorage.getItem(GALLERY_BG_KEY);
    const hex = raw ? normalizeHex(raw) : null;
    return hex || DEFAULT_GALLERY_BG;
  } catch {
    return DEFAULT_GALLERY_BG;
  }
}

function galleryInk(bg: string) {
  const light = isLightHex(bg);
  return {
    fg: light ? '#1a1a1a' : '#eee',
    muted: light ? '#5c5c5c' : '#8a8a8a',
    cell: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
    border: light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)',
    scheme: light ? 'light' : 'dark',
  };
}

function buildGalleryHtml(opts: {
  title: string;
  template: 'classic' | 'grid' | 'mosaic';
  cols: number;
  items: { name: string; src: string | null }[];
  background: string;
}): string {
  const { title, template, cols, items, background } = opts;
  const colClass = template === 'classic' ? 2 : Math.min(5, Math.max(2, cols));
  const ink = galleryInk(background);
  const cells = items
    .map((it, i) => {
      const img = it.src
        ? `<img src="${it.src}" alt="${escapeHtml(it.name)}" loading="lazy" data-full="${it.src}" />`
        : `<div class="ph">${escapeHtml(it.name)}</div>`;
      return `<figure class="cell" data-idx="${i}" data-name="${escapeHtml(
        it.name,
      )}" tabindex="0" role="button">${img}<figcaption>${escapeHtml(
        it.name,
      )}</figcaption></figure>`;
    })
    .join('\n');

  const layoutCss =
    template === 'mosaic'
      ? `.gallery { column-count: ${colClass}; column-gap: 0.65rem; padding: 1rem 1.5rem 2rem; }
  .cell { break-inside: avoid; margin: 0 0 0.65rem; display: inline-block; width: 100%; vertical-align: top; }
  .cell img { width: 100%; height: auto; object-fit: contain; display: block; }`
      : `.gallery { display: grid; gap: 0.65rem; padding: 1rem 1.5rem 2rem; grid-template-columns: repeat(${colClass}, minmax(0, 1fr)); align-items: start; }
  .cell { display: flex; flex-direction: column; margin: 0; }
  .cell img { width: 100%; height: auto; object-fit: contain; display: block; }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: ${ink.scheme}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: ${background}; color: ${ink.fg}; }
  header { padding: 1.25rem 1.5rem 0.5rem; }
  h1 { margin: 0; font-size: 1.35rem; font-weight: 600; letter-spacing: 0.02em; }
  .meta { color: ${ink.muted}; font-size: 0.8rem; margin-top: 0.35rem; }
  ${layoutCss}
  .cell { background: ${ink.cell}; border: 1px solid ${ink.border}; border-radius: 6px; overflow: hidden; cursor: zoom-in; }
  .cell .ph { display: flex; align-items: center; justify-content: center; color: ${ink.muted}; font-size: 0.75rem; padding: 1.5rem 0.5rem; text-align: center; }
  figcaption { font-size: 0.7rem; color: ${ink.muted}; padding: 0.35rem 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px solid ${ink.border}; }
  footer { padding: 0 1.5rem 1.5rem; color: ${ink.muted}; font-size: 0.7rem; }
  .cell:focus-within { outline: 1px solid #6af; }
  #lb { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.92); z-index: 50; align-items: center; justify-content: center; flex-direction: column; gap: .75rem; padding: 1rem; }
  #lb.open { display: flex; }
  #lb img { max-width: min(96vw, 1400px); max-height: 82vh; object-fit: contain; border-radius: 4px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
  #lb .cap { color: #ccc; font-size: .85rem; max-width: 90vw; text-align: center; }
  #lb .hint { color: #666; font-size: .7rem; }
  #lb button { position: absolute; top: 1rem; right: 1rem; background: #222; color: #eee; border: 1px solid #444; border-radius: 6px; padding: .4rem .7rem; cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${items.length} photo${items.length === 1 ? '' : 's'} · ${escapeHtml(template)} layout · exported from Rayfine</div>
</header>
<main class="gallery">
${cells}
</main>
<footer>Generated by Rayfine. Thumbnails embedded when available. Click a photo for lightbox · Esc / ← → navigate.</footer>
<div id="lb" aria-hidden="true">
  <button type="button" id="lb-close" aria-label="Close">Close</button>
  <img id="lb-img" alt="" />
  <div class="cap" id="lb-cap"></div>
  <div class="hint">Esc close · ← → previous/next · click backdrop to close</div>
</div>
<script>
(function(){
  var slides = ${JSON.stringify(
    items.map((it) => ({ name: it.name, src: it.src })),
  )};
  var lb = document.getElementById('lb');
  var img = document.getElementById('lb-img');
  var cap = document.getElementById('lb-cap');
  var closeBtn = document.getElementById('lb-close');
  var i = 0;
  function show(n){
    if(!slides.length) return;
    i = (n + slides.length) % slides.length;
    var s = slides[i];
    if(s.src){ img.src = s.src; img.style.display = ''; }
    else { img.removeAttribute('src'); img.style.display = 'none'; }
    cap.textContent = (i+1) + ' / ' + slides.length + ' · ' + (s.name || '');
    lb.classList.add('open');
    lb.setAttribute('aria-hidden','false');
  }
  function hide(){ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); }
  document.querySelectorAll('.cell').forEach(function(el){
    el.addEventListener('click', function(){ show(parseInt(el.getAttribute('data-idx')||'0',10)); });
    el.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); show(parseInt(el.getAttribute('data-idx')||'0',10)); }});
  });
  closeBtn.onclick = hide;
  lb.addEventListener('click', function(e){ if(e.target===lb) hide(); });
  document.addEventListener('keydown', function(e){
    if(!lb.classList.contains('open')) return;
    if(e.key==='Escape') hide();
    if(e.key==='ArrowRight') show(i+1);
    if(e.key==='ArrowLeft') show(i-1);
  });
})();
</script>
</body>
</html>
`;
}

/**
 * Lightroom Classic–style Web gallery module with live preview + HTML export.
 */
export default function WebModuleView({ onBackToLibrary }: Props) {
  const { t } = useTranslation();
  const [template, setTemplate] = useState<'classic' | 'grid' | 'mosaic'>('grid');
  const [title, setTitle] = useState('Photo Gallery');
  const [cols, setCols] = useState(3);
  const [galleryBg, setGalleryBg] = useState(loadGalleryBg);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [formatModal, setFormatModal] = useState(false);
  const [imageFormat, setImageFormat] = useState<'jpg' | 'png'>('jpg');
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const ink = galleryInk(galleryBg);

  const setBg = (hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setGalleryBg(n);
    try {
      localStorage.setItem(GALLERY_BG_KEY, n);
    } catch {
      /* ignore */
    }
  };

  const { albumId, setAlbumId, images: imageList, albumTree } = useModuleCollectionSource();
  const { developLeftPanelWidth, isInstantTransition, setUI } = useUIStore(
    useShallow((s) => ({
      developLeftPanelWidth: s.developLeftPanelWidth,
      isInstantTransition: s.isInstantTransition,
      setUI: s.setUI,
    })),
  );
  const multiSelectedPaths = useLibraryStore((s) => s.multiSelectedPaths);
  const thumbs = useProcessStore((s) => s.thumbnails);

  const photos = useMemo(() => {
    const inCol = new Set(imageList.map((i: ImageFile) => i.path));
    const checked = (multiSelectedPaths || []).filter((p) => inCol.has(p));
    const paths = checked.length > 0 ? checked : imageList.map((i: ImageFile) => i.path);
    return paths
      .map((p) => imageList.find((i: ImageFile) => i.path === p))
      .filter(Boolean) as ImageFile[];
  }, [multiSelectedPaths, imageList]);

  useEffect(() => {
    setUI({ mapImageList: photos });
    return () => setUI({ mapImageList: null });
  }, [photos, setUI]);

  useEffect(() => {
    const paths = photos.map((p) => p.path);
    if (paths.length) invoke('update_thumbnail_queue', { paths }).catch(() => {});
  }, [photos]);

  const toBytes = (raw: unknown): Uint8Array => {
    if (raw instanceof Uint8Array) return raw;
    if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    return new Uint8Array(0);
  };

  const jpegToPng = (jpeg: Uint8Array): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([jpeg], { type: 'image/jpeg' }));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        URL.revokeObjectURL(url);
        if (!ctx) {
          reject(new Error('Canvas 2D unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('PNG encode failed'));
              return;
            }
            blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
          },
          'image/png',
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('JPEG decode failed'));
      };
      img.src = url;
    });

  const previewJpeg = async (path: string): Promise<Uint8Array | null> => {
    try {
      const metadata: any = await invoke(Invokes.LoadMetadata, { path });
      const adjustments =
        metadata?.adjustments && !metadata.adjustments.is_null ? metadata.adjustments : {};
      const raw = await invoke(Invokes.GeneratePreviewForPath, {
        path,
        jsAdjustments: adjustments,
      });
      const bytes = toBytes(raw);
      if (bytes.length) return bytes;
    } catch (err) {
      console.warn('Web export preview failed', path, err);
    }
    const thumb = thumbs[path];
    if (!thumb) return null;
    try {
      const res = await fetch(thumb);
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  };

  const handleExportPackage = async (format: 'jpg' | 'png') => {
    if (photos.length === 0) {
      toast.info(t('ui.web.empty' as any, { defaultValue: 'Select photos in Library' }));
      return;
    }
    const safeTitle = (title || 'gallery').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'gallery';
    const filePath = await saveDialog({
      defaultPath: `${safeTitle}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      title: t('ui.web.exportPackage' as any, { defaultValue: 'Export package' }),
    });
    if (!filePath) return;

    setExporting(true);
    setExportProgress(`0/${photos.length}`);
    try {
      const ext = format === 'png' ? 'png' : 'jpg';
      const used = new Map<string, number>();
      const zipEntries: { name: string; data: Uint8Array }[] = [];
      const htmlItems: { name: string; src: string }[] = [];
      const missing: string[] = [];

      for (let i = 0; i < photos.length; i++) {
        const img = photos[i];
        setExportProgress(`${i + 1}/${photos.length}`);
        const base = img.path.split(/[\\/]/).pop()?.split('?')[0] || `photo_${i + 1}`;
        const stem = base.replace(/\.[^.]+$/, '') || `photo_${i + 1}`;
        let diskStem = stem;
        const key = diskStem.toLowerCase();
        if (used.has(key)) {
          const n = (used.get(key) || 1) + 1;
          used.set(key, n);
          diskStem = `${stem}_${n}`;
        } else {
          used.set(key, 1);
        }
        const diskName = `${diskStem}.${ext}`;
        const jpeg = await previewJpeg(img.path);
        if (!jpeg) {
          missing.push(base);
          continue;
        }
        const data = format === 'png' ? await jpegToPng(jpeg) : jpeg;
        zipEntries.push({ name: `images/${diskName}`, data });
        htmlItems.push({ name: base, src: `images/${diskName}` });
      }

      const html = buildGalleryHtml({
        title,
        template,
        cols,
        items: htmlItems,
        background: galleryBg,
      });
      zipEntries.push({
        name: 'index.html',
        data: new TextEncoder().encode(html),
      });

      const zip = zipStore(zipEntries);
      const bytes = Array.from(zip);
      const tempPath: string = await invoke(Invokes.SaveTempFile, { bytes });
      await invoke(Invokes.CopyFileTo, { sourcePath: tempPath, destinationPath: filePath });
      setLastExportPath(filePath);
      if (missing.length) {
        toast.warn(
          t('ui.web.exportMissing' as any, {
            defaultValue: 'Package saved — skipped {{count}} photos without a preview',
            count: missing.length,
          }),
        );
      } else {
        toast.success(
          t('ui.web.exportPackageDone' as any, {
            defaultValue: 'ZIP gallery saved ({{count}} photos + index.html)',
            count: htmlItems.length,
          }),
        );
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };


  return (
    <>
    <ModuleShell
      moduleId="web"
      title={t('ui.moduleBar.web' as any)}
      subtitle={t('ui.moduleShell.webSubtitle' as any, {
        defaultValue: 'Aperçu de galerie web et export ZIP.',
      })}
      icon={Globe}
      onBackToLibrary={onBackToLibrary}
      leftPanel={
        <div
          className="h-full flex flex-col gap-2 shrink-0"
          style={{ width: developLeftPanelWidth || 220 }}
        >
          <div className="flex-1 min-h-0">
            <MapCollectionsPanel
              width={developLeftPanelWidth || 220}
              isInstantTransition={isInstantTransition}
              albumTree={albumTree}
              activeAlbumId={albumId}
              onSelect={setAlbumId}
            />
          </div>
          <div className="shrink-0 bg-bg-secondary rounded-lg border border-border-color/30 p-2 space-y-1">
            <div className="px-1 py-1 text-[10px] uppercase tracking-wider text-text-secondary">
              {t('ui.web.templates' as any, { defaultValue: 'Template browser' })}
            </div>
            {(
              [
                ['classic', 'Classic'],
                ['grid', 'Grid'],
                ['mosaic', 'Mosaic'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTemplate(id)}
                className={`w-full text-left px-2 py-1.5 rounded text-[12px] ${
                  template === id
                    ? 'bg-card-active text-text-primary'
                    : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
      right={
        <>
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary">
              {t('ui.web.siteInfo' as any, { defaultValue: 'Site info' })}
            </div>
            <label className="block text-[11px] text-text-secondary">
              {t('ui.web.title' as any, { defaultValue: 'Title' })}
              <input
                className="mt-1 w-full h-8 rounded bg-surface border border-border-color/40 px-2 text-text-primary"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {template !== 'classic' && (
              <label className="block text-[11px] text-text-secondary">
                {t('ui.web.columns' as any, { defaultValue: 'Columns' })}
                <input
                  type="range"
                  min={2}
                  max={5}
                  value={cols}
                  onChange={(e) => setCols(Number(e.target.value))}
                  className="mt-1 w-full"
                />
                <span className="text-[10px] tabular-nums text-text-secondary">{cols}</span>
              </label>
            )}
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mt-2">
              {t('ui.web.galleryBg' as any, { defaultValue: 'Fond de la galerie' })}
            </div>
            <div className="flex items-center gap-3">
              {GALLERY_SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setBg(s.color)}
                  aria-pressed={galleryBg === s.color}
                  className={clsx(
                    'w-7 h-7 rounded border',
                    galleryBg === s.color
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-border-color hover:border-text-secondary',
                  )}
                  style={{ background: s.color }}
                />
              ))}
              <label
                className="relative w-7 h-7 rounded border border-border-color hover:border-text-secondary overflow-hidden cursor-pointer"
                data-tooltip={t('ui.web.customBg' as any, { defaultValue: 'Couleur personnalisée' })}
                style={{
                  background: GALLERY_SWATCHES.some((s) => s.color === galleryBg)
                    ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)'
                    : galleryBg,
                }}
              >
                <input
                  type="color"
                  value={galleryBg}
                  onChange={(e) => setBg(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              <span className="ml-auto text-[10px] font-mono text-text-secondary uppercase">{galleryBg}</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-secondary mt-2">
              {t('ui.web.output' as any, { defaultValue: 'Output' })}
            </div>
            <button
              type="button"
              disabled={exporting || photos.length === 0}
              onClick={() => setFormatModal(true)}
              className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-[11px] text-button-text font-semibold uppercase tracking-wide"
              data-tooltip={t('ui.web.exportPackageTip' as any, {
                defaultValue: 'ZIP with index.html and images/ (JPEG or PNG)',
              })}
            >
              {exporting
                ? t('ui.web.exportingProgress' as any, {
                    defaultValue: 'Export… {{progress}}',
                    progress: exportProgress || '',
                  })
                : t('ui.web.exportPackage' as any, { defaultValue: 'Export package…' })}
            </button>
            {lastExportPath && (
              <button
                type="button"
                className="w-full h-8 rounded border border-border-color/40 text-[12px] text-text-primary hover:bg-surface"
                onClick={() => {
                  invoke(Invokes.ShowInFinder, { path: lastExportPath }).catch(() => {});
                }}
              >
                {t('ui.web.showInFolder' as any, { defaultValue: 'Show in folder' })}
              </button>
            )}
            <p className="text-[10px] text-text-secondary leading-relaxed">
              {t('ui.web.note' as any, {
                defaultValue: 'ZIP contenant index.html et le dossier images/ (JPEG ou PNG).',
              })}
            </p>
          </section>
        </>
      }
    >
      <div
        className="w-full h-full min-h-[280px] rounded border border-border-color/40 overflow-auto p-4"
        style={{ background: galleryBg, color: ink.fg }}
      >
        <h2 className="text-[16px] font-semibold mb-3 tracking-wide" style={{ color: ink.fg }}>
          {title}
        </h2>
        {photos.length === 0 ? (
          <div className="text-center text-[12px] py-16 uppercase tracking-widest" style={{ color: ink.muted }}>
            {t('ui.web.empty' as any, { defaultValue: 'Select photos in Library' })}
          </div>
        ) : template === 'mosaic' ? (
          <div style={{ columnCount: cols, columnGap: '0.5rem' }}>
            {photos.map((img) => {
              const src = thumbs[img.path];
              return (
                <figure
                  key={img.path}
                  className="mb-2 break-inside-avoid rounded overflow-hidden"
                  style={{ background: ink.cell, border: `1px solid ${ink.border}` }}
                >
                  {src ? (
                    <img src={src} alt="" className="block w-full h-auto" />
                  ) : (
                    <div className="w-full animate-pulse" style={{ aspectRatio: '3 / 2', background: ink.cell }} />
                  )}
                </figure>
              );
            })}
          </div>
        ) : (
          <div
            className={
              template === 'classic'
                ? 'grid grid-cols-2 gap-2'
                : cols === 2
                  ? 'grid grid-cols-2 gap-2'
                  : cols === 3
                    ? 'grid grid-cols-3 gap-2'
                    : cols === 4
                      ? 'grid grid-cols-4 gap-2'
                      : 'grid grid-cols-5 gap-2'
            }
          >
            {photos.map((img) => {
              const src = thumbs[img.path];
              return (
                <figure
                  key={img.path}
                  className="rounded overflow-hidden min-w-0"
                  style={{ background: ink.cell, border: `1px solid ${ink.border}` }}
                >
                  {src ? (
                    <img src={src} alt="" className="block w-full h-auto" />
                  ) : (
                    <div className="w-full animate-pulse" style={{ aspectRatio: '3 / 2', background: ink.cell }} />
                  )}
                </figure>
              );
            })}
          </div>
        )}
      </div>
    </ModuleShell>

    {formatModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        onClick={() => setFormatModal(false)}
      >
        <div
          className="bg-surface rounded-lg shadow-xl p-5 w-full max-w-sm border border-border-color/40"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[14px] font-semibold text-text-primary mb-1">
            {t('ui.web.exportPackage' as any, { defaultValue: 'Export package' })}
          </div>
          <p className="text-[12px] text-text-secondary mb-4">
            {t('ui.web.formatPrompt' as any, {
              defaultValue: 'Format des images dans le ZIP',
            })}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {(['jpg', 'png'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setImageFormat(fmt)}
                className={clsx(
                  'h-16 rounded-lg border text-[13px] font-semibold uppercase tracking-wide',
                  imageFormat === fmt
                    ? 'bg-card-active border-accent text-text-primary'
                    : 'bg-bg-primary border-border-color/40 text-text-secondary hover:text-text-primary',
                )}
              >
                {fmt === 'jpg' ? 'JPEG' : 'PNG'}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-8 px-3 rounded text-[12px] text-text-secondary hover:bg-card-active"
              onClick={() => setFormatModal(false)}
            >
              {t('modals.confirm.cancel' as any, { defaultValue: 'Annuler' })}
            </button>
            <button
              type="button"
              className="h-8 px-3 rounded bg-accent text-button-text text-[12px] font-semibold uppercase tracking-wide"
              onClick={() => {
                const fmt = imageFormat;
                setFormatModal(false);
                void handleExportPackage(fmt);
              }}
            >
              {t('ui.web.exportPackage' as any, { defaultValue: 'Export package…' })}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
