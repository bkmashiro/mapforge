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

interface AdvancedWorkerOptions {
  colorSpace: 'lab' | 'rgb';
  labLWeight: number;
  labAWeight: number;
  labBWeight: number;
  ditherStrength: number;      // 0–100
  blueNoiseThreshold: number;  // 10–80
}

type WorkerInput = {
  type: 'convert';
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  options: {
    version: string;
    staircaseMode: 'flat' | 'staircase';
    ditherMethod: 'none' | 'atkinson' | 'floyd-steinberg' | 'blue-noise';
    enabledColourIds: number[];
    selectedVariants?: Record<number, string>;
    advanced?: Partial<AdvancedWorkerOptions>;
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
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  let X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  let Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  let Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

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

function deltaELab(
  lab1: [number, number, number],
  lab2: [number, number, number],
  lw = 1, aw = 1, bw = 1
): number {
  const dL = (lab1[0] - lab2[0]) * lw;
  const da = (lab1[1] - lab2[1]) * aw;
  const db = (lab1[2] - lab2[2]) * bw;
  return dL * dL + da * da + db * db;
}

function deltaERGB(
  rgb1: [number, number, number],
  rgb2: [number, number, number]
): number {
  const dr = rgb1[0] - rgb2[0];
  const dg = rgb1[1] - rgb2[1];
  const db = rgb1[2] - rgb2[2];
  return dr * dr + dg * dg + db * db;
}

// ── Blue Noise texture (64×64 = 4096 values) ─────────────────────────────────
// Interleaved gradient noise by Jorge Jimenez: fract(52.9829189 * fract(0.06711056*x + 0.00583715*y))
// Precomputed for deterministic behavior in workers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BLUE_NOISE_64: Uint8Array = new Uint8Array([
  0, 142, 28, 170, 57, 199, 85, 227, 114, 0, 142, 29, 170, 57, 199, 90,
  232, 118, 5, 147, 33, 175, 62, 204, 90, 232, 119, 5, 147, 34, 180, 67,
  208, 95, 237, 123, 10, 152, 39, 180, 67, 209, 95, 237, 124, 15, 157, 43,
  185, 72, 213, 100, 242, 129, 15, 157, 44, 185, 72, 214, 105, 247, 133, 20,
  79, 221, 107, 249, 136, 22, 164, 51, 193, 79, 221, 108, 249, 136, 23, 169,
  56, 197, 84, 226, 112, 254, 141, 27, 169, 56, 198, 84, 226, 113, 4, 145,
  32, 174, 61, 202, 89, 231, 117, 4, 146, 33, 174, 61, 203, 94, 235, 122,
  9, 151, 37, 179, 66, 207, 94, 236, 123, 9, 151, 38, 184, 70, 212, 99,
  158, 44, 186, 73, 215, 101, 243, 130, 16, 158, 45, 187, 73, 215, 102, 248,
  134, 21, 163, 50, 191, 78, 220, 106, 248, 135, 21, 163, 50, 192, 83, 224,
  111, 253, 139, 26, 168, 55, 196, 83, 225, 111, 253, 140, 27, 173, 59, 201,
  88, 229, 116, 3, 145, 31, 173, 60, 201, 88, 230, 117, 8, 149, 36, 178,
  237, 123, 10, 152, 38, 180, 67, 209, 95, 237, 124, 10, 152, 39, 180, 72,
  213, 100, 242, 128, 15, 157, 43, 185, 72, 214, 100, 242, 129, 15, 162, 48,
  190, 77, 218, 105, 247, 133, 20, 162, 49, 190, 77, 219, 105, 251, 138, 25,
  167, 53, 195, 82, 223, 110, 252, 139, 25, 167, 54, 195, 86, 228, 115, 2,
  60, 202, 89, 231, 117, 4, 146, 32, 174, 61, 203, 89, 231, 118, 4, 150,
  37, 179, 66, 207, 94, 236, 122, 9, 151, 37, 179, 66, 208, 94, 240, 127,
  14, 155, 42, 184, 71, 212, 99, 241, 127, 14, 156, 43, 184, 75, 217, 104,
  245, 132, 19, 161, 47, 189, 76, 217, 104, 246, 133, 19, 165, 52, 194, 80,
  139, 26, 168, 54, 196, 83, 225, 111, 253, 140, 26, 168, 55, 197, 83, 229,
  116, 3, 144, 31, 173, 60, 201, 88, 230, 116, 3, 145, 31, 173, 64, 206,
  93, 234, 121, 8, 149, 36, 178, 65, 206, 93, 235, 121, 8, 154, 41, 183,
  69, 211, 98, 239, 126, 13, 155, 41, 183, 70, 211, 98, 244, 131, 18, 159,
  218, 105, 247, 133, 20, 162, 48, 190, 77, 219, 105, 247, 134, 20, 162, 53,
  195, 82, 223, 110, 252, 138, 25, 167, 54, 195, 82, 224, 110, 252, 143, 30,
  172, 58, 200, 87, 228, 115, 2, 143, 30, 172, 59, 200, 87, 233, 120, 6,
  148, 35, 177, 63, 205, 92, 233, 120, 7, 149, 35, 177, 68, 210, 96, 238,
  42, 184, 70, 212, 99, 241, 127, 14, 156, 42, 184, 71, 213, 99, 241, 132,
  19, 160, 47, 189, 76, 217, 104, 246, 132, 19, 161, 47, 189, 76, 222, 109,
  250, 137, 24, 165, 52, 194, 81, 222, 109, 251, 137, 24, 166, 57, 199, 85,
  227, 114, 0, 142, 29, 171, 57, 199, 86, 227, 114, 5, 147, 34, 175, 62,
  121, 8, 149, 36, 178, 64, 206, 93, 235, 121, 8, 150, 36, 178, 65, 211,
  98, 239, 126, 13, 154, 41, 183, 70, 211, 98, 240, 126, 13, 155, 46, 188,
  74, 216, 103, 244, 131, 18, 159, 46, 188, 75, 216, 103, 245, 136, 22, 164,
  51, 193, 79, 221, 108, 249, 136, 23, 165, 51, 193, 84, 226, 112, 254, 141,
  200, 86, 228, 115, 2, 143, 30, 172, 58, 200, 87, 229, 115, 2, 144, 35,
  176, 63, 205, 92, 233, 120, 7, 148, 35, 177, 64, 205, 92, 234, 125, 11,
  153, 40, 182, 68, 210, 97, 238, 125, 12, 153, 40, 182, 73, 215, 101, 243,
  130, 16, 158, 45, 187, 73, 215, 102, 243, 130, 17, 163, 50, 191, 78, 220,
  24, 165, 52, 194, 80, 222, 109, 251, 137, 24, 166, 52, 194, 81, 223, 114,
  0, 142, 29, 170, 57, 199, 86, 227, 114, 1, 142, 29, 171, 62, 204, 90,
  232, 119, 5, 147, 34, 176, 62, 204, 91, 232, 119, 6, 152, 39, 180, 67,
  209, 95, 237, 124, 10, 152, 39, 181, 67, 209, 96, 242, 128, 15, 157, 44,
  103, 244, 131, 18, 159, 46, 188, 74, 216, 103, 245, 131, 18, 160, 51, 192,
  79, 221, 108, 249, 136, 23, 164, 51, 193, 80, 221, 108, 250, 141, 27, 169,
  56, 198, 84, 226, 113, 254, 141, 28, 169, 56, 198, 85, 231, 117, 4, 146,
  32, 174, 61, 203, 89, 231, 118, 4, 146, 33, 175, 66, 207, 94, 236, 122,
  181, 68, 210, 96, 238, 125, 12, 153, 40, 182, 68, 210, 97, 239, 130, 16,
  158, 45, 186, 73, 215, 102, 243, 130, 17, 158, 45, 187, 74, 220, 106, 248,
  135, 21, 163, 50, 192, 78, 220, 107, 248, 135, 22, 163, 55, 196, 83, 225,
  111, 253, 140, 26, 168, 55, 197, 83, 225, 112, 253, 144, 31, 173, 60, 201,
  5, 147, 34, 175, 62, 204, 90, 232, 119, 6, 147, 34, 176, 62, 208, 95,
  237, 124, 10, 152, 39, 180, 67, 209, 96, 237, 124, 11, 152, 43, 185, 72,
  214, 100, 242, 129, 15, 157, 44, 186, 72, 214, 101, 242, 133, 20, 162, 49,
  190, 77, 219, 105, 247, 134, 20, 162, 49, 191, 77, 223, 110, 252, 138, 25,
  84, 226, 113, 254, 141, 28, 169, 56, 198, 84, 226, 113, 255, 141, 32, 174,
  61, 202, 89, 231, 118, 4, 146, 33, 174, 61, 203, 90, 231, 122, 9, 151,
  37, 179, 66, 208, 94, 236, 123, 9, 151, 38, 179, 66, 212, 99, 241, 127,
  14, 156, 43, 184, 71, 213, 99, 241, 128, 14, 156, 47, 189, 76, 217, 104,
  163, 50, 191, 78, 220, 106, 248, 135, 22, 163, 50, 192, 78, 220, 111, 253,
  140, 26, 168, 55, 196, 83, 225, 112, 253, 140, 27, 168, 55, 201, 88, 230,
  116, 3, 145, 31, 173, 60, 202, 88, 230, 117, 3, 145, 36, 178, 65, 206,
  93, 235, 121, 8, 150, 36, 178, 65, 207, 93, 235, 126, 13, 154, 41, 183,
  242, 129, 15, 157, 44, 185, 72, 214, 100, 242, 129, 16, 157, 44, 190, 77,
  218, 105, 247, 134, 20, 162, 49, 190, 77, 219, 106, 247, 134, 25, 167, 53,
  195, 82, 224, 110, 252, 139, 25, 167, 54, 196, 82, 224, 115, 2, 143, 30,
  172, 59, 200, 87, 229, 115, 2, 144, 30, 172, 59, 205, 92, 233, 120, 7,
  66, 207, 94, 236, 123, 9, 151, 38, 179, 66, 208, 94, 236, 123, 14, 156,
  42, 184, 71, 212, 99, 241, 128, 14, 156, 43, 184, 71, 213, 104, 246, 132,
  19, 161, 47, 189, 76, 218, 104, 246, 133, 19, 161, 48, 194, 81, 222, 109,
  251, 137, 24, 166, 53, 194, 81, 223, 109, 251, 138, 29, 171, 57, 199, 86,
  145, 31, 173, 60, 201, 88, 230, 116, 3, 145, 32, 173, 60, 202, 93, 235,
  121, 8, 150, 36, 178, 65, 206, 93, 235, 122, 8, 150, 37, 183, 69, 211,
  98, 240, 126, 13, 155, 41, 183, 70, 212, 98, 240, 127, 18, 159, 46, 188,
  75, 216, 103, 245, 131, 18, 160, 46, 188, 75, 217, 108, 249, 136, 23, 165,
  223, 110, 252, 139, 25, 167, 54, 195, 82, 224, 110, 252, 139, 26, 172, 58,
  200, 87, 228, 115, 2, 144, 30, 172, 59, 200, 87, 229, 116, 7, 148, 35,
  177, 63, 205, 92, 234, 120, 7, 149, 35, 177, 64, 206, 97, 238, 125, 12,
  153, 40, 182, 69, 210, 97, 239, 125, 12, 154, 45, 187, 73, 215, 102, 243,
  47, 189, 76, 217, 104, 246, 133, 19, 161, 48, 189, 76, 218, 104, 251, 137,
  24, 166, 52, 194, 81, 222, 109, 251, 138, 24, 166, 53, 194, 85, 227, 114,
  1, 142, 29, 171, 57, 199, 86, 228, 114, 1, 143, 34, 175, 62, 204, 91,
  232, 119, 6, 147, 34, 176, 63, 204, 91, 233, 124, 10, 152, 39, 181, 67,
  126, 13, 155, 41, 183, 70, 211, 98, 240, 126, 13, 155, 42, 183, 74, 216,
  103, 245, 131, 18, 160, 46, 188, 75, 216, 103, 245, 132, 23, 164, 51, 193,
  79, 221, 108, 250, 136, 23, 165, 51, 193, 80, 222, 113, 254, 141, 28, 169,
  56, 198, 85, 226, 113, 255, 141, 28, 170, 56, 203, 89, 231, 118, 4, 146,
  205, 92, 233, 120, 7, 149, 35, 177, 64, 205, 92, 234, 120, 12, 153, 40,
  182, 68, 210, 97, 238, 125, 12, 154, 40, 182, 69, 210, 102, 243, 130, 17,
  158, 45, 187, 73, 215, 102, 244, 130, 17, 159, 45, 191, 78, 220, 107, 248,
  135, 22, 163, 50, 192, 79, 220, 107, 249, 135, 26, 168, 55, 197, 83, 225,
  29, 171, 57, 199, 86, 227, 114, 1, 143, 29, 171, 58, 199, 90, 232, 119,
  6, 147, 34, 176, 62, 204, 91, 232, 119, 6, 148, 34, 180, 67, 209, 95,
  237, 124, 11, 152, 39, 181, 67, 209, 96, 238, 124, 15, 157, 44, 185, 72,
  214, 101, 242, 129, 16, 157, 44, 186, 73, 214, 105, 247, 134, 20, 162, 49,
  108, 249, 136, 23, 165, 51, 193, 80, 221, 108, 250, 137, 23, 169, 56, 198,
  84, 226, 113, 255, 141, 28, 170, 56, 198, 85, 226, 113, 4, 146, 33, 174,
  61, 203, 89, 231, 118, 5, 146, 33, 175, 61, 203, 94, 236, 123, 9, 151,
  38, 179, 66, 208, 95, 236, 123, 10, 151, 38, 184, 71, 213, 99, 241, 128,
  187, 73, 215, 102, 243, 130, 17, 159, 45, 187, 74, 215, 102, 248, 135, 22,
  163, 50, 192, 78, 220, 107, 248, 135, 22, 164, 50, 192, 83, 225, 112, 253,
  140, 27, 168, 55, 197, 83, 225, 112, 254, 140, 27, 173, 60, 201, 88, 230,
  117, 3, 145, 32, 173, 60, 202, 89, 230, 117, 8, 150, 36, 178, 65, 207,
  10, 152, 39, 181, 67, 209, 96, 237, 124, 11, 153, 39, 181, 72, 214, 100,
  242, 129, 16, 157, 44, 186, 72, 214, 101, 242, 129, 16, 162, 49, 190, 77,
  219, 105, 247, 134, 21, 162, 49, 191, 77, 219, 106, 252, 139, 25, 167, 54,
  195, 82, 224, 111, 252, 139, 26, 167, 54, 196, 87, 229, 115, 2, 144, 30,
  89, 231, 118, 4, 146, 33, 175, 61, 203, 90, 231, 118, 5, 151, 38, 179,
  66, 208, 94, 236, 123, 10, 151, 38, 180, 66, 208, 95, 241, 128, 14, 156,
  43, 184, 71, 213, 99, 241, 128, 15, 156, 43, 185, 76, 217, 104, 246, 133,
  19, 161, 48, 189, 76, 218, 105, 246, 133, 20, 166, 52, 194, 81, 223, 109,
  168, 55, 197, 83, 225, 112, 253, 140, 27, 169, 55, 197, 84, 230, 116, 3,
  145, 32, 173, 60, 202, 88, 230, 117, 4, 145, 32, 174, 65, 206, 93, 235,
  122, 8, 150, 37, 178, 65, 207, 93, 235, 122, 9, 155, 41, 183, 70, 211,
  98, 240, 127, 13, 155, 42, 183, 70, 212, 99, 245, 131, 18, 160, 46, 188,
  247, 134, 20, 162, 49, 191, 77, 219, 106, 247, 134, 21, 163, 54, 195, 82,
  224, 110, 252, 139, 26, 167, 54, 196, 82, 224, 111, 252, 144, 30, 172, 59,
  200, 87, 229, 115, 2, 144, 31, 172, 59, 201, 87, 234, 120, 7, 149, 35,
  177, 64, 205, 92, 234, 121, 7, 149, 36, 177, 68, 210, 97, 239, 125, 12,
  71, 213, 99, 241, 128, 14, 156, 43, 185, 71, 213, 100, 241, 132, 19, 161,
  48, 189, 76, 218, 104, 246, 133, 20, 161, 48, 190, 76, 222, 109, 251, 138,
  24, 166, 53, 194, 81, 223, 109, 251, 138, 25, 166, 57, 199, 86, 227, 114,
  1, 143, 29, 171, 58, 199, 86, 228, 115, 6, 147, 34, 176, 62, 204, 91,
  150, 36, 178, 65, 207, 93, 235, 122, 8, 150, 37, 179, 65, 211, 98, 240,
  126, 13, 155, 42, 183, 70, 212, 98, 240, 127, 14, 155, 46, 188, 75, 216,
  103, 245, 132, 18, 160, 47, 188, 75, 217, 103, 245, 136, 23, 165, 51, 193,
  80, 221, 108, 250, 137, 23, 165, 52, 193, 84, 226, 113, 255, 141, 28, 170,
  229, 115, 2, 144, 30, 172, 59, 201, 87, 229, 116, 2, 144, 35, 177, 64,
  205, 92, 234, 120, 7, 149, 36, 177, 64, 206, 92, 234, 125, 12, 154, 40,
  182, 69, 210, 97, 239, 126, 12, 154, 41, 182, 73, 215, 102, 244, 130, 17,
  159, 45, 187, 74, 215, 102, 244, 131, 17, 163, 50, 192, 78, 220, 107, 249,
  53, 194, 81, 223, 109, 251, 138, 24, 166, 53, 195, 81, 223, 114, 1, 142,
  29, 171, 58, 199, 86, 228, 114, 1, 143, 30, 171, 62, 204, 91, 232, 119,
  6, 148, 34, 176, 63, 204, 91, 233, 119, 6, 152, 39, 181, 67, 209, 96,
  237, 124, 11, 153, 39, 181, 68, 209, 96, 242, 129, 16, 157, 44, 186, 72,
  131, 18, 160, 46, 188, 75, 217, 103, 245, 132, 18, 160, 51, 193, 80, 221,
  108, 250, 136, 23, 165, 52, 193, 80, 222, 108, 250, 141, 28, 170, 56, 198,
  85, 226, 113, 255, 142, 28, 170, 57, 198, 85, 231, 118, 5, 146, 33, 175,
  61, 203, 90, 231, 118, 5, 147, 33, 175, 66, 208, 94, 236, 123, 10, 151,
  210, 97, 239, 125, 12, 154, 40, 182, 69, 211, 97, 239, 130, 17, 158, 45,
  187, 74, 215, 102, 244, 130, 17, 159, 46, 187, 74, 220, 107, 248, 135, 22,
  164, 50, 192, 79, 220, 107, 249, 136, 22, 164, 55, 197, 83, 225, 112, 254,
  140, 27, 169, 55, 197, 84, 225, 112, 254, 145, 32, 173, 60, 202, 88, 230,
  34, 176, 63, 204, 91, 233, 119, 6, 148, 34, 176, 63, 209, 96, 237, 124,
  11, 152, 39, 181, 68, 209, 96, 238, 124, 11, 153, 44, 186, 72, 214, 101,
  242, 129, 16, 158, 44, 186, 73, 214, 101, 243, 134, 21, 162, 49, 191, 77,
  219, 106, 248, 134, 21, 163, 49, 191, 78, 224, 111, 252, 139, 26, 167, 54,
  113, 255, 141, 28, 170, 56, 198, 85, 227, 113, 0, 142, 33, 175, 61, 203,
  90, 231, 118, 5, 146, 33, 175, 62, 203, 90, 232, 123, 9, 151, 38, 180,
  66, 208, 95, 236, 123, 10, 152, 38, 180, 67, 213, 99, 241, 128, 15, 156,
  43, 185, 71, 213, 100, 241, 128, 15, 157, 48, 189, 76, 218, 104, 246, 133,
  192, 79, 220, 107, 249, 135, 22, 164, 50, 192, 79, 221, 112, 253, 140, 27,
  168, 55, 197, 84, 225, 112, 254, 140, 27, 169, 56, 202, 88, 230, 117, 3,
  145, 32, 174, 60, 202, 89, 230, 117, 4, 146, 37, 178, 65, 207, 93, 235,
  122, 9, 150, 37, 179, 65, 207, 94, 235, 127, 13, 155, 42, 183, 70, 212,
  16, 157, 44, 186, 73, 214, 101, 243, 129, 16, 158, 44, 191, 77, 219, 106,
  247, 134, 21, 162, 49, 191, 78, 219, 106, 248, 134, 25, 167, 54, 196, 82,
  224, 111, 252, 139, 26, 168, 54, 196, 83, 224, 115, 2, 144, 31, 172, 59,
  201, 87, 229, 116, 3, 144, 31, 173, 59, 205, 92, 234, 121, 7, 149, 36,
  95, 236, 123, 10, 151, 38, 180, 66, 208, 95, 237, 123, 14, 156, 43, 185,
  71, 213, 100, 241, 128, 15, 156, 43, 185, 72, 213, 104, 246, 133, 19, 161,
  48, 190, 76, 218, 105, 246, 133, 20, 162, 48, 194, 81, 223, 109, 251, 138,
  25, 166, 53, 195, 81, 223, 110, 251, 138, 29, 171, 58, 199, 86, 228, 115,
  173, 60, 202, 89, 230, 117, 4, 145, 32, 174, 60, 202, 93, 235, 122, 8,
  150, 37, 178, 65, 207, 94, 235, 122, 9, 150, 37, 183, 70, 212, 98, 240,
  127, 13, 155, 42, 184, 70, 212, 99, 240, 127, 18, 160, 47, 188, 75, 217,
  103, 245, 132, 19, 160, 47, 189, 75, 217, 108, 250, 137, 23, 165, 52, 193,
  252, 139, 26, 167, 54, 196, 83, 224, 111, 253, 139, 26, 172, 59, 201, 87,
  229, 116, 2, 144, 31, 172, 59, 201, 88, 229, 116, 7, 149, 35, 177, 64,
  206, 92, 234, 121, 7, 149, 36, 178, 64, 206, 97, 239, 125, 12, 154, 41,
  182, 69, 211, 97, 239, 126, 13, 154, 45, 187, 74, 215, 102, 244, 131, 17,
  76, 218, 105, 246, 133, 20, 161, 48, 190, 76, 218, 105, 251, 138, 24, 166,
  53, 195, 81, 223, 110, 251, 138, 25, 166, 53, 195, 86, 228, 114, 1, 143,
  29, 171, 58, 200, 86, 228, 115, 1, 143, 34, 176, 63, 204, 91, 233, 119,
  6, 148, 35, 176, 63, 205, 91, 233, 124, 11, 153, 39, 181, 68, 209, 96,
  155, 42, 183, 70, 212, 99, 240, 127, 14, 155, 42, 184, 75, 217, 103, 245,
  132, 18, 160, 47, 188, 75, 217, 104, 245, 132, 23, 165, 52, 193, 80, 222,
  108, 250, 137, 23, 165, 52, 194, 80, 222, 113, 255, 141, 28, 170, 57, 198,
  85, 227, 113, 0, 142, 29, 170, 57, 203, 90, 231, 118, 5, 147, 33, 175,
  234, 121, 7, 149, 36, 177, 64, 206, 93, 234, 121, 12, 154, 40, 182, 69,
  211, 97, 239, 126, 12, 154, 41, 182, 69, 211, 102, 244, 130, 17, 159, 45,
  187, 74, 216, 102, 244, 131, 17, 159, 46, 192, 79, 220, 107, 249, 135, 22,
  164, 51, 192, 79, 221, 107, 249, 136, 27, 169, 55, 197, 84, 225, 112, 254,
  58, 199, 86, 228, 115, 1, 143, 30, 171, 58, 200, 91, 233, 119, 6, 148,
  34, 176, 63, 205, 91, 233, 120, 6, 148, 35, 181, 68, 209, 96, 238, 124,
  11, 153, 39, 181, 68, 210, 96, 238, 125, 16, 157, 44, 186, 73, 214, 101,
  243, 129, 16, 158, 45, 186, 73, 215, 106, 247, 134, 21, 163, 49, 191, 78,
  137, 23, 165, 52, 193, 80, 222, 109, 250, 137, 24, 170, 56, 198, 85, 227,
  113, 255, 142, 28, 170, 57, 198, 85, 227, 114, 5, 146, 33, 175, 62, 203,
  90, 232, 118, 5, 147, 33, 175, 62, 204, 95, 236, 123, 10, 151, 38, 180,
  67, 208, 95, 237, 123, 10, 152, 39, 185, 71, 213, 100, 241, 128, 15, 157,
  215, 102, 244, 131, 17, 159, 46, 187, 74, 216, 103, 249, 135, 22, 164, 50,
  192, 79, 221, 107, 249, 136, 22, 164, 51, 192, 84, 225, 112, 254, 140, 27,
  169, 55, 197, 84, 226, 112, 254, 141, 27, 174, 60, 202, 89, 230, 117, 4,
  145, 32, 174, 61, 202, 89, 231, 117, 8, 150, 37, 179, 65, 207, 94, 235,
  39, 181, 68, 209, 96, 238, 125, 11, 153, 40, 181, 72, 214, 101, 243, 129,
  16, 158, 44, 186, 73, 215, 101, 243, 130, 16, 162, 49, 191, 78, 219, 106,
  248, 134, 21, 163, 49, 191, 78, 220, 106, 252, 139, 26, 167, 54, 196, 83,
  224, 111, 253, 139, 26, 168, 55, 196, 87, 229, 116, 2, 144, 31, 173, 59,
  118, 5, 147, 33, 175, 62, 203, 90, 232, 119, 5, 151, 38, 180, 66, 208,
  95, 237, 123, 10, 152, 38, 180, 67, 209, 95, 241, 128, 15, 156, 43, 185,
  72, 213, 100, 242, 128, 15, 157, 43, 185, 76, 218, 105, 246, 133, 20, 161,
  48, 190, 77, 218, 105, 247, 133, 20, 166, 53, 195, 81, 223, 110, 251, 138,
  197, 84, 225, 112, 254, 141, 27, 169, 56, 197, 84, 230, 117, 4, 145, 32,
  174, 60, 202, 89, 231, 117, 4, 146, 32, 174, 65, 207, 94, 235, 122, 9,
  150, 37, 179, 65, 207, 94, 236, 122, 9, 155, 42, 184, 70, 212, 99, 240,
  127, 14, 155, 42, 184, 71, 212, 99, 245, 132, 18, 160, 47, 189, 75, 217,
  21, 163, 49, 191, 78, 219, 106, 248, 135, 21, 163, 54, 196, 82, 224, 111,
  253, 139, 26, 168, 54, 196, 83, 225, 111, 253, 144, 31, 172, 59, 201, 88,
  229, 116, 3, 144, 31, 173, 59, 201, 88, 234, 121, 7, 149, 36, 177, 64,
  206, 93, 234, 121, 8, 149, 36, 178, 69, 211, 97, 239, 126, 12, 154, 41,
  100, 241, 128, 15, 157, 43, 185, 72, 213, 100, 242, 133, 20, 161, 48, 190,
  76, 218, 105, 247, 133, 20, 162, 48, 190, 77, 223, 110, 251, 138, 25, 166,
  53, 195, 82, 223, 110, 252, 138, 25, 167, 58, 200, 86, 228, 115, 1, 143,
  30, 171, 58, 200, 87, 228, 115, 6, 148, 34, 176, 63, 205, 91, 233, 120,
  179, 65, 207, 94, 235, 122, 9, 151, 37, 179, 66, 212, 98, 240, 127, 14,
  155, 42, 184, 70, 212, 99, 241, 127, 14, 156, 47, 188, 75, 217, 104, 245,
  132, 19, 160, 47, 189, 76, 217, 104, 246, 137, 23, 165, 52, 194, 80, 222,
  109, 250, 137, 24, 165, 52, 194, 85, 227, 113, 0, 142, 28, 170, 57, 199,
  3, 144, 31, 173, 59, 201, 88, 229, 116, 3, 145, 36, 177, 64, 206, 92,
  234, 121, 8, 149, 36, 178, 64, 206, 93, 235, 126, 12, 154, 41, 182, 69,
  211, 98, 239, 126, 13, 154, 41, 183, 74, 216, 102, 244, 131, 17, 159, 46,
  187, 74, 216, 103, 244, 131, 18, 164, 51, 192, 79, 221, 107, 249, 136, 22,
  81, 223, 110, 251, 138, 25, 167, 53, 195, 82, 223, 114, 1, 143, 30, 171,
  58, 200, 86, 228, 115, 2, 143, 30, 172, 63, 204, 91, 233, 120, 6, 148,
  35, 176, 63, 205, 92, 233, 120, 7, 153, 39, 181, 68, 210, 96, 238, 125,
  11, 153, 40, 181, 68, 210, 97, 243, 129, 16, 158, 44, 186, 73, 215, 101,
  160, 47, 189, 75, 217, 104, 245, 132, 19, 161, 52, 193, 80, 222, 108, 250,
  137, 24, 165, 52, 194, 80, 222, 109, 251, 142, 28, 170, 57, 198, 85, 227,
  114, 0, 142, 29, 170, 57, 199, 86, 232, 118, 5, 147, 33, 175, 62, 204,
  90, 232, 119, 5, 147, 34, 175, 67, 208, 95, 237, 123, 10, 152, 38, 180,
  239, 126, 13, 154, 41, 183, 69, 211, 98, 239, 131, 17, 159, 46, 187, 74,
  216, 102, 244, 131, 18, 159, 46, 188, 74, 220, 107, 249, 136, 22, 164, 51,
  192, 79, 221, 108, 249, 136, 23, 164, 55, 197, 84, 226, 112, 254, 141, 27,
  169, 56, 198, 84, 226, 113, 254, 145, 32, 174, 61, 202, 89, 231, 117, 4,
  63, 205, 91, 233, 120, 6, 148, 35, 177, 63, 209, 96, 238, 125, 11, 153,
  40, 181, 68, 210, 96, 238, 125, 12, 153, 44, 186, 73, 214, 101, 243, 130,
  16, 158, 45, 186, 73, 215, 102, 243, 134, 21, 163, 49, 191, 78, 220, 106,
  248, 135, 21, 163, 50, 191, 78, 224, 111, 253, 139, 26, 168, 54, 196, 83,
  142, 29, 170, 57, 199, 85, 227, 114, 0, 142, 33, 175, 62, 203, 90, 232,
  118, 5, 147, 34, 175, 62, 204, 90, 232, 123, 10, 152, 38, 180, 67, 208,
  95, 237, 124, 10, 152, 39, 180, 67, 213, 100, 242, 128, 15, 157, 43, 185,
  72, 214, 100, 242, 129, 15, 157, 48, 190, 77, 218, 105, 247, 133, 20, 162,
  221, 107, 249, 136, 23, 164, 51, 193, 79, 221, 112, 254, 141, 27, 169, 56,
  197, 84, 226, 112, 254, 141, 28, 169, 56, 202, 89, 230, 117, 4, 146, 32,
  174, 61, 202, 89, 231, 118, 4, 146, 37, 179, 65, 207, 94, 236, 122, 9,
  151, 37, 179, 66, 208, 94, 236, 127, 14, 155, 42, 184, 71, 212, 99, 241,
  45, 186, 73, 215, 101, 243, 130, 16, 158, 45, 191, 78, 219, 106, 248, 135,
  21, 163, 50, 191, 78, 220, 106, 248, 135, 26, 168, 54, 196, 83, 224, 111,
  253, 140, 26, 168, 55, 196, 83, 225, 116, 3, 144, 31, 173, 59, 201, 88,
  230, 116, 3, 145, 31, 173, 60, 206, 93, 234, 121, 8, 149, 36, 178, 65,
  123, 10, 152, 39, 180, 67, 209, 95, 237, 124, 15, 157, 43, 185, 72, 213,
  100, 242, 128, 15, 157, 44, 185, 72, 214, 105, 247, 133, 20, 162, 48, 190,
  77, 218, 105, 247, 134, 20, 162, 49, 195, 81, 223, 110, 252, 138, 25, 167,
  53, 195, 82, 224, 110, 252, 139, 30, 171, 58, 200, 87, 228, 115, 2, 143,
]);

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

