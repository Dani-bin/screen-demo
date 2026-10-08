<!--
  城市级：成都高新区三维地图（../CityMap.vue → scene/map/CityWorld.js）+ 区域 / 楼宇 / 资产面板。
  点击地图上的「成都金融城双子塔」园区卡片或右栏「进入园区」，抛出 enter-park 进入园区级。
-->
<template>
  <div class="level">
    <div class="side side-left">
      <ZoneOverview />
      <TowerRank />
      <BuildingMix />
    </div>

    <div class="center">
      <CityMap @pick-park="$emit('enter-park')" />
    </div>

    <div class="side side-right">
      <ParkPanel enterable @enter="$emit('enter-park')" />
      <AssetPanel />
      <AlarmPanel />
    </div>

    <div class="bottom-tip">
      悬浮街道查看概况 · 悬浮光柱查看高层楼宇 · 点击金色园区卡片进入园区
      &nbsp;|&nbsp; 边界与楼高来自 OpenStreetMap，运营指标为演示数据
    </div>
  </div>
</template>

<script setup>
  import CityMap from "../CityMap.vue"
  import ZoneOverview from "../ZoneOverview.vue"
  import TowerRank from "../TowerRank.vue"
  import BuildingMix from "../BuildingMix.vue"
  import ParkPanel from "../ParkPanel.vue"
  import AssetPanel from "../AssetPanel.vue"
  import AlarmPanel from "../AlarmPanel.vue"

  defineEmits(["enter-park"])
</script>

<style lang="scss" scoped>
  .level {
    position: absolute;
    inset: 0;
    background: url("../../assets/content-bg.png") no-repeat center / 100% 100%;
  }

  /* 中间地图栏：977 宽，顶部留出顶栏 + 立牌错开的空间 */
  .center {
    position: absolute;
    left: 471px;
    top: 135px;
    z-index: 2;
    width: 977px;
    height: 848px;
  }
</style>
