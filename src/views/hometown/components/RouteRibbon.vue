<!-- 底部"回家的路"纸带：5 个节点（公路路口 → 我家）各配一句回忆，文字在 data/memories.js -->
<template>
  <div class="ribbon">
    <div class="head">
      <h3>回家的路</h3>
      <p>
        <b>{{ ROUTE_LENGTH }}</b
        >米
      </p>
      <p class="todo">文字均为占位，待补充</p>
    </div>
    <div class="steps">
      <div
        v-for="(s, i) in ROUTE_STEPS"
        :key="s.title"
        class="step"
        :class="{ last: i === ROUTE_STEPS.length - 1 }"
      >
        <i>{{ i + 1 }}</i>
        <h4>{{ s.title }}</h4>
        <p>{{ s.text }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ROUTE_LENGTH, ROUTE_STEPS } from "../data/memories"
</script>

<style lang="scss" scoped>
  .ribbon {
    position: absolute;
    left: 76px;
    right: 76px;
    bottom: 46px;
    z-index: 4;
    display: flex;
    align-items: stretch;
    background: var(--ribbon-bg);
    border: 1px solid var(--ribbon-line);
    border-radius: 6px;
    box-shadow: 0 16px 40px rgba(20, 10, 0, 0.35);
    overflow: hidden;
    transition: background 0.6s;
  }
  .head {
    width: 236px;
    padding: 16px 24px;
    background: var(--ribbon-head);
    color: var(--cream);
    h3 {
      font-family: "Alimama ShuHeiTi";
      font-size: 28px;
      letter-spacing: 4px;
    }
    p {
      margin-top: 8px;
      font-size: 15px;
      opacity: 0.75;
      letter-spacing: 1px;
    }
    b {
      font-family: "DIN";
      font-size: 36px;
      color: var(--warm);
      margin-right: 6px;
    }
    .todo {
      margin-top: 2px;
      color: #c9b896;
      font-size: 12px;
    }
  }
  .steps {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    position: relative;
    padding: 14px 10px;
    &::before {
      content: "";
      position: absolute;
      left: 8%;
      right: 8%;
      top: 31px;
      border-top: 2px dashed rgba(122, 102, 80, 0.45);
    }
  }
  .step {
    position: relative;
    padding: 0 16px;
    text-align: center;
    i {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--step-dot);
      color: var(--step-ink);
      border: 2px solid var(--warm);
      font-style: normal;
      font-family: "DIN";
      font-size: 17px;
    }
    &.last i {
      background: var(--seal);
      border-color: var(--seal);
      color: #fff;
    }
    h4 {
      margin-top: 6px;
      font-size: 18px;
      letter-spacing: 2px;
      color: var(--step-ink);
    }
    p {
      margin-top: 4px;
      font-size: 14px;
      line-height: 1.5;
      color: var(--step-ink-2);
    }
  }
</style>
