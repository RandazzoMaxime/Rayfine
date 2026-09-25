export type ProfileKind = 'raw' | 'camera' | 'creative';
export type ProfileFilter = 'all' | 'color' | 'bw';

export interface CameraProfile {
  id: string;
  name: string;
  group: string;
  kind: ProfileKind;
  bw?: boolean;
}

export const CAMERA_PROFILE_GROUPS: Array<{ id: string; name: string; profiles: CameraProfile[] }> = [
  {
    id: 'adobe-raw',
    name: 'Adobe Raw',
    profiles: [
      { id: 'adobe-color', name: 'Adobe Color', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-standard', name: 'Adobe Standard', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-landscape', name: 'Adobe Landscape', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-neutral', name: 'Adobe Neutral', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-portrait', name: 'Adobe Portrait', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-vivid', name: 'Adobe Vivid', group: 'Adobe Raw', kind: 'raw' },
      { id: 'adobe-mono', name: 'Adobe Monochrome', group: 'Adobe Raw', kind: 'raw', bw: true },
    ],
  },
  {
    id: 'camera-matching',
    name: 'Camera Matching',
    profiles: [
      { id: 'cam-standard', name: 'Camera Standard', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-landscape', name: 'Camera Landscape', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-portrait', name: 'Camera Portrait', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-vivid', name: 'Camera Vivid', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-neutral', name: 'Camera Neutral', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-faithful', name: 'Camera Faithful', group: 'Camera Matching', kind: 'camera' },
      { id: 'cam-embedded', name: 'Embedded', group: 'Camera Matching', kind: 'camera' },
    ],
  },
  {
    id: 'adaptive',
    name: 'Adaptative',
    profiles: [
      { id: 'adaptive-color', name: 'Adaptive Color', group: 'Adaptative', kind: 'creative' },
      { id: 'adaptive-bw', name: 'Adaptive B&W', group: 'Adaptative', kind: 'creative', bw: true },
    ],
  },
  {
    id: 'artistic',
    name: 'Artistique',
    profiles: [
      { id: 'art-01', name: 'Artistic 01', group: 'Artistique', kind: 'creative' },
      { id: 'art-02', name: 'Artistic 02', group: 'Artistique', kind: 'creative' },
      { id: 'art-03', name: 'Artistic 03', group: 'Artistique', kind: 'creative' },
    ],
  },
  {
    id: 'film',
    name: 'Inspiré d’un film',
    profiles: [
      { id: 'film-classic', name: 'Classic', group: 'Inspiré d’un film', kind: 'creative' },
      { id: 'film-modern', name: 'Modern Film', group: 'Inspiré d’un film', kind: 'creative' },
    ],
  },
  {
    id: 'modern',
    name: 'Moderne',
    profiles: [
      { id: 'mod-01', name: 'Modern 01', group: 'Moderne', kind: 'creative' },
      { id: 'mod-02', name: 'Modern 02', group: 'Moderne', kind: 'creative' },
    ],
  },
  {
    id: 'bw',
    name: 'N&B',
    profiles: [
      { id: 'bw-01', name: 'B&W 01', group: 'N&B', kind: 'creative', bw: true },
      { id: 'bw-02', name: 'B&W 02', group: 'N&B', kind: 'creative', bw: true },
      { id: 'bw-high-contrast', name: 'B&W High Contrast', group: 'N&B', kind: 'creative', bw: true },
    ],
  },
  {
    id: 'vintage',
    name: 'Vintage',
    profiles: [
      { id: 'vintage-01', name: 'Vintage 01', group: 'Vintage', kind: 'creative' },
      { id: 'vintage-02', name: 'Vintage 02', group: 'Vintage', kind: 'creative' },
    ],
  },
];

export const ALL_CAMERA_PROFILES: CameraProfile[] = CAMERA_PROFILE_GROUPS.flatMap((g) => g.profiles);

export function findCameraProfile(nameOrId: string | null | undefined): CameraProfile | null {
  if (!nameOrId) return null;
  const q = nameOrId.toLowerCase();
  return ALL_CAMERA_PROFILES.find((p) => p.id === q || p.name.toLowerCase() === q) || null;
}

const FAV_KEY = 'rustroom.profileFavorites.v1';

export function loadProfileFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveProfileFavorites(ids: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids.slice(0, 64)));
  } catch {
    /* ignore */
  }
}
