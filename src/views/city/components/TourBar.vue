<!--
  底部导览条：显示巡览站点，点击直接飞往该景点。
  10 个站点在 1920 设计稿下单行约 1020px 宽（居中约 x 450～1470），左侧操作提示止于 x 约 248、
  右侧指北针与比例尺始于 x 约 1792，互不重叠；两侧面板下沿在 y 约 610 以上，与导览条不在同一高度。
  余量：两侧控件之间约 1540px，但导览条居中、受离中线更近的左侧操作提示限制，居中时最宽约 1420px；
  以后加站或改按钮字号、内边距，要按这个宽度复核
-->
<template>
  <nav class="tour-bar" aria-label="景点导览">
    <button
      v-for="(item, i) in spots"
      :key="item.name"
      type="button"
      class="tour-btn"
      :aria-current="i === current ? 'true' : 'false'"
      @click="emit('select', i)"
    >
      {{ item.name }}
    </button>
  </nav>
</template>

<script setup>
  defineProps({
    spots: { type: Array, required: true },
    current: { type: Number, default: 0 }
  })

  const emit = defineEmits(["select"])
</script>

<style lang="scss" scoped>
  .tour-bar {
    position: absolute;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    /*
     * left: 50% 的绝对定位元素按「容器宽 − left」（960px）收缩，10 个按钮放不下时文字会折成两行；
     * 按内容撑开宽度、按钮文字不换行，保持单行（按钮高约 37px）
     */
    width: max-content;
    gap: 6px;
    padding: 8px;
    border-radius: 40px;
    background: var(--city-panel);
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(31, 45, 58, 0.14);
  }

  .tour-btn {
    padding: 9px 18px;
    border: 0;
    border-radius: 30px;
    background: transparent;
    font-family: inherit;
    font-size: 13px;
    white-space: nowrap;
    color: var(--city-ink-soft);
    cursor: pointer;
    transition:
      background 0.18s,
      color 0.18s;

    &:hover {
      background: rgba(47, 143, 150, 0.1);
      color: var(--city-ink);
    }

    /* 当前停靠站高亮 */
    &[aria-current="true"] {
      background: var(--city-teal);
      color: #fff;
      font-weight: 600;
    }

    &:focus-visible {
      outline: 2px solid var(--city-teal);
      outline-offset: 2px;
    }
  }
</style>
