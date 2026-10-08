<!--
  环形占比图（纯 SVG）：每段一条圆弧，段间留小缺口；中心放总数与标题
-->
<template>
  <!-- 不写 width / height 属性：属性里的 px 不会被 pxtorem 转换，尺寸由父元素的样式决定 -->
  <svg class="ring-chart" :viewBox="`0 0 ${size} ${size}`">
    <!-- 外圈细刻度 -->
    <circle :cx="c" :cy="c" :r="r + 9" class="track-outer" />
    <circle :cx="c" :cy="c" :r="r" class="track" :stroke-width="width" />
    <circle
      v-for="seg in segments"
      :key="seg.name"
      :cx="c"
      :cy="c"
      :r="r"
      fill="none"
      :stroke="seg.color"
      :stroke-width="width"
      :stroke-dasharray="`${seg.len} ${circ - seg.len}`"
      :stroke-dashoffset="-seg.offset"
      :transform="`rotate(-90 ${c} ${c})`"
    />
    <!-- 字号写成 SVG 属性（用户单位，随 viewBox 缩放）；写在样式里会被转成 rem，再叠一次 viewBox 缩放 -->
    <text :x="c" :y="c + 2" class="total" font-size="22">{{ totalText }}</text>
    <text :x="c" :y="c + 22" class="label" font-size="11">{{ label }}</text>
  </svg>
</template>

<script setup>
  const props = defineProps({
    /** [{ name, value, color }] */
    items: { type: Array, default: () => [] },
    size: { type: Number, default: 128 },
    width: { type: Number, default: 10 },
    label: { type: String, default: "" },
    /** 中心数字，不传则显示各段之和 */
    total: { type: [String, Number], default: null }
  })

  const c = computed(() => props.size / 2)
  const r = computed(() => props.size / 2 - props.width / 2 - 12)
  const circ = computed(() => 2 * Math.PI * r.value)
  const sum = computed(() => props.items.reduce((s, i) => s + i.value, 0) || 1)
  const totalText = computed(() =>
    props.total != null ? props.total : sum.value.toLocaleString("en-US")
  )

  /** 段间缺口（弧长） */
  const GAP = 2.5
  const segments = computed(() => {
    let offset = 0
    return props.items.map((it) => {
      const full = (it.value / sum.value) * circ.value
      const seg = { ...it, len: Math.max(full - GAP, 0.5), offset }
      offset += full
      return seg
    })
  })
</script>

<style lang="scss" scoped>
  .ring-chart {
    display: block;
    width: 100%;
    height: 100%;
  }

  .track {
    fill: none;
    stroke: rgba(60, 110, 180, 0.18);
  }

  .track-outer {
    fill: none;
    stroke: rgba(74, 144, 226, 0.35);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }

  .total {
    font-family: "DIN", sans-serif;
    fill: #fff;
    text-anchor: middle;
  }

  .label {
    fill: #8aa0bd;
    text-anchor: middle;
  }
</style>
