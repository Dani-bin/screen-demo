<!--
  区域概况：高新区南区面积（按 OSM 街道边界计算）、街道数、接入楼宇 / 园区 / 企业数（演示数据）
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="区域概况">
      <template #extra>成都高新区 · 南区</template>
    </PanelTitle>
    <div class="zone">
      <div class="area">
        <div class="ring">
          <b class="num">{{ data.area }}</b>
          <span>km²</span>
        </div>
        <div class="split">
          <p v-for="(h, i) in data.highlights" :key="h.name">
            <i class="dot" :class="i ? 'w' : 's'"></i>{{ h.name
            }}<b class="num">{{ h.area }}</b
            >km²<em>{{ h.note }}</em>
          </p>
        </div>
      </div>
      <div class="grid">
        <div v-for="item in cells" :key="item.label" class="cell">
          <b class="num">{{ item.value }}</b
          ><small>{{ item.unit }}</small>
          <span>{{ item.label }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import { ZONE_OVERVIEW as data, ASSET_OVERVIEW } from "../data/city"

  const fmt = (n) => n.toLocaleString("en-US")
  const cells = [
    { label: "辖区街道", value: data.streets, unit: "个" },
    { label: "接入楼宇", value: fmt(data.buildings), unit: "栋" },
    { label: "重点园区", value: data.parks, unit: "个" },
    { label: "百米高楼", value: data.towers, unit: "栋" },
    { label: "入驻企业", value: fmt(data.enterprises), unit: "家" },
    {
      label: "接入资产",
      value: (ASSET_OVERVIEW.total / 10000).toFixed(1),
      unit: "万件"
    }
  ]
</script>

<style lang="scss" scoped>
  .zone {
    padding: 14px 4px 0;
  }

  .area {
    display: flex;
    align-items: center;
    gap: 22px;

    /* 面积环：外圈虚线 + 内圈发光 */
    .ring {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 112px;
      height: 112px;
      border: 2px dashed rgba(45, 226, 230, 0.45);
      border-radius: 50%;
      box-shadow:
        inset 0 0 24px rgba(30, 140, 255, 0.45),
        0 0 14px rgba(30, 140, 255, 0.25);

      b {
        font-size: 30px;
        font-weight: normal;
        color: #fff;
      }

      span {
        font-size: 12px;
        color: #8aa0bd;
      }
    }

    .split p {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin: 10px 0;
      font-size: 14px;
      color: #bcd3ee;

      em {
        margin-left: 6px;
        font-size: 12px;
        font-style: normal;
        color: #7f93ad;
      }

      b {
        min-width: 52px;
        font-size: 22px;
        font-weight: normal;
        text-align: right;
        color: #2de2e6;
      }
    }

    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;

      &.s {
        background: #2de2e6;
      }

      &.w {
        background: #2f9bff;
      }
    }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-top: 14px;

    .cell {
      padding: 8px 0 6px;
      border-bottom: 2px solid rgba(47, 155, 255, 0.5);
      background: linear-gradient(
        180deg,
        rgba(20, 70, 140, 0) 0%,
        rgba(20, 70, 140, 0.35) 100%
      );
      text-align: center;

      b {
        font-size: 22px;
        font-weight: normal;
        color: #fff;
      }

      small {
        margin-left: 2px;
        font-size: 11px;
        color: #8aa0bd;
      }

      span {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: #8aa0bd;
      }
    }
  }
</style>
