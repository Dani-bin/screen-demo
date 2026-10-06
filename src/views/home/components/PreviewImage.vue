<!--
  演示预览图
  图片加载失败（如新演示还没跑截图脚本）时显示主题色淡色占位块与演示名，不露破图。
  占位文字字号继承父元素：大预览与缩略图各自设定。
-->
<template>
  <div
    class="preview-image"
    :style="{ '--ph-bg': alpha(demo.accent, 0.14), '--ph-ink': demo.accent }"
  >
    <img
      v-if="!failed"
      :src="previewUrl(demo.preview)"
      :alt="`${demo.name} 预览图`"
      draggable="false"
      @error="failed = true"
    />
    <span v-else class="preview-placeholder">{{ demo.name }}</span>
  </div>
</template>

<script setup>
  import { previewUrl, alpha } from "../utils"

  defineProps({
    demo: { type: Object, required: true }
  })

  /** 图片是否加载失败 */
  const failed = ref(false)
</script>

<style lang="scss" scoped>
  .preview-image {
    position: relative;
    overflow: hidden;
    background: var(--ph-bg);

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  .preview-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: 2px;
    color: var(--ph-ink);
  }
</style>
