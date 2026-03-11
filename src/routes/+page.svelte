<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { McVersion, StaircaseMode, DitherMethod } from '$lib/types.js';
  import { generateSchem, generateLitematic } from '$lib/nbt.js';
  import coloursJSON from '$lib/data/colours.json';
  import { locale, t, selectedVariants, advancedSettings, DEFAULT_ADVANCED } from '$lib/stores.js';
  import { getCategory, CATEGORY_ORDER, type BlockCategory } from '$lib/blockCategories.js';
  import ImageCropper from '$lib/ImageCropper.svelte';
  import Tooltip from '$lib/Tooltip.svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface BlockVariant {
    blockId: string;
    displayName: string;
  }

  interface ColourSetInfo {
    id: number;
    name: string;
    rgb: [number, number, number];
    enabled: boolean;
    blocks: BlockVariant[];
  }

  interface MapPixelResult {
    colourSetId: number;
    tone: string;
    blockId: string;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  let version: McVersion = '1.20';
  let staircaseMode: StaircaseMode = 'flat';
  let ditherMethod: DitherMethod = 'atkinson';

  let colourSets: ColourSetInfo[] = [];
  let previewScale = 4;

  // Category collapse state
  const categoryExpanded: Record<BlockCategory, boolean> = {
    natural: true, stone: true, wood: true, metal: true, terracotta: true, wool: true, misc: true,
  };

  let originalCanvas: HTMLCanvasElement;
  let resultCanvas: HTMLCanvasElement;

  // Crop & map state
  let mapWidth = 1;
  let mapHeight = 1;
  let pendingFile: File | null = null;
  let showCropModal = false;
  let croppedImageData: ImageData | null = null;

  let isDragOver = false;
  let isConverting = false;
  let progress = 0;

  let resultPixels: MapPixelResult[][] = [];
  let materials: Record<string, number> = {};
  let worker: Worker | null = null;

  // Advanced panel expand state
  let advancedOpen = false;

  const MAP_PRESETS: [number, number][] = [
    [1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [4, 4],
  ];

  // Block presets
  const SURVIVAL_EASY_ENABLED = new Set([
    0, 1, 5, 9, 10, 12, 13,
    14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, // wool/concrete
    33, 34,
    35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, // terracotta
    57,
  ]);
  const NO_RARE_IDS = new Set([29, 30, 31, 32]); // gold, diamond, lapis, emerald

  function applyPresetSurvivalEasy() {
    colourSets = colourSets.map((c) => ({ ...c, enabled: SURVIVAL_EASY_ENABLED.has(c.id) }));
  }
  function applyPresetNoRare() {
    colourSets = colourSets.map((c) => ({ ...c, enabled: c.enabled && !NO_RARE_IDS.has(c.id) }));
  }
  function applyPresetFull() { selectAll(); }
  const versions: McVersion[] = ['1.20', '1.19', '1.18.2', '1.17.1', '1.16.5'];
  const scales = [1, 2, 4, 8];

  // ── Init ────────────────────────────────────────────────────────────────────

  onMount(() => {
    const raw = coloursJSON as Record<string, {
      tonesRGB: { normal: [number, number, number] };
      blocks: Record<string, { displayName: string }>;
    }>;

    colourSets = Object.entries(raw).map(([idStr, cs]) => {
      const id = parseInt(idStr, 10);
      const blocks: BlockVariant[] = Object.entries(cs.blocks).map(([blockId, block]) => ({
        blockId,
        displayName: block.displayName,
      }));
      return {
        id,
        name: blocks[0]?.displayName ?? `Color ${idStr}`,
        rgb: cs.tonesRGB.normal,
        enabled: true,
        blocks,
      };
    });

    // Init selectedVariants store with first block per colour
    const initVariants: Record<number, string> = {};
    for (const cs of colourSets) {
      initVariants[cs.id] = cs.blocks[0]?.blockId ?? '';
    }
    selectedVariants.set(initVariants);
  });

  onDestroy(() => worker?.terminate());

  // ── Categorized view ────────────────────────────────────────────────────────

  $: categorized = (() => {
    const groups = {} as Record<BlockCategory, ColourSetInfo[]>;
    for (const cat of CATEGORY_ORDER) groups[cat] = [];
    for (const cs of colourSets) {
      const cat = getCategory(cs.id);
      groups[cat].push(cs);
    }
    return CATEGORY_ORDER.map((cat) => ({ cat, items: groups[cat] })).filter((g) => g.items.length > 0);
  })();

  function toggleCategory(cat: BlockCategory) {
    categoryExpanded[cat] = !categoryExpanded[cat];
  }

  function selectAllInCategory(cat: BlockCategory, enabled: boolean) {
    colourSets = colourSets.map((cs) =>
      getCategory(cs.id) === cat ? { ...cs, enabled } : cs
    );
  }

  function selectAll()  { colourSets = colourSets.map((c) => ({ ...c, enabled: true })); }
  function selectNone() { colourSets = colourSets.map((c) => ({ ...c, enabled: false })); }
  function toggleColour(id: number) {
    colourSets = colourSets.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c);
  }

  function setVariant(id: number, blockId: string) {
    selectedVariants.update((v) => ({ ...v, [id]: blockId }));
    // Update display name in colourSets
    colourSets = colourSets.map((cs) => {
      if (cs.id !== id) return cs;
      const block = cs.blocks.find((b) => b.blockId === blockId);
      return { ...cs, name: block?.displayName ?? cs.name };
    });
  }

  // ── Image handling ───────────────────────────────────────────────────────────

  function loadImageFile(file: File) {
    pendingFile = file;
    showCropModal = true;
  }

  // ── Image preprocessing ──────────────────────────────────────────────────────

  function preprocessImageData(src: ImageData, satBoost: number, brightness: number): ImageData {
    // satBoost: -50 to +50 (%), brightness: -50 to +50 (%)
    if (satBoost === 0 && brightness === 0) return src;
    const out = new ImageData(src.width, src.height);
    const data = src.data;
    const d = out.data;
    const satMul = 1 + satBoost / 100;
    const briOff = brightness * 2.55;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] + briOff;
      let g = data[i + 1] + briOff;
      let b = data[i + 2] + briOff;
      // Saturation adjustment via luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + satMul * (r - lum);
      g = lum + satMul * (g - lum);
      b = lum + satMul * (b - lum);
      d[i]     = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
      d[i + 3] = data[i + 3];
    }
    return out;
  }

  function onCrop(e: CustomEvent<{ imageData: ImageData; mapWidth: number; mapHeight: number }>) {
    croppedImageData = e.detail.imageData;
    mapWidth = e.detail.mapWidth;
    mapHeight = e.detail.mapHeight;
    showCropModal = false;
    pendingFile = null;

    // Draw to originalCanvas (show pre-processed preview)
    drawOriginalCanvas();
    // Reset result
    resultPixels = [];
    materials = {};
  }

  function drawOriginalCanvas() {
    if (!croppedImageData || !originalCanvas) return;
    const adv = $advancedSettings;
    const processed = preprocessImageData(croppedImageData, adv.saturationBoost, adv.brightness);
    originalCanvas.width  = processed.width;
    originalCanvas.height = processed.height;
    originalCanvas.getContext('2d')!.putImageData(processed, 0, 0);
  }

  // Re-draw when sat/brightness changes
  $: if (croppedImageData && originalCanvas) {
    drawOriginalCanvas();
  }

  function onCropCancel() {
    showCropModal = false;
    pendingFile = null;
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
    // Reset input so same file can be re-picked
    input.value = '';
  }

  // ── Conversion ───────────────────────────────────────────────────────────────

  async function convert() {
    if (!croppedImageData) return;

    isConverting = true;
    progress = 0;
    resultPixels = [];
    materials = {};

    worker?.terminate();
    worker = new Worker(
      new URL('$lib/workers/converter.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = async (e) => {
      const data = e.data;
      if (data.type === 'progress') {
        progress = data.progress;
      } else if (data.type === 'done') {
        resultPixels = data.pixels;
        materials = data.materials;
        progress = 100;
        isConverting = false;

        // Wait for Svelte to render the canvas (it's inside {#if resultPixels.length})
        await tick();

        if (resultCanvas) {
          const rctx = resultCanvas.getContext('2d')!;
          resultCanvas.width  = croppedImageData!.width;
          resultCanvas.height = croppedImageData!.height;
          const previewImg = rctx.createImageData(resultCanvas.width, resultCanvas.height);
          previewImg.data.set(data.previewData);
          rctx.putImageData(previewImg, 0, 0);
        }
      }
    };

    worker.onerror = (e) => {
      console.error('Worker error:', e);
      isConverting = false;
    };

    // Apply preprocessing before sending to worker
    const adv = $advancedSettings;
    const processedData = preprocessImageData(croppedImageData, adv.saturationBoost, adv.brightness);

    worker.postMessage({
      type: 'convert',
      imageData: processedData.data,
      width:  processedData.width,
      height: processedData.height,
      options: {
        version,
        staircaseMode,
        ditherMethod,
        enabledColourIds: colourSets.filter((c) => c.enabled).map((c) => c.id),
        selectedVariants: $selectedVariants,
        advanced: {
          colorSpace:          adv.colorSpace,
          labLWeight:          adv.labLWeight,
          labAWeight:          adv.labAWeight,
          labBWeight:          adv.labBWeight,
          ditherStrength:      adv.ditherStrength,
          blueNoiseThreshold:  adv.blueNoiseThreshold,
        },
      },
      coloursJSON,
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  function downloadBlob(data: Uint8Array, filename: string) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportSchem() {
    exportSchemNamed();
  }

  function exportLitematic() {
    if (!resultPixels.length) return;
    const name = $advancedSettings.schematicName || 'mapforge_export';
    const raw = coloursJSON as Parameters<typeof generateLitematic>[3];
    downloadBlob(generateLitematic(resultPixels as Parameters<typeof generateLitematic>[0], version, name, raw), `${name}.litematic`);
  }

  function exportSchemNamed() {
    if (!resultPixels.length) return;
    const name = $advancedSettings.schematicName || 'mapforge_export';
    const raw = coloursJSON as Parameters<typeof generateSchem>[2];
    downloadBlob(generateSchem(resultPixels as Parameters<typeof generateSchem>[0], version, raw), `${name}.schem`);
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  $: stackCount = (count: number) => `${Math.floor(count / 64)}×64 + ${count % 64}`;
  $: sortedMaterials = Object.entries(materials).sort((a, b) => b[1] - a[1]);
  $: canGenerate = !!croppedImageData && !isConverting && colourSets.some((c) => c.enabled);
  $: previewW = (croppedImageData?.width  ?? 128) * previewScale;
  $: previewH = (croppedImageData?.height ?? 128) * previewScale;
</script>

<svelte:head>
  <title>MapForge — Minecraft Map Art Generator</title>
</svelte:head>

<!-- ── Crop modal ─────────────────────────────────────────────────────────── -->
{#if showCropModal && pendingFile}
  <div class="modal-overlay" on:click|self={onCropCancel}>
    <div class="modal-box">

      <!-- Map size selector inside modal -->
      <div class="modal-header">
        <h2 class="modal-title">✂️ {$t.crop}</h2>
        <div class="map-size-row">
          <span class="setting-label">{$t.mapSize}</span>
          <Tooltip text={$t.tooltips.mapSize} position="bottom" />
          <div class="preset-grid">
            {#each MAP_PRESETS as [pw, ph]}
              <button
                class="preset-btn"
                class:active={mapWidth === pw && mapHeight === ph}
                on:click={() => { mapWidth = pw; mapHeight = ph; }}
              >{pw}×{ph}</button>
            {/each}
          </div>
          <div class="custom-size">
            <select bind:value={mapWidth}  class="size-select">
              {#each Array.from({length: 8}, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}
            </select>
            <span class="size-sep">×</span>
            <select bind:value={mapHeight} class="size-select">
              {#each Array.from({length: 8}, (_, i) => i + 1) as n}<option value={n}>{n}</option>{/each}
            </select>
          </div>
        </div>
      </div>

      <ImageCropper
        imageFile={pendingFile}
        {mapWidth}
        {mapHeight}
        resizeFilter={$advancedSettings.resizeFilter}
        on:crop={onCrop}
        on:cancel={onCropCancel}
      />
    </div>
  </div>
{/if}

<div class="app">
  <!-- ── Top navbar ─────────────────────────────────────────────────────── -->
  <nav class="topnav">
    <div class="nav-left">
      <span class="nav-logo">🗺️ MapForge</span>
      <span class="nav-sub">{$t.subtitle}</span>
    </div>
    <div class="nav-right">
      <a
        href="https://github.com/bkmashiro/mapforge"
        target="_blank"
        rel="noopener noreferrer"
        class="nav-star"
      >⭐ Star on GitHub</a>
      <div class="lang-toggle">
        <button
          class="lang-btn"
          class:active={$locale === 'en'}
          on:click={() => locale.set('en')}
        >EN</button>
        <button
          class="lang-btn"
          class:active={$locale === 'zh'}
          on:click={() => locale.set('zh')}
        >中文</button>
      </div>
    </div>
  </nav>

  <div class="content-row">
    <!-- ── Left panel ─────────────────────────────────────────────────── -->
    <aside class="panel left-panel">

      <!-- MC Version -->
      <section class="setting-group">
        <div class="label-row">
          <label class="setting-label" for="version-select">{$t.version}</label>
          <Tooltip text={$t.tooltips.version} position="right" />
        </div>
        <select id="version-select" bind:value={version} class="select">
          {#each versions as v}<option value={v}>{v}</option>{/each}
        </select>
      </section>

      <!-- Staircase Mode -->
      <section class="setting-group">
        <div class="label-row">
          <span class="setting-label">{$t.mode}</span>
        </div>
        <div class="toggle-row">
          <button
            class="toggle-btn"
            class:active={staircaseMode === 'flat'}
            on:click={() => (staircaseMode = 'flat')}
          >
            {$t.modeFlat}
            <Tooltip text={$t.tooltips.staircaseFlat} position="bottom" />
          </button>
          <button
            class="toggle-btn"
            class:active={staircaseMode === 'staircase'}
            on:click={() => (staircaseMode = 'staircase')}
          >
            {$t.modeStaircase}
            <Tooltip text={$t.tooltips.staircaseStaircase} position="bottom" />
          </button>
        </div>
      </section>

      <!-- Dithering -->
      <section class="setting-group">
        <div class="label-row">
          <span class="setting-label">{$t.dithering}</span>
        </div>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" bind:group={ditherMethod} value="atkinson" />
            Atkinson (Recommended)
            <Tooltip text={$t.tooltips.ditherAtkinson} position="right" />
          </label>
          <label class="radio-label">
            <input type="radio" bind:group={ditherMethod} value="floyd-steinberg" />
            Floyd-Steinberg
            <Tooltip text={$t.tooltips.ditherFloyd} position="right" />
          </label>
          <label class="radio-label">
            <input type="radio" bind:group={ditherMethod} value="blue-noise" />
            Blue Noise
            <Tooltip text={$t.tooltips.ditherBlueNoise} position="right" />
          </label>
          <label class="radio-label">
            <input type="radio" bind:group={ditherMethod} value="none" />
            None
            <Tooltip text={$t.tooltips.ditherNone} position="right" />
          </label>
        </div>
      </section>

      <!-- ── Advanced settings ─────────────────────────────────────── -->
      <section class="setting-group advanced-section">
        <button class="adv-toggle" on:click={() => (advancedOpen = !advancedOpen)}>
          <span class="adv-arrow" class:open={advancedOpen}>▶</span>
          <span class="adv-label">{$t.advanced.title}</span>
        </button>

        {#if advancedOpen}
          <div class="adv-body">

            <!-- Color Matching -->
            <div class="adv-sub-header">{$t.advanced.colorSection}</div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.colorSpace}
                <Tooltip text={$t.advancedTooltips.colorSpace} position="right" />
              </label>
              <select class="adv-select" bind:value={$advancedSettings.colorSpace}>
                <option value="lab">{$t.advanced.colorSpaceLab}</option>
                <option value="rgb">{$t.advanced.colorSpaceRgb}</option>
              </select>
            </div>

            {#if $advancedSettings.colorSpace === 'lab'}
              <div class="adv-row">
                <label class="adv-label-text">
                  {$t.advanced.labLWeight}
                  <Tooltip text={$t.advancedTooltips.labLWeight} position="right" />
                </label>
                <input type="number" class="adv-num" min="0.5" max="3.0" step="0.1"
                  bind:value={$advancedSettings.labLWeight} />
              </div>
              <div class="adv-row">
                <label class="adv-label-text">
                  {$t.advanced.labAWeight}
                  <Tooltip text={$t.advancedTooltips.labAWeight} position="right" />
                </label>
                <input type="number" class="adv-num" min="0.5" max="3.0" step="0.1"
                  bind:value={$advancedSettings.labAWeight} />
              </div>
              <div class="adv-row">
                <label class="adv-label-text">
                  {$t.advanced.labBWeight}
                  <Tooltip text={$t.advancedTooltips.labBWeight} position="right" />
                </label>
                <input type="number" class="adv-num" min="0.5" max="3.0" step="0.1"
                  bind:value={$advancedSettings.labBWeight} />
              </div>
            {/if}

            <!-- Dithering -->
            <div class="adv-sub-header">{$t.advanced.ditherSection}</div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.ditherStrength}
                <Tooltip text={$t.advancedTooltips.ditherStrength} position="right" />
              </label>
              <div class="adv-slider-wrap">
                <input type="range" min="0" max="100" step="1"
                  bind:value={$advancedSettings.ditherStrength} />
                <span class="adv-val">{$advancedSettings.ditherStrength}%</span>
              </div>
            </div>

            {#if ditherMethod === 'blue-noise'}
              <div class="adv-row">
                <label class="adv-label-text">
                  {$t.advanced.blueNoiseThreshold}
                  <Tooltip text={$t.advancedTooltips.blueNoiseThreshold} position="right" />
                </label>
                <div class="adv-slider-wrap">
                  <input type="range" min="10" max="80" step="1"
                    bind:value={$advancedSettings.blueNoiseThreshold} />
                  <span class="adv-val">{$advancedSettings.blueNoiseThreshold}</span>
                </div>
              </div>
            {/if}

            <!-- Image Preprocessing -->
            <div class="adv-sub-header">{$t.advanced.preprocessSection}</div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.resizeFilter}
                <Tooltip text={$t.advancedTooltips.resizeFilter} position="right" />
              </label>
              <select class="adv-select" bind:value={$advancedSettings.resizeFilter}>
                <option value="lanczos">{$t.advanced.resizeLanczos}</option>
                <option value="bilinear">{$t.advanced.resizeBilinear}</option>
                <option value="nearest">{$t.advanced.resizeNearest}</option>
              </select>
            </div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.saturationBoost}
                <Tooltip text={$t.advancedTooltips.saturationBoost} position="right" />
              </label>
              <div class="adv-slider-wrap">
                <input type="range" min="-50" max="50" step="1"
                  bind:value={$advancedSettings.saturationBoost} />
                <span class="adv-val adv-val-signed">{$advancedSettings.saturationBoost > 0 ? '+' : ''}{$advancedSettings.saturationBoost}%</span>
              </div>
            </div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.brightness}
                <Tooltip text={$t.advancedTooltips.brightness} position="right" />
              </label>
              <div class="adv-slider-wrap">
                <input type="range" min="-50" max="50" step="1"
                  bind:value={$advancedSettings.brightness} />
                <span class="adv-val adv-val-signed">{$advancedSettings.brightness > 0 ? '+' : ''}{$advancedSettings.brightness}%</span>
              </div>
            </div>

            <!-- Export Options -->
            <div class="adv-sub-header">{$t.advanced.exportSection}</div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.schematicName}
                <Tooltip text={$t.advancedTooltips.schematicName} position="right" />
              </label>
              <input type="text" class="adv-text" bind:value={$advancedSettings.schematicName} />
            </div>

            <div class="adv-row">
              <label class="adv-label-text">
                {$t.advanced.yOffset}
                <Tooltip text={$t.advancedTooltips.yOffset} position="right" />
              </label>
              <input type="number" class="adv-num" min="0" max="320" step="1"
                bind:value={$advancedSettings.yOffset} />
            </div>

            <div class="adv-row adv-row-check">
              <label class="adv-check-label">
                <input type="checkbox" bind:checked={$advancedSettings.includeAirBlocks} />
                {$t.advanced.includeAirBlocks}
              </label>
              <Tooltip text={$t.advancedTooltips.includeAirBlocks} position="right" />
            </div>

            <!-- Block Presets -->
            <div class="adv-sub-header">{$t.advanced.presetsSection}</div>

            <div class="preset-btns">
              <button class="preset-action-btn" on:click={applyPresetSurvivalEasy}
                title={$t.advancedTooltips.presetSurvivalEasy}>
                🌿 {$t.advanced.presetSurvivalEasy}
              </button>
              <button class="preset-action-btn" on:click={applyPresetNoRare}
                title={$t.advancedTooltips.presetNoRare}>
                🚫 {$t.advanced.presetNoRare}
              </button>
              <button class="preset-action-btn" on:click={applyPresetFull}
                title={$t.advancedTooltips.presetFull}>
                🌈 {$t.advanced.presetFull}
              </button>
            </div>

            <button class="adv-reset-btn"
              on:click={() => advancedSettings.set({ ...DEFAULT_ADVANCED })}>
              ↺ Reset to defaults
            </button>

          </div>
        {/if}
      </section>

      <!-- Block Colors (categorized) -->
      <section class="setting-group colours-section">
        <div class="colours-header">
          <span class="setting-label">{$t.blocks}</span>
          <div class="colours-actions">
            <button class="link-btn" on:click={selectAll}>{$t.selectAll}</button>
            <button class="link-btn" on:click={selectNone}>{$t.selectNone}</button>
          </div>
        </div>

        <div class="colour-list">
          {#each categorized as group (group.cat)}
            <!-- Category header -->
            <div class="category-header">
              <button class="cat-toggle" on:click={() => toggleCategory(group.cat)}>
                <span class="cat-arrow" class:open={categoryExpanded[group.cat]}>▶</span>
                <span class="cat-name">{$t.category[group.cat]}</span>
                <span class="cat-count">({group.items.length})</span>
              </button>
              <div class="cat-actions">
                <button class="link-btn tiny" on:click={() => selectAllInCategory(group.cat, true)}>{$t.selectAll}</button>
                <button class="link-btn tiny" on:click={() => selectAllInCategory(group.cat, false)}>{$t.selectNone}</button>
              </div>
            </div>

            {#if categoryExpanded[group.cat]}
              {#each group.items as cs (cs.id)}
                <div class="colour-item">
                  <input
                    type="checkbox"
                    checked={cs.enabled}
                    on:change={() => toggleColour(cs.id)}
                  />
                  <span
                    class="colour-swatch"
                    style="background: rgb({cs.rgb[0]},{cs.rgb[1]},{cs.rgb[2]})"
                  ></span>
                  <span class="colour-name">{cs.name}</span>
                  {#if cs.blocks.length > 1}
                    <select
                      class="variant-select"
                      value={$selectedVariants[cs.id] ?? cs.blocks[0]?.blockId}
                      on:change={(e) => setVariant(cs.id, (e.target as HTMLSelectElement).value)}
                    >
                      {#each cs.blocks as b (b.blockId)}
                        <option value={b.blockId}>{b.displayName}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              {/each}
            {/if}
          {/each}
        </div>
      </section>
    </aside>

    <!-- ── Center panel ──────────────────────────────────────────────── -->
    <main class="center-panel">

      <!-- Drop zone (no image loaded) -->
      {#if !croppedImageData}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="dropzone"
          class:drag-over={isDragOver}
          on:dragover|preventDefault={() => (isDragOver = true)}
          on:dragleave={() => (isDragOver = false)}
          on:drop={onDrop}
        >
          <div class="drop-prompt">
            <div class="drop-icon">📁</div>
            <p>{$t.upload}</p>
            <label class="file-btn">
              Browse file
              <input type="file" accept="image/*" on:change={onFileInput} class="hidden-input" />
            </label>
          </div>
        </div>
      {:else}

        <!-- Image loaded — show change button + map info -->
        <div class="image-bar">
          <span class="image-info">
            🗺️ {mapWidth}×{mapHeight} map{mapWidth * mapHeight > 1 ? 's' : ''}
            &nbsp;({croppedImageData.width}×{croppedImageData.height}px)
          </span>
          <label class="file-btn small">
            {$t.changeImage}
            <input type="file" accept="image/*" on:change={onFileInput} class="hidden-input" />
          </label>
        </div>

        <!-- Scale controls -->
        <div class="scale-controls">
          <span class="setting-label">{$t.zoom}</span>
          {#each scales as s}
            <button
              class="scale-btn"
              class:active={previewScale === s}
              on:click={() => (previewScale = s)}
            >{s}×</button>
          {/each}
        </div>

        <!-- Canvases -->
        <div class="canvases">
          <div class="canvas-wrapper">
            <p class="canvas-label">{$t.original}</p>
            <canvas
              bind:this={originalCanvas}
              style="width:{previewW}px; height:{previewH}px; image-rendering:pixelated"
            ></canvas>
          </div>

          <div class="canvas-wrapper">
            <p class="canvas-label">{$t.result}</p>
            {#if resultPixels.length}
              <canvas
                bind:this={resultCanvas}
                style="width:{previewW}px; height:{previewH}px; image-rendering:pixelated"
              ></canvas>
            {:else}
              <div
                class="canvas-placeholder"
                style="width:{previewW}px; height:{previewH}px"
              >
                {isConverting ? `⏳ ${$t.generating}` : '← ' + $t.generate}
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

        <button class="generate-btn" on:click={convert} disabled={!canGenerate}>
          {isConverting ? `⏳ ${$t.generating} ${progress}%` : `⚡ ${$t.generate}`}
        </button>
      {/if}
    </main>

    <!-- ── Right panel: export + materials ──────────────────────────── -->
    <aside class="panel right-panel">
      <div class="panel-header">
        <h2>Export</h2>
      </div>

      <div class="export-btns">
        <button class="export-btn" on:click={exportSchem} disabled={!resultPixels.length}>
          📦 {$t.exportSchem}
        </button>
        <button class="export-btn" on:click={exportLitematic} disabled={!resultPixels.length}>
          🗺️ {$t.exportLitematic}
        </button>
      </div>

      {#if sortedMaterials.length > 0}
        <div class="materials-section">
          <h3 class="materials-title">{$t.materials} ({sortedMaterials.length})</h3>
          <div class="materials-table-wrap">
            <table class="materials-table">
              <thead>
                <tr>
                  <th>{$t.blockName}</th>
                  <th>{$t.count}</th>
                  <th>{$t.stacks}</th>
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
        <p class="no-materials">{$t.noImage}</p>
      {/if}
    </aside>
  </div>

  <!-- ── Star prompt bar ────────────────────────────────────────────────── -->
  <div class="star-bar">
    <a href="https://github.com/bkmashiro/mapforge" target="_blank" rel="noopener noreferrer">
      {$t.starPrompt}
    </a>
  </div>
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

  /* ── App shell ────────────────────────────────── */

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .content-row {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Top navbar ────────────────────────────────── */

  .topnav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 46px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 12px;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nav-logo {
    font-size: 16px;
    font-weight: 700;
    color: var(--text);
  }

  .nav-sub {
    font-size: 12px;
    color: var(--text-muted);
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-star {
    font-size: 12px;
    color: var(--text-muted);
    text-decoration: none;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: all 0.15s;
  }

  .nav-star:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .lang-toggle {
    display: flex;
    gap: 2px;
  }

  .lang-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .lang-btn:first-child { border-radius: 4px 0 0 4px; }
  .lang-btn:last-child  { border-radius: 0 4px 4px 0; margin-left: -1px; }

  .lang-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  /* ── Panels ────────────────────────────────────── */

  .panel {
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .left-panel  { width: 280px; flex-shrink: 0; }
  .right-panel {
    width: 260px; flex-shrink: 0;
    border-right: none;
    border-left: 1px solid var(--border);
  }

  .panel-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
  }

  h2 { font-size: 14px; font-weight: 600; }

  /* ── Settings ──────────────────────────────────── */

  .setting-group {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .setting-label {
    display: block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 7px;
  }

  .label-row {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 7px;
  }

  .label-row .setting-label {
    margin-bottom: 0;
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
    padding: 6px 8px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
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
    gap: 5px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text);
    font-size: 12px;
  }

  /* ── Colour list ────────────────────────────────── */

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
    margin-bottom: 7px;
  }

  .colours-header .setting-label { margin-bottom: 0; }

  .colours-actions { display: flex; gap: 8px; }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }

  .link-btn:hover { text-decoration: underline; }
  .link-btn.tiny  { font-size: 10px; }

  .colour-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  /* Category header */
  .category-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 2px;
    margin-top: 4px;
    border-bottom: 1px solid var(--border);
  }

  .cat-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
  }

  .cat-arrow {
    font-size: 8px;
    display: inline-block;
    transition: transform 0.15s;
    transform: rotate(0deg);
  }

  .cat-arrow.open { transform: rotate(90deg); }

  .cat-count { color: #555; font-size: 10px; }

  .cat-actions { display: flex; gap: 6px; }

  /* Colour item */
  .colour-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 2px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .colour-item:hover { background: var(--surface2); }

  .colour-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex-shrink: 0;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .colour-name {
    flex: 1;
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .variant-select {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 10px;
    padding: 2px 4px;
    border-radius: 3px;
    max-width: 90px;
    cursor: pointer;
  }

  /* ── Modal ─────────────────────────────────────── */

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    max-width: 680px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .modal-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .map-size-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .map-size-row .setting-label { margin-bottom: 0; }

  .preset-grid {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: 3px 9px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .preset-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .custom-size {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .size-select {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 12px;
    width: 48px;
    cursor: pointer;
  }

  .size-sep {
    color: var(--text-muted);
    font-size: 14px;
  }

  /* ── Center panel ───────────────────────────────── */

  .center-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 16px 20px;
    gap: 14px;
    background: var(--bg);
  }

  .dropzone {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 40px 24px;
    text-align: center;
    transition: border-color 0.2s, background 0.2s;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dropzone.drag-over {
    border-color: var(--accent);
    background: rgba(88, 101, 242, 0.07);
  }

  .drop-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--text-muted);
  }

  .drop-icon { font-size: 36px; }

  .image-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 14px;
  }

  .image-info {
    font-size: 12px;
    color: var(--text-muted);
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
  .file-btn.small { padding: 5px 10px; font-size: 12px; }
  .hidden-input    { display: none; }

  .scale-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .scale-controls .setting-label { margin-bottom: 0; }

  .scale-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 9px;
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
    font-size: 10px;
    font-weight: 700;
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
    min-width: 128px;
    min-height: 128px;
  }

  /* Progress */
  .progress-bar-wrap {
    height: 6px;
    background: var(--surface2);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
    max-width: 480px;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }

  .progress-text {
    font-size: 10px;
    color: var(--text-muted);
    position: absolute;
    right: 0;
    top: -16px;
  }

  /* Generate button */
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
  .generate-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ── Right panel ────────────────────────────────── */

  .export-btns {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    border-bottom: 1px solid var(--border);
  }

  .export-btn {
    width: 100%;
    padding: 8px 12px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 12px;
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
    padding: 10px 14px;
  }

  .materials-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 8px;
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
    font-size: 11px;
  }

  .materials-table th {
    text-align: left;
    padding: 3px 4px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    position: sticky;
    top: 0;
    background: var(--surface);
  }

  .materials-table td {
    padding: 3px 4px;
    border-bottom: 1px solid rgba(46, 46, 54, 0.5);
  }

  .mat-name {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 90px;
  }

  .mat-count { color: var(--text-muted); text-align: right; }
  .mat-stack { color: var(--text-muted); text-align: right; white-space: nowrap; }

  .no-materials {
    padding: 20px 0;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }

  /* ── Advanced panel ────────────────────────────── */

  .advanced-section {
    flex-shrink: 0;
    padding: 8px 14px;
  }

  .adv-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 0;
    width: 100%;
    text-align: left;
  }

  .adv-toggle:hover { color: var(--text); }

  .adv-arrow {
    font-size: 8px;
    display: inline-block;
    transition: transform 0.15s;
    transform: rotate(0deg);
  }

  .adv-arrow.open { transform: rotate(90deg); }

  .adv-label { flex: 1; }

  .adv-body {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .adv-sub-header {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    padding: 4px 0 2px;
    border-bottom: 1px solid var(--border);
    margin-top: 4px;
  }

  .adv-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 22px;
  }

  .adv-row-check {
    justify-content: flex-start;
    gap: 8px;
  }

  .adv-label-text {
    font-size: 11px;
    color: var(--text-muted);
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .adv-select {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    max-width: 120px;
    cursor: pointer;
  }

  .adv-num {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    width: 58px;
    text-align: right;
  }

  .adv-text {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    width: 120px;
  }

  .adv-slider-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .adv-slider-wrap input[type="range"] {
    width: 80px;
    accent-color: var(--accent);
  }

  .adv-val {
    font-size: 10px;
    color: var(--text-muted);
    min-width: 28px;
    text-align: right;
  }

  .adv-val-signed {
    min-width: 36px;
  }

  .adv-check-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text);
    cursor: pointer;
  }

  .preset-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .preset-action-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .preset-action-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .adv-reset-btn {
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-muted);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10px;
    cursor: pointer;
    align-self: flex-start;
    margin-top: 4px;
    transition: all 0.12s;
  }

  .adv-reset-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  /* ── Star bar ───────────────────────────────────── */

  .star-bar {
    flex-shrink: 0;
    background: rgba(88, 101, 242, 0.07);
    border-top: 1px solid rgba(88, 101, 242, 0.2);
    text-align: center;
    padding: 6px;
  }

  .star-bar a {
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.15s;
  }

  .star-bar a:hover { color: var(--text); }
</style>
