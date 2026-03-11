// Converter Web Worker — color matching engine for web-mapart

type Tone = 'dark' | 'normal' | 'light' | 'unobtainable';

interface ToneRGB {
  dark: [number, number, number];
  normal: [number, number, number];
  light: [number, number, number];
  unobtainable: [number, number, number];
}

interface BlockEntry {
  displayName: string;
  validVersions: Record<string, { NBTName: string; NBTArgs: Record<string, string> } | string>;
  supportBlockMandatory: boolean;
  flammable: boolean;
  presetIndex: number;
}

interface ColourSet {
  tonesRGB: ToneRGB;
  blocks: Record<string, BlockEntry>;
}

interface PaletteEntry {
  colourSetId: number;
  tone: Tone;
  blockId: string;
  displayName: string;
  lab: [number, number, number];
  rgb: [number, number, number];
}

type WorkerInput = {
  type: 'convert';
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  options: {
    version: string;
    staircaseMode: 'flat' | 'staircase';
    ditherMethod: 'none' | 'floyd-steinberg' | 'ordered';
    enabledColourIds: number[];
  };
  coloursJSON: Record<string, ColourSet>;
};

type WorkerOutput =
  | { type: 'progress'; progress: number }
  | {
      type: 'done';
      pixels: { colourSetId: number; tone: string; blockId: string }[][];
      materials: Record<string, number>;
      previewData: Uint8ClampedArray;
    };

// ── Color space conversion ────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  // sRGB → XYZ (D65)
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  let X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  let Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  let Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

  // XYZ → Lab (D65 white point)
  X /= 0.95047;
  Y /= 1.00000;
  Z /= 1.08883;

  function f(t: number): number {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }

  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bv = 200 * (fy - fz);

  return [L, a, bv];
}

function deltaE(lab1: [number, number, number], lab2: [number, number, number]): number {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return dL * dL + da * da + db * db;
}

// ── Palette building ──────────────────────────────────────────────────────────

function resolveVersionData(
  validVersions: BlockEntry['validVersions'],
  version: string
): { NBTName: string; NBTArgs: Record<string, string> } | null {
  const entry = validVersions[version];
  if (!entry) return null;
  if (typeof entry === 'string' && entry.startsWith('&')) {
    return resolveVersionData(validVersions, entry.slice(1));
  }
  if (typeof entry === 'string') return null;
  return entry;
}

function getFirstValidBlock(
  blocks: Record<string, BlockEntry>,
  version: string
): [string, BlockEntry] | null {
  for (const [blockId, block] of Object.entries(blocks)) {
    if (resolveVersionData(block.validVersions, version) !== null) {
      return [blockId, block];
    }
  }
  return null;
}

function buildPalette(
  coloursJSON: Record<string, ColourSet>,
  options: WorkerInput['options']
): PaletteEntry[] {
  const palette: PaletteEntry[] = [];
  const enabledSet = new Set(options.enabledColourIds);

  for (const [idStr, colourSet] of Object.entries(coloursJSON)) {
    const colourSetId = parseInt(idStr, 10);
    if (!enabledSet.has(colourSetId)) continue;

    const blockResult = getFirstValidBlock(colourSet.blocks, options.version);
    if (!blockResult) continue;
    const [blockId, block] = blockResult;

    const tones: Tone[] =
      options.staircaseMode === 'staircase'
        ? ['dark', 'normal', 'light']
        : ['normal'];

    for (const tone of tones) {
      const rgb = colourSet.tonesRGB[tone];
      if (!rgb) continue;
      const lab = rgb2lab(rgb[0], rgb[1], rgb[2]);
      palette.push({
        colourSetId,
        tone,
        blockId,
        displayName: block.displayName,
        lab,
        rgb,
      });
    }
  }

  return palette;
}

// ── Nearest color lookup ──────────────────────────────────────────────────────

