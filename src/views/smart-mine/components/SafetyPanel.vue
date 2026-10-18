<!-- 安全监测：工作面主要测点 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>
      安全监测<small
        >测点 <b>{{ online.total }}</b> · 在线
        <b>{{ (online.rate * 100).toFixed(1) }}%</b></small
      >
    </h3>
    <div class="sensors">
      <SensorCard
        name="回风隅角 CH₄"
        :value="g.t1.v.toFixed(2)"
        unit="%"
        :st="g.t1.st"
      />
      <SensorCard
        name="工作面 CH₄"
        :value="g.t0.v.toFixed(2)"
        unit="%"
        :st="g.t0.st"
      />
      <SensorCard
        name="回风巷 CH₄"
        :value="g.t2.v.toFixed(2)"
        unit="%"
        :st="g.t2.st"
      />
      <SensorCard name="工作面 CO" :value="g.co.v" unit="ppm" :st="g.co.st" />
      <SensorCard name="总回风量" :value="fmt(vent.ret)" unit="m³/min" />
      <SensorCard
        name="工作面温度"
        :value="g.temp.v.toFixed(1)"
        unit="℃"
        :st="g.temp.st"
      />
    </div>
  </section>
</template>

<script setup>
  import SensorCard from "./SensorCard.vue"
  import { fmt } from "../utils"

  defineProps({
    g: { type: Object, required: true },
    vent: { type: Object, required: true },
    online: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
</script>
