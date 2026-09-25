import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import debounce from 'lodash.debounce';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Invokes, Preset } from '../components/ui/AppProperties';
import type { UserPreset } from '../hooks/usePresets';
import { normalizePresetTree } from '../utils/presetTree';

const persist = debounce((tree: UserPreset[]) => {
  invoke(Invokes.SavePresets, { presets: tree }).catch((err) => console.error('Failed to save presets:', err));
}, 400);

interface PresetStoreState {
  /** User preset tree (folders = Lightroom-style groups), same shape as `load_presets`. */
  presets: UserPreset[];
  isLoading: boolean;
  loaded: boolean;
  /** Lightroom presets imported into the Preset Browser this session (not yet added to the user list). */
  stagedImports: Preset[];
  load: () => Promise<void>;
  /** Replace the whole tree and persist it (debounced) with `save_presets`. */
  commit: (next: UserPreset[] | ((prev: UserPreset[]) => UserPreset[])) => void;
  /** Flush pending saves (call before backend commands that read presets.json). */
  flush: () => void;
  /** Replace tree with a list returned by a backend import command (already saved on disk). */
  replaceFromBackend: (tree: UserPreset[]) => void;
  setStagedImports: (updater: (prev: Preset[]) => Preset[]) => void;
}

export const usePresetStore = create<PresetStoreState>((set, get) => ({
  presets: [],
  isLoading: false,
  loaded: false,
  stagedImports: [],

  load: async () => {
    persist.flush();
    set({ isLoading: true });
    try {
      const raw: UserPreset[] = await invoke(Invokes.LoadPresets);
      const { tree, changed } = normalizePresetTree(Array.isArray(raw) ? raw : []);
      set({ presets: tree, loaded: true });
      if (changed) persist(tree);
    } catch (err) {
      console.error('Failed to load presets:', err);
      set({ loaded: true });
    } finally {
      set({ isLoading: false });
    }
  },

  commit: (next) => {
    const tree = typeof next === 'function' ? next(get().presets) : next;
    set({ presets: tree });
    persist(tree);
  },

  flush: () => persist.flush(),

  replaceFromBackend: (raw) => {
    const { tree, changed } = normalizePresetTree(Array.isArray(raw) ? raw : []);
    set({ presets: tree });
    if (changed) persist(tree);
  },

  setStagedImports: (updater) => set((s) => ({ stagedImports: updater(s.stagedImports) })),
}));

/** Opens a file picker for Lightroom presets (.xmp / .lrtemplate) and parses them without saving. */
export async function pickAndParseLegacyPresets(title: string): Promise<{ presets: Preset[]; errors: string[] } | null> {
  const selected = await openDialog({
    filters: [{ name: 'Lightroom presets', extensions: ['xmp', 'lrtemplate'] }],
    multiple: true,
    title,
  });
  if (!selected) return null;
  const paths = Array.isArray(selected) ? selected : [selected];
  if (paths.length === 0) return null;
  const res: { presets: Preset[]; errors: string[] } = await invoke(Invokes.ParseLegacyPresetFiles, { paths });
  return { presets: res?.presets || [], errors: res?.errors || [] };
}
