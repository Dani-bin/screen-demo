<!-- 轮牧计划：分区状态环图 + 未来 7 天转场甘特（橙色 = 2 天内要转场，绿块上的数字是下一块分区） -->
<template>
  <Card
    title="轮牧计划"
    hint="未来 7 天转场 · 数字为下一块分区"
    class="rotation"
  >
    <div class="rot2">
      <div class="rot-d">
        <Donut :parts="parts">
          <b class="dn-v">{{ total }}</b
          ><span class="dn-k">分区</span>
        </Donut>
        <ul class="rot-l">
          <li>
            <i :style="{ background: PAL.accent }"></i>放牧中
            <b>{{ p.grazing }}</b>
          </li>
          <li>
            <i :style="{ background: PAL.rest }"></i>休牧恢复
            <b>{{ p.resting }}</b>
          </li>
          <li>
            <i :style="{ background: PAL.ok }"></i>待牧 <b>{{ p.ready }}</b>
          </li>
        </ul>
      </div>
      <div class="gantt">
        <div class="gt-axis">
          <b
            v-for="k in 8"
            :key="k"
            :style="{ left: `${((k - 1) / 7) * 100}%` }"
            >{{ k === 1 ? "今" : `+${k - 1}` }}</b
          >
        </div>
        <div
          v-for="r in rows"
          :key="r.unit"
          class="gt-row"
          @click="$emit('unit', r.unit)"
        >
          <span class="gt-id">{{ r.unit }}</span>
          <span class="gt-track">
            <i
              class="gt-cur"
              :class="{ soon: r.soon }"
              :style="{ width: `${r.w}%` }"
            ></i>
            <template v-if="r.w < 100">
              <i
                class="gt-next"
                :style="{ left: `${r.w}%`, width: `${100 - r.w}%` }"
              ></i>
              <em :style="{ left: `${r.w}%` }">{{ r.next }}</em>
            </template>
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import Donut from "../charts/Donut.vue"
  import { PAL, transfers } from "../../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  defineEmits(["unit"])
  const p = computed(() => props.state.ranch.paddocks)
  const total = computed(
    () => p.value.grazing + p.value.resting + p.value.ready
  )
  const parts = computed(() => [
    { v: p.value.grazing, c: PAL.accent },
    { v: p.value.resting, c: PAL.rest },
    { v: p.value.ready, c: PAL.ok }
  ])
  const rows = computed(() => {
    const tr = new Map(transfers(props.state).map((t) => [t.unit, t]))
    return props.state.units.map((u) => {
      const t = tr.get(u.id)
      const rem = Math.min(t.cur.remainDays, 7)
      return {
        unit: u.id,
        w: (rem / 7) * 100,
        soon: t.cur.remainDays < 2,
        next: t.next.id.split("-")[1]
      }
    })
  })
</script>
