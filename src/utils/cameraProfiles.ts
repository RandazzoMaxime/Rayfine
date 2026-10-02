export type ProfileKind = 'raw' | 'camera';
export type ProfileFilter = 'all' | 'color' | 'bw';

export interface CameraProfile {
  id: string;
  name: string;
  group: string;
  kind: ProfileKind;
  bw?: boolean;
}

// These are the only built-in looks implemented by the renderer. RAW files
// still use Rawler's per-camera sensor colour matrix under the Standard look.
export const CAMERA_PROFILE_GROUPS: Array<{ id: string; name: string; profiles: CameraProfile[] }> = [
  {
    id: 'defaults',
    name: 'Profils par défaut',
    profiles: [
      { id: 'standard', name: 'Standard', group: 'Profils par défaut', kind: 'raw' },
      { id: 'monochrome', name: 'Monochrome', group: 'Profils par défaut', kind: 'raw', bw: true },
    ],
  },
];

export const ALL_CAMERA_PROFILES: CameraProfile[] = CAMERA_PROFILE_GROUPS.flatMap((g) => g.profiles);

export function normalizeCameraProfile(name: string | null | undefined): string {
  const normalized = (name || '').trim().toLowerCase();
  if (normalized === 'monochrome' || normalized === 'adobe monochrome' || normalized === 'camera monochrome') return 'Monochrome';
  return 'Standard';
}

export function findCameraProfile(nameOrId: string | null | undefined): CameraProfile | null {
  if (!nameOrId) return null;
  const canonical = normalizeCameraProfile(nameOrId);
  return ALL_CAMERA_PROFILES.find((p) => p.name === canonical) || null;
}

const FAV_KEY = 'rustroom.profileFavorites.v1';

export function loadProfileFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string' && ['standard', 'monochrome'].includes(x)) : [];
  } catch {
    return [];
  }
}

export function saveProfileFavorites(ids: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids.filter((id) => ['standard', 'monochrome'].includes(id)).slice(0, 2)));
  } catch {
    /* ignore */
  }
}
