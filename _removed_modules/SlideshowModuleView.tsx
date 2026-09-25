import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { Presentation, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { ImageFile, Invokes } from '../ui/AppProperties';

interface Props {
  onBackToLibrary(): void;
}

type Transition = 'fade' | 'none' | 'slide';

/**
 * Lightroom Classic–style Slideshow with playback + HTML export.
 */
export default function SlideshowModuleView({ onBackToLibrary }: Props) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [durationSec, setDurationSec] = useState(3);
  const [transition, setTransition] = useState<Transition>('fade');
  const [showCaption, setShowCaption] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [loop, setLoop] = useState(false);
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
  const previews = useProcessStore((s) => s.previews);

  const slides = useMemo(() => {
    let list: ImageFile[];
    if (multiSelectedPaths.length > 0) {
      list = multiSelectedPaths
        .map((p) => imageList.find((i: ImageFile) => i.path === p))
        .filter(Boolean) as ImageFile[];
    } else if (libraryActivePath) {
      const idx = imageList.findIndex((i: ImageFile) => i.path === libraryActivePath);
      list = idx >= 0 ? (imageList.slice(idx) as ImageFile[]) : (imageList as ImageFile[]);
    } else {
      list = imageList as ImageFile[];
    }
    if (!shuffle || list.length < 2) return list;
    // Stable Fisher–Yates from path hash so order is deterministic for a given set + shuffle on
    const arr = [...list];
    let seed = arr.reduce((a, img) => a + img.path.length * 31 + img.path.charCodeAt(0), 0) + arr.length * 17;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [multiSelectedPaths, libraryActivePath, imageList, shuffle]);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [slides.length, multiSelectedPaths.join('|'), libraryActivePath]);

  useEffect(() => {
    const paths = slides.map((i) => i.path).slice(0, 40);
    if (paths.length === 0) return;
    invoke('update_thumbnail_queue', { paths }).catch(() => {});
  }, [slides]);

  const current = slides[index] || null;
  const src = current ? previews[current.path]?.url || thumbs[current.path] : undefined;
  const name = current?.path.split(/[\\/]/).pop()?.split('?')[0] || '';

  const next = useCallback(() => {
    setIndex((i) => (slides.length ? (i + 1) % slides.length : 0));
  }, [slides.length]);

  const prev = useCallback(() => {
    setIndex((i) => (slides.length ? (i - 1 + slides.length) % slides.length : 0));
  }, [slides.length]);

  useEffect(() => {
    if (!playing || slides.length === 0) return;
    const tmr = window.setInterval(() => {
      setIndex((i) => {
        if (i + 1 >= slides.length) {
          if (loop) return 0;
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, Math.max(1, durationSec) * 1000);
    return () => window.clearInterval(tmr);
  }, [playing, durationSec, slides.length, loop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'Escape') {
        setPlaying(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev]);

  const handleExportHtml = async () => {
    if (slides.length === 0) {
      toast.info(t('ui.slideshow.empty' as any, { defaultValue: 'No photos in library.' }));
      return;
    }
    setExporting(true);
    try {
      const filePath = await saveDialog({
        defaultPath: 'slideshow.html',
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
        title: t('ui.slideshow.exportHtml' as any, { defaultValue: 'Export slideshow HTML' }),
      });
      if (!filePath) return;

      const items = slides.map((img) => {
        const n = img.path.split(/[\\/]/).pop()?.split('?')[0] || img.path;
        const s = previews[img.path]?.url || thumbs[img.path] || null;
        const portable =
          s && (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) ? s : null;
        return { name: n, src: portable || '' };
      });

      const durationMs = Math.max(1, durationSec) * 1000;
      const slidesJson = JSON.stringify(items);
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Slideshow</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif;height:100vh;overflow:hidden}
#stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
#stage img{max-width:100%;max-height:100%;object-fit:contain;transition:opacity .45s ease}
#stage img.fade{opacity:0}
#bar{position:fixed;left:0;right:0;bottom:0;padding:.6rem 1rem;display:flex;gap:.75rem;align-items:center;background:linear-gradient(transparent,rgba(0,0,0,.75));font-size:.8rem}
button{background:#222;border:1px solid #444;color:#eee;border-radius:6px;padding:.35rem .7rem;cursor:pointer}
button:hover{background:#333}
#cap{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
</style></head><body>
<div id="stage"><img id="img" alt=""/></div>
<div id="bar">
<button type="button" id="prev">Prev</button>
<button type="button" id="play">Play</button>
<button type="button" id="next">Next</button>
<span id="cap"></span>
<span id="idx"></span>
</div>
<script>
const slides=${slidesJson};
const duration=${durationMs};
const loop=${loop ? "true" : "false"};
let i=0, timer=null, playing=false;
const img=document.getElementById('img');
const cap=document.getElementById('cap');
const idxEl=document.getElementById('idx');
const playBtn=document.getElementById('play');
function show(n){
  if(!slides.length) return;
  i=(n+slides.length)%slides.length;
  const s=slides[i];
  img.classList.add('fade');
  setTimeout(function(){
    img.src=s.src||'';
    img.alt=s.name||'';
    cap.textContent=s.name||'';
    idxEl.textContent=(i+1)+' / '+slides.length;
    img.classList.remove('fade');
  },200);
}
function next(){show(i+1)}
function prev(){show(i-1)}
function stop(){playing=false;clearInterval(timer);timer=null;playBtn.textContent='Play'}
function start(){if(!slides.length)return;playing=true;playBtn.textContent='Pause';clearInterval(timer);timer=setInterval(function(){if(i+1>=slides.length){if(loop){next();return}stop();return}next()}, duration)}
playBtn.onclick=function(){playing?stop():start()};
document.getElementById('next').onclick=function(){stop();next()};
document.getElementById('prev').onclick=function(){stop();prev()};
document.addEventListener('keydown',function(e){
  if(e.key===' '){e.preventDefault();playing?stop():start()}
  else if(e.key==='ArrowRight'){stop();next()}
  else if(e.key==='ArrowLeft'){stop();prev()}
  else if(e.key==='Escape')stop();
});
show(0);
</script>
</body></html>`;

      await invoke(Invokes.WriteTextFile, { path: filePath, contents: html });
      setLastExportPath(filePath);
      toast.success(
        t('ui.slideshow.exportDone' as any, {
          defaultValue: 'Slideshow HTML saved ({{count}} slides)',
          count: slides.length,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  /** Multi-file package: folder/index.html + images/* with relative paths */
  const handleExportPackage = async () => {
    if (slides.length === 0) {
      toast.info(t('ui.slideshow.empty' as any, { defaultValue: 'No photos in library.' }));
      return;
    }
    setExporting(true);
    try {
      const parentDir = await openDialog({
        directory: true,
        multiple: false,
        title: t('ui.slideshow.exportPackagePick' as any, {
          defaultValue: 'Choose folder for slideshow package',
        }),
      });
      if (!parentDir || typeof parentDir !== 'string') return;

      const packageRoot = `${parentDir.replace(/[\\/]+$/, '')}/slideshow`;
      const imagesDir = `${packageRoot}/images`;
      await invoke(Invokes.CreateFolder, { path: imagesDir });

      const used = new Map<string, number>();
      const plan: { name: string; sourcePath: string; diskName: string }[] = [];
      for (const img of slides) {
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

      const items = plan.map((item) => ({ name: item.name, src: `images/${item.diskName}` }));
      const durationMs = Math.max(1, durationSec) * 1000;
      const slidesJson = JSON.stringify(items);
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Slideshow</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font-family:system-ui,sans-serif;height:100vh;overflow:hidden}
#stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
#stage img{max-width:100%;max-height:100%;object-fit:contain;transition:opacity .45s ease}
#stage img.fade{opacity:0}
#bar{position:fixed;left:0;right:0;bottom:0;padding:.6rem 1rem;display:flex;gap:.75rem;align-items:center;background:linear-gradient(transparent,rgba(0,0,0,.75));font-size:.8rem}
button{background:#222;border:1px solid #444;color:#eee;border-radius:6px;padding:.35rem .7rem;cursor:pointer}
button:hover{background:#333}
#cap{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
</style></head><body>
<div id="stage"><img id="img" alt=""/></div>
<div id="bar">
<button type="button" id="prev">Prev</button>
<button type="button" id="play">Play</button>
<button type="button" id="next">Next</button>
<span id="cap"></span>
<span id="idx"></span>
</div>
<script>
const slides=${slidesJson};
const duration=${durationMs};
const loop=${loop ? "true" : "false"};
let i=0, timer=null, playing=false;
const img=document.getElementById('img');
const cap=document.getElementById('cap');
const idxEl=document.getElementById('idx');
const playBtn=document.getElementById('play');
function show(n){
  if(!slides.length) return;
  i=(n+slides.length)%slides.length;
  const s=slides[i];
  img.classList.add('fade');
  setTimeout(function(){
    img.src=s.src||'';
    img.alt=s.name||'';
    cap.textContent=s.name||'';
    idxEl.textContent=(i+1)+' / '+slides.length;
    img.classList.remove('fade');
  },200);
}
function next(){show(i+1)}
function prev(){show(i-1)}
function stop(){playing=false;clearInterval(timer);timer=null;playBtn.textContent='Play'}
function start(){if(!slides.length)return;playing=true;playBtn.textContent='Pause';clearInterval(timer);timer=setInterval(function(){if(i+1>=slides.length){if(loop){next();return}stop();return}next()}, duration)}
playBtn.onclick=function(){playing?stop():start()};
document.getElementById('next').onclick=function(){stop();next()};
document.getElementById('prev').onclick=function(){stop();prev()};
document.addEventListener('keydown',function(e){
  if(e.key===' '){e.preventDefault();playing?stop():start()}
  else if(e.key==='ArrowRight'){stop();next()}
  else if(e.key==='ArrowLeft'){stop();prev()}
  else if(e.key==='Escape')stop();
});
show(0);
</script>
</body></html>`;

      await invoke(Invokes.WriteTextFile, { path: `${packageRoot}/index.html`, contents: html });
      setLastExportPath(packageRoot);
      toast.success(
        t('ui.slideshow.exportPackageDone' as any, {
          defaultValue: 'Slideshow package saved ({{count}} slides + images/)',
          count: slides.length,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };


  return (
    <ModuleShell
      moduleId="slideshow"
      title={t('ui.moduleBar.slideshow' as any)}
      subtitle={t('ui.moduleShell.slideshowSubtitle' as any, {
        defaultValue: 'Play a slideshow from the current selection.',
      })}
      icon={Presentation}
      onBackToLibrary={onBackToLibrary}
      left={
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/35">
            {t('ui.slideshow.playlist' as any, { defaultValue: 'Playlist' })}
          </div>
          <div className="px-2 text-[11px] text-white/50 mb-2">
            {slides.length === 0
              ? t('ui.slideshow.empty' as any, { defaultValue: 'No photos in library.' })
              : t('ui.slideshow.count' as any, {
                  defaultValue: '{{count}} slides',
                  count: slides.length,
                })}
          </div>
          <div className="max-h-[55vh] overflow-y-auto custom-scrollbar space-y-0.5">
            {slides.map((img, i) => {
              const n = img.path.split(/[\\/]/).pop()?.split('?')[0];
              const th = thumbs[img.path];
              return (
                <button
                  key={img.path}
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setPlaying(false);
                  }}
                  className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left ${
                    i === index ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  <div className="w-10 h-8 rounded bg-black/40 overflow-hidden shrink-0">
                    {th && <img src={th} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <span className="text-[11px] truncate flex-1">{n}</span>
                  <span className="text-[10px] text-white/35 tabular-nums">{i + 1}</span>
                </button>
              );
            })}
          </div>
        </>
      }
      right={
        <>
          <section className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-white/35">
              {t('ui.slideshow.options' as any, { defaultValue: 'Options' })}
            </div>
            <label className="block text-[11px] text-white/60">
              {t('ui.slideshow.duration' as any, { defaultValue: 'Slide duration (s)' })}
              <input
                type="range"
                min={1}
                max={15}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                className="mt-1 w-full"
              />
              <span className="text-white/40 tabular-nums">{durationSec}s</span>
            </label>
            <label className="block text-[11px] text-white/60">
              {t('ui.slideshow.transition' as any, { defaultValue: 'Transition' })}
              <select
                className="mt-1 w-full h-8 rounded bg-white/5 border border-white/10 px-2 text-white/80"
                value={transition}
                onChange={(e) => setTransition(e.target.value as Transition)}
              >
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
                <option value="none">None</option>
              </select>
            <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={() => {
                  setShuffle((v) => !v);
                  setIndex(0);
                  setPlaying(false);
                }}
              />
              {t('ui.slideshow.shuffle' as any, { defaultValue: 'Shuffle play order' })}
            </label>
            <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={loop} onChange={() => setLoop((v) => !v)} />
              {t('ui.slideshow.loop' as any, { defaultValue: 'Loop / repeat' })}
            </label>
            </label>
            <label className="h-8 rounded bg-white/5 border border-white/10 px-2 flex items-center gap-2 text-[11px] text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={showCaption}
                onChange={(e) => setShowCaption(e.target.checked)}
                className="accent-white"
              />
              {t('ui.slideshow.captions' as any, { defaultValue: 'Show filename' })}
            </label>
            <button
              type="button"
              disabled={exporting || slides.length === 0}
              onClick={handleExportHtml}
              className="w-full h-8 rounded bg-white/15 hover:bg-white/25 disabled:opacity-40 text-[11px] text-white font-semibold uppercase tracking-wide"
            >
              {exporting
                ? t('ui.slideshow.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.slideshow.exportHtml' as any, { defaultValue: 'Export HTML' })}
            </button>
            <button
              type="button"
              disabled={exporting || slides.length === 0}
              onClick={handleExportPackage}
              className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 text-[11px] text-button-text font-semibold uppercase tracking-wide"
              data-tooltip={t('ui.slideshow.exportPackageTip' as any, {
                defaultValue: 'Folder with images/ + index.html (portable multi-file package)',
              })}
            >
              {exporting
                ? t('ui.slideshow.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.slideshow.exportPackage' as any, { defaultValue: 'Export package…' })}
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
          </section>
          <section className="mt-4 space-y-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={prev}
                className="flex-1 h-9 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                aria-label="Previous"
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="flex-[1.4] h-9 rounded bg-white/20 hover:bg-white/30 text-white flex items-center justify-center gap-1 font-semibold text-[11px] uppercase"
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing
                  ? t('ui.slideshow.pause' as any, { defaultValue: 'Pause' })
                  : t('ui.slideshow.play' as any, { defaultValue: 'Play' })}
              </button>
              <button
                type="button"
                onClick={next}
                className="flex-1 h-9 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                aria-label="Next"
              >
                <SkipForward size={16} />
              </button>
            </div>
            <p className="text-[10px] text-white/35">
              {t('ui.slideshow.hint' as any, {
                defaultValue: 'Space play/pause · ←/→ navigate · Esc stop',
              })}
            </p>
          </section>
        </>
      }
    >
      <div className="w-full h-full min-h-[280px] rounded border border-white/10 bg-black overflow-hidden relative flex items-center justify-center">
        {src ? (
          <img
            key={`${current?.path}-${transition}`}
            src={src}
            alt={name}
            className={
              transition === 'fade'
                ? 'max-w-full max-h-full object-contain animate-[fadeIn_0.45s_ease]'
                : transition === 'slide'
                  ? 'max-w-full max-h-full object-contain animate-[slideIn_0.4s_ease]'
                  : 'max-w-full max-h-full object-contain'
            }
          />
        ) : (
          <div className="text-white/30 text-[12px] uppercase tracking-widest">
            {t('ui.slideshow.noPreview' as any, { defaultValue: 'No preview' })}
          </div>
        )}
        {showCaption && name && (
          <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end pointer-events-none">
            <span className="text-[12px] text-white/85 bg-black/45 px-2 py-1 rounded truncate max-w-[70%]">
              {name}
            </span>
            <span className="text-[11px] text-white/60 bg-black/45 px-2 py-1 rounded tabular-nums">
              {slides.length ? `${index + 1} / ${slides.length}` : '0 / 0'}
            </span>
          </div>
        )}
        {playing && (
          <div className="absolute top-3 right-3 text-[10px] uppercase tracking-wider text-emerald-300/90 bg-black/50 px-2 py-0.5 rounded">
            Live
          </div>
        )}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0.15; } to { opacity: 1; } }
        @keyframes slideIn { from { opacity: 0.4; transform: translateX(24px); } to { opacity: 1; transform: none; } }
      `}</style>
    </ModuleShell>
  );
}
