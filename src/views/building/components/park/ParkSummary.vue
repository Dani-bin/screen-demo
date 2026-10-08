<!--
  园区概况：名称卡 + 6 格指标（楼栋数来自 OSM，其余为演示数据）
-->
<template>
  <section>
    <PanelTitle title="园区概况" />
    <div class="body">
      <div class="name-card">
        <div class="row1">
          <span class="nm">{{ s.name }}</span
          ><span class="tag ok">运行正常</span>
        </div>
        <div class="addr">{{ s.address }}</div>
      </div>
      <div class="cells">
        <div v-for="c in cells" :key="c.label" class="cell" :class="c.tone">
          <b class="num">{{ c.value }}</b
          ><small>{{ c.unit }}</small>
          <span>{{ c.label }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import { PARK_SUMMARY as s } from "../../data/park"

  const cells = [
    { label: "楼栋", value: s.buildings, unit: "栋", tone: "gold" },
    { label: "建筑面积", value: s.floorArea, unit: "万m²" },
    { label: "入驻率", value: s.occupancy, unit: "%", tone: "cyan" },
    { label: "入驻企业", value: s.tenants, unit: "家" },
    { label: "在岗人数", value: s.staff, unit: "万" },
    { label: "车位", value: s.parking.toLocaleString("en-US"), unit: "个" }
  ]
</script>

<style lang="scss" scoped>
  .name-card {
    margin-bottom: 10px;
    padding: 10px 14px;
    border: 1px solid rgba(255, 198, 90, 0.45);
    background: linear-gradient(
      135deg,
      rgba(70, 46, 8, 0.5),
      rgba(10, 30, 64, 0.35)
    );

    .row1 {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .nm {
      font-size: 18px;
      font-weight: bold;
      color: #ffe6b0;
    }

    .addr {
      margin-top: 4px;
      font-size: 12px;
      color: #a9b9cf;
    }
  }
</style>
