<!-- A7 告警趋势：近 30 天每天的告警条数，按一到四级堆叠；可按四维筛选（同一套等级色，不重新上色） -->
<template>
  <Panel no="A7" title="告警趋势 · 30 天" en="TREND">
    <template #tools>
      <div class="seg mini">
        <a
          v-for="d in DIMS"
          :key="d[0]"
          :class="{ on: dim === d[0] }"
          @click="dim = d[0]"
          >{{ d[1] }}</a
        >
      </div>
    </template>
    <svg
      :style="{ width: rem(W), height: rem(H + 16) }"
      :viewBox="`0 0 ${W} ${H + 16}`"
    >
      <line
        v-for="g in grid"
        :key="g"
        x1="0"
        :x2="W"
        :y1="y(g)"
        :y2="y(g)"
        stroke="var(--hair-soft)"
      />
      <text v-for="g in grid" :key="'t' + g" x="0" :y="y(g) - 2" class="ax">
        {{ g }}
      </text>
      <g v-for="(d, i) in daysView" :key="d.t">
        <rect
          v-for="s in d.stack"
          :key="s.l"
          :x="i * bw + 1"
          :y="s.y"
          :width="bw - 2"
          :height="Math.max(0, s.h - 1)"
          :fill="`var(${LV_VAR[s.l]})`"
        >
          <title>{{ md(d.t) }} {{ LV[s.l] }} {{ s.n }} 条</title>
        </rect>
      </g>
      <text x="0" :y="H + 13" class="ax">{{ md(days[0].t) }}</text>
      <text :x="W" :y="H + 13" class="ax" text-anchor="end">今天</text>
    </svg>
    <ul class="tr-lg">
      <li
        v-for="l in [0, 1, 2, 3]"
        :key="l"
        :style="{ '--c': `var(${LV_VAR[l]})` }"
      >
        <i></i>{{ LV[l] }} {{ totals[l] }}
      </li>
      <li class="avg">日均 {{ fmt(avg, 1) }} 条</li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { LV, LV_VAR, fmt, md, rem } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const DIMS = [
    ["all", "全部"],
    ["person", "人"],
    ["machine", "机"],
    ["material", "料"],
    ["env", "环"]
  ]
  const dim = ref("all")
  // 图区 396 × 112（设计稿 px）
  const W = 396
  const H = 112
  const DAY = 24 * 3600000

  const days = computed(() => {
    const ev = props.w.events30.filter(
      (e) => dim.value === "all" || e.dim === dim.value
    )
    const out = Array.from({ length: 30 }, (_, i) => ({
      t: props.w.d0 - (29 - i) * DAY,
      n: [0, 0, 0, 0]
    }))
    for (const e of ev) {
      const i = Math.floor((e.at - out[0].t) / DAY)
      if (i >= 0 && i < 30) out[i].n[e.level]++
    }
    return out
  })
  const max = computed(() =>
    Math.max(4, ...days.value.map((d) => d.n.reduce((a, x) => a + x, 0)))
  )
  const top = computed(() => Math.ceil(max.value / 4) * 4)
  const y = (v) => H - (v / top.value) * (H - 4)
  const grid = computed(() => [top.value / 2, top.value])
  const bw = W / 30
  // 堆叠：一级在最下
  const daysView = computed(() =>
    days.value.map((d) => {
      let acc = 0
      return {
        t: d.t,
        stack: [0, 1, 2, 3].map((l) => {
          const y0 = y(acc)
          acc += d.n[l]
          return { l, n: d.n[l], y: y(acc), h: y0 - y(acc) }
        })
      }
    })
  )
  const totals = computed(() =>
    [0, 1, 2, 3].map((l) => days.value.reduce((a, d) => a + d.n[l], 0))
  )
  const avg = computed(() => totals.value.reduce((a, x) => a + x, 0) / 30)
</script>
