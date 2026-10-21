<!-- 全场逐月 NDVI：2026 实线、2025 同期虚线，当前月份高亮（真实数据） -->
<template>
  <svg :viewBox="`0 0 ${w} ${h}`" class="chart">
    <defs>
      <linearGradient id="ranch-ndvi-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b7bd6" stop-opacity="0.35" />
        <stop offset="1" stop-color="#2b7bd6" stop-opacity="0" />
      </linearGradient>
    </defs>
    <g v-for="v in [0.2, 0.4, 0.6, 0.8]" :key="v">
      <line
        :x1="pad[0]"
        :x2="w - pad[1]"
        :y1="ys(v)"
        :y2="ys(v)"
        class="grid"
      />
      <text :x="pad[0] - 6" :y="ys(v) + 4" class="tick" text-anchor="end">
        {{ v.toFixed(1) }}
      </text>
    </g>
    <path :d="area" fill="url(#ranch-ndvi-g)" />
    <path
      :d="line(y25)"
      fill="none"
      stroke="#93a5b5"
      stroke-width="1.6"
      stroke-dasharray="4 4"
    />
    <path :d="line(y26)" fill="none" stroke="#2b7bd6" stroke-width="2.4" />
    <text
      v-for="(m, i) in months"
      :key="m"
      :x="xs(i)"
      :y="h - 5"
      class="tick"
      :class="{ on: i === mi }"
      text-anchor="middle"
    >
      {{ m }}月
    </text>
    <circle
      v-if="mi >= 0"
      :cx="xs(mi)"
      :cy="ys(y26[mi])"
      r="5"
      fill="#2b7bd6"
      stroke="#fff"
      stroke-width="2"
    />
  </svg>
</template>

<script setup>
  const props = defineProps({
    months: { type: Array, default: () => [] },
    y26: { type: Array, default: () => [] },
    y25: { type: Array, default: () => [] },
    month: { type: Number, default: 7 },
    w: { type: Number, default: 250 },
    h: { type: Number, default: 116 }
  })
  const pad = [30, 10, 22, 12]
  const lo = 0.1
  const hi = 0.8
  const xs = (i) =>
    pad[0] + (i / (props.months.length - 1)) * (props.w - pad[0] - pad[1])
  const ys = (v) =>
    pad[3] + (1 - (v - lo) / (hi - lo)) * (props.h - pad[2] - pad[3])
  const line = (arr) =>
    arr
      .map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)
      .join(" ")
  const mi = computed(() => props.months.indexOf(Math.round(props.month)))
  const area = computed(
    () =>
      `${line(props.y26)} L${xs(props.months.length - 1)},${props.h - pad[2]} L${xs(0)},${props.h - pad[2]} Z`
  )
</script>
