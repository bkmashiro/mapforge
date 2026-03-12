<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';

  interface SelectionRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export let image: HTMLImageElement | null = null;
  export let mapWidth = 1;
  export let mapHeight = 1;
  export let rotation: 0 | 90 | 180 | 270 = 0;

  const dispatch = createEventDispatcher<{ selectionChange: SelectionRect }>();

  let container: HTMLDivElement;
  let containerW = 600;
  let containerH = 400;

  // Image transform: screen = imgOffset + imgCoord * imgScale
  let imgScale = 1;
  let imgOffsetX = 0;
  let imgOffsetY = 0;

  // Selection box - fixed screen-pixel size, movable
  const SEL_W = 240;
  $: selH = SEL_W * (mapHeight / mapWidth);
  let selX = 0;
  let selY = 0;

  // Drag state
  let dragMode: 'none' | 'sel' | 'pan' = 'none';
  let dragOriginX = 0;
  let dragOriginY = 0;
  let dragStartVal1 = 0;
  let dragStartVal2 = 0;

  let initialized = false;
  let prevImageSrc = '';

  // ResizeObserver
  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerW = entry.contentRect.width || 600;
        containerH = entry.contentRect.height || 400;
      }
    });
    if (container) resizeObserver.observe(container);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
  });

  function screenToImage(sx: number, sy: number) {
    return {
      x: (sx - imgOffsetX) / imgScale,
      y: (sy - imgOffsetY) / imgScale,
    };
  }

  function emitSelection() {
    if (!image) return;
    // Pass full context so extraction can replicate exact visual result
    dispatch('selectionChange', {
      x: 0, y: 0, width: 1, height: 1, // legacy fields (unused when _ctx present)
      _ctx: {
        containerW, containerH,
        imgOffsetX, imgOffsetY, imgScale,
        selX, selY, selW: SEL_W, selH,
        rotation,
      }
    });
  }

  function initView() {
    if (!image || !container) return;
    const rect = container.getBoundingClientRect();
    containerW = rect.width || 600;
    containerH = rect.height || 400;

    const sx = containerW / image.width;
    const sy = containerH / image.height;
    imgScale = Math.min(sx, sy) * 0.88;
    imgOffsetX = (containerW - image.width * imgScale) / 2;
    imgOffsetY = (containerH - image.height * imgScale) / 2;

    initialized = true;
    emitSelection();
  }

  // Re-init when image source changes
  $: if (image) {
    const src = image.src;
    if (src !== prevImageSrc) {
      prevImageSrc = src;
      initialized = false;
      tick().then(() => initView());
    }
  }

  // Update selection when map aspect changes
  // Selection is always centered — recompute whenever container or map dims change
  $: selX = (containerW - SEL_W) / 2;
  $: selY = (containerH - selH) / 2;
  $: if (initialized && (selX || selY || selX === 0)) emitSelection();
  // Re-emit when rotation changes so _ctx stays fresh
  $: if (initialized) { rotation; emitSelection(); }

  // ── Zoom (scroll wheel, centered on mouse) ──────────────────────────
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (!image) return;

    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
    const newScale = Math.max(0.005, Math.min(80, imgScale * factor));

    // Zoom towards mouse position
    imgOffsetX = mx - (mx - imgOffsetX) * (newScale / imgScale);
    imgOffsetY = my - (my - imgOffsetY) * (newScale / imgScale);
    imgScale = newScale;

    emitSelection();
  }

  // ── Pointer drag (pan image only; selection is fixed center) ─────────
  function onPointerDown(e: PointerEvent) {
    if (!image) return;
    const rect = container.getBoundingClientRect();
    dragMode = 'pan';
    dragOriginX = e.clientX - rect.left;
    dragOriginY = e.clientY - rect.top;
    dragStartVal1 = imgOffsetX;
    dragStartVal2 = imgOffsetY;
    container.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragMode === 'none') return;
    const rect = container.getBoundingClientRect();
    const dx = (e.clientX - rect.left) - dragOriginX;
    const dy = (e.clientY - rect.top) - dragOriginY;
    imgOffsetX = dragStartVal1 + dx;
    imgOffsetY = dragStartVal2 + dy;
    emitSelection();
  }

  function onPointerUp() {
    dragMode = 'none';
  }

  function onContextMenu(e: Event) {
    e.preventDefault();
  }

  let copyFlash = false;
  function copyParams() {
    const params = JSON.stringify({ x: Math.round(imgOffsetX), y: Math.round(imgOffsetY), scale: +imgScale.toFixed(4), rotation });
    navigator.clipboard.writeText(params);
    copyFlash = true;
    setTimeout(() => (copyFlash = false), 1200);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="crop-container"
  bind:this={container}
  on:wheel|preventDefault={handleWheel}
  on:pointerdown={onPointerDown}
  on:pointermove={onPointerMove}
  on:pointerup={onPointerUp}
  on:pointerleave={onPointerUp}
  on:contextmenu={onContextMenu}
>
  {#if image}
    <div class="transform-layer" style="transform: rotate({rotation}deg); transform-origin: center center;">
      <img
        src={image.src}
        alt=""
        class="crop-image"
        style="transform: translate({imgOffsetX}px, {imgOffsetY}px) scale({imgScale}); transform-origin: 0 0;"
        draggable="false"
      />
    </div>

    <!-- Bottom-left offset badge -->
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="offset-badge" class:flash={copyFlash} on:click|stopPropagation={copyParams} title="Click to copy params">
      {copyFlash ? '✓ Copied!' : `x:${Math.round(imgOffsetX)} y:${Math.round(imgOffsetY)} ×${imgScale.toFixed(2)}`}
    </div>

    <!-- Selection box - fixed screen size, dimmed overlay via box-shadow -->
    <div
      class="selection-box"
      style="left: {selX}px; top: {selY}px; width: {SEL_W}px; height: {selH}px;"
    >
      {#each { length: mapWidth - 1 } as _, i}
        <div class="grid-v" style="left: {((i + 1) / mapWidth) * 100}%"></div>
      {/each}
      {#each { length: mapHeight - 1 } as _, i}
        <div class="grid-h" style="top: {((i + 1) / mapHeight) * 100}%"></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .crop-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #111827;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .crop-container:active {
    cursor: grabbing;
  }

  .transform-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .crop-image {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    image-rendering: auto;
  }

  .offset-badge {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 10;
    background: rgba(15, 23, 42, 0.82);
    color: #94a3b8;
    font-size: 11px;
    font-family: monospace;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    cursor: pointer;
    user-select: none;
    transition: color 0.2s;
  }
  .offset-badge:hover { color: #e2e8f0; }
  .offset-badge.flash { color: #4ade80; border-color: #4ade80; }

  .selection-box {
    position: absolute;
    border: 2px solid #fff7b2;
    outline: 1px solid rgba(255, 255, 255, 0.95);
    box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.7);
    cursor: move;
    z-index: 1;
  }

  .grid-v,
  .grid-h {
    position: absolute;
    pointer-events: none;
  }

  .grid-v {
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px dashed rgba(255, 255, 255, 0.34);
  }

  .grid-h {
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px dashed rgba(255, 255, 255, 0.34);
  }
</style>
