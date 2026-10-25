<!--
  7 天检修甘特（运维中心底部）：今晚起连续 7 个零点班（00:00–08:00），每晚一行，每项检修一段；
  平台预警消缺紫色、例行任务青色；点一段三维飞到检修位置
-->
<template>
  <div class="cs gantt">
    <div class="cs-hd">
      <b>7 天检修计划</b><em>NIGHT SHIFT 00:00–08:00 · 挂牌闭锁作业</em>
      <span class="lg"><i class="p"></i>预警消缺 <i class="c"></i>例行</span>
    </div>
    <div class="gt-rows">
      <div v-for="r in rows" :key="r.date" class="gt-r">
        <span>{{ r.label }}</span>
        <div class="gt-track">
          <i
            v-for="x in r.items"
            :key="x.id"
            :class="{ pred: x.track }"
            :style="{
              left: `${x.l}%`,
              width: `${x.w}%`,
              top: `${x.lane * 50}%`
            }"
            :title="`${hm(x.start)}–${hm(x.end)} ${x.title} · ${x.crew} 人`"
            @click="emit('locate', x)"
            ><b v-if="x.w > 4">{{ x.belt }}</b></i
          >
        </div>
        <em>{{ r.items.length }} 项</em>
      </div>
      <div class="gt-ax">
        <span v-for="h in [0, 1, 2, 3, 4, 5, 6, 7, 8]" :key="h">{{
          String(h).padStart(2, "0")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { hm } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const emit = defineEmits(["locate"])
  const sim = inject("sim")
  const HOUR = 3600000
  const DAY = 24 * HOUR
  const WEEK = "日一二三四五六"

  const rows = computed(() => {
    // 今夜 = 下一个零点班（当前在零点班里就是今天）
    const bjNow = new Date(props.w.ms + 8 * HOUR)
    const first = bjNow.getUTCHours() >= 8 ? props.w.d0 + DAY : props.w.d0
    return Array.from({ length: 7 }, (_, k) => {
      const t00 = first + k * DAY
      const date = new Date(t00 + 8 * HOUR).toISOString().slice(0, 10)
      const items = [...sim.nightPlan(date)].sort((a, b) => a.start - b.start)
      // 重叠的任务分两条泳道
      const laneEnd = [0, 0]
      const out = items.map((x) => {
        const lane = x.start >= laneEnd[0] ? 0 : 1
        laneEnd[lane] = x.end
        return {
          ...x,
          lane,
          l: ((x.start - t00) / (8 * HOUR)) * 100,
          w: Math.max(1.5, ((x.end - x.start) / (8 * HOUR)) * 100)
        }
      })
      const d = new Date(t00 + 8 * HOUR)
      return {
        date,
        label: `${k === 0 ? "今晚" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`} 周${WEEK[d.getUTCDay()]}`,
        items: out
      }
    })
  })
</script>
