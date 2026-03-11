<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  interface SelectionRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export let image: HTMLImageElement | null = null;
  export let mapWidth = 1;
  export let mapHeight = 1;
  export let selection: SelectionRect | null = null;

  const dispatch = createEventDispatcher<{ selectionChange: SelectionRect }>();

  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null = null;

  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 540;
  const HANDLE_SIZE = 8;
  const SNAP_STEP = 128;

  type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'none';

  let displayX = 0;
  let displayY = 0;
  let displayWidth = 0;
  let displayHeight = 0;
  let scale = 1;

  let activeHandle: Handle = 'none';
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragStartSelection: SelectionRect | null = null;

  onMount(() => {
    context = canvas.getContext('2d');
    draw();
  });

  $: if (context) {
    draw();
  }

  function computeDisplayRect() {
    if (!image) return;

    const scaleX = CANVAS_WIDTH / image.width;
    const scaleY = CANVAS_HEIGHT / image.height;
    scale = Math.min(scaleX, scaleY);
    displayWidth = image.width * scale;
    displayHeight = image.height * scale;
    displayX = (CANVAS_WIDTH - displayWidth) / 2;
    displayY = (CANVAS_HEIGHT - displayHeight) / 2;
  }

  function supportsSnap() {
    if (!image) return false;
    return image.width >= mapWidth * SNAP_STEP && image.height >= mapHeight * SNAP_STEP;
  }

  function clampSelection(rect: SelectionRect): SelectionRect {
    if (!image) return rect;

    const aspect = mapWidth / mapHeight;
    let width = Math.max(16, rect.width);
    let height = width / aspect;

    if (height > image.height) {
      height = image.height;
      width = height * aspect;
    }

    if (width > image.width) {
      width = image.width;
      height = width / aspect;
    }

    let x = rect.x;
    let y = rect.y;

    if (supportsSnap()) {
      const baseWidth = mapWidth * SNAP_STEP;
      const baseHeight = mapHeight * SNAP_STEP;
      const maxUnits = Math.max(1, Math.floor(Math.min(image.width / baseWidth, image.height / baseHeight)));
      const units = Math.max(1, Math.min(maxUnits, Math.round(width / baseWidth)));
      width = baseWidth * units;
      height = baseHeight * units;
      x = Math.round(x / SNAP_STEP) * SNAP_STEP;
      y = Math.round(y / SNAP_STEP) * SNAP_STEP;
    }

    x = Math.max(0, Math.min(image.width - width, x));
    y = Math.max(0, Math.min(image.height - height, y));

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function toCanvasRect(rect: SelectionRect) {
    return {
      x: displayX + rect.x * scale,
      y: displayY + rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale
    };
  }

  function handlePoints(rect: { x: number; y: number; width: number; height: number }) {
    const midX = rect.x + rect.width / 2;
    const midY = rect.y + rect.height / 2;

    return [
      { type: 'nw' as const, x: rect.x, y: rect.y },
      { type: 'n' as const, x: midX, y: rect.y },
      { type: 'ne' as const, x: rect.x + rect.width, y: rect.y },
      { type: 'e' as const, x: rect.x + rect.width, y: midY },
      { type: 'se' as const, x: rect.x + rect.width, y: rect.y + rect.height },
      { type: 's' as const, x: midX, y: rect.y + rect.height },
      { type: 'sw' as const, x: rect.x, y: rect.y + rect.height },
      { type: 'w' as const, x: rect.x, y: midY }
    ];
  }

  function draw() {
    if (!context) return;

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = '#111827';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (!image) return;

    computeDisplayRect();
    context.drawImage(image, displayX, displayY, displayWidth, displayHeight);

    if (!selection) return;

    const rect = toCanvasRect(selection);

    context.save();
    context.fillStyle = 'rgba(15, 23, 42, 0.7)';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.clearRect(rect.x, rect.y, rect.width, rect.height);
    context.restore();

    context.save();
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
    context.drawImage(image, displayX, displayY, displayWidth, displayHeight);
    context.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    context.lineWidth = 1;
    context.setLineDash([6, 4]);

    for (let col = 1; col < mapWidth; col += 1) {
      const x = rect.x + (rect.width * col) / mapWidth;
      context.beginPath();
      context.moveTo(x, rect.y);
      context.lineTo(x, rect.y + rect.height);
      context.stroke();
    }

    for (let row = 1; row < mapHeight; row += 1) {
      const y = rect.y + (rect.height * row) / mapHeight;
      context.beginPath();
      context.moveTo(rect.x, y);
      context.lineTo(rect.x + rect.width, y);
      context.stroke();
    }

    context.restore();

    context.setLineDash([]);
    context.strokeStyle = '#fff7b2';
    context.lineWidth = 2;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.lineWidth = 1;
    context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

    for (const handle of handlePoints(rect)) {
      context.fillStyle = '#f8fafc';
      context.strokeStyle = '#0f172a';
      context.lineWidth = 1.5;
      context.beginPath();
      context.rect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      context.fill();
      context.stroke();
    }
  }

  function hitHandle(mouseX: number, mouseY: number): Handle {
    if (!selection) return 'none';

    const rect = toCanvasRect(selection);
    for (const handle of handlePoints(rect)) {
      if (Math.abs(mouseX - handle.x) <= HANDLE_SIZE && Math.abs(mouseY - handle.y) <= HANDLE_SIZE) {
        return handle.type;
      }
    }

    if (
      mouseX >= rect.x && mouseX <= rect.x + rect.width &&
      mouseY >= rect.y && mouseY <= rect.y + rect.height
    ) {
      return 'move';
    }

    return 'none';
  }

  function mousePosition(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function setCursor(handle: Handle) {
    canvas.style.cursor =
      handle === 'move' ? 'move' :
      handle === 'n' || handle === 's' ? 'ns-resize' :
      handle === 'e' || handle === 'w' ? 'ew-resize' :
      handle === 'nw' || handle === 'se' ? 'nwse-resize' :
      handle === 'ne' || handle === 'sw' ? 'nesw-resize' :
      'crosshair';
  }

  function onMouseDown(event: MouseEvent) {
    if (!selection) return;
    const { x, y } = mousePosition(event);
    const handle = hitHandle(x, y);
    if (handle === 'none') return;

    activeHandle = handle;
    dragStartMouseX = x;
    dragStartMouseY = y;
    dragStartSelection = { ...selection };
    setCursor(handle);
  }

  function onMouseMove(event: MouseEvent) {
    if (!image || !selection) return;

    const { x, y } = mousePosition(event);

    if (activeHandle === 'none') {
      setCursor(hitHandle(x, y));
      return;
    }

    if (!dragStartSelection) return;

    const deltaX = (x - dragStartMouseX) / scale;
    const deltaY = (y - dragStartMouseY) / scale;
    const start = dragStartSelection;
    const aspect = mapWidth / mapHeight;

    let next: SelectionRect = { ...start };

    if (activeHandle === 'move') {
      next.x = start.x + deltaX;
      next.y = start.y + deltaY;
    } else if (activeHandle === 'e') {
      next.width = start.width + deltaX;
      next.height = next.width / aspect;
      next.y = start.y + (start.height - next.height) / 2;
    } else if (activeHandle === 'w') {
      next.width = start.width - deltaX;
      next.height = next.width / aspect;
      next.x = start.x + start.width - next.width;
      next.y = start.y + (start.height - next.height) / 2;
    } else if (activeHandle === 's') {
      next.height = start.height + deltaY;
      next.width = next.height * aspect;
      next.x = start.x + (start.width - next.width) / 2;
    } else if (activeHandle === 'n') {
      next.height = start.height - deltaY;
      next.width = next.height * aspect;
      next.x = start.x + (start.width - next.width) / 2;
      next.y = start.y + start.height - next.height;
    } else if (activeHandle === 'se') {
      next.width = start.width + deltaX;
      next.height = next.width / aspect;
    } else if (activeHandle === 'sw') {
      next.width = start.width - deltaX;
      next.height = next.width / aspect;
      next.x = start.x + start.width - next.width;
    } else if (activeHandle === 'ne') {
      next.width = start.width + deltaX;
      next.height = next.width / aspect;
      next.y = start.y + start.height - next.height;
    } else if (activeHandle === 'nw') {
      next.width = start.width - deltaX;
      next.height = next.width / aspect;
      next.x = start.x + start.width - next.width;
      next.y = start.y + start.height - next.height;
    }

    dispatch('selectionChange', clampSelection(next));
  }

  function onMouseUp() {
    activeHandle = 'none';
    dragStartSelection = null;
    setCursor('none');
  }
</script>

<canvas
  bind:this={canvas}
  width={CANVAS_WIDTH}
  height={CANVAS_HEIGHT}
  class="workspace-canvas"
  on:mousedown={onMouseDown}
  on:mousemove={onMouseMove}
  on:mouseup={onMouseUp}
  on:mouseleave={onMouseUp}
></canvas>

<style>
  .workspace-canvas {
    display: block;
    width: 100%;
    max-width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: #111827;
    touch-action: none;
  }
</style>
