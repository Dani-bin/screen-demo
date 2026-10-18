<!-- 矿井概况：公开资料里的真实数字（GEM 矿山库、USGS / 科罗拉多地调局资料） -->
<template>
  <section class="panel">
    <h3>矿井概况<small>Mountain Coal Co.</small></h3>
    <div class="facts">
      <div class="wide">
        <span>位置</span><b>美国科罗拉多州 Gunnison 县 Somerset</b>
      </div>
      <div><span>开采方式</span><b>井工 · 长壁综采</b></div>
      <div><span>井田面积</span><b class="num">74.5 km²</b></div>
      <div class="wide">
        <span>在采煤层</span><b>B 煤（萨默塞特煤）· 采高 3.6 m</b>
      </div>
      <div><span>煤种</span><b>高挥发分烟煤</b></div>
      <div><span>最大埋深</span><b class="num">≈ 490 m</b></div>
      <div><span>2025 年产量</span><b class="num">294 万 t</b></div>
      <div><span>职工</span><b class="num">292 人</b></div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    font-size: 14px;

    div {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      border-bottom: 1px dashed rgba(120, 170, 230, 0.18);
    }

    .wide {
      grid-column: span 2;
    }

    span {
      flex: none;
      margin-right: 10px;
      color: var(--sub);
    }

    b {
      font-weight: normal;
    }
  }
</style>
