<!-- 草场长势：全场逐月 NDVI 曲线（2026 / 2025）+ 40 个分区的当月长势矩阵（真实数据） -->
<template>
  <Card title="草场长势" hint="分区矩阵：10 单元 × 4 分区" class="ndvi">
    <div class="ndvi2">
      <div class="ndvi2-chart">
        <NdviChart
          :months="s.months"
          :y26="s.y26"
          :y25="s.y25"
          :month="month"
        />
        <div class="legend-line">
          <span><i class="solid"></i>2026</span
          ><span><i class="dash"></i>2025 同期</span>
        </div>
      </div>
      <div class="mx">
        <div class="mx-h">
          <span></span><span>1</span><span>2</span><span>3</span><span>4</span>
        </div>
        <div v-for="u in layout.units" :key="u.id" class="mx-row">
          <span>{{ u.id }}</span>
          <i
            v-for="id in u.paddocks"
            :key="id"
            class="mx-cell"
            :class="cls(id)"
            :style="{ background: color(id) }"
            :title="id"
            @click="$emit('paddock', id)"
          ></i>
        </div>
        <div class="mx-k"><i class="g"></i>在牧 <i class="r"></i>休牧</div>
      </div>
    </div>
    <p class="note">
      {{ month }} 月全场 NDVI {{ s.y26[mi].toFixed(2) }}，比 2025 年同期
      {{ sign(s.y26[mi] - s.y25[mi], 2) }} · Sentinel-2 真实数据
    </p>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import NdviChart from "../charts/NdviChart.vue"
  import { ndviSeries, rampColor, sign } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    layout: { type: Object, required: true },
    /** 长势月份（底部月份条选的，默认当月） */
    month: { type: Number, default: 7 }
  })
  defineEmits(["paddock"])
  const s = ndviSeries(props.layout)
  const mi = computed(() => s.months.indexOf(props.month))
  const byId = computed(
    () => new Map(props.state.paddocks.map((p) => [p.id, p]))
  )
  const pad = new Map(props.layout.paddocks.map((p) => [p.id, p]))
  // 矩阵颜色跟随选中的月份（真实逐月 NDVI）
  const color = (id) => rampColor(pad.get(id).ndvi["2026"][mi.value])
  const cls = (id) => {
    const st = byId.value.get(id)?.status
    return st === "grazing" ? "grazing" : st === "resting" ? "resting" : ""
  }
</script>
