<!--
  底部演示列表
  当前项底边的进度条就是轮播计时器：CSS 动画走完一次即发出 finish，由页面切到下一个；
  暂停只是把动画停住（animation-play-state），恢复后从停住处继续。
  进度条以 round 为 key，每次切换都会重新挂载、从头开始走。
-->
<template>
  <nav class="demo-rail" aria-label="演示列表">
    <button
      v-for="(item, i) in demos"
      :key="item.key"
      type="button"
      class="rail-item"
      :class="{ active: i === current }"
      :style="{ '--item-accent': item.accent }"
      :aria-current="i === current ? 'true' : null"
      @click="emit('select', i)"
    >
      <PreviewImage :demo="item" class="rail-thumb" />
      <span class="rail-text">
        <b class="rail-no">{{ pad2(i + 1) }}</b>
        <span class="rail-name">{{ item.name }}</span>
        <span class="rail-sub">{{ item.subTitle }}</span>
      </span>
      <i
        v-if="autoplay && i === current"
        :key="round"
        class="rail-progress"
        :style="{
          animationDuration: `${duration}s`,
          animationPlayState: paused ? 'paused' : 'running'
        }"
        @animationend="emit('finish')"
      ></i>
    </button>
  </nav>
</template>

<script setup>
  import PreviewImage from "./PreviewImage.vue"
  import { pad2 } from "../utils"

  defineProps({
    demos: { type: Array, required: true },
    current: { type: Number, required: true },
    /** 切换计数，用作进度条的 key */
    round: { type: Number, required: true },
    /** 是否轮播：只有一个演示时为 false，不显示进度条 */
    autoplay: { type: Boolean, default: true },
    /** 是否暂停（鼠标悬停在内容区上） */
    paused: { type: Boolean, default: false },
    /** 轮播间隔（秒） */
    duration: { type: Number, required: true }
  })

  const emit = defineEmits(["select", "finish"])
</script>

<style lang="scss" scoped>
  .demo-rail {
    flex: none;
    margin-top: 24px;
    display: flex;
    /* 一行最多放 4 项（380 宽 + 24 间距）。不设 overflow 滚动：会把当前项的投影裁掉；
       演示超过 4 个时再改为横向滚动并给投影留出内边距 */
    gap: 24px;
  }

  .rail-item {
    position: relative;
    flex: none;
    width: 380px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px;
    border: 0;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.55);
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 0.3s ease,
      box-shadow 0.3s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.85);
    }

    &.active {
      background: #fff;
      box-shadow: 0 16px 40px -20px rgba(31, 45, 58, 0.35);

      .rail-no {
        color: var(--item-accent);
      }
    }

    &:focus-visible {
      outline: 3px solid var(--item-accent);
      outline-offset: 2px;
    }
  }

  .rail-thumb {
    flex: none;
    width: 132px;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    /* 占位块里演示名的字号 */
    font-size: 12px;
  }

  .rail-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rail-no {
    font-family: "DIN";
    font-weight: normal;
    font-size: 14px;
    color: var(--ink-faint);
  }

  .rail-name {
    font-size: 18px;
    color: var(--ink);
  }

  .rail-sub {
    font-size: 14px;
    color: var(--ink-faint);
  }

  /* 进度条：用 scaleX 而不是 width 做动画，只走合成层 */
  .rail-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--item-accent);
    transform-origin: left center;
    animation-name: rail-progress;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes rail-progress {
    from {
      transform: scaleX(0);
    }

    to {
      transform: scaleX(1);
    }
  }
</style>
