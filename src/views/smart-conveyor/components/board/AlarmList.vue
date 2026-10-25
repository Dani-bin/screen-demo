<!--
  07 实时告警：未结束告警（平台预警紫色、读数存疑 / 过期的标出来），最后一行是今日已处理条数和最近一条；
  点一条飞到告警位置
-->
<template>
  <Panel no="07" title="实时告警" en="LIVE ALARMS">
    <ul class="al">
      <li
        v-for="a in alarms"
        :key="a.id"
        :class="[{ pred: a.predictive }, a.quality ? `q-${a.quality}` : '']"
        @click="emit('pick', a)"
      >
        <LvTag :l="a.level" /><DimTag :k="a.dim" />
        <div class="al-t">
          <b>{{ a.title }}</b
          ><span
            ><Ic :name="SENSE_ICON[a.sense] || 'pin'" />{{ a.sense }} ·
            {{ loc(a) }}</span
          >
        </div>
        <div class="al-s">
          <em>{{ a.predictive ? "平台预警" : a.status }}</em
          ><span>{{ md(a.at) }} {{ hm(a.at) }}</span>
        </div>
      </li>
      <li v-if="!alarms.length" class="sep">
        <Ic name="check" class="ok" /><span>当前没有未结束告警</span>
      </li>
      <li v-if="last" class="sep">
        <Ic name="check" class="ok" /><span
          >今日已处理 <b>{{ w.closed.length }}</b> 条 · 最近 {{ hm(last.at) }}
          {{ last.title }}（{{ loc(last) }}）</span
        >
      </li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { DimTag, LvTag } from "../tags.js"
  import { SENSE_ICON, beltShort, fmt, hm, md } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const emit = defineEmits(["pick"])

  // 一级在前；同级保持仿真器给的顺序（稳定排序）
  const alarms = computed(() =>
    [...props.f.s.alarms].sort((a, b) => a.level - b.level)
  )
  const last = computed(() => props.w.closed[0] || null)
  /** 位置：皮带短名 · 里程 */
  const loc = (a) =>
    `${a.belt ? beltShort(layout, a.belt) : ""}${a.chainage != null ? ` · ${fmt(a.chainage)} m` : ""}`
</script>
