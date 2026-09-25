import { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, MapPin, Navigation } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';
import ModuleShell from './ModuleShell';
import MapCollectionsPanel, { MapCollectionsRail } from '../panel/MapCollectionsPanel';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useUIStore } from '../../store/useUIStore';
import { Album, AlbumGroup, AlbumItem, ImageFile, Invokes } from '../ui/AppProperties';

interface Props {
  onBackToLibrary(): void;
  /** Double-click a pin / list item to open Develop (LR Map → Develop). */
  onOpenDevelop?(path: string): void;
}

function parseDms(dmsString: string): number | null {
  if (!dmsString) return null;
  const parts = String(dmsString).match(/(\d+\.?\d*)\s*deg\s*(\d+\.?\d*)\s*min\s*(\d+\.?\d*)\s*sec/i);
  if (!parts) {
    const n = parseFloat(dmsString);
    return Number.isFinite(n) ? n : null;
  }
  return parseFloat(parts[1]) + parseFloat(parts[2]) / 60 + parseFloat(parts[3]) / 3600;
}

function gpsFromExif(exif: Record<string, any> | null | undefined): { lat: number; lon: number } | null {
  if (!exif) return null;
  const latStr = exif.GPSLatitude;
  const lonStr = exif.GPSLongitude;
  if (latStr == null || lonStr == null) return null;
  let lat = typeof latStr === 'number' ? latStr : parseDms(String(latStr));
  let lon = typeof lonStr === 'number' ? lonStr : parseDms(String(lonStr));
  if (lat == null || lon == null) return null;
  const latRef = String(exif.GPSLatitudeRef || '').toUpperCase();
  const lonRef = String(exif.GPSLongitudeRef || '').toUpperCase();
  if (latRef === 'S') lat = -Math.abs(lat);
  if (lonRef === 'W') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

type MapStyle = 'mapnik' | 'cycle' | 'transport';
type MapFilter = 'all' | 'tagged' | 'untagged';

function findAlbum(items: AlbumItem[] | undefined, id: string): Album | null {
  for (const item of items || []) {
    if (item.type === 'album' && item.id === id) return item as Album;
    if (item.type === 'group') {
      const found = findAlbum((item as AlbumGroup).children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Lightroom Classic–style Map module with real GPS pins from library EXIF.
 * Uses OpenStreetMap embed (public tiles) — original RustROOM chrome, no Adobe assets.
 */
export default function MapModuleView({ onBackToLibrary, onOpenDevelop }: Props) {
  const { t } = useTranslation();
  const [style, setStyle] = useState<MapStyle>('mapnik');
  const [showPins, setShowPins] = useState(true);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [filter, setFilter] = useState<MapFilter>(() => {
    try {
      const v = sessionStorage.getItem('rustroom.map.filter');
      if (v !== null) sessionStorage.removeItem('rustroom.map.filter');
      // Legacy 'selected' (or anything unknown) falls back to 'all'
      if (v === 'tagged' || v === 'untagged') return v;
    } catch {
      /* ignore */
    }
    return 'all';
  });
  const [exporting, setExporting] = useState(false);
  /** Map-local source: null = current folder (Library image list), else a collection (album) id. */
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [albumImages, setAlbumImages] = useState<ImageFile[] | null>(null);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [showLeft, setShowLeft] = useState(true);

  const { imageList, libraryActivePath, setLibrary, albumTree, currentFolderPath } = useLibraryStore(
    useShallow((s) => ({
      imageList: s.imageList,
      libraryActivePath: s.libraryActivePath,
      setLibrary: s.setLibrary,
      albumTree: s.albumTree,
      currentFolderPath: s.currentFolderPath,
    })),
  );
  const { developLeftPanelWidth, isInstantTransition, setUI } = useUIStore(
    useShallow((s) => ({
      developLeftPanelWidth: s.developLeftPanelWidth,
      isInstantTransition: s.isInstantTransition,
      setUI: s.setUI,
    })),
  );

  useEffect(() => {
    invoke(Invokes.GetAlbums)
      .then((res: any) => setLibrary({ albumTree: res as AlbumItem[] }))
      .catch(() => {});
  }, [setLibrary]);

  const activeAlbum = useMemo(() => (albumId ? findAlbum(albumTree, albumId) : null), [albumTree, albumId]);

  // Collection deleted elsewhere → back to the current folder
  useEffect(() => {
    if (albumId && !activeAlbum) setAlbumId(null);
  }, [albumId, activeAlbum]);

  const albumPathsKey = activeAlbum ? (activeAlbum.images || []).join('\n') : '';
  useEffect(() => {
    if (!activeAlbum) {
      setAlbumImages(null);
      setAlbumLoading(false);
      return;
    }
    let cancelled = false;
    setAlbumImages(null);
    setAlbumLoading(true);
    invoke<ImageFile[]>(Invokes.GetAlbumImages, { paths: activeAlbum.images || [] })
      .then((files) => {
        if (!cancelled) setAlbumImages(files || []);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`Failed to load album: ${err}`);
        setAlbumImages([]);
      })
      .finally(() => {
        if (!cancelled) setAlbumLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAlbum?.id, albumPathsKey]);

  const sourceList: ImageFile[] = useMemo(
    () => (albumId ? albumImages ?? [] : (imageList as ImageFile[])),
    [albumId, albumImages, imageList],
  );

  const pins = useMemo(() => {
    const out: Array<{ path: string; name: string; lat: number; lon: number }> = [];
    for (const img of sourceList) {
      const g = gpsFromExif(img.exif as any);
      if (!g) continue;
      out.push({
        path: img.path,
        name: img.path.split(/[\\/]/).pop()?.split('?')[0] || img.path,
        lat: g.lat,
        lon: g.lon,
      });
    }
    return out;
  }, [sourceList]);

  const untaggedCount = sourceList.length - pins.length;

  /** Images matching the source + location filter (drives the module filmstrip). */
  const filteredImages = useMemo(() => {
    if (filter === 'all') return sourceList;
    const tagged = new Set(pins.map((p) => p.path));
    return sourceList.filter((img) => (filter === 'tagged' ? tagged.has(img.path) : !tagged.has(img.path)));
  }, [sourceList, pins, filter]);

  // Filmstrip shows only relevant images; null = default Library list (keeps Library sort order)
  useEffect(() => {
    setUI({ mapImageList: albumId || filter !== 'all' ? filteredImages : null });
  }, [albumId, filter, filteredImages, setUI]);
  useEffect(() => () => setUI({ mapImageList: null }), [setUI]);

  const visiblePins = useMemo(() => {
    if (!showPins || filter === 'untagged') return [] as typeof pins;
    return pins;
  }, [pins, showPins, filter]);

  const focus = useMemo(() => {
    if (selectedPin) {
      const p = pins.find((x) => x.path === selectedPin);
      if (p) return p;
    }
    if (libraryActivePath) {
      const p = pins.find((x) => x.path === libraryActivePath);
      if (p) return p;
    }
    if (visiblePins.length === 1) return visiblePins[0];
    if (visiblePins.length > 1) {
      const lat = visiblePins.reduce((s, p) => s + p.lat, 0) / visiblePins.length;
      const lon = visiblePins.reduce((s, p) => s + p.lon, 0) / visiblePins.length;
      return { path: '', name: '', lat, lon };
    }
    // world default
    return { path: '', name: '', lat: 20, lon: 0 };
  }, [selectedPin, libraryActivePath, pins, visiblePins]);

  // Bounding box / zoom heuristic
  const embedUrl = useMemo(() => {
    const span =
      visiblePins.length > 1
        ? Math.max(
            0.02,
            Math.max(...visiblePins.map((p) => p.lat)) - Math.min(...visiblePins.map((p) => p.lat)),
            Math.max(...visiblePins.map((p) => p.lon)) - Math.min(...visiblePins.map((p) => p.lon)),
          ) * 0.75
        : 0.08;
    const lat = focus.lat;
    const lon = focus.lon;
    const bbox = `${lon - span}%2C${lat - span}%2C${lon + span}%2C${lat + span}`;
    const layer =
      style === 'cycle' ? 'cyclemap' : style === 'transport' ? 'transportmap' : 'mapnik';
    // OSM embed supports one marker; multi-pin list is shown on the side
    const marker =
      focus.path || visiblePins.length === 1
        ? `&marker=${lat}%2C${lon}`
        : visiblePins.length > 0
          ? `&marker=${visiblePins[0].lat}%2C${visiblePins[0].lon}`
          : '';
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=${layer}${marker}`;
  }, [focus, style, visiblePins]);

  useEffect(() => {
    // Prefer pin for active library photo
    if (libraryActivePath && pins.some((p) => p.path === libraryActivePath)) {
      setSelectedPin(libraryActivePath);
    }
  }, [libraryActivePath, pins]);

  const selectPhoto = (path: string) => {
    setSelectedPin(path);
    setLibrary({ libraryActivePath: path, multiSelectedPaths: [path] });
  };

  const openInDevelop = (path: string) => {
    selectPhoto(path);
    onOpenDevelop?.(path);
  };

  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  /** Export visible (or all tagged) pins as GPX 1.1 waypoints — LR-style location export. */
  const handleExportGpx = async () => {
    const list = visiblePins.length ? visiblePins : pins;
    if (!list.length) {
      toast.info(
        t('ui.map.noPins' as any, {
          defaultValue: 'No GPS coordinates in current library EXIF.',
        }),
      );
      return;
    }
    setExporting(true);
    try {
      const filePath = await saveDialog({
        defaultPath: 'rustroom-locations.gpx',
        filters: [{ name: 'GPX', extensions: ['gpx'] }],
        title: t('ui.map.exportGpx' as any, { defaultValue: 'Export GPX' }),
      });
      if (!filePath) return;

      const wpts = list
        .map((p) => {
          const name = escapeXml(p.name);
          return `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">
    <name>${name}</name>
    <desc>${escapeXml(p.path)}</desc>
    <type>photo</type>
  </wpt>`;
        })
        .join('\n');
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Rayfine" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Rayfine photo locations</name>
    <desc>${list.length} waypoint${list.length === 1 ? '' : 's'} from library GPS EXIF</desc>
  </metadata>
${wpts}
</gpx>
`;
      await invoke(Invokes.WriteTextFile, { path: filePath, contents: gpx });
      toast.success(
        t('ui.map.exportGpxDone' as any, {
          defaultValue: 'GPX saved ({{count}} waypoints)',
          count: list.length,
        }),
      );
      try {
        await invoke(Invokes.ShowInFinder, { path: filePath });
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };

  // LR Map: ←/→ cycle pins; Enter opens Develop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (!visiblePins.length) return;
      const cur = selectedPin || libraryActivePath;
      let idx = cur ? visiblePins.findIndex((p) => p.path === cur) : -1;
      if (idx < 0) idx = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = visiblePins[(idx + 1) % visiblePins.length];
        selectPhoto(next.path);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = visiblePins[(idx - 1 + visiblePins.length) % visiblePins.length];
        selectPhoto(prev.path);
      } else if (e.key === 'Enter') {
        const path = selectedPin || libraryActivePath;
        if (!path) return;
        e.preventDefault();
        openInDevelop(path);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visiblePins, selectedPin, libraryActivePath, onOpenDevelop]);

  return (
    <ModuleShell
      moduleId="map"
      title={t('ui.moduleBar.map' as any)}
      subtitle={t('ui.moduleShell.mapSubtitle' as any, {
        defaultValue: 'GPS locations and photo pins on a map.',
      })}
      icon={MapIcon}
      onBackToLibrary={onBackToLibrary}
      leftPanel={
        showLeft ? (
          <MapCollectionsPanel
            width={developLeftPanelWidth || 220}
            isInstantTransition={isInstantTransition}
            albumTree={albumTree || []}
            activeAlbumId={albumId}
            currentFolderLabel={t('ui.map.currentFolder' as any, { defaultValue: 'Current folder' })}
            currentFolderTitle={currentFolderPath || undefined}
            currentFolderCount={imageList.length}
            onSelect={(id) => {
              setAlbumId(id);
              setSelectedPin(null);
            }}
            onHide={() => setShowLeft(false)}
          />
        ) : (
          <MapCollectionsRail onShow={() => setShowLeft(true)} />
        )
      }
      right={
        <>
          <section className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary">
              {t('ui.map.mapStyle' as any, { defaultValue: 'Map style' })}
            </div>
            {(
              [
                ['mapnik', 'Standard'],
                ['cycle', 'Cycle'],
                ['transport', 'Transport'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStyle(id)}
                className={`w-full h-8 rounded border px-2 flex items-center text-[11px] ${
                  style === id
                    ? 'bg-card-active border-border-color text-text-primary'
                    : 'bg-surface border-border-color/40 text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </section>
          <section className="space-y-1.5 mt-3">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary">
              {t('ui.map.options' as any, { defaultValue: 'Options' })}
            </div>
            <label className="h-8 rounded bg-surface border border-border-color/40 px-2 flex items-center gap-2 text-[11px] text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={showPins}
                onChange={(e) => setShowPins(e.target.checked)}
                className="accent-accent"
              />
              {t('ui.map.showPins' as any, { defaultValue: 'Show pins' })}
            </label>
            {focus.path && (
              <>
                <button
                  type="button"
                  onClick={() => openInDevelop(focus.path)}
                  className="w-full h-8 rounded bg-card-active border border-border-color px-2 flex items-center gap-2 text-[11px] text-text-primary hover:bg-card-active/80"
                >
                  <MapPin size={12} />
                  {t('ui.map.openDevelop' as any, { defaultValue: 'Open in Develop' })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    invoke(Invokes.ShowInFinder, { path: focus.path }).catch(() => {});
                  }}
                  className="w-full h-8 rounded bg-surface border border-border-color/40 px-2 flex items-center gap-2 text-[11px] text-text-primary hover:bg-card-active"
                >
                  {t('ui.map.showInFolder' as any, { defaultValue: 'Show in folder' })}
                </button>
                <a
                  className="h-8 rounded bg-surface border border-border-color/40 px-2 flex items-center gap-2 text-[11px] text-accent hover:bg-card-active"
                  href={`https://www.openstreetmap.org/?mlat=${focus.lat}&mlon=${focus.lon}#map=14/${focus.lat}/${focus.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={12} />
                  {t('ui.map.openOsm' as any, { defaultValue: 'Open in OSM' })}
                </a>
              </>
            )}
            <button
              type="button"
              disabled={exporting || (!visiblePins.length && !pins.length)}
              onClick={handleExportGpx}
              className="w-full h-8 rounded bg-accent/80 hover:bg-accent disabled:opacity-40 text-button-text text-[11px] font-semibold uppercase tracking-wide"
              data-tooltip={t('ui.map.exportGpxTip' as any, {
                defaultValue: 'Export visible pins (or all tagged) as GPX waypoints',
              })}
            >
              {exporting
                ? t('ui.map.exporting' as any, { defaultValue: 'Exporting…' })
                : t('ui.map.exportGpx' as any, { defaultValue: 'Export GPX…' })}
            </button>
          </section>
          <section className="space-y-1 mt-3">
            <div className="text-[10px] uppercase tracking-wider text-text-secondary">
              {t('ui.map.pins' as any, { defaultValue: 'Pins' })} ({visiblePins.length})
            </div>
            <div className="max-h-[40vh] overflow-y-auto custom-scrollbar space-y-0.5">
              {visiblePins.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-text-secondary">
                  {albumLoading
                    ? '…'
                    : filter === 'untagged'
                      ? t('ui.map.untaggedHint' as any, {
                          defaultValue: 'Photos without GPS are listed in count only.',
                        })
                      : t('ui.map.noPins' as any, {
                          defaultValue: 'No GPS coordinates in current library EXIF.',
                        })}
                </div>
              ) : (
                visiblePins.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => selectPhoto(p.path)}
                    onDoubleClick={() => openInDevelop(p.path)}
                    title={t('ui.map.doubleClickDevelop' as any, {
                      defaultValue: 'Double-click to open in Develop',
                    })}
                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-start gap-1.5 ${
                      selectedPin === p.path || libraryActivePath === p.path
                        ? 'bg-card-active text-text-primary'
                        : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                  >
                    <MapPin size={12} className="mt-0.5 shrink-0 opacity-70" />
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-[10px] text-text-secondary tabular-nums">
                        {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
          <section className="space-y-1 mt-4 text-[10px] text-text-secondary leading-relaxed">
            {t('ui.map.noteCollections' as any, {
              defaultValue:
                'Pins from EXIF GPS of the selected collection or current folder. ←/→ cycle · Enter Develop · GPX export.',
            })}
          </section>
        </>
      }
    >
      <div className="w-full h-full min-h-0 flex flex-col gap-2">
        {/* Location filter bar (top of map, LR Map style) */}
        <div className="flex items-center gap-1 shrink-0 min-w-0">
          {(
            [
              ['all', t('ui.map.filterAll' as any, { defaultValue: 'All photos' }), sourceList.length],
              ['tagged', t('ui.map.filterTagged' as any, { defaultValue: 'GPS tagged' }), pins.length],
              ['untagged', t('ui.map.filterUntagged' as any, { defaultValue: 'No GPS' }), untaggedCount],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`h-7 px-2.5 rounded text-[11px] flex items-center gap-1.5 border ${
                filter === id
                  ? 'bg-card-active border-border-color text-text-primary'
                  : 'bg-surface border-border-color/40 text-text-secondary hover:text-text-primary'
              }`}
            >
              <span>{label}</span>
              <span className="text-text-secondary tabular-nums text-[10px]">{count}</span>
            </button>
          ))}
          <span className="ml-auto pl-2 text-[10px] text-text-secondary truncate">
            {activeAlbum ? activeAlbum.name : t('ui.map.currentFolder' as any, { defaultValue: 'Current folder' })}
            {albumLoading ? ' …' : ''}
          </span>
        </div>
        <div className="w-full flex-1 min-h-[280px] rounded border border-white/10 overflow-hidden bg-[#1a1a1a] relative">
          <iframe
            title="map"
            className="absolute inset-0 w-full h-full border-0"
            src={embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <span className="text-[10px] px-2 py-1 rounded bg-black/55 text-white/70">
              {visiblePins.length} pin{visiblePins.length === 1 ? '' : 's'} · OSM
            </span>
            {focus.name && (
              <span className="text-[10px] px-2 py-1 rounded bg-black/55 text-white/80 truncate max-w-[50%]">
                {focus.name}
              </span>
            )}
          </div>
        </div>
      </div>
    </ModuleShell>
  );
}
