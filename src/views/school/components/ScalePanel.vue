<!--
  办学规模指标面板
  value 为 null 的条目显示「待补充」—— 百科未载的数字不编造。
-->
<template>
  <section class="panel scale-panel">
    <h2 class="panel-title">
      办学规模
      <span class="title-en">By the numbers</span>
    </h2>
    <div class="metric-grid">
      <div
        v-for="item in metrics"
        :key="item.key"
        class="metric-cell"
        :class="{ pending: item.value === null }"
      >
        <div class="metric-value">
          <template v-if="item.value !== null">
            {{ item.value }}<span class="metric-unit">{{ item.unit }}</span>
          </template>
          <template v-else>待补充</template>
        </div>
        <div class="metric-key">{{ item.key }}</div>
      </div>
    </div>
  </section>
</template>

<script setup>
  defineProps({
    metrics: { type: Array, required: true }
  })
</script>

<style lang="scss" scoped>
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: var(--school-rule);
  }

  .metric-cell {
    padding: 11px 12px;
    background: rgba(255, 253, 249, 0.7);
  }

  .metric-value {
    font-size: 26px;
    font-weight: 500;
    line-height: 1.05;
    color: var(--school-brick-deep);
    font-variant-numeric: tabular-nums;
  }

  .metric-unit {
    margin-left: 4px;
    font-size: 14px;
    font-weight: 500;
    color: var(--school-ink-soft);
  }

  .metric-key {
    margin-top: 4px;
    font-size: 12.5px;
    letter-spacing: 0.5px;
    color: var(--school-ink-faint);
  }

  .metric-cell.pending .metric-value {
    font-size: 16px;
    letter-spacing: 1px;
    color: var(--school-ink-faint);
  }
</style>
