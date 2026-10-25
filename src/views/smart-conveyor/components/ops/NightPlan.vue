<!--
  O1 今夜检修：零点班（00:00–08:00）检修计划，每项一行：任务、皮带、时段、人数、来源（平台预警消缺 / 例行）；
  点一项三维飞到检修位置
-->
<template>
  <Panel no="M1" title="今夜检修" en="TONIGHT · 00:00–08:00">
    <div class="np-sum">
      <span>{{ dateText }} 零点班</span><b>{{ list.length }}</b
      ><em>项</em> <span>预警消缺</span><b class="pred">{{ fromPred }}</b
      ><em>项</em> <span>出动</span><b>{{ crew }}</b
      ><em>人次</em>
    </div>
    <ul class="np">
      <li
        v-for="x in list"
        :key="x.id"
        :class="{ pred: x.track }"
        @click="emit('locate', x)"
      >
        <span class="code">{{ hm(x.start) }}–{{ hm(x.end) }}</span>
        <b>{{ x.title }}</b>
        <em>{{ x.track ? "预警消缺" : "例行" }}</em>
        <i>{{ x.crew }} 人</i>
      </li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { hm, md } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const emit = defineEmits(["locate"])

  const list = computed(() =>
    [...props.w.tonight].sort((a, b) => a.start - b.start)
  )
  const fromPred = computed(() => list.value.filter((x) => x.track).length)
  const crew = computed(() => list.value.reduce((a, x) => a + x.crew, 0))
  const dateText = computed(() =>
    list.value[0] ? md(list.value[0].start) : ""
  )
</script>
