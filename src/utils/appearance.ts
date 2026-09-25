import { THEMES } from './themes';
import { Theme } from '../components/ui/AppProperties';

export type AppearanceId = 'dark' | 'light';

export interface ColorSeeds {
  canvas: string;
  text: string;
  accent: string;
}

export interface AppearanceState {
  appearance: AppearanceId;
  seeds: Record<AppearanceId, ColorSeeds>;
}

const STORAGE_KEY = 'rustroom.appearance.v1';

type Rgb = [number, number, number];

const rgbStr = ([r, g, b]: Rgb) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

export function parseCssColor(input: string): Rgb {
  const hex = input.trim();
  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = hex.match(/[\d.]+/g);
  if (m && m.length >= 3) {
    return [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])];
  }
  return [24, 24, 24];
}

export function rgbToHex(rgb: Rgb): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function hexToRgb(hex: string): Rgb {
  return parseCssColor(hex);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const u = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export function luminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

function seedsFromTheme(id: Theme.Dark | Theme.Light): ColorSeeds {
  const vars = THEMES.find((t) => t.id === id)?.cssVariables || THEMES[0].cssVariables;
  return {
    canvas: rgbToHex(parseCssColor(vars['--app-bg-primary'])),
    text: rgbToHex(parseCssColor(vars['--app-text-primary'])),
    accent: rgbToHex(parseCssColor(vars['--app-accent'])),
  };
}

export const DEFAULT_SEEDS: Record<AppearanceId, ColorSeeds> = {
  dark: seedsFromTheme(Theme.Dark),
  light: seedsFromTheme(Theme.Light),
};

export function defaultAppearanceState(): AppearanceState {
  return {
    appearance: 'dark',
    seeds: {
      dark: { ...DEFAULT_SEEDS.dark },
      light: { ...DEFAULT_SEEDS.light },
    },
  };
}

export function paletteFromSeeds(seeds: ColorSeeds, appearance: AppearanceId): Record<string, string> {
  const canvas = hexToRgb(seeds.canvas);
  const text = hexToRgb(seeds.text);
  const accent = hexToRgb(seeds.accent);
  const towardText = (t: number) => mix(canvas, text, t);
  const dark = appearance === 'dark';
  return {
    '--app-bg-primary': rgbStr(canvas),
    '--app-bg-secondary': rgbStr(towardText(dark ? 0.07 : 0.05)),
    '--app-surface': rgbStr(towardText(dark ? 0.04 : 0.09)),
    '--app-card-active': rgbStr(towardText(dark ? 0.13 : 0.14)),
    '--app-text-primary': rgbStr(text),
    '--app-text-secondary': rgbStr(mix(text, canvas, 0.38)),
    '--app-accent': rgbStr(accent),
    '--app-border-color': rgbStr(towardText(dark ? 0.16 : 0.2)),
    '--app-hover-color': rgbStr(accent),
    '--app-button-text': luminance(accent) > 0.55 ? 'rgb(20, 20, 20)' : 'rgb(255, 255, 255)',
  };
}

export function applyCssVariables(vars: Record<string, string>, appearance?: AppearanceId) {
  const root = document.documentElement;
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  if (appearance) {
    root.style.colorScheme = appearance;
    root.dataset.appearance = appearance;
  }
}

export function applyAppearance(state: AppearanceState) {
  const seeds = state.seeds[state.appearance] || DEFAULT_SEEDS[state.appearance];
  applyCssVariables(paletteFromSeeds(seeds, state.appearance), state.appearance);
}

export function loadAppearance(): AppearanceState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    const base = defaultAppearanceState();
    const appearance: AppearanceId = parsed.appearance === 'light' ? 'light' : 'dark';
    return {
      appearance,
      seeds: {
        dark: { ...base.seeds.dark, ...(parsed.seeds?.dark || {}) },
        light: { ...base.seeds.light, ...(parsed.seeds?.light || {}) },
      },
    };
  } catch {
    return null;
  }
}

export function saveAppearance(state: AppearanceState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function isLightHex(hex: string): boolean {
  return luminance(hexToRgb(hex)) > 0.55;
}

export function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const h = v.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}
