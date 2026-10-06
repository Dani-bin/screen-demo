<!--
  右侧大预览
  所有演示的预览图叠放在同一块「屏幕」里，只显示当前项，切换时交叉淡入淡出；
  全部图片一开始就挂载，相当于预加载，切换时不闪白。整块屏幕可点击进入演示。
-->
<template>
  <section class="demo-stage">
    <button
      type="button"
      class="stage-screen"
      :aria-label="`进入演示：${demos[current].name}`"
      @click="emit('enter')"
    >
      <PreviewImage
        v-for="(item, i) in demos"
        :key="item.key"
        :demo="item"
        class="stage-shot"
        :class="{ active: i === current }"
      />
      <span class="stage-hint">点击进入全屏演示</span>
    </button>
  </section>
</template>

<script setup>
  import PreviewImage from "./PreviewImage.vue"

  defineProps({
    demos: { type: Array, required: true },
    current: { type: Number, required: true }
  })

  const emit = defineEmits(["enter"])
</script>

<style lang="scss" scoped>
  .demo-stage {
    flex: none;
    width: 1080px;
  }

  /* 模拟一块显示屏：白色外框 + 下方投影 */
  .stage-screen {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 0;
    border-radius: 18px;
    overflow: hidden;
    background: #fff;
    cursor: pointer;
    box-shadow:
      0 0 0 10px #fff,
      0 50px 100px -40px rgba(31, 45, 58, 0.45);
    transition:
      transform 0.3s ease,
      box-shadow 0.3s ease;

    &:hover {
      transform: translateY(-4px);
      box-shadow:
        0 0 0 10px #fff,
        0 60px 110px -40px rgba(31, 45, 58, 0.5);

      .stage-hint {
        opacity: 1;
        transform: none;
      }
    }

    &:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 14px;
    }
  }

  .stage-shot {
    position: absolute;
    inset: 0;
    opacity: 0;
    /* 占位块里演示名的字号 */
    font-size: 32px;
    transition: opacity 0.6s ease;

    &.active {
      opacity: 1;
    }
  }

  /* 悬停时右下角浮出的进入提示 */
  .stage-hint {
    position: absolute;
    right: 24px;
    bottom: 24px;
    padding: 12px 22px;
    border-radius: 999px;
    background: rgba(31, 45, 58, 0.82);
    color: #fff;
    font-size: 16px;
    letter-spacing: 1px;
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .stage-screen,
    .stage-screen:hover {
      transform: none;
    }

    .stage-shot {
      transition-duration: 0.15s;
    }
  }
</style>
