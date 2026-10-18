<!-- 采掘接续：各工作面回采 / 掘进进度 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>采掘接续<small>2026 年度计划</small></h3>
    <BarRow
      v-for="s in list"
      :key="s.name"
      :k="s.name"
      :v="(s.v * 100).toFixed(0)"
      :unit="s.unit"
      :pct="s.v * 100"
      :color="s.color"
    />
    <div class="cap">LW-B05 预计 2027-02 回采结束，LW-B06 接续</div>
  </section>
</template>

<script setup>
  import BarRow from "./BarRow.vue"

  defineProps({
    list: { type: Array, required: true },
    grow: { type: Boolean, default: false }
  })
</script>
