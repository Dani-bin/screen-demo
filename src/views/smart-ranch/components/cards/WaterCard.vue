<!-- 饮水点：16 个水罐液位（低于 20% 或泵故障标红）+ 今日供水与走势；点一个飞过去 -->
<template>
  <Card title="饮水点" hint="液位低于 20% 告警" class="water">
    <div class="wd">
      <div class="wgrid">
        <div
          v-for="w in state.water"
          :key="w.id"
          class="wp"
          :class="{ bad: w.pump === 'fault' || w.level < 20 }"
          @click="$emit('water', w.id)"
        >
          <span class="wl"><i :style="{ height: `${w.level}%` }"></i></span
          ><b>{{ w.id.slice(3) }}</b>
        </div>
      </div>
      <div class="wd-s">
        <span>供水</span
        ><b>{{ state.ranch.suppliedM3.toFixed(1) }}<small>m³</small></b>
        <Spark :values="supplied" :w="92" :h="26" />
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import Spark from "../charts/Spark.vue"

  defineProps({
    state: { type: Object, required: true },
    /** 今日逐时累计供水（m³） */
    supplied: { type: Array, default: () => [] }
  })
  defineEmits(["water"])
</script>
