<!-- 折线面积图（24 h 曲线），带预警 / 断电阈值虚线，末端圆点表示当前值 -->
<template>
  <svg class="area-chart" :viewBox="`0 0 ${W} ${H}`">
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="color" stop-opacity=".35" />
        <stop offset="1" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <g v-for="k in 5" :key="k">
      <line
        :x1="L0"
        :x2="W"
        :y1="Y(tick(k))"
        :y2="Y(tick(k))"
        stroke="rgba(120,170,230,.12)"
      />
      <text x="0" :y="Y(tick(k)) + 4" class="ax" font-size="10">
        {{ tick(k).toFixed(1) }}
      </text>
    </g>
    <g v-for="l in lines" :key="l.t">
      <line
        :x1="L0"
        :x2="W"
        :y1="Y(l.v)"
        :y2="Y(l.v)"
        :stroke="l.c"
        stroke-dasharray="5 4"
        stroke-width="1.2"
      />
      <text :x="W - 2" :y="Y(l.v) - 4" :fill="l.c" class="th" font-size="11">
        {{ l.t }}
      </text>
    </g>
    <polygon
      :points="`${L0},${BASE} ${pts} ${X(values.length - 1)},${BASE}`"
      :fill="`url(#${gid})`"
    />
    <polyline :points="pts" fill="none" :stroke="color" stroke-width="1.8" />
    <circle
      :cx="X(values.length - 1)"
      :cy="Y(last)"
      r="8"
      :fill="color"
      opacity=".25"
    />
    <circle :cx="X(values.length - 1)" :cy="Y(last)" r="4" :fill="color" />
    <text
      v-for="[i, t] in xlabels"
      :key="t"
      :x="X(i)"
      :y="H - 3"
      class="ax"
      font-size="10"
      :text-anchor="i === values.length - 1 ? 'end' : 'middle'"
    >
      {{ t }}
    </text>
  </svg>
</template>

<script setup>
  const props = defineProps({
    values: { type: Array, required: true },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 1 },
    /** 阈值线 [{ v, c, t }] */
    lines: { type: Array, default: () => [] },
    /** 横轴标签 [[下标, 文字]] */
    xlabels: { type: Array, default: () => [] },
    color: { type: String, default: "#ffcf3a" }
  })
  const W = 370
  const H = 112
  const TOP = 8
  const BASE = H - 18
  const L0 = 26
  const gid = `area-${Math.random().toString(36).slice(2, 8)}`

  const X = (i) => L0 + (i * (W - L0 - 4)) / (props.values.length - 1)
  const Y = (v) =>
    BASE - ((v - props.min) / (props.max - props.min)) * (BASE - TOP)
  const tick = (k) => props.min + ((props.max - props.min) * (k - 1)) / 4
  const pts = computed(() =>
    props.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")
  )
  const last = computed(() => props.values[props.values.length - 1])
</script>

<style lang="scss" scoped>
  .area-chart {
    display: block;
    width: 100%;
    height: auto;
  }

  /* 字号写在 SVG 属性里（见 BarChart.vue） */
  .ax {
    font-family: "DIN", sans-serif;
    fill: #6f87a8;
  }

  .th {
    text-anchor: end;
  }
</style>
