<!-- 环形进度（瓦斯抽采在抽率） -->
<template>
  <svg class="ring" viewBox="0 0 92 92">
    <circle
      cx="46"
      cy="46"
      :r="R"
      fill="none"
      stroke="rgba(120,170,230,.15)"
      stroke-width="7"
    />
    <circle
      cx="46"
      cy="46"
      :r="R"
      fill="none"
      :stroke="color"
      stroke-width="7"
      stroke-linecap="round"
      :stroke-dasharray="`${C * pct} ${C}`"
      transform="rotate(-90 46 46)"
      :style="{ filter: `drop-shadow(0 0 4px ${color})` }"
    />
    <text x="46" y="45" class="v" font-size="22">
      {{ Math.round(pct * 100) }}%
    </text>
    <text x="46" y="63" class="l" font-size="11">{{ label }}</text>
  </svg>
</template>

<script setup>
  defineProps({
    pct: { type: Number, required: true },
    label: { type: String, default: "" },
    color: { type: String, default: "#c6ff5a" }
  })
  const R = 39
  const C = 2 * Math.PI * R
</script>

<style lang="scss" scoped>
  .ring {
    flex: none;
    width: 92px;
    height: 92px;
  }

  text {
    text-anchor: middle;
  }

  /* 字号写在 SVG 属性里（见 BarChart.vue） */
  .v {
    font-family: "DIN", sans-serif;
    fill: #fff;
  }

  .l {
    fill: #8ea6c8;
  }
</style>
