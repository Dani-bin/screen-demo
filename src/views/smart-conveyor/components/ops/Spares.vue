<!--
  O3 备件：库存 vs 预测需求（未来 7 晚检修计划里的消缺任务 + 近 30 天平均消耗），低于安全库存标黄、不够用标红
-->
<template>
  <Panel no="M3" title="备件预测" en="SPARE PARTS · 7 DAYS">
    <table class="sp">
      <thead>
        <tr>
          <th>备件</th>
          <th>库存</th>
          <th>7 天需求</th>
          <th>30 天消耗</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in rows" :key="p.id" :class="p.cls">
          <td>
            <b>{{ p.name }}</b
            ><span>{{ p.spec }}</span>
          </td>
          <td class="num">{{ p.stock }}</td>
          <td class="num">{{ p.need }}</td>
          <td class="num">{{ p.used }}</td>
          <td>
            <div class="sp-bar">
              <i
                :style="{ width: `${Math.min(100, (p.stock / p.cap) * 100)}%` }"
              ></i>
              <u
                :style="{ left: `${Math.min(100, (p.safe / p.cap) * 100)}%` }"
              ></u>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="sp-note">竖线 = 安全库存 · 需求由劣化过程派生（演示）</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { SPARES } from "../../data/ops.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const sim = inject("sim")
  const DAY = 24 * 3600000

  const rows = computed(() => {
    // 未来 7 晚的消缺任务（检修计划里带 track 的）
    const tasks = []
    for (let k = 0; k < 7; k++) {
      const date = new Date(props.w.ms + 8 * 3600000 + (k + 1) * DAY)
        .toISOString()
        .slice(0, 10)
      for (const x of sim.nightPlan(date)) if (x.track) tasks.push(x)
    }
    const tracks = sim.tracksBetween(
      props.w.ms - 30 * DAY,
      props.w.ms + 7 * DAY
    )
    const kindOf = (id) => tracks.find((t) => t.id === id)?.kind
    const past = tracks.filter((t) => t.tFix <= props.w.ms)
    return SPARES.map((p) => {
      const need =
        tasks.filter((x) => kindOf(x.track) === p.kind).length * p.per
      const used = past.filter((t) => t.kind === p.kind).length * p.per
      const cls =
        p.stock < need ? "short" : p.stock - need < p.safe ? "low" : ""
      return { ...p, need, used, cls, cap: Math.max(p.stock, p.safe * 2, 1) }
    })
  })
</script>
