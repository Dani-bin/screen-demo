<!-- 本周航次按船型（单系列横条 + 数字；来自周泊位计划） -->
<template>
  <Panel title="本周航次 · 船型" en="WEEKLY CALLS" fill>
    <div v-for="x in byClass" :key="x.k" class="hb-r">
      <span>{{ x.name }}</span>
      <div class="hb-t">
        <s :style="{ width: (x.n / max) * 100 + '%' }"></s>
      </div>
      <b>{{ x.n }}</b
      ><em>航次</em>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"

  const props = defineProps({ byClass: { type: Array, default: () => [] } })
  const max = computed(() => Math.max(...props.byClass.map((x) => x.n), 1))
</script>
