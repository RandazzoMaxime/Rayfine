import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../components/ui/AppProperties';
import { useLibraryStore } from '../store/useLibraryStore';
import { usePresetStore } from '../store/usePresetStore';
import { findPreset } from './presetTree';
import { loadMetadataPresets, nonemptyFields } from './metadataPresets';

function expandKeywords(raw: string): string[] {
  const tokens = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const expanded = new Set<string>();
  for (const kw of tokens) {
    const bare = kw.toLowerCase().replace(/^user:/, '').replace(/\s*>\s*/g, '/').replace(/\s*\|\s*/g, '/');
    if (!bare) continue;
    const parts = bare.split('/').map((p) => p.trim()).filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      expanded.add(`user:${acc}`);
    }
  }
  return Array.from(expanded);
}

/** Apply develop preset, metadata preset and keywords chosen in Library "Apply during import". */
export async function applyImportSidecars(paths: string[]) {
  if (!paths.length) return;
  const lib = useLibraryStore.getState();
  const developId = lib.importApplyDevelopPresetId;
  const metadataId = lib.importApplyMetadataPresetId;
  const keywordRaw = lib.importApplyKeywords || '';

  if (developId) {
    let tree = usePresetStore.getState().presets;
    if (!tree.length) {
      try {
        await usePresetStore.getState().load();
        tree = usePresetStore.getState().presets;
      } catch {
        /* ignore */
      }
    }
    const found = findPreset(tree, developId);
    const adj = found?.preset?.adjustments;
    if (adj && Object.keys(adj).length > 0) {
      await invoke(Invokes.ApplyAdjustmentsToPaths, { paths, adjustments: adj });
    }
  }

  if (metadataId) {
    const preset = loadMetadataPresets().find((p) => p.id === metadataId);
    const fields = preset ? nonemptyFields(preset.fields) : {};
    if (Object.keys(fields).length > 0) {
      await invoke(Invokes.UpdateExifFields, { paths, updates: fields });
    }
  }

  const tags = expandKeywords(keywordRaw);
  for (const tag of tags) {
    try {
      await invoke(Invokes.AddTagForPaths, { paths, tag });
    } catch {
      /* continue */
    }
  }
}
