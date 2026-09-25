<!-- 底部导览栏：显示巡览停靠点，点击可直接飞往该地标 -->
<template>
  <nav class="tour-progress" aria-label="校园导览点">
    <button
      v-for="(item, i) in landmarks"
      :key="item.name"
      type="button"
      class="stop-btn"
      :aria-current="i === current ? 'true' : 'false'"
      @click="emit('select', i)"
    >
      <span class="stop-idx">{{ String(i + 1).padStart(2, "0") }}</span>
      <span>{{ item.shortName || item.name }}</span>
    </button>
  </nav>
</template>

<script setup>
  defineProps({
    landmarks: { type: Array, required: true },
    current: { type: Number, default: 0 }
  })

  const emit = defineEmits(["select"])
</script>

<style lang="scss" scoped>
  .tour-progress {
    position: absolute;
    bottom: 26px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 7px;
    border: 1px solid var(--school-panel-edge);
    border-radius: 3px;
    background: var(--school-panel);
    backdrop-filter: blur(10px);
    box-shadow: 0 8px 28px rgba(35, 40, 46, 0.13);
  }

  .stop-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 15px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    font-family: inherit;
    font-size: 13.5px;
    letter-spacing: 0.5px;
    color: var(--school-ink-soft);
    cursor: pointer;
    transition:
      background 0.18s,
      color 0.18s;

    &:hover {
      background: rgba(166, 80, 60, 0.08);
      color: var(--school-ink);
    }

    &[aria-current="true"] {
      background: var(--school-brick);
      color: #fff;

      .stop-idx {
        color: rgba(255, 255, 255, 0.7);
      }
    }

    &:focus-visible {
      outline: 2px solid var(--school-brick-deep);
      outline-offset: 2px;
    }
  }

  .stop-idx {
    font-size: 12px;
    color: var(--school-ink-faint);
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .stop-btn {
      transition: none;
    }
  }
</style>
