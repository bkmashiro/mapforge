export interface ToneRGB {
  dark: [number, number, number];
  normal: [number, number, number];
  light: [number, number, number];
  unobtainable: [number, number, number];
}

export type Tone = 'dark' | 'normal' | 'light' | 'unobtainable';

export interface BlockEntry {
  displayName: string;
  validVersions: Record<string, { NBTName: string; NBTArgs: Record<string, string> } | string>;
  supportBlockMandatory: boolean;
  flammable: boolean;
  presetIndex: number;
}

export interface ColourSet {
  colourSetId: number;
  tonesRGB: ToneRGB;
  blocks: Record<string, BlockEntry>;
}

export interface ColourMap {
  [id: string]: Omit<ColourSet, 'colourSetId'>;
}

export type McVersion = '1.20' | '1.19' | '1.18.2' | '1.17.1' | '1.16.5';

export type StaircaseMode = 'flat' | 'staircase';

export type DitherMethod = 'none' | 'floyd-steinberg' | 'ordered';

export interface GeneratorOptions {
  version: McVersion;
  staircaseMode: StaircaseMode;
  ditherMethod: DitherMethod;
  enabledColourIds: Set<number>;
}

export interface MapPixel {
  colourSetId: number;
  tone: Tone;
  blockId: string;
}

export interface GeneratorResult {
  pixels: MapPixel[][];
  width: number;
  height: number;
  materials: Record<string, number>;
}

export interface ExportOptions {
  format: 'litematica' | 'schem';
  version: McVersion;
  name: string;
}
