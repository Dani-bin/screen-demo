<!--
  24 点面积折线图（纯 SVG）：渐变填充 + 当前时刻游标 + 横轴刻度
  尺寸由父元素样式决定（viewBox 固定），字号写成 SVG 属性，避免 pxtorem 二次缩放
-->
<template>
  <svg
    class="area-chart"
    :viewBox="`0 0 ${W} ${H + 18}`"
    preserveAspectRatio="none"
  >
    <defs>
      <linearGradient :id="gid" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" :stop-color="color" stop-opacity="0.45" />
        <stop offset="1" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <line
      v-for="t in [0.25, 0.5, 0.75]"
      :key="t"
      x1="0"
      :x2="W"
      :y1="H * t"
      :y2="H * t"
      class="grid"
    />
    <path :d="area" :fill="`url(#${gid})`" />
    <path :d="line" fill="none" :stroke="color" stroke-width="2" />
    <template v-if="cursor != null">
      <line
        :x1="pts[cursor][0]"
        :x2="pts[cursor][0]"
        y1="0"
        :y2="H"
        class="cur"
      />
      <circle :cx="pts[cursor][0]" :cy="pts[cursor][1]" r="4" fill="#ffc65a" />
    </template>
    <text
      v-for="(t, i) in ticks"
      :key="t"
      :x="(i / (ticks.length - 1)) * W"
      :y="H + 15"
      font-size="11"
      :text-anchor="
        i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
      "
    >
      {{ t }}
    </text>
  </svg>
</template>

<script setup>
  const props = defineProps({
    values: { type: Array, required: true },
    color: { type: String, default: "#2de2e6" },
    /** 游标所在下标（当前小时） */
    cursor: { type: Number, default: null },
    ticks: {
      type: Array,
      default: () => ["00:00", "06:00", "12:00", "18:00", "24:00"]
    },
    /** 纵轴从 0 起（人数、能耗）；false 时按数据最小、最大值上下留白（温度、压力这类变化幅度小的读数） */
    zero: { type: Boolean, default: true }
  })

  const W = 392
  const H = 100
  const gid = `ac${Math.random().toString(36).slice(2, 8)}`
  const pts = computed(() => {
    const hi = Math.max(...props.values)
    const lo = props.zero ? 0 : Math.min(...props.values)
    const pad = props.zero ? hi * 0.15 : (hi - lo) * 0.35 || 1
    const top = hi + pad
    const bot = props.zero ? 0 : lo - pad
    return props.values.map((v, i) => [
      (i / (props.values.length - 1)) * W,
      H - ((v - bot) / (top - bot || 1)) * H
    ])
  })
  const line = computed(() =>
    pts.value
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(" ")
  )
  const area = computed(() => `${line.value} L${W} ${H} L0 ${H} Z`)
</script>

<style lang="scss" scoped>
  .area-chart {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .grid {
    stroke: rgba(74, 144, 226, 0.15);
    stroke-dasharray: 3 4;
  }

  .cur {
    stroke: #ffc65a;
    stroke-dasharray: 2 3;
  }

  text {
    fill: #7f93ad;
    font-family: "DIN", sans-serif;
  }
</style>