function buildPalette(
  coloursJSON: Record<string, ColourSet>,
  options: WorkerInput['options']
): PaletteEntry[] {
  const palette: PaletteEntry[] = [];
  const enabledSet = new Set(options.enabledColourIds);
  const variants = options.selectedVariants ?? {};

  for (const [idStr, colourSet] of Object.entries(coloursJSON)) {
    const colourSetId = parseInt(idStr, 10);
    if (!enabledSet.has(colourSetId)) continue;

    // Pick selected variant, or fall back to first valid block
    let chosenBlockId: string | null = null;
    let chosenBlock: BlockEntry | null = null;

    const preferredId = variants[colourSetId];
    if (preferredId && colourSet.blocks[preferredId]) {
      const block = colourSet.blocks[preferredId];
      if (resolveVersionData(block.validVersions, options.version) !== null) {
        chosenBlockId = preferredId;
        chosenBlock = block;
      }
    }

    if (!chosenBlockId) {
      for (const [blockId, block] of Object.entries(colourSet.blocks)) {
        if (resolveVersionData(block.validVersions, options.version) !== null) {
          chosenBlockId = blockId;
          chosenBlock = block;
          break;
        }
      }
    }

    if (!chosenBlockId || !chosenBlock) continue;

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
        blockId: chosenBlockId,
        displayName: chosenBlock.displayName,
        lab,
        rgb,
      });
    }
  }

  return palette;
}

