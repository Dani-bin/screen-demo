<!-- 牧区气象：当前温度 + 24 h 温度曲线（橙）与降水概率（蓝柱）+ 未来 3 天 -->
<template>
  <Card title="牧区气象" class="weather">
    <div class="wx2">
      <div class="wx-now">
        <b>{{ w.temp }}<small>℃</small></b
        ><span>{{ w.sky }} · {{ w.wind }}</span
        ><span>今日 {{ w.lo }}–{{ w.hi }}℃</span>
      </div>
      <svg :viewBox="`0 0 ${W} ${H}`" class="wx-chart">
        <rect
          v-for="x in w.hourly"
          :key="x.h"
          :x="xs(x.h) - 3"
          :y="H - 14 - (x.rain / 100) * 26"
          width="6"
          :height="(x.rain / 100) * 26"
          fill="#2b7bd6"
          opacity="0.35"
        />
        <path :d="line" fill="none" stroke="#f08c2e" stroke-width="2" />
        <line
          :x1="xs(now)"
          :x2="xs(now)"
          y1="2"
          :y2="H - 14"
          stroke="#1f3a2b"
          stroke-dasharray="2 3"
          opacity="0.5"
        />
        <text
          v-for="h in [0, 6, 12, 18, 23]"
          :key="h"
          :x="xs(h)"
          :y="H - 2"
          class="tick"
          text-anchor="middle"
        >
          {{ h }}时
        </text>
      </svg>
    </div>
    <div class="wx-next">
      <span v-for="n in w.next" :key="n.date"
        ><b>{{ n.date }}</b
        ><i>{{ n.sky }}</i
        ><em>{{ n.lo }}–{{ n.hi }}℃</em></span
      >
      <span class="rain"><i></i>柱：降水概率</span>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"

  const props = defineProps({ state: { type: Object, required: true } })
  const W = 250
  const H = 70
  const w = computed(() => props.state.weather)
  const now = computed(() => props.state.t.hours)
  const range = computed(() => {
    const t = w.value.hourly.map((x) => x.temp)
    return [Math.min(...t) - 1, Math.max(...t) + 1]
  })
  const xs = (h) => 6 + (h / 23) * (W - 12)
  const ys = (v) =>
    6 +
    (1 - (v - range.value[0]) / (range.value[1] - range.value[0])) * (H - 24)
  const line = computed(() =>
    w.value.hourly
      .map(
        (x, i) =>
          `${i ? "L" : "M"}${xs(x.h).toFixed(1)},${ys(x.temp).toFixed(1)}`
      )
      .join(" ")
  )
</script>
