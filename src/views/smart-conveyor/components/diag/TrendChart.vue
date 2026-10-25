<!--
  D2 温振趋势：选中劣化设备近 7 天的逐小时读数（托辊看温度、电机 / 减速机看振动），
  三级 / 二级预警线（虚线）和首次越线的时刻（竖线）；单系列一种颜色、单轴
-->
<template>
  <Panel no="D2" title="温振趋势 · 7 天" en="TREND">
    <div v-if="tr" class="tc-h">
      <span>{{ tr.where }}</span
      ><b
        >{{ fmt(last, 1) }}<i>{{ trend.metric.u }}</i></b
      ><em>{{ trend.metric.name }}</em>
    </div>
    <svg
      v-if="tr"
      :style="{ width: rem(W), height: rem(H + 16) }"
      :viewBox="`0 0 ${W} ${H + 16}`"
    >
      <rect x="0" y="0" :width="W" :height="H" fill="rgba(255,255,255,0.015)" />
      <g v-for="d in 8" :key="d">
        <line
          :x1="((d - 1) / 7) * W"
          :x2="((d - 1) / 7) * W"
          y1="0"
          :y2="H"
          stroke="var(--hair-soft)"
        />
      </g>
      <line
        x1="0"
        :x2="W"
        :y1="y(trend.warn)"
        :y2="y(trend.warn)"
        class="tc-th l3"
      />
      <line
        x1="0"
        :x2="W"
        :y1="y(trend.alarm)"
        :y2="y(trend.alarm)"
        class="tc-th l2"
      />
      <text :x="W - 2" :y="y(trend.warn) - 3" class="ax" text-anchor="end">
        三级 {{ fmt(trend.warn, 1) }}
      </text>
      <text :x="W - 2" :y="y(trend.alarm) - 3" class="ax" text-anchor="end">
        二级 {{ fmt(trend.alarm, 1) }}
      </text>
      <path
        :d="`${path}L${W},${H}L0,${H}Z`"
        fill="var(--data)"
        opacity="0.08"
        stroke="none"
      />
      <path :d="path" stroke="var(--data)" stroke-width="1.6" />
      <g v-for="m in marks" :key="m.name">
        <line
          :x1="m.x"
          :x2="m.x"
          y1="0"
          :y2="H"
          :stroke="`var(${m.c})`"
          stroke-dasharray="3 2"
        />
        <text :x="m.x + 3" y="10" class="ax">{{ m.name }} {{ md(m.t) }}</text>
      </g>
      <text x="0" :y="H + 13" class="ax">{{ md(trend.pts[0].t) }}</text>
      <text :x="W" :y="H + 13" class="ax" text-anchor="end">现在</text>
    </svg>
    <p v-else class="none">选择左上的劣化设备</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, md, rem } from "../ui.js"
  import { trendOf } from "../../store/diag.js"

  const props = defineProps({
    f: { type: Object, required: true },
    tr: { type: Object, default: null }
  })
  const sim = inject("sim")
  // 图区 396 × 132（设计稿 px）
  const W = 396
  const H = 132

  // 趋势按小时生成，跟着整点刷新就够了
  const hourKey = computed(() => Math.floor(props.f.ms / 3600000))
  const trend = computed(() => {
    void hourKey.value
    return props.tr ? trendOf(sim, props.tr, props.f.ms) : null
  })
  const range = computed(() => {
    const vs = trend.value.pts.map((p) => p.v)
    const lo = Math.min(...vs, trend.value.warn) - 1
    const hi = Math.max(...vs, trend.value.alarm) + 1
    return [lo, hi]
  })
  const y = (v) =>
    H -
    ((v - range.value[0]) / (range.value[1] - range.value[0])) * (H - 14) -
    2
  const x = (t) =>
    ((t - trend.value.pts[0].t) /
      (trend.value.pts.at(-1).t - trend.value.pts[0].t)) *
    W
  const path = computed(() =>
    trend.value.pts
      .map(
        (p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`
      )
      .join("")
  )
  const last = computed(() => trend.value.pts.at(-1).v)
  // 首次越过三级 / 二级预警线的时刻（在 7 天窗口里才画）
  const marks = computed(() =>
    [
      { name: "三级", t: props.tr.tWarn, c: "--l3" },
      { name: "二级", t: props.tr.tAlarm, c: "--l2" }
    ]
      .filter((m) => m.t >= trend.value.pts[0].t && m.t <= props.f.ms)
      .map((m) => ({ ...m, x: x(m.t) }))
  )
</script>
