<!--
  O6 预测性维护成效：近 30 天平台预警了多少次劣化、平均提前量、计划消缺率，避免的非计划停机时长
  （每次若等到集控跳闸，按同类故障平均抢修 3.5 h、主斜井运量折算停产吨数），以及集控跳闸次数对照
-->
<template>
  <Panel no="M6" title="预测性维护成效" en="PdM · LAST 30 DAYS">
    <div class="pm">
      <div v-for="x in kpis" :key="x.k" :class="x.cls">
        <span>{{ x.k }}</span
        ><b
          >{{ x.v }}<i>{{ x.u }}</i></b
        ><em>{{ x.sub }}</em>
      </div>
    </div>
    <div class="pm-vs">
      <div class="pm-row">
        <span>平台预警 → 计划消缺</span>
        <div class="bar">
          <i
            class="ok"
            :style="{ width: `${(fixed / Math.max(1, fixed + trips)) * 100}%` }"
          ></i>
        </div>
        <b>{{ fixed }}</b>
      </div>
      <div class="pm-row">
        <span>集控跳闸（事后停机）</span>
        <div class="bar">
          <i
            class="bad"
            :style="{ width: `${(trips / Math.max(1, fixed + trips)) * 100}%` }"
          ></i>
        </div>
        <b>{{ trips }}</b>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const sim = inject("sim")
  const DAY = 24 * 3600000
  /** 一次非计划故障停机的平均抢修时长（h）、主斜井平均运量（t/h）：演示假设 */
  const REPAIR_H = 3.5
  const FLOW = 1500

  const tracks = computed(() =>
    sim
      .tracksBetween(props.w.ms - 30 * DAY, props.w.ms)
      .filter((t) => t.tWarn <= props.w.ms)
  )
  const fixed = computed(
    () => tracks.value.filter((t) => t.tFix <= props.w.ms).length
  )
  const trips = computed(
    () => props.w.events30.filter((e) => e.kind === "trip").length
  )
  const kpis = computed(() => {
    const n = tracks.value.length
    const lead = n
      ? tracks.value.reduce(
          (a, t) => a + (Math.min(t.tFix, props.w.ms) - t.tWarn),
          0
        ) /
        n /
        DAY
      : 0
    const saved = fixed.value * REPAIR_H
    return [
      { k: "平台预警", v: n, u: "次", sub: "劣化过程" },
      {
        k: "平均提前量",
        v: fmt(lead, 1),
        u: "天",
        sub: "首次预警 → 消缺",
        cls: "pred"
      },
      {
        k: "避免停机",
        v: fmt(saved, 1),
        u: "h",
        sub: `约 ${fmt((saved * FLOW) / 10000, 1)} 万吨`,
        cls: "ok"
      },
      {
        k: "计划消缺率",
        v: n ? Math.round((fixed.value / n) * 100) : 0,
        u: "%",
        sub: "其余在计划中"
      }
    ]
  })
</script>
