<!-- 喇叭图标（叫号条、语音开关共用），颜色跟随 currentColor -->
<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 9h4l6-5v16l-6-5H3z" fill="currentColor" />
    <path
      v-if="!muted"
      d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <path
      v-else
      d="M16.5 9.5l5 5M21.5 9.5l-5 5"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup>
  defineProps({ muted: { type: Boolean, default: false } })
</script>