// ── Nearest color lookup ──────────────────────────────────────────────────────

interface MatchOptions {
  colorSpace: 'lab' | 'rgb';
  lw: number; aw: number; bw: number;
}

function findNearest(
  r: number,
  g: number,
  b: number,
  palette: PaletteEntry[],
  mo: MatchOptions
): PaletteEntry {
  let best = palette[0];
  let bestDist = Infinity;

  if (mo.colorSpace === 'rgb') {
    const src: [number, number, number] = [r, g, b];
    for (const entry of palette) {
      const dist = deltaERGB(src, entry.rgb);
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
  } else {
    const lab = rgb2lab(r, g, b);
    for (const entry of palette) {
      const dist = deltaELab(lab, entry.lab, mo.lw, mo.aw, mo.bw);
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
  }

  return best;
}

// ── Dithering algorithms ──────────────────────────────────────────────────────

/**
 * No dithering — direct nearest-color mapping.
 */
function noDitherWithProgress(
  pixels: Float32Array,
  w: number, h: number,
  palette: PaletteEntry[],
  mo: MatchOptions,
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const entry = findNearest(pixels[idx], pixels[idx + 1], pixels[idx + 2], palette, mo);
      row.push(entry);
      preview[idx] = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0)
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
  }
  return { result, previewData: preview };
}

