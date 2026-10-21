<!-- 生产作业：剪毛、药浴、冬羔配种、打草储草、秋季防疫的进度（节点见 02 调研的季节日历） -->
<template>
  <Card title="生产作业" class="ops-card">
    <ul class="ops">
      <li v-for="o in state.ops" :key="o.id" :class="o.state">
        <span class="op-n">{{ o.name }}</span>
        <span class="op-b"
          ><i :style="{ width: `${o.state === 'done' ? 100 : pct(o)}%` }"></i
        ></span>
        <span class="op-v">{{
          o.unit ? `${fmt(o.done)} / ${fmt(o.total)} ${o.unit}` : ST[o.state]
        }}</span>
      </li>
    </ul>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import { fmt } from "../../utils.js"

  defineProps({ state: { type: Object, required: true } })
  const ST = { done: "已完成", doing: "进行中", todo: "未开始" }
  const pct = (o) => (o.total ? (o.done / o.total) * 100 : 0)
</script>