function findNearest(
  r: number,
  g: number,
  b: number,
  palette: PaletteEntry[]
): PaletteEntry {
  const lab = rgb2lab(r, g, b);
  let best = palette[0];
  let bestDist = Infinity;
  for (const entry of palette) {
    const dist = deltaE(lab, entry.lab);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

// ── Bayer 4×4 matrix ─────────────────────────────────────────────────────────

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// ── Dithering algorithms ──────────────────────────────────────────────────────

function convertNoOither(
  pixels: Float32Array, // RGBA, flat [y*w + x]*4
  w: number,
  h: number,
  palette: PaletteEntry[]
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const entry = findNearest(r, g, b, palette);
      row.push(entry);
      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
  }

  return { result, previewData: preview };
}

function floydSteinberg(
  pixels: Float32Array,
  w: number,
  h: number,
  palette: PaletteEntry[]
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const buf = new Float32Array(pixels); // working copy
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = Math.max(0, Math.min(255, buf[idx]));
      const g = Math.max(0, Math.min(255, buf[idx + 1]));
      const b = Math.max(0, Math.min(255, buf[idx + 2]));

      const entry = findNearest(r, g, b, palette);
      row.push(entry);

      // Error diffusion
      const er = r - entry.rgb[0];
      const eg = g - entry.rgb[1];
      const eb = b - entry.rgb[2];

      // Right: 7/16
      if (x + 1 < w) {
        buf[idx + 4] += (er * 7) / 16;
        buf[idx + 5] += (eg * 7) / 16;
        buf[idx + 6] += (eb * 7) / 16;
      }
      // Bottom-left: 3/16
      if (y + 1 < h && x - 1 >= 0) {
        const bidx = ((y + 1) * w + (x - 1)) * 4;
        buf[bidx] += (er * 3) / 16;
        buf[bidx + 1] += (eg * 3) / 16;
        buf[bidx + 2] += (eb * 3) / 16;
      }
      // Bottom: 5/16
      if (y + 1 < h) {
        const bidx = ((y + 1) * w + x) * 4;
        buf[bidx] += (er * 5) / 16;
        buf[bidx + 1] += (eg * 5) / 16;
        buf[bidx + 2] += (eb * 5) / 16;
      }
      // Bottom-right: 1/16
      if (y + 1 < h && x + 1 < w) {
        const bidx = ((y + 1) * w + (x + 1)) * 4;
        buf[bidx] += (er * 1) / 16;
        buf[bidx + 1] += (eg * 1) / 16;
        buf[bidx + 2] += (eb * 1) / 16;
      }

      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
  }

  return { result, previewData: preview };
}

function orderedDither(
  pixels: Float32Array,
  w: number,
  h: number,
  palette: PaletteEntry[]
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);
  const strength = 24; // dither strength in [0..255] range

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bayer = (BAYER4[y % 4][x % 4] / 16 - 0.5) * strength;
      const r = Math.max(0, Math.min(255, pixels[idx] + bayer));
      const g = Math.max(0, Math.min(255, pixels[idx + 1] + bayer));
      const b = Math.max(0, Math.min(255, pixels[idx + 2] + bayer));

      const entry = findNearest(r, g, b, palette);
      row.push(entry);

      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
  }

  return { result, previewData: preview };
}

