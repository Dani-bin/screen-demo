<!--
  图表悬停提示：一个跟着鼠标走的小卡片，位置取舞台设计像素，靠近右 / 下边缘时翻到鼠标另一侧
  内容由 board.showTip(事件, 标题, 行[]) 写入；行 = { c?: 色块颜色, k: 名称, v: 数值 }
-->
<template>
  <div v-if="tip.on" class="tip" :style="style">
    <div class="th">{{ tip.title }}</div>
    <div v-for="r in tip.rows" :key="r.k" class="tr">
      <span><b v-if="r.c" :style="{ background: r.c }"></b>{{ r.k }}</span
      ><span class="num">{{ r.v }}</span>
    </div>
  </div>
</template>

<script setup>
  const { tip } = inject("board")
  const style = computed(() => ({
    left: tip.x + "px",
    top: tip.y + "px",
    transform: `translate(${tip.x > 1560 ? "calc(-100% - 14px)" : "14px"}, ${tip.y > 900 ? "calc(-100% - 12px)" : "12px"})`
  }))
</script>
