<!-- 指标格：items = [{ label, value, unit, color, dot }]，cols 列 -->
<template>
  <div class="kpis" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }">
    <div v-for="k in items" :key="k.label" class="kpi">
      <div class="l">
        <i v-if="k.dot" class="dot" :style="{ background: k.dot }"></i
        >{{ k.label }}
      </div>
      <div class="v" :style="{ color: k.color }">
        <span :class="{ num: !k.text }">{{ k.value }}</span
        ><small v-if="k.unit">{{ k.unit }}</small>
      </div>
    </div>
  </div>
</template>

<script setup>
  defineProps({
    items: { type: Array, required: true },
    cols: { type: Number, default: 3 }
  })
</script>

<style lang="scss" scoped>
  .kpis {
    display: grid;
    gap: 10px;
  }

  .kpi {
    padding: 8px 10px 7px;
    border: 1px solid rgba(45, 120, 200, 0.25);
    border-radius: 4px;
    background: rgba(30, 70, 130, 0.18);
  }

  .l {
    display: flex;
    align-items: center;
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
  }

  .dot {
    width: 8px;
    height: 8px;
    margin-right: 5px;
    border-radius: 50%;
  }

  .v {
    margin-top: 2px;
    font-size: 24px;
    color: #fff;
    white-space: nowrap;

    small {
      margin-left: 3px;
      font-size: 12px;
      color: var(--muted);
    }
  }
</style>
