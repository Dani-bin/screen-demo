<!-- 监测点小卡片：名称、读数、状态角标；预警时描边变黄 -->
<template>
  <div class="sensor" :class="st">
    <span class="n">{{ name }}</span>
    <b class="num"
      >{{ value }}<small>{{ unit }}</small></b
    >
    <em :style="{ color: STATUS[st].c }">{{ STATUS[st].t }}</em>
  </div>
</template>

<script setup>
  import { STATUS } from "../utils"

  defineProps({
    name: { type: String, required: true },
    value: { type: [String, Number], required: true },
    unit: { type: String, default: "" },
    st: { type: String, default: "ok" }
  })
</script>

<style lang="scss" scoped>
  .sensor {
    position: relative;
    padding: 6px 10px;
    border: 1px solid rgba(80, 160, 255, 0.2);
    border-radius: 3px;
    background: rgba(20, 60, 120, 0.12);

    &.warn {
      border-color: rgba(255, 207, 58, 0.55);
      box-shadow: inset 0 0 14px rgba(255, 207, 58, 0.14);

      b {
        color: #ffcf3a;
      }
    }

    &.alarm {
      border-color: rgba(255, 77, 90, 0.6);

      b {
        color: #ff4d5a;
      }
    }
  }

  .n {
    font-size: 13px;
    color: var(--sub);
  }

  b {
    display: block;
    font-size: 24px;
    font-weight: normal;
    line-height: 28px;

    small {
      margin-left: 3px;
      font-family: "Source Han Sans CN", sans-serif;
      font-size: 12px;
      color: var(--sub);
    }
  }

  em {
    position: absolute;
    top: 7px;
    right: 8px;
    padding: 0 6px;
    border-radius: 2px;
    font-size: 12px;
    font-style: normal;
    background: rgba(255, 255, 255, 0.06);
  }
</style>
