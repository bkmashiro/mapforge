# MapForge

[![Live Demo](https://img.shields.io/badge/demo-mf.yuzhes.com-5865F2?style=flat-square)](https://mf.yuzhes.com)
[![GitHub stars](https://img.shields.io/github/stars/bkmashiro/mapforge?style=flat-square&logo=github)](https://github.com/bkmashiro/mapforge)
[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![SvelteKit](https://img.shields.io/badge/built_with-SvelteKit-FF3E00?style=flat-square&logo=svelte)](https://kit.svelte.dev)

> Fast, browser-based Minecraft map art generator.  
> Upload an image → crop to map grid → export `.schem` or `.litematic`. Done.

**[→ Open MapForge](https://mf.yuzhes.com)**

---

## Features

| | |
|---|---|
| 🎨 **183 colors** | 61 base map colors × 3 height shades (staircase mode) |
| 🖼️ **Smart cropping** | Interactive crop tool snapped to 128px map grid |
| 🎲 **Modern dithering** | Atkinson (recommended), Blue Noise, Floyd-Steinberg |
| 🧱 **Block selection** | Per-color block variant picker, grouped by category |
| ⚡ **Auto-optimized** | WASM SIMD → KD-tree → JS fallback, picked automatically |
| 📦 **Export formats** | WorldEdit `.schem` (v2) and Litematica `.litematic` |
| 🌐 **Bilingual** | English / 中文 |
| 🎮 **Multi-version** | 1.16.5 through 1.20 |

---

## How to use

1. **Upload** an image (drag & drop or click)
2. **Crop** — pick how many maps (1×1, 2×2, etc.) and drag the crop region
3. **Configure** — choose MC version, flat/staircase, dithering, and which blocks to include
4. **Generate** — conversion runs in a Web Worker, main thread stays smooth
5. **Export** — download `.schem` for WorldEdit or `.litematic` for Litematica

---

## Map colors & MC internals

Minecraft computes map pixel colors by comparing a block's Y position to its northern neighbor:

| Tone | Multiplier | Condition |
|------|-----------|-----------|
| Light | × 1.000 | Higher than northern neighbor |
| Normal | × 0.863 | Same height |
| Dark | × 0.706 | Lower than northern neighbor |

**Flat mode** — only `normal` tone available (single layer, simpler build)  
**Staircase mode** — all 3 tones available (staircase pattern, 3× more colors)

Color data sourced from [mapartcraft](https://github.com/rebane2001/mapartcraft) (GPL-3).

---

## Performance

MapForge runs color matching in a Web Worker and auto-selects the fastest available backend:

```
WASM SIMD  →  WASM  →  KD-tree JS  →  brute-force JS
```

The backend is selected on first load via a silent capability check and micro-benchmark.  
Result is cached in `localStorage` — no overhead on subsequent visits.

---

## Development

```bash
git clone https://github.com/bkmashiro/mapforge
cd mapforge
npm install
npm run dev
```

Build for production:
```bash
npm run build
```

---

## License

MIT © [bkmashiro](https://github.com/bkmashiro)

Color data from [rebane2001/mapartcraft](https://github.com/rebane2001/mapartcraft) — GPL-3.0

---

*If MapForge saved you some time, a ⭐ on GitHub goes a long way.*