/**
 * Atkinson dithering (recommended for Minecraft map art).
 * Diffuses 6/8 = 75% of error across 6 neighbors.
 * Pattern:       X   1/8  1/8
 *           1/8  1/8  1/8
 *                1/8
 */
function atkinsonWithProgress(
  pixels: Float32Array,
  w: number, h: number,
  palette: PaletteEntry[],
  mo: MatchOptions,
  strength: number,  // 0–100
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const buf = new Float32Array(pixels);
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);
  const s = strength / 100;

  function addErr(px: number, py: number, er: number, eg: number, eb: number) {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const i = (py * w + px) * 4;
    buf[i]     += er * s;
    buf[i + 1] += eg * s;
    buf[i + 2] += eb * s;
  }

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = Math.max(0, Math.min(255, buf[idx]));
      const g = Math.max(0, Math.min(255, buf[idx + 1]));
      const b = Math.max(0, Math.min(255, buf[idx + 2]));

      const entry = findNearest(r, g, b, palette, mo);
      row.push(entry);

      // Raw error (strength applied in addErr)
      const er = (r - entry.rgb[0]) / 8;
      const eg = (g - entry.rgb[1]) / 8;
      const eb = (b - entry.rgb[2]) / 8;

      addErr(x + 1, y,     er, eg, eb);
      addErr(x + 2, y,     er, eg, eb);
      addErr(x - 1, y + 1, er, eg, eb);
      addErr(x,     y + 1, er, eg, eb);
      addErr(x + 1, y + 1, er, eg, eb);
      addErr(x,     y + 2, er, eg, eb);

      preview[idx]     = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0)
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
  }
  return { result, previewData: preview };
}

