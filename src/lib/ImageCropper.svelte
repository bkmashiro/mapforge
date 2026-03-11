<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';

  export let imageFile: File;
  export let mapWidth: number = 1;  // horizontal map count
  export let mapHeight: number = 1; // vertical map count
  export let resizeFilter: 'lanczos' | 'bilinear' | 'nearest' = 'lanczos';

  const dispatch = createEventDispatcher<{
    crop: { imageData: ImageData; mapWidth: number; mapHeight: number };
    cancel: void;
  }>();

  // ── Canvas & image state ────────────────────────────────────────────────────
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let img: HTMLImageElement | null = null;

  // Display rect of image on canvas (letterboxed)
  let dispX = 0, dispY = 0, dispW = 0, dispH = 0;
  let scale = 1; // canvas px per image px

  // Crop rect in IMAGE coordinates (pixels)
  let cropX = 0, cropY = 0, cropW = 0, cropH = 0;

  // ── Drag state ──────────────────────────────────────────────────────────────
  type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move' | 'none';
  let dragHandle: Handle = 'none';
  let dragStartMX = 0, dragStartMY = 0;
  let dragStartCrop = { x: 0, y: 0, w: 0, h: 0 };
  const HANDLE_SIZE = 10; // px on canvas

  // ── Canvas size ─────────────────────────────────────────────────────────────
  const CANVAS_W = 600;
  const CANVAS_H = 500;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onMount(() => {
    ctx = canvas.getContext('2d')!;
    loadImage();
  });

  // Reactively reset crop when map dimensions or file change
  $: if (img && mapWidth && mapHeight) resetCrop();

  function loadImage() {
    const url = URL.createObjectURL(imageFile);
    const image = new Image();
    image.onload = () => {
      img = image;
      URL.revokeObjectURL(url);
      computeDisplay();
      resetCrop();
      draw();
    };
    image.src = url;
  }

  function computeDisplay() {
    if (!img) return;
    const sx = CANVAS_W / img.width;
    const sy = CANVAS_H / img.height;
    scale = Math.min(sx, sy);
    dispW = img.width * scale;
    dispH = img.height * scale;
    dispX = (CANVAS_W - dispW) / 2;
    dispY = (CANVAS_H - dispH) / 2;
  }

  function resetCrop() {
    if (!img) return;
    const aspect = mapWidth / mapHeight;
    const imgAspect = img.width / img.height;
    if (aspect > imgAspect) {
      // crop width-constrained
      cropW = img.width;
      cropH = img.width / aspect;
    } else {
      // crop height-constrained
      cropH = img.height;
      cropW = img.height * aspect;
    }
    cropX = (img.width - cropW) / 2;
    cropY = (img.height - cropH) / 2;
    if (canvas && ctx) draw();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  function draw() {
    if (!img || !ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 1. Draw source image
    ctx.drawImage(img, dispX, dispY, dispW, dispH);

    // 2. Dark overlay over entire canvas
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 3. Convert crop rect to canvas coords
    const cx = dispX + cropX * scale;
    const cy = dispY + cropY * scale;
    const cw = cropW * scale;
    const ch = cropH * scale;

    // 4. Punch out crop region (reveal image)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.restore();

    // 5. Redraw image inside crop rect only
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();
    ctx.drawImage(img, dispX, dispY, dispW, dispH);
    ctx.restore();

    // 6. Grid lines inside crop rect (every 128 image px)
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Vertical lines at 128*n image px
    for (let gx = 128; gx < cropW; gx += 128) {
      const screenX = cx + gx * scale;
      ctx.beginPath();
      ctx.moveTo(screenX, cy);
      ctx.lineTo(screenX, cy + ch);
      ctx.stroke();
    }
    // Horizontal lines
    for (let gy = 128; gy < cropH; gy += 128) {
      const screenY = cy + gy * scale;
      ctx.beginPath();
      ctx.moveTo(cx, screenY);
      ctx.lineTo(cx + cw, screenY);
      ctx.stroke();
    }

    ctx.restore();

    // 7. Crop border
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(cx, cy, cw, ch);

    // 8. Rule-of-thirds lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx + cw / 3, cy);
    ctx.lineTo(cx + cw / 3, cy + ch);
    ctx.moveTo(cx + (2 * cw) / 3, cy);
    ctx.lineTo(cx + (2 * cw) / 3, cy + ch);
    ctx.moveTo(cx, cy + ch / 3);
    ctx.lineTo(cx + cw, cy + ch / 3);
    ctx.moveTo(cx, cy + (2 * ch) / 3);
    ctx.lineTo(cx + cw, cy + (2 * ch) / 3);
    ctx.stroke();

    // 9. Corner handles
    const hs = HANDLE_SIZE;
    const corners = [
      { x: cx,        y: cy,        label: 'nw' as Handle },
      { x: cx + cw,   y: cy,        label: 'ne' as Handle },
      { x: cx,        y: cy + ch,   label: 'sw' as Handle },
      { x: cx + cw,   y: cy + ch,   label: 'se' as Handle },
    ];
    for (const c of corners) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
      ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
    }

    // 10. Dimensions label
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(`${mapWidth}×${mapHeight} map${mapWidth * mapHeight > 1 ? 's' : ''} (${Math.round(cropW)}×${Math.round(cropH)}px)`, cx + cw / 2, cy - 6);
  }

  // ── Mouse helpers ────────────────────────────────────────────────────────────

  function canvasToCropCoords(mx: number, my: number): [number, number] {
    return [(mx - dispX) / scale, (my - dispY) / scale];
  }

  function hitHandle(mx: number, my: number): Handle {
    const cx = dispX + cropX * scale;
    const cy = dispY + cropY * scale;
    const cw = cropW * scale;
    const ch = cropH * scale;
    const hs = HANDLE_SIZE + 4;

    if (Math.abs(mx - cx)        <= hs && Math.abs(my - cy)        <= hs) return 'nw';
    if (Math.abs(mx - (cx + cw)) <= hs && Math.abs(my - cy)        <= hs) return 'ne';
    if (Math.abs(mx - cx)        <= hs && Math.abs(my - (cy + ch)) <= hs) return 'sw';
    if (Math.abs(mx - (cx + cw)) <= hs && Math.abs(my - (cy + ch)) <= hs) return 'se';

    // Inside crop rect = move
    if (mx >= cx && mx <= cx + cw && my >= cy && my <= cy + ch) return 'move';

    return 'none';
  }

  function getMousePos(e: MouseEvent | TouchEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    if (e instanceof MouseEvent) {
      return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
    } else {
      const t = e.touches[0];
      return [(t.clientX - rect.left) * scaleX, (t.clientY - rect.top) * scaleY];
    }
  }

  function onPointerDown(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    const [mx, my] = getMousePos(e);
    dragHandle = hitHandle(mx, my);
    if (dragHandle === 'none') return;
    dragStartMX = mx;
    dragStartMY = my;
    dragStartCrop = { x: cropX, y: cropY, w: cropW, h: cropH };
  }

  function onPointerMove(e: MouseEvent | TouchEvent) {
    if (!img) return;
    const [mx, my] = getMousePos(e);

    // Update cursor
    if (e instanceof MouseEvent && dragHandle === 'none') {
      const h = hitHandle(mx, my);
      canvas.style.cursor =
        h === 'nw' || h === 'se' ? 'nwse-resize' :
        h === 'ne' || h === 'sw' ? 'nesw-resize' :
        h === 'move' ? 'move' : 'crosshair';
    }

    if (dragHandle === 'none') return;
    e.preventDefault();

    const dx = (mx - dragStartMX) / scale; // in image px
    const dy = (my - dragStartMY) / scale;
    const aspect = mapWidth / mapHeight;
    const minSize = 32; // minimum crop dimension in image px

    const imgW = img.width;
    const imgH = img.height;

    if (dragHandle === 'move') {
      cropX = Math.max(0, Math.min(imgW - cropW, dragStartCrop.x + dx));
      cropY = Math.max(0, Math.min(imgH - cropH, dragStartCrop.y + dy));
    } else {
      // Corner resize — maintain aspect ratio
      let newW = dragStartCrop.w;
      let newH = dragStartCrop.h;
      let newX = dragStartCrop.x;
      let newY = dragStartCrop.y;

      if (dragHandle === 'se') {
        newW = Math.max(minSize, dragStartCrop.w + dx);
        newH = newW / aspect;
      } else if (dragHandle === 'nw') {
        newW = Math.max(minSize, dragStartCrop.w - dx);
        newH = newW / aspect;
        newX = dragStartCrop.x + dragStartCrop.w - newW;
        newY = dragStartCrop.y + dragStartCrop.h - newH;
      } else if (dragHandle === 'ne') {
        newW = Math.max(minSize, dragStartCrop.w + dx);
        newH = newW / aspect;
        newY = dragStartCrop.y + dragStartCrop.h - newH;
      } else if (dragHandle === 'sw') {
        newW = Math.max(minSize, dragStartCrop.w - dx);
        newH = newW / aspect;
        newX = dragStartCrop.x + dragStartCrop.w - newW;
      }

      // Clamp to image bounds
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);
      if (newX + newW > imgW) { newW = imgW - newX; newH = newW / aspect; }
      if (newY + newH > imgH) { newH = imgH - newY; newW = newH * aspect; }

      cropX = newX;
      cropY = newY;
      cropW = newW;
      cropH = newH;
    }

    draw();
  }

  function onPointerUp() {
    dragHandle = 'none';
  }

  // ── Confirm crop ─────────────────────────────────────────────────────────────

  function confirmCrop() {
    if (!img) return;

    const outW = 128 * mapWidth;
    const outH = 128 * mapHeight;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = outW;
    offCanvas.height = outH;
    const offCtx = offCanvas.getContext('2d')!;

    // Apply resize filter via canvas smoothing settings
    if (resizeFilter === 'nearest') {
      offCtx.imageSmoothingEnabled = false;
    } else {
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = resizeFilter === 'bilinear' ? 'medium' : 'high';
    }

    // Draw the crop region scaled to output size
    offCtx.drawImage(
      img,
      cropX, cropY, cropW, cropH,  // source rect (image coords)
      0, 0, outW, outH              // dest rect
    );

    const imageData = offCtx.getImageData(0, 0, outW, outH);
    dispatch('crop', { imageData, mapWidth, mapHeight });
  }

  function handleCancel() {
    dispatch('cancel');
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="cropper-wrap">
  <canvas
    bind:this={canvas}
    width={CANVAS_W}
    height={CANVAS_H}
    class="crop-canvas"
    on:mousedown={onPointerDown}
    on:mousemove={onPointerMove}
    on:mouseup={onPointerUp}
    on:mouseleave={onPointerUp}
    on:touchstart={onPointerDown}
    on:touchmove={onPointerMove}
    on:touchend={onPointerUp}
  ></canvas>

  <div class="crop-hint">
    Drag inside to move · Drag corners to resize · Grid lines = 128px (1 map)
  </div>

  <div class="crop-actions">
    <button class="btn-cancel" on:click={handleCancel}>Cancel</button>
    <button class="btn-confirm" on:click={confirmCrop}>✂️ Confirm Crop</button>
  </div>
</div>

<style>
  .cropper-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .crop-canvas {
    display: block;
    max-width: 100%;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    cursor: crosshair;
    touch-action: none;
  }

  .crop-hint {
    font-size: 11px;
    color: #888;
    text-align: center;
  }

  .crop-actions {
    display: flex;
    gap: 10px;
  }

  .btn-cancel,
  .btn-confirm {
    padding: 8px 20px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
  }

  .btn-cancel {
    background: #333;
    color: #aaa;
  }

  .btn-confirm {
    background: #3ba55c;
    color: #fff;
  }

  .btn-cancel:hover,
  .btn-confirm:hover {
    opacity: 0.85;
  }
</style>
