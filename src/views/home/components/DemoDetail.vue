<!--
  左栏：当前演示的介绍
  切换演示时整块淡出、再从下方淡入（Transition 以演示 key 为 key）。
-->
<template>
  <section class="demo-detail">
    <Transition name="swap" mode="out-in">
      <div :key="demo.key" class="detail-body">
        <div class="detail-index">
          {{ pad2(index + 1) }}<small> / {{ pad2(total) }}</small>
        </div>
        <h2 class="detail-name">{{ demo.name }}</h2>
        <div class="detail-en">{{ demo.en }}</div>
        <div class="detail-sub">{{ demo.subTitle }}</div>
        <p class="detail-desc">{{ demo.desc }}</p>
        <ul class="detail-tags">
          <li v-for="tag in demo.tags" :key="tag">{{ tag }}</li>
        </ul>
        <div class="detail-stats">
          <div v-for="stat in demo.stats" :key="stat.key" class="stat">
            <b
              >{{ stat.value }}<small>{{ stat.unit }}</small></b
            >
            <span>{{ stat.key }}</span>
          </div>
        </div>
        <button type="button" class="enter-btn" @click="emit('enter')">
          进入演示
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </Transition>
  </section>
</template>

<script setup>
  import { pad2 } from "../utils"

  defineProps({
    demo: { type: Object, required: true },
    /** 当前演示的序号（从 0 起） */
    index: { type: Number, required: true },
    /** 演示总数 */
    total: { type: Number, required: true }
  })

  const emit = defineEmits(["enter"])
</script>

<style lang="scss" scoped>
  .demo-detail {
    flex: none;
    width: 584px;
  }

  /* 序号：主题色数字 + 一段短横线 */
  .detail-index {
    display: flex;
    align-items: center;
    gap: 14px;
    font-family: "DIN";
    font-size: 20px;
    letter-spacing: 2px;
    color: var(--accent);
    transition: color 0.6s ease;

    small {
      font-size: inherit;
      color: var(--ink-faint);
    }

    &::after {
      content: "";
      width: 64px;
      height: 2px;
      background: currentColor;
    }
  }

  .detail-name {
    margin: 26px 0 0;
    font-family: "Alimama ShuHeiTi";
    font-weight: normal;
    font-size: 64px;
    line-height: 1.15;
    letter-spacing: 3px;
    color: var(--ink);
  }

  .detail-en {
    margin-top: 14px;
    font-family: "DIN";
    font-size: 15px;
    letter-spacing: 6px;
    color: var(--accent);
  }

  .detail-sub {
    margin-top: 22px;
    font-size: 20px;
    color: var(--ink);
  }

  .detail-desc {
    margin: 14px 0 0;
    font-size: 18px;
    line-height: 1.8;
    color: var(--ink-soft);
  }

  .detail-tags {
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    li {
      padding: 6px 14px;
      border: 1px solid var(--accent-soft);
      border-radius: 999px;
      font-size: 14px;
      color: var(--accent);
    }
  }

  .detail-stats {
    margin-top: 36px;
    display: flex;
    gap: 44px;

    b {
      font-family: "DIN";
      font-weight: normal;
      font-size: 40px;
      color: var(--ink);
    }

    small {
      margin-left: 4px;
      font-size: 15px;
      color: var(--ink-faint);
    }

    span {
      display: block;
      font-size: 15px;
      color: var(--ink-faint);
    }
  }

  .enter-btn {
    margin-top: 40px;
    height: 64px;
    padding: 0 36px;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: #fff;
    font-family: inherit;
    font-size: 20px;
    letter-spacing: 2px;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;

    svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.2s ease;
    }

    &:hover {
      background: var(--accent);

      svg {
        transform: translateX(4px);
      }
    }

    &:active {
      transform: scale(0.97);
    }

    &:focus-visible {
      outline: 3px solid var(--accent-soft);
      outline-offset: 3px;
    }
  }

  /* 切换动效：旧内容快速上移淡出，新内容从下方淡入 */
  .swap-enter-active {
    transition:
      opacity 0.35s ease-out,
      transform 0.35s ease-out;
  }

  .swap-leave-active {
    transition:
      opacity 0.2s ease-in,
      transform 0.2s ease-in;
  }

  .swap-enter-from {
    opacity: 0;
    transform: translateY(16px);
  }

  .swap-leave-to {
    opacity: 0;
    transform: translateY(-8px);
  }

  @media (prefers-reduced-motion: reduce) {
    .swap-enter-from,
    .swap-leave-to {
      transform: none;
    }

    .swap-enter-active,
    .swap-leave-active {
      transition-duration: 0.15s;
    }
  }
</style>
