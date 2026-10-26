<!-- 操作记录：本次人工干预的集控操作；没有时显示今日主煤流的保护动作（从事件里取） -->
<template>
  <Panel no="R4" title="操作与联锁记录" en="OPERATION LOG">
    <ul class="ol">
      <li v-for="(x, i) in items" :key="i" :class="x.cls">
        <span class="code">{{ hm(x.at) }}</span
        ><i></i><b>{{ x.text }}</b
        ><em>{{ x.by }}</em>
      </li>
      <li v-if="!items.length" class="none">今日无人工操作 · 全自动运行</li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { hm } from "../ui.js"

  const props = defineProps({
    w: { type: Object, required: true },
    ctl: { type: Object, required: true }
  })
  // 人工操作在前，其后是今日保护跳闸（自动联锁）
  const items = computed(() =>
    [
      ...props.ctl.log.map((x) => ({
        at: x.at,
        text: x.text,
        by: "集控员",
        cls: "op"
      })),
      ...props.w.today
        .filter((e) => e.kind === "trip")
        .sort((a, b) => b.at - a.at)
        .map((e) => ({ at: e.at, text: e.title, by: "保护联锁", cls: "trip" }))
    ].slice(0, 7)
  )
</script>
