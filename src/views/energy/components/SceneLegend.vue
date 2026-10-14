<!--
  场站速览 + 图例：浮在三维画面左下角。
  设计稿视角下场站沿对角线斜穿画面，左面板与场站之间的左下角空出一块三角区，这里放场站规模与设施颜色图例
  （设计稿整屏效果图 03 在场站下方也有一行图例）；半透明、不挡模型，开场动画期间隐藏
-->
<template>
  <aside class="legend">
    <div class="head">
      <span class="title">场站规模</span>
      <span class="area">
        用地 <b class="num">{{ (PLAN.siteArea / 10000).toFixed(1) }}</b> ha
      </span>
    </div>
    <ul class="facts">
      <li v-for="f in FACTS" :key="f.label">
        <i :style="{ background: f.color, '--glow': f.color }"></i>
        <span class="label">{{ f.label }}</span>
        <span class="value num">{{ f.value }}</span>
      </li>
    </ul>
  </aside>
</template>

<script setup>
  import PLAN from "../data/plan.json"
  import { STATION } from "../data/station"

  /** 设施规模（颜色与三维里的灯带 / 标签一致） */
  const FACTS = [
    { label: "加油加气", value: "6 岛 12 枪", color: "#36b8ff" },
    { label: "LNG 加气", value: "2 岛 4 枪", color: "#b48cff" },
    {
      label: "重卡超充",
      value: `10 × ${STATION.chargerKw} kW`,
      color: "#3ddc97"
    },
    { label: "乘用车换电", value: `${STATION.swapSlots} 仓`, color: "#2de2e6" },
    { label: "光伏车棚", value: `${STATION.pvKwp} kWp`, color: "#ffd45a" },
    { label: "LNG 储罐", value: `${STATION.lngTankM3} m³`, color: "#8a63d2" }
  ]
</script>

<style lang="scss" scoped>
  .legend {
    position: absolute;
    left: 440px;
    bottom: 262px;
    z-index: 3;
    width: 330px;
    padding: 12px 16px 10px;
    border: 1px solid rgba(74, 144, 226, 0.22);
    border-radius: 6px;
    background: linear-gradient(
      180deg,
      rgba(12, 30, 60, 0.62),
      rgba(6, 18, 40, 0.5)
    );
    backdrop-filter: blur(4px);
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(74, 144, 226, 0.18);

    .title {
      font-size: 15px;
      font-weight: bold;
      letter-spacing: 1px;
      color: #fff;
    }

    .area {
      font-size: 12px;
      color: var(--muted);

      b {
        font-size: 16px;
        color: var(--cyan);
      }
    }
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      white-space: nowrap;
    }

    i {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      box-shadow: 0 0 6px var(--glow);
    }

    .label {
      color: var(--muted);
    }

    .value {
      margin-left: auto;
      font-size: 13px;
      color: var(--text);
    }
  }
</style>
