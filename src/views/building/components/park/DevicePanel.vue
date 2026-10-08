<!--
  设备运行（演示数据）：环形占比 + 图例
-->
<template>
  <section>
    <PanelTitle title="设备运行">
      <template #extra>在线率 98.2%</template>
    </PanelTitle>
    <div class="body dev">
      <div class="ring">
        <RingChart :items="DEVICES" :total="totalText" label="园区设备" />
      </div>
      <ul class="legend">
        <li v-for="d in DEVICES" :key="d.name">
          <i :style="{ background: d.color }"></i>
          <span>{{ d.name }}</span>
          <b class="num">{{ d.value.toLocaleString("en-US") }}</b
          ><small>台</small>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import RingChart from "../RingChart.vue"
  import { DEVICES } from "../../data/park"

  const totalText =
    (DEVICES.reduce((s, d) => s + d.value, 0) / 10000).toFixed(2) + "万"
</script>

<style lang="scss" scoped>
  .dev {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .ring {
    width: 136px;
    height: 136px;
    flex-shrink: 0;
  }

  .legend {
    flex: 1;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 10px 1fr auto 16px;
      align-items: baseline;
      gap: 8px;
      height: 25px;
      font-size: 13px;
      color: #cfe0f5;
    }

    i {
      width: 8px;
      height: 8px;
    }

    b {
      font-size: 15px;
      font-weight: normal;
      text-align: right;
      color: #fff;
    }

    small {
      font-size: 11px;
      color: #8aa0bd;
    }
  }
</style>
