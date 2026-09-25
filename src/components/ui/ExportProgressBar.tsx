import { useProcessStore } from '../../store/useProcessStore';
import { Status } from './ExportImportProperties';

export default function ExportProgressBar() {
  const { status, progress } = useProcessStore((s) => s.exportState);
  if (status !== Status.Exporting && status !== Status.Cancelling && status !== Status.Success) return null;
  const total = progress?.total || 0;
  const current = progress?.current || 0;
  const pct = total ? Math.min(100, Math.round((current / total) * 100)) : status === Status.Success ? 100 : 0;

  return (
    <div className="shrink-0 h-6 px-3 flex items-center gap-2 bg-bg-secondary border-b border-border-color/30 z-40">
      <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-text-secondary shrink-0">
        {status === Status.Success
          ? `${total}/${total} fichiers exportés`
          : `${current}/${total} fichiers exportés`}
      </span>
    </div>
  );
}
