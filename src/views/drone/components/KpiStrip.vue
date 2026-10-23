<!-- 顶部 5 项关键指标：全部从仿真状态的明细现算（见 sim/simulator.js 的 kpi），不写死 -->
<template>
  <div class="kpis">
    <div
      v-for="d in items"
      :key="d.k"
      class="kpi"
      :class="{ click: d.click }"
      @click="d.click && $emit(d.click)"
    >
      <div class="k">{{ d.k }}</div>
      <div class="v num" v-html="d.v"></div>
      <div class="s" v-html="d.s"></div>
    </div>
  </div>
</template>

<script setup>
  import { pad, pct } from "../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  defineEmits(["events"])

  const fmtMin = (m) =>
    `${Math.floor(m / 60)}<small>h</small> ${pad(Math.round(m % 60))}<small>min</small>`

  const items = computed(() => {
    const K = props.state.kpi
    const inAir = Object.values(props.state.drones).filter(
      (u) => u.state !== "docked"
    ).length
    return [
      {
        k: "今日架次",
        v: `${K.sorties}<small>架次</small>`,
        s: `计划 <em>${K.planSorties}</em> · 复核 <em>${K.reviewSorties}</em>`
      },
      {
        k: "飞行时长",
        v: fmtMin(K.flightMin),
        s: `在飞 <em>${inAir}</em> 架 · 共 4 架`
      },
      {
        k: "巡检里程",
        v: `${K.distanceKm.toFixed(1)}<small>km</small>`,
        s: `覆盖对象 <em>${K.coveredTargets}/${K.coverTotal}</em> · ${pct(K.coverage)}%`
      },
      {
        k: "今日计划",
        v: `${K.planDone}<small>/ ${K.planTotal} 趟</small>`,
        s: `执行中 <em>${K.planRunning}</em> · 顺延 <em class="warn">${K.planPostponed}</em> · 漏巡 <em>${K.planMissed}</em>`
      },
      {
        k: "今日事件",
        v: `${K.eventTotal}<small>条</small>`,
        s: `<span class="alarm">待确认 ${K.pending}</span> · 处置中 <em>${K.inProgress}</em> · 办结 <em>${K.closed}</em> · 误报 <em>${K.falseAlarm}</em>`,
        click: "events"
      }
    ]
  })
</script>

<style lang="scss" scoped>
  .kpis {
    position: absolute;
    left: 456px;
    top: 92px;
    width: 1008px;
    display: flex;
    justify-content: space-between;
    z-index: 4;
  }
  .kpi {
    padding: 10px 14px;
    min-width: 180px;
    background: linear-gradient(
      180deg,
      rgba(54, 227, 216, 0.08),
      rgba(54, 227, 216, 0)
    );
    border-top: 2px solid rgba(54, 227, 216, 0.5);
    &.click {
      cursor: pointer;
    }
  }
  .k {
    font-size: 13px;
    color: var(--sub);
  }
  .v {
    font-size: 30px;
    line-height: 1;
    margin-top: 6px;
    :deep(small) {
      font-family: "Source Han Sans CN", sans-serif;
      font-size: 13px;
      color: var(--sub);
      margin-left: 3px;
    }
  }
  .s {
    font-size: 12px;
    color: var(--sub);
    margin-top: 6px;
    white-space: nowrap;
    :deep(em) {
      font-style: normal;
      color: var(--text);
    }
    :deep(.warn) {
      color: var(--warn);
    }
    :deep(.alarm) {
      color: var(--major);
    }
  }
</style>
