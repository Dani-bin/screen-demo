<!-- 安全监测：可燃气体浓度、LNG 罐压 / 液温、静电接地、视频在线、安全运行天数 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <ShieldCheck />
      <h3>安全监测</h3>
      <span class="unit">罐区 / 加油加气区</span>
    </div>
    <KpiGrid :items="items" />
  </section>
</template>

<script setup>
  import { ShieldCheck } from "lucide-vue-next"
  import KpiGrid from "./KpiGrid.vue"

  const props = defineProps({ safety: { type: Object, required: true } })
  const items = computed(() => {
    const s = props.safety
    return [
      {
        label: "可燃气体",
        value: s.lel.toFixed(1),
        unit: "%LEL",
        color: s.lel > 10 ? "#ff4d5a" : "#3ddc97"
      },
      { label: "LNG 罐压", value: s.lngMpa.toFixed(2), unit: "MPa" },
      { label: "LNG 液温", value: s.lngTemp.toFixed(0), unit: "°C" },
      {
        label: "静电接地",
        value: s.grounding ? "正常" : "异常",
        text: true,
        color: s.grounding ? "#3ddc97" : "#ff4d5a"
      },
      { label: "视频在线", value: s.video[0], unit: `/${s.video[1]} 路` },
      { label: "安全运行", value: s.safeDays, unit: "天", color: "#2de2e6" }
    ]
  })
</script>
