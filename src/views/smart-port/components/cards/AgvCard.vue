<!-- AGV 电量分布（单系列柱，25% 以下用告警色、标"换电线"）+ 两座换电站 -->
<template>
  <Panel title="AGV 电量与换电" en="AGV & BATTERY SWAP">
    <svg class="bars" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="(n, i) in bins" :key="i">
        <path :d="bar(i, n)" :class="i < 3 ? 'b-low' : 'b-bar'" />
        <text
          :x="x(i) + bw / 2"
          :y="H - 20 - bh(n)"
          class="val"
          text-anchor="middle"
        >
          {{ n }}
        </text>
        <text :x="x(i) + bw / 2" :y="H - 3" class="ax" text-anchor="middle">
          {{ i * 10 }}
        </text>
      </g>
      <line :x1="x(2.5)" :x2="x(2.5)" y1="4" :y2="H - 15" class="g-cur warn" />
      <text :x="x(2.5) - 4" y="12" class="ax" text-anchor="end">
        换电线 25%
      </text>
    </svg>
    <div v-for="s in state.swaps" :key="s.id" class="sw-st">
      <i v-html="ICON.bolt"></i><b>{{ s.id }}</b
      ><span
        >换电中 <i>{{ s.swapping }}</i></span
      ><span
        >往返 <i>{{ s.queue }}</i></span
      ><span
        >满电电池 <i>{{ s.full }}</i></span
      ><span
        >今日换电 <i>{{ s.swapsToday }}</i> 次</span
      >
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { ICON } from "../../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  const W = 412
  const H = 74
  const bw = (W - 16) / 10
  const x = (i) => 8 + i * bw
  const bins = computed(() => {
    const b = new Array(10).fill(0)
    for (const a of props.state.agvs) b[Math.min(9, Math.floor(a.soc / 10))]++
    return b
  })
  const max = computed(() => Math.max(...bins.value, 1))
  const bh = (n) => Math.max(2, (n / max.value) * (H - 34))
  function bar(i, n) {
    const h = bh(n)
    return `M${x(i) + 3},${H - 16} v${-(h - 2)} q0,-2 2,-2 h${bw - 10} q2,0 2,2 v${h - 2} z`
  }
</script>
