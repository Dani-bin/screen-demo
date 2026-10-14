<!-- 告警与作业：最近 6 条（重要 / 作业 / 一般 / 提示） -->
<template>
  <section class="panel">
    <div class="ptitle">
      <BellRing />
      <h3>告警与作业</h3>
      <span class="unit"
        >今日重要 <b class="num">{{ count }}</b> 条</span
      >
    </div>
    <TransitionGroup name="al" tag="div" class="list">
      <div v-for="a in alarms" :key="a.time + a.text" class="al">
        <span class="num t">{{ a.time }}</span>
        <span class="lv" :style="{ '--c': LEVEL[a.level] }">{{ a.level }}</span>
        <span class="x">{{ a.text }}</span>
      </div>
    </TransitionGroup>
  </section>
</template>

<script setup>
  import { BellRing } from "lucide-vue-next"

  defineProps({
    alarms: { type: Array, required: true },
    count: { type: Number, default: 0 }
  })
  const LEVEL = {
    重要: "#ff4d5a",
    作业: "#b48cff",
    一般: "#ff9a3d",
    提示: "#4c8dff"
  }
</script>

<style lang="scss" scoped>
  .unit b {
    font-size: 15px;
    font-weight: normal;
    color: var(--red);
  }

  .list {
    position: relative;
    overflow: hidden;
  }

  .al {
    display: grid;
    grid-template-columns: 50px 42px 1fr;
    align-items: center;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px dashed rgba(45, 120, 200, 0.2);
    font-size: 13px;
  }

  .t {
    color: var(--muted);
  }

  .lv {
    padding: 1px 0;
    border-radius: 2px;
    background: color-mix(in srgb, var(--c) 25%, transparent);
    color: var(--c);
    font-size: 11px;
    text-align: center;
  }

  .x {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .al-enter-from {
    opacity: 0;
    transform: translateY(-10px);
  }

  .al-enter-active {
    transition: all 0.5s;
  }
</style>
