<!-- 靠离泊计划：横轴前 6 h → 后 18 h，纵轴岸线位置（B01 在上）；色块 = 航次，尾部红色 = 延误 -->
<template>
  <Panel title="靠离泊计划 · 24 h" en="BERTH SCHEDULE">
    <svg class="gantt" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="b in layout.berths" :key="b.id">
        <line x1="30" :x2="W - 4" :y1="Y(b.u0)" :y2="Y(b.u0)" class="grid" />
        <text x="2" :y="Y((b.u0 + b.u1) / 2) + 4" class="ax">{{ b.id }}</text>
      </g>
      <text
        v-for="k in [-6, 0, 6, 12, 18]"
        :key="k"
        :x="X(now + k * HOUR)"
        :y="H - 3"
        class="ax"
        text-anchor="middle"
      >
        {{ hm(now + k * HOUR) }}
      </text>
      <g v-for="c in bars" :key="c.id" @click="$emit('vessel', c.id)">
        <rect :x="c.a" :y="c.y0" :width="c.w" :height="c.h" :class="c.cls" />
        <rect
          v-if="c.late"
          :x="c.p"
          :y="c.y0"
          :width="c.lw"
          :height="c.h"
          class="g-late"
        />
        <text
          v-if="c.b - c.a > 60"
          :x="c.a + 5"
          :y="c.y0 + c.h / 2 + 4"
          class="g-lb"
        >
          {{ c.name }}
        </text>
      </g>
      <line :x1="X(now)" :x2="X(now)" y1="0" :y2="H - 15" class="g-cur" />
      <text :x="X(now) + 4" y="10" class="g-curt">现在</text>
    </svg>
    <div class="lg">
      <span><i class="sw g-now"></i>作业中</span
      ><span><i class="sw g-plan"></i>计划</span
      ><span><i class="sw g-done"></i>已离泊</span
      ><span><i class="sw g-late"></i>延误</span>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { hm } from "../../utils.js"

  const props = defineProps({
    now: { type: Number, required: true },
    layout: { type: Object, required: true },
    /** sim.schedule(now − 6 h, now + 18 h) */
    schedule: { type: Array, default: () => [] }
  })
  defineEmits(["vessel"])
  const HOUR = 3600000
  const W = 412
  const H = 112
  const t0 = computed(() => props.now - 6 * HOUR)
  const t1 = computed(() => props.now + 18 * HOUR)
  const X = (t) => 30 + ((t - t0.value) / (t1.value - t0.value)) * (W - 36)
  const Y = (u) => 4 + (u / props.layout.quay.u1) * (H - 22)
  const bars = computed(() =>
    props.schedule.map((c) => {
      const a = X(Math.max(t0.value, c.tb))
      const b = X(Math.min(t1.value, c.depart))
      const p = X(Math.min(t1.value, c.planEnd))
      const y0 = Y(c.u0) + 1.5
      const h = Y(c.u1) - 1.5 - y0
      const cls =
        c.depart < props.now ? "g-done" : c.tb <= props.now ? "g-now" : "g-plan"
      return {
        id: c.id,
        name: c.name,
        a,
        b,
        p,
        y0,
        h,
        cls,
        w: Math.max(3, Math.min(b, p) - a),
        late: c.delayMin >= 30,
        lw: Math.max(2, b - p)
      }
    })
  )
</script>
