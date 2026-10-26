<!-- 顶部指标条：8 个关键指标，全部从仿真状态派生 -->
<template>
  <div class="kpis">
    <div v-for="x in items" :key="x.t" class="kpi" :class="x.c">
      <span>{{ x.t }}</span>
      <b
        >{{ x.v }}<small v-if="x.small">{{ x.small }}</small
        ><i>{{ x.u }}</i></b
      >
      <em>{{ x.sub }}</em>
    </div>
  </div>
</template>

<script setup>
  import { fmt } from "./ui.js"

  const props = defineProps({ f: { type: Object, required: true } })

  const items = computed(() => {
    const s = props.f.s
    const k = s.kpi
    const total = Object.keys(s.belts).length
    const slowed = Object.values(s.belts).filter((b) => b.v > 0.05).length
    return [
      {
        t: "今日原煤产量",
        v: fmt(k.outputToday),
        u: "t",
        c: "coal",
        sub: `计划 ${fmt(props.f.planDay)} t`
      },
      {
        t: "当前运量",
        v: fmt(k.flowNow),
        u: "t/h",
        c: "coal",
        sub: "主斜井皮带秤"
      },
      {
        t: "运行皮带",
        v: k.beltsRunning,
        small: `/${total}`,
        u: "条",
        sub: slowed ? "料流均衡调速中" : "全线停车"
      },
      {
        t: "主煤流总功率",
        v: fmt(k.powerTotal),
        u: "kW",
        sub: `下运回馈 ${fmt(Math.max(0, -s.belts.BC04.power))} kW`
      },
      { t: "吨煤电耗", v: fmt(k.kwhPerTon, 2), u: "kWh/t", sub: "今日累计" },
      {
        t: "调速节电率",
        v: fmt(k.savingRate * 100, 1),
        u: "%",
        c: "ok",
        sub: "较额定带速运行"
      },
      {
        t: "未结束告警",
        v: s.alarms.length,
        u: "条",
        c: s.alarms.some((a) => a.level === 0) ? "l1" : "l2",
        sub: `含平台预警 ${s.alarms.filter((a) => a.predictive).length}`
      },
      { t: "井下人数", v: fmt(k.peopleUnderground), u: "人", sub: "UWB 定位" }
    ]
  })
</script>
