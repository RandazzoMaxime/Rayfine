export interface MetadataPreset {
  id: string;
  name: string;
  fields: Record<string, string>;
}

export const METADATA_PRESET_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'ImageDescription', label: 'Caption' },
  { key: 'XPTitle', label: 'Title' },
  { key: 'Headline', label: 'Headline' },
  { key: 'Artist', label: 'Creator' },
  { key: 'Copyright', label: 'Copyright' },
  { key: 'Credit', label: 'Credit' },
  { key: 'Source', label: 'Source' },
  { key: 'City', label: 'City' },
  { key: 'State', label: 'State' },
  { key: 'Country', label: 'Country' },
  { key: 'Location', label: 'Location' },
  { key: 'Instructions', label: 'Instructions' },
  { key: 'UsageTerms', label: 'Usage terms' },
];

const STORAGE_KEY = 'rustroom.metadataPresets.v1';

export function loadMetadataPresets(): MetadataPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.fields);
  } catch {
    return [];
  }
}

export function saveMetadataPresets(presets: MetadataPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* quota */
  }
}

export function nonemptyFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const t = String(v ?? '').trim();
    if (t) out[k] = t;
  }
  return out;
}
