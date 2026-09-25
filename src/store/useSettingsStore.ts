import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { AppSettings, SupportedTypes, Invokes } from '../components/ui/AppProperties';
import { DEFAULT_THEME_ID } from '../utils/themes';
import { applyAppearance, normalizeAppearanceState, saveAppearance } from '../utils/appearance';

interface SettingsState {
  appSettings: AppSettings | null;
  theme: string;
  supportedTypes: SupportedTypes | null;
  osPlatform: string;

  // Actions
  initPlatform: () => void;
  setAppSettings: (settings: AppSettings | null) => void;
  setTheme: (theme: string) => void;
  setSupportedTypes: (types: SupportedTypes | null) => void;
  handleSettingsChange: (newSettings: AppSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appSettings: null,
  theme: DEFAULT_THEME_ID,
  supportedTypes: null,
  osPlatform: '',

  initPlatform: () => {
    try {
      set({ osPlatform: platform() });
    } catch (_err) {
      set({ osPlatform: '' });
    }
  },

  setAppSettings: (settings) => set({ appSettings: settings }),

  setTheme: (theme) => set({ theme }),

  setSupportedTypes: (types) => set({ supportedTypes: types }),

  handleSettingsChange: async (newSettings: AppSettings) => {
    if (!newSettings) {
      console.error('handleSettingsChange was called with null settings. Aborting save operation.');
      return;
    }

    if (newSettings.theme && newSettings.theme !== get().theme) {
      set({ theme: newSettings.theme });
    }

    const prev = get().appSettings;
    const merged: AppSettings = {
      ...newSettings,
      appearance: newSettings.appearance ?? prev?.appearance,
    };
    if (merged.theme === 'light' || merged.theme === 'dark') {
      const prevAppearance = merged.appearance;
      if (prevAppearance) {
        merged.appearance = { ...prevAppearance, appearance: merged.theme };
      }
    }

    const { searchCriteria: _searchCriteria, ...settingsToSave } = merged as any;
    set({ appSettings: merged });
    const appearanceState = normalizeAppearanceState(merged.appearance);
    if (appearanceState) {
      applyAppearance(appearanceState);
      saveAppearance(appearanceState);
    }

    try {
      await invoke(Invokes.SaveSettings, { settings: settingsToSave });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },
}));