// ── Main worker handler ───────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { type, imageData, width, height, options, coloursJSON } = event.data;
  if (type !== 'convert') return;

  const palette = buildPalette(coloursJSON, options);
  if (palette.length === 0) {
    self.postMessage({ type: 'done', pixels: [], materials: {}, previewData: new Uint8ClampedArray(0) } satisfies WorkerOutput);
    return;
  }

  // Build flat float buffer for processing
  const pixelsBuf = new Float32Array(width * height * 4);
  for (let i = 0; i < imageData.length; i++) {
    pixelsBuf[i] = imageData[i];
  }

  let result: PaletteEntry[][];
  let previewData: Uint8ClampedArray;

  // We need to emit progress per row. For large images, split and post progress.
  // Since all dither functions are synchronous, we wrap with progress posts:
  const reportEvery = Math.max(1, Math.floor(height / 10));

  // For floyd-steinberg and no-dither, process row by row with progress
  if (options.ditherMethod === 'floyd-steinberg') {
    const out = floydSteinbergWithProgress(pixelsBuf, width, height, palette, reportEvery);
    result = out.result;
    previewData = out.previewData;
  } else if (options.ditherMethod === 'ordered') {
    const out = orderedDitherWithProgress(pixelsBuf, width, height, palette, reportEvery);
    result = out.result;
    previewData = out.previewData;
  } else {
    const out = noDitherWithProgress(pixelsBuf, width, height, palette, reportEvery);
    result = out.result;
    previewData = out.previewData;
  }

  // Build materials map
  const materials: Record<string, number> = {};
  const pixels2D = result.map((row) =>
    row.map((entry) => {
      const key = entry.displayName;
      materials[key] = (materials[key] || 0) + 1;
      return { colourSetId: entry.colourSetId, tone: entry.tone, blockId: entry.blockId };
    })
  );

  const out: WorkerOutput = {
    type: 'done',
    pixels: pixels2D,
    materials,
    previewData,
  };
  self.postMessage(out, [previewData.buffer]);
};

function noDitherWithProgress(
  pixels: Float32Array,
  w: number,
  h: number,
  palette: PaletteEntry[],
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const entry = findNearest(r, g, b, palette);
      row.push(entry);
      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0) {
      const progress = Math.round(((y + 1) / h) * 100);
      self.postMessage({ type: 'progress', progress } satisfies WorkerOutput);
    }
  }
  return { result, previewData: preview };
}

function floydSteinbergWithProgress(
  pixels: Float32Array,
  w: number,
  h: number,
  palette: PaletteEntry[],
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const buf = new Float32Array(pixels);
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = Math.max(0, Math.min(255, buf[idx]));
      const g = Math.max(0, Math.min(255, buf[idx + 1]));
      const b = Math.max(0, Math.min(255, buf[idx + 2]));

      const entry = findNearest(r, g, b, palette);
      row.push(entry);

      const er = r - entry.rgb[0];
      const eg = g - entry.rgb[1];
      const eb = b - entry.rgb[2];

      if (x + 1 < w) {
        buf[idx + 4] += (er * 7) / 16;
        buf[idx + 5] += (eg * 7) / 16;
        buf[idx + 6] += (eb * 7) / 16;
      }
      if (y + 1 < h && x - 1 >= 0) {
        const bidx = ((y + 1) * w + (x - 1)) * 4;
        buf[bidx] += (er * 3) / 16;
        buf[bidx + 1] += (eg * 3) / 16;
        buf[bidx + 2] += (eb * 3) / 16;
      }
      if (y + 1 < h) {
        const bidx = ((y + 1) * w + x) * 4;
        buf[bidx] += (er * 5) / 16;
        buf[bidx + 1] += (eg * 5) / 16;
        buf[bidx + 2] += (eb * 5) / 16;
      }
      if (y + 1 < h && x + 1 < w) {
        const bidx = ((y + 1) * w + (x + 1)) * 4;
        buf[bidx] += er / 16;
        buf[bidx + 1] += eg / 16;
        buf[bidx + 2] += eb / 16;
      }

      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0) {
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
    }
  }
  return { result, previewData: preview };
}

function orderedDitherWithProgress(
  pixels: Float32Array,
  w: number,
  h: number,
  palette: PaletteEntry[],
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);
  const strength = 24;

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bayer = (BAYER4[y % 4][x % 4] / 16 - 0.5) * strength;
      const r = Math.max(0, Math.min(255, pixels[idx] + bayer));
      const g = Math.max(0, Math.min(255, pixels[idx + 1] + bayer));
      const b = Math.max(0, Math.min(255, pixels[idx + 2] + bayer));

      const entry = findNearest(r, g, b, palette);
      row.push(entry);

      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0) {
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
    }
  }
  return { result, previewData: preview };
}

// Suppress unused function warnings (kept for reference)
void convertNoOither;
void floydSteinberg;
void orderedDither;
