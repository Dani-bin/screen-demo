<!-- 称重日增重：称重通道 WS-01 近 7 天羔羊、育肥牛的平均日增重 -->
<template>
  <Card
    title="称重日增重"
    :hint="`称重通道 WS-01 · 今日过秤 ${w.count} 只`"
    class="weighcard"
  >
    <div class="wg">
      <div class="wg-i">
        <span>羔羊</span><b>{{ last(w.lamb) }}<small>g/天</small></b>
        <Spark :values="w.lamb" :w="110" :h="30" color="#2f8f4e" />
      </div>
      <div class="wg-i">
        <span>育肥牛</span
        ><b>{{ last(w.steer).toFixed(2) }}<small>kg/天</small></b>
        <Spark :values="w.steer" :w="110" :h="30" color="#c08a5a" />
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import Spark from "../charts/Spark.vue"

  const props = defineProps({ state: { type: Object, required: true } })
  const w = computed(() => props.state.weigh)
  const last = (a) => a[a.length - 1]
</script>
