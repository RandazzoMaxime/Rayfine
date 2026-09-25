import { X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';

export default function ImageInfoModal() {
  const open = useUIStore((s) => s.isImageInfoModalOpen);
  const setUI = useUIStore((s) => s.setUI);
  const img = useEditorStore((s) => s.selectedImage);
  if (!open) return null;

  const name = img?.path?.split(/[\\/]/).pop()?.split('?')[0] || '—';
  const ex = (img?.exif || {}) as Record<string, string>;
  const rows: Array<[string, string]> = [];
  const add = (k: string, v?: string | number | null) => {
    if (v == null || String(v).trim() === '') return;
    rows.push([k, String(v)]);
  };
  add('Fichier', name);
  if (img?.width && img?.height) add('Dimensions', `${img.width} × ${img.height}`);
  if (img?.isRaw) add('Type', 'RAW');
  add('Appareil', [ex.Make, ex.Model].filter(Boolean).join(' '));
  add('Objectif', ex.LensModel || ex.Lens);
  add('ISO', ex.PhotographicSensitivity || ex.ISO || ex.ISOSpeedRatings);
  add('Ouverture', ex.FNumber ? (String(ex.FNumber).startsWith('f') ? ex.FNumber : `f/${ex.FNumber}`) : '');
  add('Vitesse', ex.ExposureTime);
  add('Focale', ex.FocalLengthIn35mmFilm || ex.FocalLength);
  add('Date', ex.DateTimeOriginal);
  add('Créateur', ex.Artist || ex.Creator);
  add('Copyright', ex.Copyright);
  add('Légende', ex.ImageDescription);
  add('Ville', ex.City);
  add('Pays', ex.Country);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" onClick={() => setUI({ isImageInfoModalOpen: false })}>
      <div
        className="w-[min(22rem,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto custom-scrollbar rounded-md bg-surface border border-border-color/50 shadow-xl p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold">Infos image</span>
          <button type="button" className="p-0.5 text-text-secondary hover:text-text-primary" onClick={() => setUI({ isImageInfoModalOpen: false })}>
            <X size={14} />
          </button>
        </div>
        <dl className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11px]">
              <dt className="w-24 shrink-0 text-text-secondary">{k}</dt>
              <dd className="min-w-0 text-text-primary break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
