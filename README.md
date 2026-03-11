# MapForge

> Fast, browser-based Minecraft map art generator. Upload an image, get a WorldEdit schematic or Litematica blueprint.

**[Live Demo →](https://bkmashiro.github.io/mapforge)**

## Features

- 🎨 **61 base map colors** × 3 shades — 183 total colors (staircase mode)
- 🖼️ **Dithering** — Floyd-Steinberg and Ordered (Bayer 4×4)
- 📦 **Export** — WorldEdit `.schem` and Litematica `.litematic`
- ⚡ **Web Worker** — non-blocking conversion, runs off the main thread
- 🎮 **Multi-version** — 1.16.5 through 1.20
- 📋 **Materials list** — exact block counts with stack breakdown

## Usage

1. Upload an image (drag & drop or click)
2. Choose version, staircase mode, and dithering
3. Click **Generate**
4. Export as `.schem` or `.litematic`

## Technical Notes

Map colors are defined per-block in Minecraft's source (`MapColor` enum). Each base color has 3 usable shades determined by height difference with the northern neighbor block:
- **Light** (×255/255) — block is higher than northern neighbor
- **Normal** (×220/255) — same height
- **Dark** (×180/255) — block is lower

Color matching uses CIE L\*a\*b\* color space for perceptual accuracy.

Color data sourced from [mapartcraft](https://github.com/rebane2001/mapartcraft) (GPL-3).

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