/**
 * Floyd-Steinberg dithering (classic, full error diffusion).
 */
function floydSteinbergWithProgress(
  pixels: Float32Array,
  w: number, h: number,
  palette: PaletteEntry[],
  mo: MatchOptions,
  strength: number,
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const buf = new Float32Array(pixels);
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);
  const s = strength / 100;

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = Math.max(0, Math.min(255, buf[idx]));
      const g = Math.max(0, Math.min(255, buf[idx + 1]));
      const b = Math.max(0, Math.min(255, buf[idx + 2]));

      const entry = findNearest(r, g, b, palette, mo);
      row.push(entry);

      const er = (r - entry.rgb[0]) * s;
      const eg = (g - entry.rgb[1]) * s;
      const eb = (b - entry.rgb[2]) * s;

      if (x + 1 < w) {
        buf[idx + 4] += (er * 7) / 16;
        buf[idx + 5] += (eg * 7) / 16;
        buf[idx + 6] += (eb * 7) / 16;
      }
      if (y + 1 < h && x - 1 >= 0) {
        const bidx = ((y + 1) * w + (x - 1)) * 4;
        buf[bidx]     += (er * 3) / 16;
        buf[bidx + 1] += (eg * 3) / 16;
        buf[bidx + 2] += (eb * 3) / 16;
      }
      if (y + 1 < h) {
        const bidx = ((y + 1) * w + x) * 4;
        buf[bidx]     += (er * 5) / 16;
        buf[bidx + 1] += (eg * 5) / 16;
        buf[bidx + 2] += (eb * 5) / 16;
      }
      if (y + 1 < h && x + 1 < w) {
        const bidx = ((y + 1) * w + (x + 1)) * 4;
        buf[bidx]     += er / 16;
        buf[bidx + 1] += eg / 16;
        buf[bidx + 2] += eb / 16;
      }

      preview[idx]     = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0)
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
  }
  return { result, previewData: preview };
}

