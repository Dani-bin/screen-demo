<!--
  O2 五大决策：对最严重的劣化项回答 修不修 / 何时修 / 修什么 / 谁来修 / 怎么修
  （依据：严重度与剩余寿命、检修计划里的时段和人数、劣化类型对应的备件与作业步骤）
-->
<template>
  <Panel no="M2" title="五大决策" en="WHETHER · WHEN · WHAT · WHO · HOW">
    <template v-if="tr">
      <div class="dc-h">
        <span class="tag-pred">平台预警</span><b>{{ tr.where }}</b
        ><em>{{ tr.name }} · {{ pct(tr.s) }}</em>
      </div>
      <dl class="dc">
        <div v-for="x in items" :key="x.q">
          <dt>{{ x.q }}</dt>
          <dd>{{ x.a }}</dd>
        </div>
      </dl>
    </template>
    <p v-else class="none">当前没有需要决策的劣化</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, hm, md, pct } from "../ui.js"
  import { rulOf } from "../../store/diag.js"
  import { SPARES } from "../../data/ops.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  /** 每类劣化的作业步骤 */
  const HOW = {
    idlerBearing: "挂牌闭锁 → 拆托辊 → 换新 → 试车 → 光纤听诊复测",
    motorBearing: "停机断电 → 拆端盖 → 换轴承 → 对中 → 振动复测",
    reducerGear: "停机放油 → 开箱检查 → 换齿轮组 → 加油 → 频谱复测",
    pulleyLagging: "挂牌闭锁 → 清理滚筒 → 冷粘包胶 → 固化 → 试车",
    reducerOil: "停机放油 → 清洗冷却器 → 换油 → 试车 → 油温复测"
  }
  /** 当班机电人员（演示） */
  const LEADS = ["刘志强", "周立新", "陈国栋"]

  const tr = computed(
    () => [...props.f.s.tracks].sort((a, b) => b.s - a.s)[0] || null
  )
  const items = computed(() => {
    const t = tr.value
    const rul = rulOf(t, props.f.ms)
    const wo = props.w.tonight.find((x) => x.track === t.id)
    const parts = SPARES.filter((p) => p.kind === t.kind)
      .map((p) => `${p.name} × ${p.per}`)
      .join("、")
    return [
      {
        q: "修不修",
        a:
          t.s >= 0.7
            ? `修。严重度 ${pct(t.s)} 已过二级，放任约 ${fmt(rul.days, 1)} 天失效`
            : t.s >= 0.35
              ? `修，排进计划。严重度 ${pct(t.s)}，剩余约 ${fmt(rul.days, 1)} 天`
              : "暂不修，持续观察"
      },
      {
        q: "何时修",
        a: wo
          ? `${md(wo.start)} ${hm(wo.start)}–${hm(wo.end)} 零点班检修窗口，不占生产时间`
          : `计划 ${md(t.tFix)} 零点班`
      },
      { q: "修什么", a: `${t.where}：${parts}` },
      {
        q: "谁来修",
        a: `机电班 ${wo ? wo.crew : 3} 人 · 带班 ${LEADS[t.id.length % LEADS.length]}`
      },
      { q: "怎么修", a: HOW[t.kind] }
    ]
  })
</script>
