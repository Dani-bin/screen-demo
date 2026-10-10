<!--
  楼栋一览：名称 / 层高 / 入驻率条；点击行在三维里选中该楼，当前选中行高亮
-->
<template>
  <section>
    <PanelTitle title="楼栋一览">
      <template #extra>入驻率</template>
    </PanelTitle>
    <ul class="body list">
      <li
        v-for="b in BUILDING_LIST"
        :key="b.key"
        :class="{ gold: b.kind === 'tower', on: b.key === selected }"
        @click="$emit('select', b.key)"
      >
        <span class="nm">
          <i v-if="b.status === 'alarm'" class="dot"></i>{{ label(b) }}
        </span>
        <span class="lv num"
          >{{ b.kind === "tower" ? `${b.height}m · ` : ""
          }}{{ b.levels }}F</span
        >
        <span class="bar"><i :style="{ width: b.occupancy + '%' }"></i></span>
        <b class="num">{{ b.occupancy }}%</b>
      </li>
    </ul>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import { BUILDING_LIST } from "../../data/park"

  defineProps({ selected: { type: String, default: null } })
  defineEmits(["select"])

  const label = (b) => (b.kind === "tower" ? `双子塔 · ${b.short}` : b.short)
</script>

<style lang="scss" scoped>
  .list {
    margin: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 104px 84px 1fr 40px;
      align-items: center;
      gap: 8px;
      height: 27px;
      padding: 0 6px;
      border-left: 2px solid transparent;
      font-size: 13px;
      color: #cfe0f5;
      cursor: pointer;

      &:hover {
        background: rgba(47, 155, 255, 0.1);
      }

      &.on {
        border-left-color: #37e4ff;
        background: rgba(47, 155, 255, 0.18);
      }
    }

    .nm {
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ff4d5a;
      box-shadow: 0 0 6px #ff4d5a;
    }

    .lv {
      font-size: 12px;
      color: #8aa0bd;
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
      font-size: 14px;
      font-weight: normal;
      text-align: right;
      color: #fff;
    }

    li.gold {
      .nm,
      b {
        color: #ffd27a;
      }

      .bar i {
        background: linear-gradient(90deg, rgba(255, 178, 62, 0.3), #ffc65a);
      }

      &.on {
        border-left-color: #ffc65a;
        background: rgba(255, 198, 90, 0.14);
      }
    }
  }
</style>
