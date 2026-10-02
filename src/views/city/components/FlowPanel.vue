<!-- 热门景点客流 Top5：横向条形，按最大值归一化 -->
<template>
  <section class="panel flow-panel">
    <h2 class="panel-title">
      热门景点客流
      <span class="title-en">Visitor Flow · Top 5</span>
    </h2>
    <div class="bar-list">
      <div v-for="item in flow" :key="item.name" class="bar-row">
        <span class="bar-name">{{ item.name }}</span>
        <div class="bar-track">
          <div class="bar-fill" :style="{ width: percent(item.value) }"></div>
        </div>
        <em class="bar-value">{{ format(item.value) }}</em>
      </div>
    </div>
  </section>
</template>

<script setup>
  const props = defineProps({
    flow: { type: Array, required: true }
  })

  const max = computed(() => Math.max(1, ...props.flow.map((f) => f.value)))
  const percent = (v) => `${Math.round((v / max.value) * 100)}%`
  /** 人次显示为「x.x万」 */
  const format = (v) => `${(v / 10000).toFixed(1)}万`
</script>

<style lang="scss" scoped>
  .bar-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .bar-row {
    display: grid;
    grid-template-columns: 86px 1fr 44px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--city-ink-soft);
  }

  .bar-track {
    height: 8px;
    border-radius: 4px;
    background: #e9eef0;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, #7ccbc4, var(--city-teal));
    transition: width 0.6s;
  }

  .bar-value {
    font-style: normal;
    font-weight: 600;
    text-align: right;
    color: var(--city-ink);
    font-family: "DIN", sans-serif;
    font-variant-numeric: tabular-nums;
  }
</style>
