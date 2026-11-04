<!--
  线性图标（设计稿的 SVG 图标集，统一 24×24 描边，不用 emoji）
  用法：<Icon name="drone" />；size 缺省 17 px，颜色由 stroke 决定（默认香槟金）。
-->
<template>
  <svg
    class="ic"
    :style="{
      width: size + 'px',
      height: size + 'px',
      ...(fill ? { fill: 'currentColor', stroke: 'none' } : {})
    }"
    viewBox="0 0 24 24"
    v-html="PATHS[name]"
  ></svg>
</template>

<script setup>
  defineProps({
    name: { type: String, required: true },
    size: { type: Number, default: 17 },
    fill: { type: Boolean, default: false }
  })

  const PATHS = {
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shieldCheck:
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    flame:
      '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    person:
      '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    car: '<path d="M5 17h14 M3 13l2-6h14l2 6v4H3z"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
    building:
      '<path d="M3 21h18 M5 21V7l7-4 7 4v14 M9 9h2 M13 9h2 M9 13h2 M13 13h2 M9 17h2 M13 17h2"/>',
    fence: '<path d="M4 20V6 M9 20V6 M14 20V6 M19 20V6 M2 10h20 M2 16h20"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0 M1.42 9a16 16 0 0 1 21.16 0 M8.53 16.11a6 6 0 0 1 6.95 0 M12 20h.01"/>',
    battery: '<path d="M2 8h16v8H2z M22 11v2"/>',
    drone:
      '<path d="M5 5l14 14M19 5L5 19"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>',
    list: '<path d="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01"/>',
    flow: '<path d="M4 6h6v4H4z M14 14h6v4h-6z M10 8h4a2 2 0 0 1 2 2v4"/>',
    mission:
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M7 5h4v14H7z M13 5h4v14h-4z"/>',
    swap: '<path d="M7 7h12l-3-3 M17 17H5l3 3"/>',
    eye: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    logo: '<path d="M5 5l14 14M19 5L5 19"/><circle cx="5" cy="5" r="2.4"/><circle cx="19" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><circle cx="12" cy="12" r="2.2"/>'
  }
</script>

<style>
  .community-page svg.ic {
    fill: none;
    stroke: var(--gold);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
  }
</style>
