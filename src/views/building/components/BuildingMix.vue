<!--
  接入楼宇业态构成（演示数据）：环形图 + 图例
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="楼宇业态">
      <template #extra>单位：栋</template>
    </PanelTitle>
    <div class="mix">
      <div class="ring"><RingChart :items="items" label="接入楼宇" /></div>
      <ul class="legend">
        <li v-for="it in items" :key="it.name">
          <i :style="{ background: it.color }"></i>
          <span>{{ it.name }}</span>
          <b class="num">{{ it.value }}</b>
          <em class="num">{{ pct(it.value) }}%</em>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import RingChart from "./RingChart.vue"
  import { BUILDING_MIX as items } from "../data/city"

  const sum = items.reduce((s, i) => s + i.value, 0)
  const pct = (v) => ((v / sum) * 100).toFixed(1)
</script>

<style lang="scss" scoped>
  .mix {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 12px 4px 0;
  }

  .ring {
    width: 140px;
    height: 140px;
    flex-shrink: 0;
  }

  .legend {
    flex: 1;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 10px 1fr 40px 52px;
      align-items: center;
      gap: 8px;
      height: 26px;
      font-size: 13px;
      color: #cfe0f5;
    }

    i {
      width: 8px;
      height: 8px;
      border-radius: 1px;
    }

    b {
      font-size: 16px;
      font-weight: normal;
      text-align: right;
      color: #fff;
    }

    em {
      font-size: 13px;
      font-style: normal;
      text-align: right;
      color: #8aa0bd;
    }
  }
</style>
