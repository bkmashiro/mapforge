<div align="center">

# 🗺️ MapForge

**Fast, browser-based Minecraft map art generator.**

[![Live Demo](https://img.shields.io/badge/🌐_demo-mf.yuzhes.com-5865F2?style=for-the-badge)](https://mf.yuzhes.com)
[![GitHub stars](https://img.shields.io/github/stars/bkmashiro/mapforge?style=for-the-badge&logo=github&color=FFD700)](https://github.com/bkmashiro/mapforge)
[![MIT License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)](https://kit.svelte.dev)

**English** | [中文](README.zh.md)

</div>

---

## Before / After

<div align="center">

| Original (128×128) | Minecraft Map Art |
|:---:|:---:|
| <img src="docs/demo-input.png" width="256" alt="Original image"> | <img src="docs/demo-output.png" width="256" alt="Minecraft map art output"> |

*Upload any image → crop to map grid → export `.schem` or `.litematic`. Done.*

<sub>Demo image: <a href="https://zh.moegirl.org.cn/File:Hazard_Creeper.png">Hazard Creeper</a> via moegirl.org.cn</sub>

</div>

---

## ✨ Features

| | |
|:---|:---|
| 🎨 **183 colors** | 61 base map colors × 3 height shades (staircase mode) |
| 🖼️ **Smart cropping** | Interactive crop tool snapped to 128px map grid |
| 🔄 **Image transforms** | Rotate 90° / 180° / 270° in the crop workspace |
| 🎲 **Modern dithering** | Atkinson (recommended), Blue Noise, Floyd-Steinberg |
| 🧱 **Block selection** | Per-color block variant picker, grouped by category |
| ⚡ **Auto-optimized** | WASM SIMD → KD-tree → JS fallback, auto-selected |
| 📦 **Export formats** | WorldEdit `.schem` (v2) and Litematica `.litematic` |
| 📋 **Materials list** | Block count + namespace IDs for shopping lists |
| 🌐 **Bilingual** | English / 中文 |
| 🎮 **Multi-version** | MC 1.16.5 through 1.20 |

---

## 🚀 How to use

```
1. Upload   →  drag & drop or click to browse
2. Crop     →  pick map size (1×1, 2×2 …) and position the region
3. Configure →  version, flat/staircase, dithering, block palette
4. Generate →  runs in a Web Worker — main thread stays smooth
5. Export   →  .schem for WorldEdit  or  .litematic for Litematica
```

---

## 🎮 Map colors & MC internals

Minecraft computes map pixel colors by comparing a block's Y position to its northern neighbor:

| Tone | Multiplier | Condition |
|:-----|:----------|:----------|
| Light | × 1.000 | Higher than northern neighbor |
| Normal | × 0.863 | Same height |
| Dark | × 0.706 | Lower than northern neighbor |

**Flat mode** — only `normal` tone (single layer, simpler build)  
**Staircase mode** — all 3 tones (staircase pattern, 3× more colors)

Color data sourced from [mapartcraft](https://github.com/rebane2001/mapartcraft) (GPL-3).

---

## ⚡ Performance

MapForge runs color matching in a Web Worker and auto-selects the fastest available backend:

```
WASM SIMD  →  WASM  →  KD-tree JS  →  brute-force JS
```

The backend is selected on first load via a capability check + micro-benchmark.  
Result is cached in `localStorage` — no overhead on subsequent visits.

---

## 🛠️ Development

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

## 📄 License

MIT © [bkmashiro](https://github.com/bkmashiro)

Color data from [rebane2001/mapartcraft](https://github.com/rebane2001/mapartcraft) — GPL-3.0

---

<div align="center">

*If MapForge saved you some time, a ⭐ on GitHub goes a long way.*

</div>
