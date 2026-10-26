<!--
  告警时间线（预警中心底部）：今天 0–24 时，人 / 机 / 料 / 环四行，每条事件一段（起止时刻，颜色 = 等级），
  平台预警（劣化）单独一行画成紫色长条；"现在"竖线。点一段三维飞过去。
-->
<template>
  <div class="cs atl">
    <div class="cs-hd">
      <b>告警时间线</b><em>TODAY · 人 / 机 / 料 / 环 · 平台预警</em>
      <span class="lg">
        <template v-for="l in [0, 1, 2, 3]" :key="l">
          <i :style="{ background: `var(${LV_VAR[l]})` }"></i>{{ LV[l] }}
        </template>
        <i class="p"></i>平台预警
      </span>
    </div>
    <div class="atl-rows">
      <div v-for="r in rows" :key="r.k" class="atl-r">
        <span :style="{ '--c': `var(${r.v})` }"
          >{{ r.name }}<b>{{ r.items.length }}</b></span
        >
        <div class="atl-track">
          <i
            v-for="e in r.items"
            :key="e.id"
            :class="{ pred: e.predictive }"
            :style="{
              left: `${e.l}%`,
              width: `${e.w}%`,
              background: e.predictive
                ? 'var(--predict)'
                : `var(${LV_VAR[e.level]})`
            }"
            :title="`${hm(e.at)} ${e.title}`"
            @click="emit('pick', e)"
          ></i>
          <u :style="{ left: `${nowK}%` }"></u>
        </div>
      </div>
      <div class="atl-ax">
        <span v-for="t in [0, 3, 6, 9, 12, 15, 18, 21, 24]" :key="t">{{
          String(t).padStart(2, "0")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { DIM, LV, LV_VAR, hm } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const emit = defineEmits(["pick"])
  const DAY = 24 * 3600000

  const pos = (e) => {
    const a = Math.max(e.at, props.w.d0)
    const b = Math.min(e.end ?? props.f.ms, props.f.ms)
    return {
      l: ((a - props.w.d0) / DAY) * 100,
      // 至少 0.35 %（约 5 分钟）宽，短事件也看得见
      w: Math.max(0.35, ((b - a) / DAY) * 100)
    }
  }
  const rows = computed(() => {
    const base = Object.entries(DIM).map(([k, [name, v]]) => ({
      k,
      name,
      v,
      items: props.w.today
        .filter((e) => e.dim === k)
        .map((e) => ({ ...e, ...pos(e) }))
    }))
    const pred = props.f.s.alarms
      .filter((a) => a.predictive)
      .map((a) => ({ ...a, ...pos(a) }))
    return [...base, { k: "pred", name: "预警", v: "--predict", items: pred }]
  })
  const nowK = computed(() => ((props.f.ms - props.w.d0) / DAY) * 100)
</script>
