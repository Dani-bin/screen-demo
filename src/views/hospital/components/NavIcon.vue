<!--
  导视图标（与设计稿 scripts/hospital/draft.py 里的 icon() 同一套图形，24 × 24 网格）
  name：straight 直行 / left 左转 / right 右转 / escalator 扶梯 / elevator 电梯 / stairs 楼梯 /
        start 起点 / end 终点 / search 搜索 / swap 交换
  颜色跟随 currentColor
-->
<template>
  <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <template v-if="name === 'straight'">
      <path d="M12 21V8" class="s3" />
      <path d="M12 2l6 7H6z" class="fill" />
    </template>
    <template v-else-if="name === 'left'">
      <path d="M16 22V12H8" class="s3" />
      <path d="M3 12l6-6v12z" class="fill" />
    </template>
    <template v-else-if="name === 'right'">
      <path d="M8 22V12h8" class="s3" />
      <path d="M21 12l-6-6v12z" class="fill" />
    </template>
    <template v-else-if="name === 'escalator'">
      <path d="M1 20h6L17 8h6" class="s3" />
      <circle cx="12" cy="5" r="2.2" class="fill" />
      <path d="M12 8l-1 6" class="s2" />
    </template>
    <template v-else-if="name === 'elevator'">
      <rect x="4.5" y="2.5" width="15" height="19" class="s2" />
      <path d="M12 5.5l4 4.5H8z M12 18.5l4-4.5H8z" class="fill" />
    </template>
    <template v-else-if="name === 'stairs'">
      <path d="M2 21h5v-5h5v-5h5V6h5" class="s3" />
    </template>
    <template v-else-if="name === 'start'">
      <circle cx="12" cy="12" r="6.5" class="s4" />
    </template>
    <template v-else-if="name === 'end'">
      <path
        d="M12 2a7 7 0 0 1 7 7c0 4.4-7 13-7 13S5 13.4 5 9a7 7 0 0 1 7-7z"
        class="fill"
      />
      <circle cx="12" cy="9" r="2.8" class="hole" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10" cy="10" r="6" class="s2" />
      <path d="M14.5 14.5L21 21" class="s3" />
    </template>
    <template v-else-if="name === 'swap'">
      <path d="M8 21V6" class="s2" />
      <path d="M8 1l5 6H3z" class="fill" />
      <path d="M16 3v15" class="s2" />
      <path d="M16 23l5-6H11z" class="fill" />
    </template>
  </svg>
</template>

<script setup>
  defineProps({ name: { type: String, required: true } })
</script>

<style lang="scss" scoped>
  .nav-icon {
    display: block;
    width: 1em;
    height: 1em;
    overflow: visible;
  }
  .fill {
    fill: currentColor;
  }
  .hole {
    fill: var(--icon-hole, #fff);
  }
  .s2,
  .s3,
  .s4 {
    fill: none;
    stroke: currentColor;
    stroke-linejoin: round;
  }
  .s2 {
    stroke-width: 2.4;
  }
  .s3 {
    stroke-width: 3;
  }
  .s4 {
    stroke-width: 5;
  }
</style>
