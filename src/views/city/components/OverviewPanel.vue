<!-- 城市总览：四项指标 + 城市标签（指标为示意值） -->
<template>
  <section class="panel overview-panel">
    <h2 class="panel-title">
      城市总览
      <span class="title-en">City Overview</span>
    </h2>
    <div class="stat-grid">
      <div v-for="item in metrics" :key="item.key" class="stat">
        <b
          >{{ item.value }}<i>{{ item.unit }}</i></b
        >
        <span>{{ item.key }}</span>
      </div>
    </div>
    <div class="tag-row">
      <i v-for="tag in tags" :key="tag">{{ tag }}</i>
    </div>
  </section>
</template>

<script setup>
  defineProps({
    metrics: { type: Array, required: true },
    tags: { type: Array, required: true }
  })
</script>

<style lang="scss" scoped>
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat {
    padding: 10px 12px;
    border-radius: 8px;
    background: #f3f7f8;

    b {
      display: block;
      font-size: 26px;
      font-weight: 700;
      color: var(--city-ink);
      font-family: "DIN", sans-serif;
      font-variant-numeric: tabular-nums;

      i {
        margin-left: 3px;
        font-style: normal;
        font-size: 12px;
        color: var(--city-teal);
      }
    }

    span {
      font-size: 12px;
      color: var(--city-ink-soft);
    }
  }

  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;

    i {
      padding: 4px 9px;
      border-radius: 20px;
      background: rgba(47, 143, 150, 0.12);
      font-style: normal;
      font-size: 11px;
      color: var(--city-teal);
    }
  }
</style>
