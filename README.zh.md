<div align="center">

# 🗺️ MapForge

**快速、纯浏览器端的 Minecraft 地图画生成器。**

[![在线 Demo](https://img.shields.io/badge/🌐_在线体验-mf.yuzhes.com-5865F2?style=for-the-badge)](https://mf.yuzhes.com)
[![GitHub stars](https://img.shields.io/github/stars/bkmashiro/mapforge?style=for-the-badge&logo=github&color=FFD700)](https://github.com/bkmashiro/mapforge)
[![MIT License](https://img.shields.io/badge/许可证-MIT-22c55e?style=for-the-badge)](LICENSE)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)](https://kit.svelte.dev)

[English](README.md) | **中文**

</div>

---

## 效果对比

<div align="center">

| 原图（128×128） | Minecraft 地图画 |
|:---:|:---:|
| <img src="docs/demo-input.png" width="256" alt="原图"> | <img src="docs/demo-output.png" width="256" alt="地图画输出"> |

*上传图片 → 裁剪到地图网格 → 导出 `.schem` 或 `.litematic`，就这么简单。*

<sub>示例图片：<a href="https://zh.moegirl.org.cn/File:Hazard_Creeper.png">Hazard Creeper</a>，来源萌娘百科</sub>

</div>

---

## ✨ 功能特性

| | |
|:---|:---|
| 🎨 **183 种颜色** | 61 种基础地图色 × 3 种高度色调（阶梯模式） |
| 🖼️ **智能裁剪** | 可交互裁剪工具，自动对齐 128px 地图网格 |
| 🔄 **图片变换** | 在裁剪工作区旋转 90° / 180° / 270° |
| 🎲 **现代抖动算法** | Atkinson（推荐）、Blue Noise、Floyd-Steinberg |
| 🧱 **方块选择** | 按类别分组的颜色变体选择器 |
| ⚡ **自动优化** | WASM SIMD → KD-tree → JS 降级，自动选择最快方案 |
| 📦 **导出格式** | WorldEdit `.schem`（v2）和 Litematica `.litematic` |
| 📋 **材料清单** | 方块数量 + 命名空间 ID，方便生存模式备料 |
| 🌐 **双语界面** | 中文 / English |
| 🎮 **多版本支持** | MC 1.16.5 至 1.20 |

---

## 🚀 使用方法

```
1. 上传图片   →  拖放或点击浏览
2. 裁剪       →  选择地图尺寸（1×1、2×2……）并调整裁剪区域
3. 配置参数   →  版本、平地/阶梯、抖动算法、方块调色板
4. 生成       →  在 Web Worker 中运行，主线程不卡顿
5. 导出       →  .schem 用于 WorldEdit，.litematic 用于 Litematica
```

---

## 🎮 地图颜色原理

Minecraft 根据方块 Y 坐标与其北方邻居的高度差计算地图像素颜色：

| 色调 | 亮度倍数 | 条件 |
|:-----|:--------|:-----|
| 亮色 | × 1.000 | 高于北方相邻方块 |
| 正常 | × 0.863 | 与北方相邻方块同高 |
| 暗色 | × 0.706 | 低于北方相邻方块 |

**平地模式** — 只有 `正常` 色调（单层建造，更简单）  
**阶梯模式** — 三种色调全部可用（阶梯式高度差，颜色多 3 倍）

颜色数据来源：[mapartcraft](https://github.com/rebane2001/mapartcraft)（GPL-3）。

---

## ⚡ 性能

颜色匹配在 Web Worker 中运行，自动选择最快的后端：

```
WASM SIMD  →  WASM  →  KD-tree JS  →  暴力搜索 JS
```

首次加载时通过能力检测 + 微基准测试选择后端，结果缓存在 `localStorage`，后续访问无额外开销。

---

## 🛠️ 开发

```bash
git clone https://github.com/bkmashiro/mapforge
cd mapforge
npm install
npm run dev
```

构建生产版本：
```bash
npm run build
```

---

## 📄 许可证

MIT © [bkmashiro](https://github.com/bkmashiro)

颜色数据来自 [rebane2001/mapartcraft](https://github.com/rebane2001/mapartcraft) — GPL-3.0

---

<div align="center">

*如果 MapForge 帮到了你，在 GitHub 点个 ⭐ 是对我最大的鼓励。*

</div>
