<!--
  折线图（SVG，按 dataviz 的规则）：2 px 线、末端 ≥ 8 px 圆点带 2 px 表面色描边、直接标注、弱化的网格、
  "现在"竖线，现在之后的区域淡化，可选虚线预测。数据是 61 个等间隔点（每分钟一个），窗口 = 现在 ± 30 分钟。
-->
<template>
  <svg :width="w" :height="h" :viewBox="`0 0 ${w} ${h}`">
    <g v-for="t in yTicks" :key="'y' + t">
      <line
        :x1="padL"
        :x2="w - padR"
        :y1="Y(t)"
        :y2="Y(t)"
        stroke="rgba(243,235,221,.09)"
      />
      <text
        :x="padL - 6"
        :y="Y(t) + 4"
        fill="#8f8372"
        font-size="11"
        text-anchor="end"
        font-family="DIN"
      >
        {{ t }}
      </text>
    </g>
    <text
      v-for="i in [0, 10, 20, 30, 40, 50, 60]"
      :key="'x' + i"
      :x="X(i)"
      :y="h - 5"
      fill="#8f8372"
      font-size="11"
      text-anchor="middle"
      font-family="DIN"
    >
      {{ labelAt(i) }}
    </text>
    <rect
      :x="X(nowIdx)"
      :y="padT"
      :width="Math.max(0, w - padR - X(nowIdx))"
      :height="ih"
      fill="rgba(255,255,255,.025)"
    />
    <g v-for="r in refs" :key="r.label">
      <line
        :x1="padL"
        :x2="w - padR"
        :y1="Y(r.y)"
        :y2="Y(r.y)"
        :stroke="r.color"
        stroke-dasharray="5 4"
        stroke-width="1.4"
      />
      <text :x="padL + 4" :y="Y(r.y) - 4" :fill="r.color" font-size="11">
        {{ r.label }}
      </text>
    </g>
    <g v-for="(s, k) in series" :key="k">
      <polyline
        :points="past(s)"
        fill="none"
        :stroke="s.color"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
        :stroke-dasharray="s.dash ? '6 4' : null"
      />
      <polyline
        v-if="s.future"
        :points="future(s)"
        fill="none"
        :stroke="s.color"
        stroke-opacity=".5"
        stroke-width="2"
        stroke-dasharray="2 5"
        stroke-linecap="round"
      />
      <circle
        :cx="X(nowIdx)"
        :cy="Y(s.data[nowIdx])"
        r="5"
        :fill="s.color"
        stroke="#1a1510"
        stroke-width="2"
      />
      <text
        :x="X(nowIdx) + 10"
        :y="endY[k] + 4"
        fill="#f3ebdd"
        font-size="12"
        font-family="DIN"
      >
        {{ s.label }}
      </text>
    </g>
    <line
      :x1="X(nowIdx)"
      :x2="X(nowIdx)"
      :y1="padT"
      :y2="h - padB"
      stroke="#ffd27a"
      stroke-opacity=".7"
      stroke-width="1.2"
    />
    <text
      v-for="n in notes"
      :key="n.text"
      :x="X(n.i)"
      :y="n.y"
      :fill="n.color"
      font-size="11"
      :text-anchor="n.anchor || 'middle'"
    >
      {{ n.text }}
    </text>
  </svg>
</template>

<script setup>
  import { computed } from "vue"
  import { clock } from "../sim/simulator.js"

  const props = defineProps({
    w: { type: Number, default: 420 },
    h: { type: Number, default: 130 },
    series: { type: Array, required: true }, // [{color, data[61], label, dash, future}]
    yMin: { type: Number, required: true },
    yMax: { type: Number, required: true },
    yTicks: { type: Array, required: true },
    nowIdx: { type: Number, default: 30 },
    t0: { type: Number, required: true }, // 窗口起点（仿真分钟）
    refs: { type: Array, default: () => [] },
    notes: { type: Array, default: () => [] },
    padL: { type: Number, default: 34 },
    padR: { type: Number, default: 62 },
    padT: { type: Number, default: 8 },
    padB: { type: Number, default: 20 }
  })

  const iw = computed(() => props.w - props.padL - props.padR)
  const ih = computed(() => props.h - props.padT - props.padB)
  const X = (i) => props.padL + (i / 60) * iw.value
  const Y = (v) =>
    props.padT + (1 - (v - props.yMin) / (props.yMax - props.yMin)) * ih.value
  const labelAt = (i) => clock((((props.t0 + i) % 1440) + 1440) % 1440)
  const pts = (s, a, b) =>
    s.data
      .slice(a, b)
      .map((v, k) => `${X(a + k)},${Y(v)}`)
      .join(" ")
  const past = (s) => pts(s, 0, props.nowIdx + 1)
  const future = (s) => pts(s, props.nowIdx, 61)
  // 末端数字标签按 y 排序后错开，避免互相压住
  const endY = computed(() => {
    const ends = props.series
      .map((s, k) => ({ k, y: Y(s.data[props.nowIdx]) }))
      .sort((a, b) => a.y - b.y)
    const out = []
    ends.forEach((e, n) => {
      out[e.k] =
        n && e.y < out[ends[n - 1].k] + 13 ? out[ends[n - 1].k] + 13 : e.y
    })
    return out
  })
</script>
