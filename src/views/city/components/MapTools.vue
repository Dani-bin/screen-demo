<!-- 右侧地图工具栏：复位 / 放大 / 缩小 / 全屏 / 巡览开关 -->
<template>
  <div class="map-tools">
    <button
      type="button"
      title="复位到总览"
      aria-label="复位到总览"
      @click="emit('reset')"
    >
      ⌂
    </button>
    <hr />
    <button
      type="button"
      title="放大"
      aria-label="放大"
      @click="emit('zoom-in')"
    >
      ＋
    </button>
    <button
      type="button"
      title="缩小"
      aria-label="缩小"
      @click="emit('zoom-out')"
    >
      －
    </button>
    <hr />
    <button
      type="button"
      title="全屏"
      aria-label="全屏"
      @click="emit('fullscreen')"
    >
      ⛶
    </button>
    <!-- 巡览开关：播放中显示暂停图标，暂停时显示播放图标 -->
    <button
      type="button"
      :title="playing ? '暂停巡览' : '开始巡览'"
      aria-label="自动巡览"
      :aria-pressed="playing"
      :class="{ on: playing }"
      @click="emit('toggle-play')"
    >
      {{ playing ? "❚❚" : "▶" }}
    </button>
  </div>
</template>

<script setup>
  defineProps({
    playing: { type: Boolean, default: true }
  })

  const emit = defineEmits([
    "reset",
    "zoom-in",
    "zoom-out",
    "fullscreen",
    "toggle-play"
  ])
</script>

<style lang="scss" scoped>
  .map-tools {
    position: absolute;
    right: 28px;
    top: 92px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 12px;
    background: var(--city-panel);
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(31, 45, 58, 0.12);

    button {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      font-size: 15px;
      color: var(--city-ink);
      cursor: pointer;

      &:hover {
        background: rgba(47, 143, 150, 0.1);
      }

      &.on {
        background: rgba(47, 143, 150, 0.14);
        color: var(--city-teal);
      }

      /* 键盘聚焦时的可见焦点框 */
      &:focus-visible {
        outline: 2px solid var(--city-teal);
        outline-offset: 2px;
      }
    }

    hr {
      margin: 2px 4px;
      border: 0;
      border-top: 1px solid var(--city-line);
    }
  }
</style>
