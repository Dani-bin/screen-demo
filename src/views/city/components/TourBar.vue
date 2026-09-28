<!-- 底部导览条：显示巡览站点，点击直接飞往该景点 -->
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
