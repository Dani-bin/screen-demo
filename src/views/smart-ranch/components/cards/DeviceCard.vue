<!-- 设备在线：项圈、中继基站、摄像头、提水泵 -->
<template>
  <Card title="设备在线" class="devices">
    <div class="dvs">
      <div class="dv">
        <span>项圈</span
        ><b>{{ state.collars.online }}/{{ state.collars.total }}</b>
        <em
          >低电 {{ state.collars.lowBattery }} · 离线
          {{ state.collars.total - state.collars.online }}</em
        >
      </div>
      <div class="dv">
        <span>中继基站</span
        ><b>{{ layout.stations.length }}/{{ layout.stations.length }}</b
        ><em>太阳能 · LoRa</em>
      </div>
      <div class="dv">
        <span>摄像头</span
        ><b>{{ layout.cameras.length }}/{{ layout.cameras.length }}</b
        ><em>360° 全景</em>
      </div>
      <div class="dv" :class="{ bad: pumps.fault }">
        <span>提水泵</span
        ><b
          >{{ (pumps.run || 0) + (pumps.stop || 0) }}/{{
            state.water.length
          }}</b
        >
        <em>运行 {{ pumps.run || 0 }} · 故障 {{ pumps.fault || 0 }}</em>
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"

  const props = defineProps({
    state: { type: Object, required: true },
    layout: { type: Object, required: true }
  })
  const pumps = computed(() =>
    props.state.water.reduce(
      (a, w) => ((a[w.pump] = (a[w.pump] || 0) + 1), a),
      {}
    )
  )
</script>
