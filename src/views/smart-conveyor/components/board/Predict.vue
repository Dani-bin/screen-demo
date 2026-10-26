<!--
  08 平台预警 · 预测性维护：最严重的劣化过程 —— 提前了几天、劣化开始 → 三级 → 二级 → 计划更换的时间线、
  "不处理会怎样"（集控只能事后跳闸），下面再列一条次严重的
-->
<template>
  <Panel no="08" title="平台预警 · 预测性维护" en="PHM · EARLY WARNING">
    <template v-if="top">
      <div class="pd-top">
        <div class="pd-h">
          <span class="tag-pred">平台预警</span><LvTag :l="topLevel" /><b>{{
            top.where
          }}</b
          ><em>{{ top.name }} · 严重度 {{ pct(top.s) }}</em>
        </div>
        <div class="pd-lead">
          <b>{{ fmt(lead, 1) }}</b
          ><span>天<br />提前预警</span>
        </div>
      </div>
      <div class="pd-tl">
        <div class="pd-line">
          <i :style="{ width: `${Math.min(100, nowK * 100).toFixed(0)}%` }"></i>
        </div>
        <div
          v-for="(x, i) in steps"
          :key="x.name"
          class="pd-st"
          :class="[
            i % 2 ? 'up' : 'down',
            i === 3 ? 'next' : i === 0 ? 'first' : ''
          ]"
          :style="{ left: `${(x.k * 100).toFixed(1)}%` }"
          :title="x.note"
        >
          <i></i><b>{{ x.name }}</b
          ><span>{{ md(x.t) }} {{ hm(x.t) }}</span>
        </div>
        <div class="pd-now" :style="{ left: `${(nowK * 100).toFixed(1)}%` }">
          <span>现在</span>
        </div>
      </div>
      <p class="pd-vs">
        <Ic name="bolt" />不处理：{{
          CONSEQ[top.kind]
        }}，集控只能<em>事后</em>止损
      </p>
      <ul class="pd-list">
        <li v-for="t in rest" :key="t.id">
          <span class="code">{{ t.belt }}</span
          ><b>{{ t.where.replace(/^[^ ]+ /, "") }}</b
          ><em>{{ t.name }}</em>
          <div class="sev">
            <i
              :style="{
                width: `${(t.s * 100).toFixed(0)}%`,
                background: `var(${t.s >= 0.7 ? '--l2' : t.s >= 0.35 ? '--l3' : '--predict'})`
              }"
            ></i>
          </div>
          <strong>{{ t.stage }}</strong>
        </li>
      </ul>
    </template>
    <p v-else class="pd-vs">
      <Ic name="check" class="ok" />当前没有在发展的劣化
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { LvTag } from "../tags.js"
  import { fmt, hm, md, pct } from "../ui.js"
  import { DAY } from "../../store/board.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })

  /** 各类劣化放任不管的后果（平台提前量 vs 集控事后跳闸） */
  const CONSEQ = {
    idlerBearing: "卡死升温 → 烟雾 / 超温保护跳闸",
    motorBearing: "轴承抱死 → 电机过流跳闸",
    reducerGear: "断齿 → 驱动失效、全线停车",
    pulleyLagging: "包胶脱落 → 打滑保护跳闸",
    reducerOil: "油温过高 → 超温保护停机"
  }

  const tracks = computed(() => [...props.f.s.tracks].sort((a, b) => b.s - a.s))
  const top = computed(() => tracks.value[0] || null)
  const topLevel = computed(() => (top.value.s >= 0.7 ? 1 : 2))
  /** 计划消缺（今夜检修计划里有就用计划时间） */
  const fix = computed(() =>
    top.value ? props.w.tonight.find((x) => x.track === top.value.id) : null
  )
  const tEnd = computed(() => (fix.value ? fix.value.start : top.value.tFix))
  const lead = computed(() => Math.max(0, (props.f.ms - top.value.tWarn) / DAY))
  const nowK = computed(
    () => (props.f.ms - top.value.t0) / (tEnd.value - top.value.t0)
  )
  const steps = computed(() => {
    const t = top.value
    const span = tEnd.value - t.t0
    return [
      [t.t0, "劣化开始", "光纤听诊轻微异响"],
      [t.tWarn, "三级预警", "DAS + DTS 热点"],
      [t.tAlarm, "二级预警", "自动派单"],
      [
        tEnd.value,
        "计划更换",
        fix.value ? `今晚 ${hm(fix.value.start)} · ${fix.value.crew} 人` : ""
      ]
    ].map(([tt, name, note]) => ({ t: tt, name, note, k: (tt - t.t0) / span }))
  })
  const rest = computed(() => tracks.value.slice(1, 2))
</script>
