import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, LayoutGrid, Star } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import {
  ALL_CAMERA_PROFILES,
  CAMERA_PROFILE_GROUPS,
  findCameraProfile,
  loadProfileFavorites,
  saveProfileFavorites,
  type CameraProfile,
  type ProfileFilter,
} from '../../../utils/cameraProfiles';
import Slider from '../../ui/Slider';

export default function ProfileExplorer() {
  const { t } = useTranslation();
  const setUI = useUIStore((s) => s.setUI);
  const adjustments = useEditorStore((s) => s.adjustments);
  const { setAdjustments } = useEditorActions();
  const [filter, setFilter] = useState<ProfileFilter>('all');
  const [favorites, setFavorites] = useState<string[]>(() =>
    typeof window !== 'undefined' ? loadProfileFavorites() : [],
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['adobe-raw']));

  const current = findCameraProfile((adjustments as any).cameraProfile) || ALL_CAMERA_PROFILES[1];
  const amount = Number((adjustments as any).profileAmount ?? 100);
  const amountEnabled = current?.kind === 'creative';

  const matches = (p: CameraProfile) => {
    if (filter === 'bw') return !!p.bw;
    if (filter === 'color') return !p.bw;
    return true;
  };

  const favProfiles = useMemo(
    () => ALL_CAMERA_PROFILES.filter((p) => favorites.includes(p.id) && matches(p)),
    [favorites, filter],
  );

  const apply = (p: CameraProfile) => {
    setAdjustments((prev: any) => ({
      ...prev,
      cameraProfile: p.name,
      convertToGrayscale: !!p.bw,
      saturation: p.bw ? -100 : prev.saturation === -100 ? 0 : prev.saturation,
      profileAmount: p.kind === 'creative' ? (prev.profileAmount ?? 100) : 100,
    }));
  };

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveProfileFavorites(next);
      return next;
    });
  };

  const toggleGroup = (id: string) => {
    setOpenGroups((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const close = () => setUI({ isProfileBrowserOpen: false });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-1.5 flex items-center justify-between shrink-0 border-b border-border-color/40">
        <span className="text-[12px] font-semibold">
          {t('adjustments.profile.explorer' as any, { defaultValue: 'Explorateur de profils' })}
        </span>
      </div>

      <div className="px-2.5 py-2 shrink-0 border-b border-border-color/30 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-text-primary truncate">{current?.name || 'Adobe Standard'}</span>
          <button
            type="button"
            className="h-6 px-2 rounded text-[11px] bg-surface border border-border-color/40 hover:bg-card-active"
            onClick={close}
          >
            {t('adjustments.profile.close' as any, { defaultValue: 'Fermer' })}
          </button>
        </div>
        <Slider
          label={t('adjustments.profile.amount' as any, { defaultValue: 'Niveau' })}
          min={0}
          max={100}
          step={1}
          value={amountEnabled ? amount : 100}
          disabled={!amountEnabled}
          onChange={(e: any) =>
            setAdjustments((prev: any) => ({ ...prev, profileAmount: parseFloat(e.target.value) }))
          }
        />
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex rounded bg-surface border border-border-color/40 p-0.5">
            {(
              [
                ['all', t('adjustments.profile.all' as any, { defaultValue: 'Tout' })],
                ['color', t('adjustments.profile.color' as any, { defaultValue: 'Couleur' })],
                ['bw', t('adjustments.profile.bw' as any, { defaultValue: 'N&B' })],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={clsx(
                  'h-6 px-2 rounded',
                  filter === id ? 'bg-card-active text-text-primary' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-1 text-text-secondary">
            <LayoutGrid size={12} />
            {t('adjustments.profile.grid' as any, { defaultValue: 'Grille' })}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
        <Group
          title={t('adjustments.profile.favorites' as any, { defaultValue: 'Favoris' })}
          count={favProfiles.length}
          open={openGroups.has('favorites')}
          onToggle={() => toggleGroup('favorites')}
        >
          {favProfiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              active={current?.id === p.id}
              favorite
              onSelect={() => apply(p)}
              onFav={() => toggleFav(p.id)}
            />
          ))}
        </Group>
        {CAMERA_PROFILE_GROUPS.map((g) => {
          const items = g.profiles.filter(matches);
          if (!items.length) return null;
          return (
            <Group
              key={g.id}
              title={g.name}
              count={items.length}
              open={openGroups.has(g.id)}
              onToggle={() => toggleGroup(g.id)}
            >
              {items.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  active={current?.id === p.id}
                  favorite={favorites.includes(p.id)}
                  onSelect={() => apply(p)}
                  onFav={() => toggleFav(p.id)}
                />
              ))}
            </Group>
          );
        })}
      </div>
    </div>
  );
}

function Group({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-2.5 py-1 text-[11px] text-text-primary hover:bg-card-active"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate">
          {title} ({count})
        </span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function ProfileRow({
  profile,
  active,
  favorite,
  onSelect,
  onFav,
}: {
  profile: CameraProfile;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFav: () => void;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-1 pl-6 pr-2 py-0.5 text-[11px] cursor-pointer',
        active ? 'bg-card-active text-text-primary' : 'text-text-primary hover:bg-card-active/70',
      )}
    >
      <button type="button" className="flex-1 text-left truncate" onClick={onSelect}>
        {profile.name}
      </button>
      <button
        type="button"
        className={clsx('p-0.5', favorite ? 'text-amber-300' : 'text-text-secondary/40 hover:text-amber-200')}
        onClick={(e) => {
          e.stopPropagation();
          onFav();
        }}
        aria-label="Favorite"
      >
        <Star size={11} className={favorite ? 'fill-amber-300' : ''} />
      </button>
    </div>
  );
}
