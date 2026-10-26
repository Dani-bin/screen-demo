<!-- A2 机：设备类告警（含平台预警）列表 + 今日各类设备事件次数 -->
<template>
  <Panel no="A2" title="机 · 设备告警" en="MACHINE · PHM + PROTECTION">
    <div class="mc-k">
      <div v-for="x in kinds" :key="x.k">
        <b>{{ x.n }}</b
        ><span>{{ x.k }}</span>
      </div>
    </div>
    <ul class="mc-l">
      <li
        v-for="a in list"
        :key="a.id"
        :class="{ pred: a.predictive, done: a.done }"
        @click="!a.done && emit('pick', a)"
      >
        <LvTag :l="a.level" /><b>{{ a.title }}</b
        ><em>{{ a.done ? "已处理" : a.predictive ? "平台预警" : a.status }}</em
        ><span class="code">{{ hm(a.at) }}</span>
      </li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { LvTag } from "../tags.js"
  import { hm } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const emit = defineEmits(["pick"])

  const kinds = computed(() => {
    const t = props.w.today.filter((e) => e.dim === "machine")
    const n = (...k) => t.filter((e) => k.includes(e.kind)).length
    return [
      { k: "保护跳闸", n: n("trip") },
      { k: "跑偏", n: n("deviation") },
      { k: "打滑预警", n: n("slipWarn") },
      { k: "通信 / 电量", n: n("comm", "battery") },
      { k: "平台预警", n: props.f.s.alarms.filter((a) => a.predictive).length }
    ]
  })
  // 未结束的在前，再补今日已处理的
  const list = computed(() => {
    const active = props.f.s.alarms.filter((a) => a.dim === "machine")
    const done = props.w.closed
      .filter((e) => e.dim === "machine")
      .map((e) => ({ ...e, done: true }))
    return [...active, ...done].slice(0, 7)
  })
</script>
