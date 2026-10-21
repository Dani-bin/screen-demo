<!-- 单船作业跟踪：进度环 + 船舶信息 + 逐路（贝段）完成情况 + 为它服务的岸桥 / AGV / 箱区；右上角退出 -->
<template>
  <Panel
    :title="`单船跟踪 · ${v.name}`"
    en="VESSEL TRACKING"
    class="track-card"
  >
    <template #tools
      ><a class="pn-tool exit" @click="$emit('exit')">退出跟踪</a></template
    >
    <div class="ts">
      <svg width="112" height="112" viewBox="0 0 120 120" class="ring">
        <circle cx="60" cy="60" r="46" class="ring-bg" />
        <circle
          cx="60"
          cy="60"
          r="46"
          class="ring-fg"
          :stroke-dasharray="`${C * p} ${C}`"
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="60" text-anchor="middle" class="ring-v">
          {{ Math.round(p * 100) }}%
        </text>
        <text x="60" y="80" text-anchor="middle" class="ring-l">已完成</text>
      </svg>
      <div class="ts-i">
        <div>
          <span>船型</span><b>{{ v.clsName }} · {{ fmt(v.teuClass) }} TEU 级</b>
        </div>
        <div>
          <span>航线</span><b>{{ v.route }}</b>
        </div>
        <div>
          <span>泊位</span><b>{{ v.berths.join(" · ") }}</b>
        </div>
        <div>
          <span>靠泊</span><b>{{ hm(v.tb) }}</b
          ><span>计划离泊</span><b>{{ hm(v.planEnd) }}</b>
        </div>
        <div>
          <span>船时效率</span><b>{{ fmt(v.rate) }} 自然箱/h</b
          ><span>预计离泊</span
          ><b :class="{ bad: v.delayMin >= 30 }">{{ hm(v.depart) }}</b>
        </div>
      </div>
    </div>
    <div class="ts-sub">按作业路（贝段）· 先卸后装</div>
    <div
      v-for="(l, i) in v.lines"
      :key="l.id"
      class="bay"
      :class="{ on: l.working }"
    >
      <span
        >第 {{ i + 1 }} 路 ·
        <span class="code">{{ l.crane || "完工" }}</span></span
      >
      <div class="tr">
        <s :style="{ width: (l.total ? l.done / l.total : 1) * 100 + '%' }"></s>
      </div>
      <b>{{ fmt(l.done) }}/{{ fmt(l.total) }}</b>
    </div>
    <div class="ts-flow">
      <span
        >岸桥 <b>{{ cranes.length }}</b></span
      ><i>→</i
      ><span
        >AGV <b>{{ agvs.length }}</b></span
      ><i>→</i
      ><span
        >箱区 <b>{{ blocks.join(" ") || "—" }}</b></span
      >
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, hm } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    v: { type: Object, required: true }
  })
  defineEmits(["exit"])
  const C = 2 * Math.PI * 46
  const p = computed(() => props.v.done / props.v.moves)
  const cranes = computed(() =>
    props.state.cranes.filter(
      (c) => c.vessel === props.v.id && c.state !== "idle"
    )
  )
  const agvs = computed(() =>
    props.state.agvs.filter((a) => a.vessel === props.v.id)
  )
  const blocks = computed(() => [
    ...new Set(cranes.value.map((c) => c.target).filter(Boolean))
  ])
</script>
