import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronLeft, ChevronRight, Folder, FolderHeart, FolderOpen, Images } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants, TextWeights } from '../../types/typography';
import { Album, AlbumGroup, AlbumItem } from '../ui/AppProperties';

function countImages(item: AlbumItem): number {
  if (item.type === 'album') return (item as Album).images?.length || 0;
  return ((item as AlbumGroup).children || []).reduce((n, c) => n + countImages(c), 0);
}

interface MapCollectionsPanelProps {
  width: number;
  albumTree: AlbumItem[];
  /** null = current folder (Library image list) */
  activeAlbumId: string | null;
  currentFolderLabel: string;
  currentFolderTitle?: string;
  currentFolderCount: number;
  onSelect(albumId: string | null): void;
  onHide(): void;
  isInstantTransition?: boolean;
}

/**
 * Map module left column — same chrome as the Develop left panel, Collections only.
 * Selecting a collection only changes the Map's local source (Library state untouched).
 */
export default function MapCollectionsPanel({
  width,
  albumTree,
  activeAlbumId,
  currentFolderLabel,
  currentFolderTitle,
  currentFolderCount,
  onSelect,
  onHide,
  isInstantTransition,
}: MapCollectionsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const rowClass = (active: boolean) =>
    clsx(
      'w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center gap-1.5 border-l-2',
      active
        ? 'bg-card-active text-text-primary font-medium border-white/60'
        : 'text-text-primary hover:bg-card-active border-transparent',
    );

  const renderItems = (items: AlbumItem[], depth: number) =>
    items.map((item) => {
      const pad = { paddingLeft: `${6 + depth * 12}px` };
      if (item.type === 'group') {
        const group = item as AlbumGroup;
        const collapsed = !!collapsedGroups[group.id];
        return (
          <li key={group.id}>
            <button
              type="button"
              style={pad}
              onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
              className={rowClass(false)}
            >
              {collapsed ? (
                <Folder size={12} className="shrink-0 opacity-70" />
              ) : (
                <FolderOpen size={12} className="shrink-0 opacity-70" />
              )}
              <span className="truncate flex-1">{group.name}</span>
              <span className="text-[10px] tabular-nums text-text-secondary">{countImages(group)}</span>
              <ChevronDown
                size={12}
                className={clsx('shrink-0 text-text-secondary transition-transform', collapsed && '-rotate-90')}
              />
            </button>
            {!collapsed && (group.children || []).length > 0 && (
              <ul className="space-y-0.5 mt-0.5">{renderItems(group.children, depth + 1)}</ul>
            )}
          </li>
        );
      }
      const album = item as Album;
      return (
        <li key={album.id}>
          <button
            type="button"
            style={pad}
            onClick={() => onSelect(album.id)}
            className={rowClass(activeAlbumId === album.id)}
          >
            <Images size={12} className="shrink-0 opacity-70" />
            <span className="truncate flex-1">{album.name}</span>
            <span className="text-[10px] tabular-nums text-text-secondary">{album.images?.length || 0}</span>
          </button>
        </li>
      );
    });

  return (
    <div
      className={clsx(
        'h-full flex flex-col shrink-0 bg-bg-secondary rounded-lg overflow-hidden border border-border-color/30',
        !isInstantTransition && 'transition-[width] duration-200',
      )}
      style={{ width }}
    >
      <div className="flex items-center justify-between px-2 py-1 border-b border-border-color/40 shrink-0">
        <Text variant={TextVariants.small} weight={TextWeights.semibold} className="uppercase tracking-wider text-[10px]">
          {t('ui.moduleBar.map' as any)}
        </Text>
        <button
          type="button"
          className="p-1 rounded hover:bg-card-active text-text-secondary"
          data-tooltip={t('ui.developLeft.hide' as any)}
          onClick={onHide}
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="flex flex-col flex-1 border-b border-border-color/50 min-h-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-card-active shrink-0"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
            <FolderHeart size={12} />
            {t('ui.developLeft.collections' as any, { defaultValue: 'Collections' })}
          </span>
          <ChevronDown size={14} className={clsx('text-text-secondary transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-2 pb-2">
            <ul className="space-y-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className={rowClass(activeAlbumId === null)}
                  title={currentFolderTitle}
                >
                  <Folder size={12} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">{currentFolderLabel}</span>
                  <span className="text-[10px] tabular-nums text-text-secondary">{currentFolderCount}</span>
                </button>
              </li>
              {albumTree.length === 0 ? (
                <li className="px-1.5 py-1 text-[10px] text-text-secondary">
                  {t('ui.developLeft.noAlbums' as any, { defaultValue: 'No albums yet' })}
                </li>
              ) : (
                renderItems(albumTree, 0)
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsed rail to re-show the Map collections column (mirrors DevelopLeftRail). */
export function MapCollectionsRail({ onShow }: { onShow(): void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onShow}
      className="h-full w-8 shrink-0 flex flex-col items-center justify-start pt-2 gap-2 bg-bg-secondary rounded-lg border border-border-color/30 text-text-secondary hover:text-text-primary"
      data-tooltip={t('ui.map.showCollections' as any, { defaultValue: 'Show collections' })}
    >
      <ChevronRight size={14} />
      <FolderHeart size={14} />
    </button>
  );
}