/**
 * Blue Noise dithering — uses precomputed 64×64 IGN texture.
 * Threshold controls the offset amplitude (10–80 recommended).
 * Strength scales the effect (0–100%).
 */
function blueNoiseWithProgress(
  pixels: Float32Array,
  w: number, h: number,
  palette: PaletteEntry[],
  mo: MatchOptions,
  threshold: number,
  strength: number,
  reportEvery: number
): { result: PaletteEntry[][]; previewData: Uint8ClampedArray } {
  const result: PaletteEntry[][] = [];
  const preview = new Uint8ClampedArray(w * h * 4);
  const effectiveThreshold = threshold * (strength / 100);

  for (let y = 0; y < h; y++) {
    const row: PaletteEntry[] = [];
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const noiseVal = BLUE_NOISE_64[(x % 64) + (y % 64) * 64];
      const offset = (noiseVal / 255.0 - 0.5) * effectiveThreshold;

      const r = Math.max(0, Math.min(255, pixels[idx]     + offset));
      const g = Math.max(0, Math.min(255, pixels[idx + 1] + offset));
      const b = Math.max(0, Math.min(255, pixels[idx + 2] + offset));

      const entry = findNearest(r, g, b, palette, mo);
      row.push(entry);

      preview[idx]     = entry.rgb[0];
      preview[idx + 1] = entry.rgb[1];
      preview[idx + 2] = entry.rgb[2];
      preview[idx + 3] = 255;
    }
    result.push(row);
    if ((y + 1) % reportEvery === 0)
      self.postMessage({ type: 'progress', progress: Math.round(((y + 1) / h) * 100) } satisfies WorkerOutput);
  }
  return { result, previewData: preview };
}

