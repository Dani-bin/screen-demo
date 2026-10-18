<!-- 瓦斯监测：在采工作面 T0 / T1 / T2 / CO，下面是 T1 回风隅角 24 h 曲线 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>瓦斯监测<small>LW-B05 工作面</small></h3>
    <div class="sensors">
      <SensorCard
        name="T1 回风隅角"
        :value="g.t1.v.toFixed(2)"
        unit="%"
        :st="g.t1.st"
      />
      <SensorCard
        name="T0 工作面"
        :value="g.t0.v.toFixed(2)"
        unit="%"
        :st="g.t0.st"
      />
      <SensorCard
        name="T2 回风顺槽"
        :value="g.t2.v.toFixed(2)"
        unit="%"
        :st="g.t2.st"
      />
      <SensorCard name="CO" :value="g.co.v" unit="ppm" :st="g.co.st" />
    </div>
    <div class="cap">T1 回风隅角瓦斯（%）· 24 h</div>
    <T1Chart :g="g" />
  </section>
</template>

<script setup>
  import SensorCard from "./SensorCard.vue"
  import T1Chart from "./T1Chart.vue"

  defineProps({
    g: { type: Object, required: true },
    grow: { type: Boolean, default: false }
  })
</script>
