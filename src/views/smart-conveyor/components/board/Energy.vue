<!-- 04 能耗与调速：吨煤电耗、节电率、今日耗电 / 回馈；各皮带功率（以 0 为中轴，负值 = 下运发电回馈） -->
<template>
  <Panel no="04" title="能耗与调速" en="ENERGY · VFD">
    <div class="en">
      <div class="en-l">
        <div class="en-big">
          <span>吨煤电耗</span><b>{{ fmt(k.kwhPerTon, 2) }}</b
          ><i>kWh/t</i>
        </div>
        <div class="en-row">
          <span>调速节电率</span
          ><b class="ok">{{ fmt(k.savingRate * 100, 1) }}%</b>
        </div>
        <div class="en-row">
          <span>今日耗电</span><b>{{ fmt(k.energyToday) }} kWh</b>
        </div>
        <div class="en-row">
          <span>下运回馈</span><b class="regen">{{ fmt(k.regenToday) }} kWh</b>
        </div>
      </div>
      <div class="en-r" :style="{ width: rem(196) }">
        <p>各皮带功率 kW <em>（负值 = 下运发电回馈）</em></p>
        <div v-for="b in bars" :key="b.id" class="eb">
          <span class="code">{{ b.id }}</span>
          <div class="eb-track">
            <i :class="{ neg: b.p < 0 }" :style="b.style"></i>
          </div>
          <b :class="{ regen: b.p < 0 }">{{ fmt(b.p) }}</b>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, rem } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ f: { type: Object, required: true } })
  const k = computed(() => props.f.s.kpi)
  const bars = computed(() => {
    const s = props.f.s
    const max = Math.max(
      1,
      ...layout.belts.map((b) => Math.abs(s.belts[b.id].power))
    )
    return [...layout.belts].reverse().map((b) => {
      const p = s.belts[b.id].power
      // 半边轨道 70 px：正值向右、负值向左
      const len = (Math.abs(p) / max) * 70
      return {
        id: b.id,
        p,
        style: { width: rem(len), [p < 0 ? "right" : "left"]: "50%" }
      }
    })
  })
</script>