// ── Main worker handler ───────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { type, imageData, width, height, options, coloursJSON } = event.data;
  if (type !== 'convert') return;

  const palette = buildPalette(coloursJSON, options);
  if (palette.length === 0) {
    self.postMessage({
      type: 'done',
      pixels: [],
      materials: {},
      previewData: new Uint8ClampedArray(0),
    } satisfies WorkerOutput);
    return;
  }

  const pixelsBuf = new Float32Array(imageData.length);
  for (let i = 0; i < imageData.length; i++) {
    pixelsBuf[i] = imageData[i];
  }

  const reportEvery = Math.max(1, Math.floor(height / 10));

  // Resolve advanced options with defaults
  const adv = options.advanced ?? {};
  const mo: MatchOptions = {
    colorSpace: adv.colorSpace ?? 'lab',
    lw: adv.labLWeight ?? 1,
    aw: adv.labAWeight ?? 1,
    bw: adv.labBWeight ?? 1,
  };
  const ditherStrength    = adv.ditherStrength       ?? 100;
  const blueNoiseThresh   = adv.blueNoiseThreshold   ?? 40;

  let result: PaletteEntry[][];
  let previewData: Uint8ClampedArray;

  switch (options.ditherMethod) {
    case 'atkinson':
      ({ result, previewData } = atkinsonWithProgress(pixelsBuf, width, height, palette, mo, ditherStrength, reportEvery));
      break;
    case 'floyd-steinberg':
      ({ result, previewData } = floydSteinbergWithProgress(pixelsBuf, width, height, palette, mo, ditherStrength, reportEvery));
      break;
    case 'blue-noise':
      ({ result, previewData } = blueNoiseWithProgress(pixelsBuf, width, height, palette, mo, blueNoiseThresh, ditherStrength, reportEvery));
      break;
    default:
      ({ result, previewData } = noDitherWithProgress(pixelsBuf, width, height, palette, mo, reportEvery));
  }

  const materials: Record<string, number> = {};
  const pixels2D = result.map((row) =>
    row.map((entry) => {
      const key = entry.displayName;
      materials[key] = (materials[key] || 0) + 1;
      return { colourSetId: entry.colourSetId, tone: entry.tone, blockId: entry.blockId };
    })
  );

  const out: WorkerOutput = { type: 'done', pixels: pixels2D, materials, previewData };
  self.postMessage(out);
};
