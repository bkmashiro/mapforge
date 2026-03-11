<script lang="ts">
  export let text: string;
  // 'top' appears above, 'right' appears to the right (useful in narrow panels)
  export let position: 'top' | 'right' | 'bottom' = 'top';
</script>

<span class="tip-wrap">
  <span class="tip-icon" aria-label="Info">ⓘ</span>
  <span class="tip-bubble {position}" role="tooltip">{text}</span>
</span>

<style>
  .tip-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  .tip-icon {
    cursor: help;
    color: #666;
    font-size: 11px;
    line-height: 1;
    user-select: none;
    padding: 2px;
    border-radius: 50%;
    transition: color 0.1s;
  }

  .tip-wrap:hover .tip-icon {
    color: #aaa;
  }

  .tip-bubble {
    position: absolute;
    background: #111118;
    border: 1px solid #383848;
    color: #d8d8f0;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.5;
    padding: 7px 10px;
    border-radius: 6px;
    width: 230px;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    white-space: normal;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }

  .tip-wrap:hover .tip-bubble {
    opacity: 1;
  }

  /* top: bubble above the icon */
  .tip-bubble.top {
    bottom: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tip-bubble.top::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #383848;
  }

  /* right: bubble to the right of icon */
  .tip-bubble.right {
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
  }

  .tip-bubble.right::after {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 5px solid transparent;
    border-right-color: #383848;
  }

  /* bottom: bubble below icon */
  .tip-bubble.bottom {
    top: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tip-bubble.bottom::after {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-bottom-color: #383848;
  }
</style>
