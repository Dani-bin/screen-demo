<!--
  A4 环：各环境监测分站的 CO、甲烷、粉尘、温度、湿度；按"离限值最近"排序，超限标红、接近（≥ 80 %）标黄。
  限值按《煤矿安全规程》常用值：CO 24 ppm、CH4 1.0 %（皮带巷）、粉尘 10 mg/m³、温度 26 °C。
-->
<template>
  <Panel no="A4" title="环 · 环境监测" en="ENVIRONMENT · 18 STATIONS">
    <table class="ev">
      <thead>
        <tr>
          <th>分站</th>
          <th>CO ppm</th>
          <th>CH₄ %</th>
          <th>粉尘 mg/m³</th>
          <th>温度 °C</th>
          <th>湿度 %</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            <b class="code">{{ r.id.replace(/-EN0?/, "·") }}</b>
          </td>
          <td :class="cls(r.r.co, LIM.co)">{{ fmt(r.r.co, 1) }}</td>
          <td :class="cls(r.r.ch4, LIM.ch4)">{{ fmt(r.r.ch4, 2) }}</td>
          <td :class="cls(r.r.dust, LIM.dust)">{{ fmt(r.r.dust, 1) }}</td>
          <td :class="cls(r.r.temp, LIM.temp)">{{ fmt(r.r.temp, 1) }}</td>
          <td>{{ fmt(r.r.rh, 0) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="ev-sum">
      {{ w.env.length }} 个分站 · 超限
      <b :class="{ hot: over }">{{ over }}</b> · 接近限值 <b>{{ near }}</b> ·
      按离限值远近排序
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const LIM = { co: 24, ch4: 1.0, dust: 10, temp: 26 }
  /** 各项占限值的最大比例 */
  const ratio = (r) =>
    Math.max(
      r.co / LIM.co,
      r.ch4 / LIM.ch4,
      r.dust / LIM.dust,
      r.temp / LIM.temp
    )
  const cls = (v, lim) => (v >= lim ? "over" : v >= lim * 0.8 ? "near" : "")
  const sorted = computed(() =>
    [...props.w.env].sort((a, b) => ratio(b.r) - ratio(a.r))
  )
  const rows = computed(() => sorted.value.slice(0, 9))
  const over = computed(() => props.w.env.filter((x) => ratio(x.r) >= 1).length)
  const near = computed(
    () => props.w.env.filter((x) => ratio(x.r) >= 0.8 && ratio(x.r) < 1).length
  )
</script>
