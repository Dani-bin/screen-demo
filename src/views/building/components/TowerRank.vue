<!--
  高层楼宇排行：双子塔 + 高新区内 100 m 以上的楼宇，高度 / 层数取自 OSM
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="高层楼宇">
      <template #extra>高度 m · 数据来源 OSM</template>
    </PanelTitle>
    <ul class="rank">
      <li v-for="(t, i) in list" :key="t.name" :class="{ park: t.park }">
        <span class="no num">{{ String(i + 1).padStart(2, "0") }}</span>
        <span class="name" :title="t.name">{{ t.name }}</span>
        <span class="bar"
          ><i :style="{ width: (t.height / max) * 100 + '%' }"></i
        ></span>
        <b class="num">{{ t.height }}</b>
      </li>
    </ul>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import { TOWER_RANK as list } from "../data/city"

  const max = Math.max(...list.map((t) => t.height))
</script>

<style lang="scss" scoped>
  .rank {
    margin: 12px 0 0;
    padding: 0 4px;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 28px 150px 1fr 40px;
      align-items: center;
      gap: 8px;
      height: 29px;
      font-size: 13px;
      color: #cfe0f5;
    }

    .no {
      font-size: 15px;
      color: #5f8fc4;
    }

    li:nth-child(-n + 3) .no {
      color: #2de2e6;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar {
      height: 6px;
      background: rgba(60, 110, 180, 0.25);

      i {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, rgba(47, 155, 255, 0.3), #2de2e6);
      }
    }

    b {
      font-size: 16px;
      font-weight: normal;
      text-align: right;
      color: #fff;
    }

    /* 本演示的园区（双子塔）用金色强调 */
    li.park {
      .name,
      b {
        color: #ffd27a;
      }

      .bar i {
        background: linear-gradient(90deg, rgba(255, 178, 62, 0.3), #ffc65a);
      }
    }
  }
</style>
