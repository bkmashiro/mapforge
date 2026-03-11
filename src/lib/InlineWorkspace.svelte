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
  let renderTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastLoadedFile: File | null = null;
  let isRendering = false;
  let currentBlobUrl: string | null = null;

  $: if (imageFile !== lastLoadedFile) {
    void loadImageFile(imageFile);
  }

  // Trigger crop whenever selection, resizeFilter, or map dims change
  $: if (image && selection) {
    resizeFilter;
    mapWidth;
    mapHeight;
    scheduleCrop();
  }

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (renderTimeout) clearTimeout(renderTimeout);
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  });

  async function loadImageFile(file: File | null) {
    lastLoadedFile = file;
    image = null;
    selection = null;
    isRendering = false;

    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }

    if (!file) return;

    // Revoke previous blob URL before creating a new one
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }

    const url = URL.createObjectURL(file);
    currentBlobUrl = url; // Keep alive so InlineCropWorkspace can use image.src

    try {
      const nextImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });

      if (lastLoadedFile !== file) {
        // A newer file was requested; clean up this blob URL
        URL.revokeObjectURL(url);
        if (currentBlobUrl === url) currentBlobUrl = null;
        return;
      }
      image = nextImage;
      // InlineCropWorkspace will emit the initial selection via selectionChange
    } catch (error) {
      console.error('Failed to load image:', error);
      URL.revokeObjectURL(url);
      if (currentBlobUrl === url) currentBlobUrl = null;
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
    if (renderTimeout) clearTimeout(renderTimeout);

    isRendering = true;

    // Safety fallback: force clear rendering after 5 s
    renderTimeout = setTimeout(() => {
      renderTimeout = null;
      isRendering = false;
    }, 5000);

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        const data = extractCroppedImageData(image!, selection!);
        dispatch('crop', { croppedImageData: data });
      } catch (e) {
        console.error('Crop extraction failed:', e);
      }
      isRendering = false;
      if (renderTimeout) { clearTimeout(renderTimeout); renderTimeout = null; }
    }, 800);
  }

  function onSelectionChange(event: CustomEvent<SelectionRect>) {
    selection = event.detail;
    // Reactive block ($: if (image && selection)) will call scheduleCrop
  }
</script>

<div class="inline-workspace-shell">
  {#if image}
    <InlineCropWorkspace {image} {mapWidth} {mapHeight} on:selectionChange={onSelectionChange} />
    {#if isRendering}
      <div class="render-badge">Rendering...</div>
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
