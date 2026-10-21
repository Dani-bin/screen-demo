<!-- 地图右侧工具条（图层 / 视角 / 工具）+ 沙盘下方的长势月份条（可播放） -->
<template>
  <div class="maptools">
    <div class="mt-g">
      <span class="mt-k">图层</span>
      <span
        v-for="l in LAYERS"
        :key="l.key"
        :class="{
          on:
            l.key === layer ||
            (l.key === 'herds' && herds) ||
            (l.key === 'devices' && devices)
        }"
        @click="$emit('layer', l.key)"
        >{{ l.name }}</span
      >
    </div>
    <div class="mt-g">
      <span class="mt-k">视角</span>
      <span
        :class="{ on: view === 'overview' && !touring }"
        @click="$emit('view', 'overview')"
        >全景</span
      >
      <span :class="{ on: touring }" @click="$emit('view', 'tour')">巡游</span>
      <span :class="{ on: view === 'top' }" @click="$emit('view', 'top')"
        >二维</span
      >
    </div>
    <div class="mt-g">
      <span class="mt-k">工具</span>
      <span :class="{ on: measuring }" @click="$emit('tool', 'measure')"
        >测距</span
      >
      <span @click="$emit('tool', 'reset')">复位</span>
    </div>
  </div>
  <div class="monthbar">
    <span class="mb-k">长势月份</span>
    <span
      v-for="m in MONTHS"
      :key="m"
      :class="{ on: m === Math.round(month) }"
      @click="$emit('month', m)"
      >{{ m }}月</span
    >
    <span class="play" @click="$emit('play')">{{
      playing ? "■ 停止" : "▶ 播放"
    }}</span>
    <div class="ramp">
      <i></i><span>NDVI 0.2</span><span>0.5</span><span>0.8</span>
    </div>
  </div>
</template>

<script setup>
  defineProps({
    layer: { type: String, default: "ndvi" },
    herds: { type: Boolean, default: false },
    devices: { type: Boolean, default: false },
    view: { type: String, default: "overview" },
    touring: { type: Boolean, default: false },
    measuring: { type: Boolean, default: false },
    month: { type: Number, default: 7 },
    playing: { type: Boolean, default: false }
  })
  defineEmits(["layer", "view", "tool", "month", "play"])
  const LAYERS = [
    { key: "ndvi", name: "长势" },
    { key: "rotation", name: "轮牧" },
    { key: "herds", name: "畜群" },
    { key: "devices", name: "设备" },
    { key: "heat", name: "热力" }
  ]
  const MONTHS = [4, 5, 6, 7, 8, 9, 10]
</script>
