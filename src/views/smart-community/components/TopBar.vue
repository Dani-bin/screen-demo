<!-- 顶栏：标题、五个指标、时钟与天气（数字全部来自仿真快照） -->
<template>
  <div class="card topbar">
    <div class="brand">
      <div class="logo">
        <Icon name="logo" :size="28" style="stroke: var(--gold-hi)" />
      </div>
      <div>
        <h1>松岚苑 · 空中巡防指挥中心</h1>
        <div class="sub">
          三机联动 · 主侦查 / 中继 / 补盲
          <span class="chip" style="height: 20px">虚构社区 · 效果示意</span>
        </div>
      </div>
    </div>
    <div class="kpis">
      <div v-for="k in kpis" :key="k.l" class="kpi">
        <div class="v">
          {{ k.v }}<small>{{ k.u }}</small>
        </div>
        <div class="l">{{ k.l }}</div>
      </div>
    </div>
    <div class="clock">
      <div class="v">{{ snap.clock }}</div>
      <div class="l">
        11 月 4 日 周三 · 风速 {{ snap.env.wind.toFixed(1) }} m/s ·
        {{ snap.env.temp.toFixed(1) }} ℃ ·
        {{ snap.env.wind < 12 ? "可飞" : "大风停飞" }}
      </div>
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import Icon from "./Icon.vue"

  const props = defineProps({ snap: { type: Object, required: true } })
  const kpis = computed(() => {
    const s = props.snap
    return [
      { v: s.counts.total, u: "件", l: "今日事件" },
      { v: (s.doneRate * 100).toFixed(1), u: "%", l: "事件处置率" },
      { v: s.sorties, u: "架次", l: "今日完成架次" },
      { v: Math.floor(s.flightMin), u: "min", l: "累计飞行" },
      { v: `${s.blind.checked}/${s.blind.total}`, u: "处", l: "盲区核验" }
    ]
  })
</script>
