<!-- 回风隅角 T1 瓦斯 24 h 曲线（预警 0.8%、断电 1.0%） -->
<template>
  <AreaChart
    :values="g.series"
    :min="0.2"
    :max="1.2"
    :lines="LINES"
    :xlabels="xlabels"
  />
</template>

<script setup>
  import AreaChart from "./AreaChart.vue"

  const props = defineProps({ g: { type: Object, required: true } })
  const LINES = [
    { v: 0.8, c: "#ffcf3a", t: "预警 0.8%" },
    { v: 1.0, c: "#ff4d5a", t: "断电 1.0%" }
  ]
  /** 每 6 小时一个整点标签，最后一个是「现在」 */
  const xlabels = computed(() => {
    const h0 = props.g.seriesStart
    const hh = (i) => String((((h0 + i) % 24) + 24) % 24).padStart(2, "0")
    return [0, 6, 12, 18].map((i) => [i, `${hh(i)}:00`]).concat([[23, "现在"]])
  })
</script>
