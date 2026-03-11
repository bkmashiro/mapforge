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

  const dispatch = createEventDispatcher<{ selectionChange: SelectionRect }>();

  let container: HTMLDivElement;
  let containerW = 600;
  let containerH = 400;

  // Image transform: screen = imgOffset + imgCoord * imgScale
  let imgScale = 1;
  let imgOffsetX = 0;
  let imgOffsetY = 0;

  // Selection box — fixed screen-pixel size, movable
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
    const tl = screenToImage(selX, selY);
    const w = SEL_W / imgScale;
    const h = selH / imgScale;

    dispatch('selectionChange', {
      x: Math.max(0, Math.round(tl.x)),
      y: Math.max(0, Math.round(tl.y)),
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
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

    selX = (containerW - SEL_W) / 2;
    selY = (containerH - selH) / 2;

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
  let prevMapKey = '';
  $: {
    const key = `${mapWidth}x${mapHeight}`;
    if (initialized && key !== prevMapKey) {
      prevMapKey = key;
      selX = (containerW - SEL_W) / 2;
      selY = (containerH - selH) / 2;
      emitSelection();
    }
  }

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

  // ── Pointer drag (left on selection = move selection, else = pan) ────
  function onPointerDown(e: PointerEvent) {
    if (!image) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (e.button === 0 && mx >= selX && mx <= selX + SEL_W && my >= selY && my <= selY + selH) {
      dragMode = 'sel';
      dragOriginX = mx;
      dragOriginY = my;
      dragStartVal1 = selX;
      dragStartVal2 = selY;
    } else {
      dragMode = 'pan';
      dragOriginX = mx;
      dragOriginY = my;
      dragStartVal1 = imgOffsetX;
      dragStartVal2 = imgOffsetY;
    }

    container.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragMode === 'none') return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - dragOriginX;
    const dy = my - dragOriginY;

    if (dragMode === 'sel') {
      selX = dragStartVal1 + dx;
      selY = dragStartVal2 + dy;
    } else {
      imgOffsetX = dragStartVal1 + dx;
      imgOffsetY = dragStartVal2 + dy;
    }

    emitSelection();
  }

  function onPointerUp() {
    dragMode = 'none';
  }

  function onContextMenu(e: Event) {
    e.preventDefault();
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
    <img
      src={image.src}
      alt=""
      class="crop-image"
      style="transform: translate({imgOffsetX}px, {imgOffsetY}px) scale({imgScale}); transform-origin: 0 0;"
      draggable="false"
    />

    <!-- Selection box — fixed screen size, dimmed overlay via box-shadow -->
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

  .crop-image {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    image-rendering: auto;
  }

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
