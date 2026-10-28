<!--
 * 顶部加载进度条：固定在窗口最上沿的细条，状态和控制逻辑在 topProgress.js
-->
<template>
  <div
    class="top-progress"
    :class="{ show: progress.visible, instant: progress.instant }"
    role="progressbar"
    aria-label="页面加载中"
    :aria-valuenow="Math.round(progress.value * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <!-- 整条宽度不变，用平移露出已完成的部分，只动 transform 不触发重排 -->
    <div
      class="bar"
      :style="{
        transform: `translate3d(${(progress.value - 1) * 100}%, 0, 0)`
      }"
    >
      <i class="head"></i>
    </div>
  </div>
</template>

<script setup>
  import { progress } from "./topProgress.js"
  // 细条要在任何屏幕上都是几像素，样式放在不做 px → rem 转换的文件里
  import "./top-progress.no-convert.css"
</script>
