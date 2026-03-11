<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { McVersion, StaircaseMode, DitherMethod } from '$lib/types.js';
  import { generateSchem, generateLitematic } from '$lib/nbt.js';
  import coloursJSON from '$lib/data/colours.json';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface ColourSetInfo {
    id: number;
    name: string;
    rgb: [number, number, number];
    enabled: boolean;
  }

  interface MapPixelResult {
    colourSetId: number;
    tone: string;
    blockId: string;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  let version: McVersion = '1.20';
  let staircaseMode: StaircaseMode = 'flat';
  let ditherMethod: DitherMethod = 'floyd-steinberg';

  let colourSets: ColourSetInfo[] = [];
  let previewScale = 4;

  let originalCanvas: HTMLCanvasElement;
  let resultCanvas: HTMLCanvasElement;

  let sourceImage: HTMLImageElement | null = null;
  let isDragOver = false;
  let isConverting = false;
  let progress = 0;

  let resultPixels: MapPixelResult[][] = [];
  let materials: Record<string, number> = {};

  let worker: Worker | null = null;

  const versions: McVersion[] = ['1.20', '1.19', '1.18.2', '1.17.1', '1.16.5'];
  const scales = [1, 2, 4, 8];

  // ── Colour set list ─────────────────────────────────────────────────────────

  onMount(() => {
    const raw = coloursJSON as Record<string, { tonesRGB: { normal: [number, number, number] }; blocks: Record<string, { displayName: string }> }>;
    colourSets = Object.entries(raw).map(([idStr, cs]) => {
      const firstBlock = Object.values(cs.blocks)[0];
      return {
        id: parseInt(idStr, 10),
        name: firstBlock?.displayName ?? `Color ${idStr}`,
        rgb: cs.tonesRGB.normal,
        enabled: true,
      };
    });
  });

  onDestroy(() => {
    worker?.terminate();
  });

  // ── Image handling ──────────────────────────────────────────────────────────

  function loadImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        drawOriginal();
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function drawOriginal() {
    if (!sourceImage || !originalCanvas) return;
    const ctx = originalCanvas.getContext('2d')!;
    originalCanvas.width = 128;
    originalCanvas.height = 128;
    ctx.drawImage(sourceImage, 0, 0, 128, 128);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) loadImageFile(file);
  }

  function onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) loadImageFile(file);
  }

  // ── Conversion ──────────────────────────────────────────────────────────────

  async function convert() {
    if (!sourceImage || !originalCanvas) return;
    isConverting = true;
    progress = 0;
    resultPixels = [];
    materials = {};

    // Get 128×128 pixel data from canvas
    const ctx = originalCanvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, 128, 128);

    // Terminate previous worker
    worker?.terminate();
    worker = new Worker(new URL('$lib/workers/converter.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === 'progress') {
        progress = data.progress;
      } else if (data.type === 'done') {
        resultPixels = data.pixels;
        materials = data.materials;
        progress = 100;
        isConverting = false;

        // Draw preview
        if (resultCanvas) {
          const rctx = resultCanvas.getContext('2d')!;
          resultCanvas.width = 128;
          resultCanvas.height = 128;
          const previewImgData = rctx.createImageData(128, 128);
          previewImgData.data.set(data.previewData);
          rctx.putImageData(previewImgData, 0, 0);
        }
      }
    };

    worker.onerror = (e) => {
      console.error('Worker error:', e);
      isConverting = false;
    };

    worker.postMessage({
      type: 'convert',
      imageData: imgData.data,
      width: 128,
      height: 128,
      options: {
        version,
        staircaseMode,
        ditherMethod,
        enabledColourIds: colourSets.filter((c) => c.enabled).map((c) => c.id),
      },
      coloursJSON,
    });
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  function downloadBlob(data: Uint8Array, filename: string) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSchem() {
    if (!resultPixels.length) return;
    const raw = coloursJSON as Parameters<typeof generateSchem>[2];
    const data = generateSchem(resultPixels as Parameters<typeof generateSchem>[0], version, raw);
    downloadBlob(data, 'mapforge.schem');
  }

  function exportLitematic() {
    if (!resultPixels.length) return;
    const raw = coloursJSON as Parameters<typeof generateLitematic>[3];
    const data = generateLitematic(resultPixels as Parameters<typeof generateLitematic>[0], version, 'MapForge', raw);
    downloadBlob(data, 'mapforge.litematic');
  }

  // ── Colour set controls ─────────────────────────────────────────────────────

  function selectAll() { colourSets = colourSets.map((c) => ({ ...c, enabled: true })); }
  function selectNone() { colourSets = colourSets.map((c) => ({ ...c, enabled: false })); }
  function toggleColour(id: number) {
    colourSets = colourSets.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  $: stackCount = (count: number) => `${Math.floor(count / 64)} stk ${count % 64}`;
  $: sortedMaterials = Object.entries(materials).sort((a, b) => b[1] - a[1]);
</script>

<svelte:head>
  <title>MapForge — Minecraft Map Art Generator</title>
</svelte:head>

<div class="app">
  <!-- ── Left panel ─────────────────────────────────────────────────────── -->
  <aside class="panel left-panel">
    <div class="panel-header">
      <h1>🗺️ MapForge</h1>
      <p class="subtitle">Minecraft Map Art Generator</p>
    </div>

    <section class="setting-group">
      <label class="setting-label" for="version-select">MC Version</label>
      <select id="version-select" bind:value={version} class="select">
        {#each versions as v}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </section>

    <section class="setting-group">
      <span class="setting-label">Staircase Mode</span>
      <div class="toggle-row">
        <button
          class="toggle-btn"
          class:active={staircaseMode === 'flat'}
          on:click={() => (staircaseMode = 'flat')}
        >Flat</button>
        <button
          class="toggle-btn"
          class:active={staircaseMode === 'staircase'}
          on:click={() => (staircaseMode = 'staircase')}
        >Staircase</button>
      </div>
    </section>

    <section class="setting-group">
      <span class="setting-label">Dithering</span>
      <div class="radio-group">
        {#each [['none', 'None'], ['floyd-steinberg', 'Floyd-Steinberg'], ['ordered', 'Ordered (Bayer 4×4)']] as [val, label]}
          <label class="radio-label">
            <input type="radio" bind:group={ditherMethod} value={val} />
            {label}
          </label>
        {/each}
      </div>
    </section>

    <section class="setting-group colours-section">
      <div class="colours-header">
        <span class="setting-label">Block Colors</span>
        <div class="colours-actions">
          <button class="link-btn" on:click={selectAll}>All</button>
          <button class="link-btn" on:click={selectNone}>None</button>
        </div>
      </div>
      <div class="colour-list">
        {#each colourSets as cs (cs.id)}
          <label class="colour-item">
            <input type="checkbox" checked={cs.enabled} on:change={() => toggleColour(cs.id)} />
            <span
              class="colour-swatch"
              style="background: rgb({cs.rgb[0]},{cs.rgb[1]},{cs.rgb[2]})"
            ></span>
            <span class="colour-name">{cs.name}</span>
          </label>
        {/each}
      </div>
    </section>
  </aside>

  <!-- ── Center: preview ───────────────────────────────────────────────── -->
  <main class="center-panel">
    <!-- Drop zone -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="dropzone"
      class:drag-over={isDragOver}
      on:dragover|preventDefault={() => (isDragOver = true)}
      on:dragleave={() => (isDragOver = false)}
      on:drop={onDrop}
    >
      {#if !sourceImage}
        <div class="drop-prompt">
          <div class="drop-icon">📁</div>
          <p>Drag & drop an image here</p>
          <p class="drop-sub">or</p>
          <label class="file-btn">
            Browse file
            <input type="file" accept="image/*" on:change={onFileInput} class="hidden-input" />
          </label>
        </div>
      {:else}
        <p class="drop-hint">Drop a new image to replace</p>
        <label class="file-btn small">
          Change image
          <input type="file" accept="image/*" on:change={onFileInput} class="hidden-input" />
        </label>
      {/if}
    </div>

    <!-- Canvases -->
    {#if sourceImage}
      <div class="canvas-section">
        <div class="scale-controls">
          <span class="setting-label">Preview Scale</span>
          {#each scales as s}
            <button
              class="scale-btn"
              class:active={previewScale === s}
              on:click={() => (previewScale = s)}
            >{s}×</button>
          {/each}
        </div>

        <div class="canvases">
          <div class="canvas-wrapper">
            <p class="canvas-label">Original</p>
            <canvas
              bind:this={originalCanvas}
              style="width:{128 * previewScale}px; height:{128 * previewScale}px; image-rendering:pixelated"
            ></canvas>
          </div>

          <div class="canvas-wrapper">
            <p class="canvas-label">Preview</p>
            {#if resultPixels.length}
              <canvas
                bind:this={resultCanvas}
                style="width:{128 * previewScale}px; height:{128 * previewScale}px; image-rendering:pixelated"
              ></canvas>
            {:else}
              <div
                class="canvas-placeholder"
                style="width:{128 * previewScale}px; height:{128 * previewScale}px"
              >
                {isConverting ? '⏳ Converting...' : 'Click Generate →'}
              </div>
            {/if}
          </div>
        </div>

        <!-- Progress bar -->
        {#if isConverting}
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:{progress}%"></div>
            <span class="progress-text">{progress}%</span>
          </div>
        {/if}

        <button
          class="generate-btn"
          on:click={convert}
          disabled={isConverting || !colourSets.some((c) => c.enabled)}
        >
          {isConverting ? `Generating... ${progress}%` : '⚡ Generate'}
        </button>
      </div>
    {/if}
  </main>

  <!-- ── Right panel: materials + export ───────────────────────────────── -->
  <aside class="panel right-panel">
    <div class="panel-header">
      <h2>Export</h2>
    </div>

    <div class="export-btns">
      <button
        class="export-btn"
        on:click={exportSchem}
        disabled={!resultPixels.length}
      >
        📦 WorldEdit .schem
      </button>
      <button
        class="export-btn"
        on:click={exportLitematic}
        disabled={!resultPixels.length}
      >
        🗺️ Litematica .litematic
      </button>
    </div>

    {#if sortedMaterials.length > 0}
      <div class="materials-section">
        <h3 class="materials-title">Materials ({sortedMaterials.length} blocks)</h3>
        <div class="materials-table-wrap">
          <table class="materials-table">
            <thead>
              <tr>
                <th>Block</th>
                <th>Count</th>
                <th>Stacks</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedMaterials as [name, count]}
                <tr>
                  <td class="mat-name">{name}</td>
                  <td class="mat-count">{count}</td>
                  <td class="mat-stack">{stackCount(count)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <p class="no-materials">Generate a map to see materials</p>
    {/if}
  </aside>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
  }

  :root {
    --bg: #0f0f11;
    --surface: #1a1a1f;
    --surface2: #242429;
    --border: #2e2e36;
    --accent: #5865f2;
    --accent-hover: #6d7af5;
    --text: #e4e4f0;
    --text-muted: #888899;
    --green: #3ba55c;
    --radius: 8px;
  }

  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Panels ─────────────────────────────────────── */

  .panel {
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .left-panel {
    width: 300px;
    flex-shrink: 0;
  }

  .right-panel {
    width: 260px;
    flex-shrink: 0;
    border-right: none;
    border-left: 1px solid var(--border);
  }

  .panel-header {
    padding: 20px 16px 12px;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 12px;
    margin-top: 2px;
  }

  /* ── Settings ─────────────────────────────────────── */

  .setting-group {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .setting-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .select {
    width: 100%;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: var(--radius);
    font-size: 13px;
    cursor: pointer;
  }

  .toggle-row {
    display: flex;
    gap: 6px;
  }

  .toggle-btn {
    flex: 1;
    padding: 6px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
  }

  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
  }

  /* ── Colour list ─────────────────────────────────── */

  .colours-section {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .colours-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .colours-header .setting-label {
    margin-bottom: 0;
  }

  .colours-actions {
    display: flex;
    gap: 8px;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }

  .link-btn:hover { text-decoration: underline; }

  .colour-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .colour-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .colour-item:hover { background: var(--surface2); }

  .colour-swatch {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    flex-shrink: 0;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .colour-name {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Center ───────────────────────────────────────── */

  .center-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 20px;
    gap: 16px;
    background: var(--bg);
  }

  .dropzone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 24px;
    text-align: center;
    transition: border-color 0.2s, background 0.2s;
    cursor: default;
  }

  .dropzone.drag-over {
    border-color: var(--accent);
    background: rgba(88, 101, 242, 0.08);
  }

  .drop-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
  }

  .drop-icon { font-size: 32px; }

  .drop-sub { font-size: 12px; }

  .drop-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .file-btn {
    display: inline-block;
    background: var(--accent);
    color: #fff;
    padding: 8px 16px;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s;
  }

  .file-btn:hover { background: var(--accent-hover); }

  .file-btn.small {
    padding: 5px 10px;
    font-size: 12px;
  }

  .hidden-input {
    display: none;
  }

  /* ── Canvas section ──────────────────────────────── */

  .canvas-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .scale-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .scale-controls .setting-label {
    margin-bottom: 0;
  }

  .scale-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }

  .scale-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .canvases {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }

  .canvas-wrapper {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .canvas-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  canvas {
    display: block;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .canvas-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 13px;
  }

  /* ── Progress ─────────────────────────────────────── */

  .progress-bar-wrap {
    height: 6px;
    background: var(--surface2);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
    max-width: 500px;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
    border-radius: 3px;
  }

  .progress-text {
    font-size: 11px;
    color: var(--text-muted);
    position: absolute;
    right: 0;
    top: -16px;
  }

  /* ── Generate button ─────────────────────────────── */

  .generate-btn {
    align-self: flex-start;
    background: var(--green);
    color: #fff;
    border: none;
    padding: 10px 24px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .generate-btn:hover:not(:disabled) { opacity: 0.85; }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Right panel ──────────────────────────────────── */

  .export-btns {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid var(--border);
  }

  .export-btn {
    width: 100%;
    padding: 9px 12px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    transition: all 0.15s;
  }

  .export-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .export-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .materials-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 12px 16px;
  }

  .materials-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 10px;
  }

  .materials-table-wrap {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .materials-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .materials-table th {
    text-align: left;
    padding: 4px 4px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .materials-table td {
    padding: 4px 4px;
    border-bottom: 1px solid rgba(46, 46, 54, 0.5);
  }

  .mat-name {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100px;
  }

  .mat-count {
    color: var(--text-muted);
    text-align: right;
  }

  .mat-stack {
    color: var(--text-muted);
    text-align: right;
    white-space: nowrap;
  }

  .no-materials {
    padding: 20px 0;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
</style>
