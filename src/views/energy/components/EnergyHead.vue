<!-- 顶栏：左侧视图切换（规划回顾重播开场动画），中间标题框，右侧时间、天气、系统状态 -->
<template>
  <header class="head">
    <nav class="left">
      <button class="tab on">综合态势</button>
      <button class="tab" :disabled="introPlaying" @click="$emit('replay')">
        <Clapperboard class="ico" />规划回顾
      </button>
    </nav>
    <svg class="frame" viewBox="0 0 760 62">
      <path
        d="M0 0 L60 54 L700 54 L760 0"
        fill="rgba(20,60,120,.35)"
        stroke="rgba(45,226,230,.6)"
        stroke-width="1.5"
      />
      <path d="M90 62 L670 62" stroke="#2de2e6" stroke-width="2" opacity=".8" />
    </svg>
    <h1>{{ STATION.name }}</h1>
    <div class="right">
      <span class="num clock">{{ dateText }}&nbsp;&nbsp;{{ timeText }}</span>
      <span class="wx"><CloudSun class="ico" />21℃ 多云</span>
      <span v-if="urgent" class="state bad"
        ><TriangleAlert class="ico" />重要告警 {{ urgent }}</span
      >
      <span v-else class="state"><ShieldCheck class="ico" />站点运行正常</span>
    </div>
  </header>
</template>

<script setup>
  import {
    Clapperboard,
    CloudSun,
    ShieldCheck,
    TriangleAlert
  } from "lucide-vue-next"
  import { STATION } from "../data/station"

  const props = defineProps({
    now: { type: Date, required: true },
    urgent: { type: Number, default: 0 },
    introPlaying: { type: Boolean, default: false }
  })
  defineEmits(["replay"])

  const pad = (n) => String(n).padStart(2, "0")
  const dateText = computed(() => {
    const d = props.now
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const timeText = computed(() => props.now.toTimeString().slice(0, 8))
</script>

<style lang="scss" scoped>
  .head {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 5;
    width: 100%;
    height: 62px;
    background: linear-gradient(
      180deg,
      rgba(6, 18, 38, 0.95),
      rgba(6, 18, 38, 0.4)
    );
    pointer-events: none;
  }

  .frame {
    position: absolute;
    left: 50%;
    top: 0;
    width: 760px;
    height: 62px;
    transform: translateX(-50%);
  }

  h1 {
    position: absolute;
    left: 50%;
    top: 0;
    margin: 0;
    transform: translateX(-50%);
    font-family: "Alimama ShuHeiTi", sans-serif;
    font-size: 34px;
    line-height: 54px;
    letter-spacing: 6px;
    white-space: nowrap;
    color: #fff;
    text-shadow: 0 0 18px rgba(45, 226, 230, 0.6);
  }

  .left {
    position: absolute;
    left: 24px;
    top: 16px;
    display: flex;
    gap: 12px;
    pointer-events: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 3px;
    background: rgba(10, 30, 60, 0.5);
    color: var(--muted);
    font-size: 15px;
    cursor: pointer;

    &.on {
      border-color: var(--cyan);
      color: var(--cyan);
      background: rgba(45, 226, 230, 0.08);
      cursor: default;
    }

    &:not(.on):hover:not(:disabled) {
      color: #fff;
      border-color: var(--cyan);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  .ico {
    width: 16px;
    height: 16px;
  }

  .right {
    position: absolute;
    right: 28px;
    top: 18px;
    display: flex;
    align-items: center;
    gap: 24px;
    font-size: 16px;
    color: var(--muted);

    span {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .clock {
      font-size: 18px;
      color: #fff;
    }

    .state {
      color: #3ddc97;

      &.bad {
        color: var(--red);
      }
    }
  }
</style>
