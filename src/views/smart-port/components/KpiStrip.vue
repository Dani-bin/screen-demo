<!-- 顶部指标条：6 个指标，数值 + 较昨日同时刻 + 迷你走势（数字全部从仿真明细汇总） -->
<template>
  <div class="kpis">
    <div
      v-for="it in items"
      :key="it.name"
      class="kpi"
      :class="{ warn: it.warn }"
    >
      <div class="kpi-name">{{ it.name }}</div>
      <div class="kpi-row">
        <b>{{ it.v }}</b
        ><i>{{ it.u }}</i>
        <svg
          v-if="it.spark"
          class="spark"
          width="120"
          height="30"
          viewBox="0 0 120 30"
        >
          <polygon :points="it.spark.fill" class="spark-fill" />
          <polyline :points="it.spark.line" />
          <circle :cx="it.spark.end[0]" :cy="it.spark.end[1]" r="3" />
        </svg>
      </div>
      <div class="kpi-note">
        <template v-if="it.delta !== undefined">
          较昨日同时刻
          <span class="dl" :class="it.delta >= 0 ? 'up' : 'dn'"
            >{{ it.delta >= 0 ? "▲" : "▼" }}
            {{ Math.abs(it.delta * 100).toFixed(1) }}%</span
          >
        </template>
        <template v-else>{{ it.note }}</template>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { QC_RECORD } from "../sim/simulator.js"
  import { fmt } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    /** 昨日同一时刻的指标（index.vue 每分钟算一次） */
    yday: { type: Object, default: null },
    hourly: { type: Array, default: () => [] },
    teuCum: { type: Array, default: () => [] }
  })

  /** 迷你折线：单系列主色细线 + 末端点 */
  function spark(vals, w = 120, h = 30) {
    if (!vals || vals.length < 2) return null
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const X = (i) => (i / (vals.length - 1)) * (w - 4) + 2
    const Y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6)
    const pts = vals
      .map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
      .join(" ")
    const last = vals.length - 1
    return {
      line: pts,
      fill: `2,${h} ${pts} ${X(last)},${h}`,
      end: [X(last), Y(vals[last])]
    }
  }

  const items = computed(() => {
    const k = props.state.kpi
    const y = props.yday
    const delta = (a, b) => (y && b ? (a - b) / b : undefined)
    const today = props.state.events.filter(
      (e) => e.at >= props.state.clock.dayStart
    )
    return [
      {
        name: "今日吞吐量",
        v: fmt(k.teuToday),
        u: "TEU",
        delta: delta(k.teuToday, y?.teuToday),
        spark: spark(props.teuCum)
      },
      {
        name: "今日作业量",
        v: fmt(k.movesToday),
        u: "自然箱",
        delta: delta(k.movesToday, y?.movesToday),
        spark: spark(props.hourly)
      },
      {
        name: "在泊作业船",
        v: k.vesselsAtBerth,
        u: "艘",
        note: `锚地待泊 ${k.vesselsAnchor} 艘 · 泊位 7 个`
      },
      {
        name: "平均船时效率",
        v: fmt(k.vesselRate, 1),
        u: "自然箱/h",
        note: "在泊船舶按作业小时加权"
      },
      {
        name: "岸桥平均台时量",
        v: fmt(k.qcTph, 1),
        u: "自然箱/h",
        note: `单机纪录 ${QC_RECORD.single}（${QC_RECORD.year} 年）`
      },
      {
        name: "未结束告警",
        v: k.alarmsActive,
        u: "条",
        note: `今日累计 ${today.length} 条`,
        warn: k.alarmsActive > 0
      }
    ]
  })
</script>
