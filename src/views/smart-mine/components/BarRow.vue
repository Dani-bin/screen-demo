<!-- 一行横向进度条：名称 · 进度条 · 数值 -->
<template>
  <div class="bar-row">
    <span class="k">{{ k }}</span>
    <span class="bar"
      ><i
        :style="{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: `linear-gradient(90deg, ${color}33, ${color})`
        }"
    /></span>
    <span class="v num"
      >{{ v }}<small>{{ unit }}</small></span
    >
  </div>
</template>

<script setup>
  defineProps({
    k: { type: String, required: true },
    v: { type: [String, Number], required: true },
    unit: { type: String, default: "" },
    pct: { type: Number, default: 0 },
    color: { type: String, default: "#36e0ff" }
  })
</script>

<style lang="scss" scoped>
  .bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
    font-size: 14px;
  }

  .k {
    flex: none;
    width: 96px;
    color: var(--sub);
  }

  .bar {
    flex: 1;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: rgba(80, 140, 220, 0.16);

    i {
      display: block;
      height: 100%;
      border-radius: 4px;
      transition: width 0.8s;
    }
  }

  .v {
    flex: none;
    min-width: 82px;
    font-size: 17px;
    text-align: right;
    white-space: nowrap;

    small {
      margin-left: 2px;
      font-family: "Source Han Sans CN", sans-serif;
      font-size: 12px;
      color: var(--sub);
    }
  }
</style>
