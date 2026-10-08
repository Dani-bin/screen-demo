<!--
  园区告警（演示数据）：点击一条告警在三维里定位到所在楼栋
-->
<template>
  <section>
    <PanelTitle title="告警事件">
      <template #extra>今日 {{ PARK_ALARMS.length }} 起</template>
    </PanelTitle>
    <ul class="body alarms">
      <li
        v-for="(a, i) in PARK_ALARMS"
        :key="i"
        @click="$emit('locate', a.key)"
      >
        <span class="tag" :class="LEVEL[a.level].cls">{{
          LEVEL[a.level].name
        }}</span>
        <div class="tx">
          <p class="t">{{ a.text }}</p>
          <p class="p">{{ a.place }}</p>
        </div>
        <span class="tm num">{{ a.time }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import { PARK_ALARMS } from "../../data/park"

  defineEmits(["locate"])

  const LEVEL = {
    1: { name: "紧急", cls: "err" },
    2: { name: "重要", cls: "warn" },
    3: { name: "一般", cls: "info" }
  }
</script>

<style lang="scss" scoped>
  .alarms {
    margin: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 4px;
      border-bottom: 1px dashed rgba(74, 144, 226, 0.2);
      cursor: pointer;

      &:hover {
        background: rgba(47, 155, 255, 0.08);
      }
    }

    .tx {
      flex: 1;
      min-width: 0;

      p {
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .t {
        font-size: 13px;
        color: #e2ecf8;
      }

      .p {
        font-size: 11px;
        color: #7f93ad;
      }
    }

    .tm {
      font-size: 14px;
      color: #8aa0bd;
    }
  }
</style>
