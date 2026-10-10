<!--
  资产概览（全区接入楼宇，演示数据）：资产总量 + 在线率 + 六大类占比
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="资产概览">
      <template #extra>单位：件</template>
    </PanelTitle>
    <div class="asset">
      <div class="ring">
        <RingChart
          :items="data.categories"
          :total="(data.total / 10000).toFixed(1) + '万'"
          label="资产总量"
        />
      </div>
      <div class="cats">
        <div v-for="c in data.categories" :key="c.name" class="cat">
          <span><i :style="{ background: c.color }"></i>{{ c.name }}</span>
          <b class="num">{{ c.value.toLocaleString("en-US") }}</b>
        </div>
        <div class="online">
          设备在线率<b class="num">{{ data.online }}</b
          >%
          <span class="bar"><i :style="{ width: data.online + '%' }"></i></span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import RingChart from "./RingChart.vue"
  import { ASSET_OVERVIEW as data } from "../data/city"
</script>

<style lang="scss" scoped>
  .asset {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 4px 0;
  }

  .ring {
    width: 136px;
    height: 136px;
    flex-shrink: 0;
  }

  .cats {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;

    .cat {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 12px;
      color: #a9b9cf;

      i {
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 5px;
        vertical-align: middle;
      }

      b {
        padding-left: 11px;
        font-size: 17px;
        font-weight: normal;
        color: #fff;
      }
    }

    .online {
      grid-column: 1 / -1;
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-top: 4px;
      font-size: 12px;
      color: #a9b9cf;

      b {
        margin-left: 6px;
        font-size: 18px;
        font-weight: normal;
        color: #3ddc97;
      }

      .bar {
        flex: 1;
        height: 5px;
        margin-left: 8px;
        background: rgba(60, 110, 180, 0.25);

        i {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, rgba(61, 220, 151, 0.3), #3ddc97);
        }
      }
    }
  }
</style>
