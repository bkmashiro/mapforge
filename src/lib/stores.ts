import { writable, derived } from 'svelte/store';
import { translations, type Locale } from './i18n';

export const locale = writable<Locale>('en');
export const t = derived(locale, ($locale) => translations[$locale]);

// Per colourSetId block variant selection
export const selectedVariants = writable<Record<number, string>>({});

// ── Advanced settings ────────────────────────────────────────────────────────

export type ColorSpace = 'lab' | 'rgb';
export type ResizeFilter = 'lanczos' | 'bilinear' | 'nearest';

export interface AdvancedSettings {
  // Color matching
  colorSpace: ColorSpace;
  labLWeight: number;   // 0.5–3.0
  labAWeight: number;
  labBWeight: number;

  // Dithering
  ditherStrength: number;       // 0–100 (%)
  blueNoiseThreshold: number;   // 10–80

  // Preprocessing (applied in page before worker)
  resizeFilter: ResizeFilter;
  saturationBoost: number;  // -50 to +50 (%)
  brightness: number;       // -50 to +50 (%)

  // Export
  schematicName: string;
  yOffset: number;
  includeAirBlocks: boolean;
}

export const DEFAULT_ADVANCED: AdvancedSettings = {
  colorSpace: 'lab',
  labLWeight: 1.0,
  labAWeight: 1.0,
  labBWeight: 1.0,
  ditherStrength: 100,
  blueNoiseThreshold: 40,
  resizeFilter: 'lanczos',
  saturationBoost: 0,
  brightness: 0,
  schematicName: 'mapforge_export',
  yOffset: 64,
  includeAirBlocks: true,
};

export const advancedSettings = writable<AdvancedSettings>({ ...DEFAULT_ADVANCED });
