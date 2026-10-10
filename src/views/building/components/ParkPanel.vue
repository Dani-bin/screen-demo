<!--
  重点园区：成都金融城双子塔。塔高 / 层数取自 OSM，运营指标为演示数据。
  「进入园区」是下一级（园区）的入口。
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="重点园区" />
    <div class="park">
      <div class="head">
        <div class="name">
          {{ info.name }}
          <small>{{ info.street }} · {{ info.address }}</small>
        </div>
        <button class="enter" :disabled="!enterable" @click="$emit('enter')">
          {{ enterable ? "进入园区 ›" : "园区级建设中" }}
        </button>
      </div>
      <div class="towers">
        <div v-for="t in info.towers" :key="t.name" class="tower">
          <span class="tname">{{ shortName(t.name) }}</span>
          <span
            ><b class="num">{{ t.height }}</b
            >m</span
          >
          <span
            ><b class="num">{{ t.levels }}</b
            >层</span
          >
        </div>
      </div>
      <div class="kpis">
        <div v-for="k in kpis" :key="k.label">
          <b class="num">{{ k.value }}</b
          ><small>{{ k.unit }}</small>
          <span>{{ k.label }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import { PARK_INFO as info } from "../data/city"

  defineProps({
    /** 园区级是否已开放 */
    enterable: { type: Boolean, default: false }
  })
  defineEmits(["enter"])

  /** 「成都金融城双子塔（南塔）」→「南塔」 */
  const shortName = (n) => n.match(/（(.+)）/)?.[1] || n

  const kpis = [
    { label: "建筑面积", value: info.floorArea, unit: "万m²" },
    { label: "入驻率", value: info.occupancy, unit: "%" },
    { label: "入驻企业", value: info.tenants, unit: "家" },
    { label: "今日能耗", value: info.energyToday, unit: "MWh" }
  ]
</script>

<style lang="scss" scoped>
  .park {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 198, 90, 0.35);
    background: linear-gradient(
      135deg,
      rgba(70, 46, 8, 0.45),
      rgba(10, 30, 64, 0.35)
    );
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;

    .name {
      font-size: 18px;
      font-weight: bold;
      color: #ffe6b0;

      small {
        display: block;
        margin-top: 3px;
        font-size: 12px;
        font-weight: normal;
        color: #a9b9cf;
      }
    }

    .enter {
      flex-shrink: 0;
      padding: 5px 12px;
      border: 1px solid #ffc65a;
      border-radius: 2px;
      background: rgba(255, 198, 90, 0.18);
      font-size: 13px;
      font-weight: bold;
      color: #ffc65a;
      cursor: pointer;

      &:disabled {
        border-color: rgba(255, 198, 90, 0.35);
        background: transparent;
        color: rgba(255, 198, 90, 0.55);
        cursor: default;
      }
    }
  }

  .towers {
    display: flex;
    gap: 10px;
    margin-top: 12px;

    .tower {
      flex: 1;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(255, 198, 90, 0.08);
      font-size: 12px;
      color: #a9b9cf;

      .tname {
        font-size: 14px;
        color: #ffd27a;
      }

      b {
        margin-right: 2px;
        font-size: 20px;
        font-weight: normal;
        color: #fff;
      }
    }
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-top: 12px;
    text-align: center;

    b {
      font-size: 20px;
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
</style>
