<!-- 页头：标题 + "老家"印章 + 信息行；右上角傍晚 / 夜晚纸签、静音按钮、重播开场 -->
<template>
  <header class="head">
    <div class="title">
      <div class="row">
        <h1>营山 · 五通村</h1>
        <div class="seal">老<br />家</div>
      </div>
      <p>
        <span v-for="s in SUBTITLE" :key="s">{{ s }}</span>
      </p>
    </div>
    <div class="tools">
      <div class="tabs">
        <button :class="{ on: !night }" @click="$emit('night', false)">
          傍晚
        </button>
        <button :class="{ on: night }" @click="$emit('night', true)">
          夜晚
        </button>
      </div>
      <button
        class="icon"
        :title="muted ? '打开环境音' : '静音'"
        @click="$emit('mute')"
      >
        <!-- 喇叭：静音时带叉，有声时带声波 -->
        <svg viewBox="0 0 24 24">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path v-if="muted" d="m17 9 5 6M22 9l-5 6" />
          <path v-else d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      </button>
      <button class="icon" title="重播开场" @click="$emit('replay')">
        <svg viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup>
  import { SUBTITLE } from "../data/memories"

  defineProps({
    night: { type: Boolean, default: false },
    muted: { type: Boolean, default: true }
  })
  defineEmits(["night", "mute", "replay"])
</script>

<style lang="scss" scoped>
  .head {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 5;
    pointer-events: none;
  }
  .title {
    position: absolute;
    left: 76px;
    top: 58px;
    color: var(--cream);
    .row {
      display: flex;
      align-items: center;
      gap: 22px;
    }
    h1 {
      font-family: "Alimama ShuHeiTi";
      font-size: 66px;
      letter-spacing: 10px;
      text-shadow: 0 4px 22px rgba(30, 16, 4, 0.45);
    }
    p {
      margin-top: 14px;
      font-size: 20px;
      letter-spacing: 4px;
      opacity: 0.92;
      span + span::before {
        content: "·";
        margin: 0 12px;
        opacity: 0.6;
      }
    }
  }
  .seal {
    width: 58px;
    height: 58px;
    border: 3px solid var(--seal);
    border-radius: 6px;
    color: var(--seal);
    background: rgba(255, 240, 220, 0.9);
    font-family: "Alimama ShuHeiTi";
    font-size: 22px;
    line-height: 1.05;
    display: grid;
    place-items: center;
    text-align: center;
    transform: rotate(-8deg);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .tools {
    position: absolute;
    right: 76px;
    top: 66px;
    display: flex;
    gap: 14px;
    align-items: center;
    pointer-events: auto;
  }
  .tabs {
    display: flex;
    background: var(--paper);
    border-radius: 6px;
    padding: 5px;
    box-shadow: 0 8px 24px rgba(30, 16, 4, 0.3);
    transform: rotate(1deg);
    button {
      padding: 9px 22px;
      font-size: 18px;
      letter-spacing: 3px;
      color: var(--ink-2);
      border-radius: 4px;
      cursor: pointer;
      transition:
        background 0.3s,
        color 0.3s;
      &.on {
        background: var(--ink);
        color: var(--cream);
      }
    }
  }
  .icon {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: var(--paper);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(30, 16, 4, 0.3);
    svg {
      width: 22px;
      height: 22px;
      stroke: var(--ink);
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
</style>
