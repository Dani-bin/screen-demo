<!--
  园区安防（演示数据）：6 格指标
-->
<template>
  <section>
    <PanelTitle title="园区安防" />
    <div class="body">
      <div class="cells">
        <div v-for="c in SECURITY" :key="c.label" class="cell" :class="c.tone">
          <b class="num">{{ c.value }}</b
          ><small>{{ c.unit }}</small>
          <span>{{ c.label }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import { SECURITY } from "../../data/park"
</script>
