<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import InlineCropWorkspace from '$lib/InlineCropWorkspace.svelte';

  interface SelectionRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export let imageFile: File | null = null;
  export let mapWidth = 1;
  export let mapHeight = 1;
  export let resizeFilter: 'lanczos' | 'bilinear' | 'nearest' = 'lanczos';

  const dispatch = createEventDispatcher<{
    crop: { croppedImageData: ImageData };
  }>();

  let image: HTMLImageElement | null = null;
  let selection: SelectionRect | null = null;
  let cropCanvas: HTMLCanvasElement | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLoadedFile: File | null = null;
  let lastMapKey = '1x1';
  let isRendering = false;

  $: if (imageFile !== lastLoadedFile) {
    void loadImageFile(imageFile);
  }

  $: if (image) {
    const nextMapKey = `${mapWidth}x${mapHeight}`;
    if (nextMapKey !== lastMapKey) {
      lastMapKey = nextMapKey;
      selection = createDefaultSelection(image, mapWidth, mapHeight);
      scheduleCrop();
    }
  }

  $: if (image && selection) {
    resizeFilter;
    scheduleCrop();
  }

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  function createDefaultSelection(source: HTMLImageElement, widthMaps: number, heightMaps: number): SelectionRect {
    const baseWidth = widthMaps * 128;
    const baseHeight = heightMaps * 128;
    const snappedUnits = Math.floor(Math.min(source.width / baseWidth, source.height / baseHeight));

    if (snappedUnits >= 1) {
      const width = baseWidth * snappedUnits;
      const height = baseHeight * snappedUnits;
      const x = Math.max(0, Math.round(((source.width - width) / 2) / 128) * 128);
      const y = Math.max(0, Math.round(((source.height - height) / 2) / 128) * 128);
      return { x, y, width, height };
    }

    const aspect = widthMaps / heightMaps;
    let width = source.width;
    let height = width / aspect;

    if (height > source.height) {
      height = source.height;
      width = height * aspect;
    }

    return {
      x: Math.round((source.width - width) / 2),
      y: Math.round((source.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  async function loadImageFile(file: File | null) {
    lastLoadedFile = file;
    image = null;
    selection = null;
    isRendering = false;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (!file) return;

    const url = URL.createObjectURL(file);

    try {
      const nextImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });

      if (lastLoadedFile !== file) return;

      image = nextImage;
      lastMapKey = `${mapWidth}x${mapHeight}`;
      selection = createDefaultSelection(nextImage, mapWidth, mapHeight);
      scheduleCrop();
    } catch (error) {
      console.error('Failed to load image:', error);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function extractCroppedImageData(source: HTMLImageElement, rect: SelectionRect): ImageData {
    const width = mapWidth * 128;
    const height = mapHeight * 128;
    cropCanvas ??= document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const context = cropCanvas.getContext('2d')!;

    if (resizeFilter === 'nearest') {
      context.imageSmoothingEnabled = false;
    } else {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = resizeFilter === 'bilinear' ? 'medium' : 'high';
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }

  function scheduleCrop() {
    if (!image || !selection) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    isRendering = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      isRendering = false;
      dispatch('crop', { croppedImageData: extractCroppedImageData(image!, selection!) });
    }, 800);
  }

  function onSelectionChange(event: CustomEvent<SelectionRect>) {
    selection = event.detail;
    scheduleCrop();
  }
</script>

<div class="inline-workspace-shell">
  {#if image}
    <InlineCropWorkspace image={image} {mapWidth} {mapHeight} {selection} on:selectionChange={onSelectionChange} />
    {#if isRendering}
      <div class="render-badge">🔄 Rendering...</div>
    {/if}
  {/if}
</div>

<style>
  .inline-workspace-shell {
    position: relative;
    width: 100%;
    max-width: 600px;
  }

  .render-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 244, 163, 0.35);
    background: rgba(15, 23, 42, 0.86);
    color: #fff4a3;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 700;
    backdrop-filter: blur(4px);
  }
</style>
