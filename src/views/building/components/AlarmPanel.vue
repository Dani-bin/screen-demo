<!--
  实时告警（演示数据）：按级别着色的告警列表，顶部三级计数
-->
<template>
  <section class="panel-sec">
    <PanelTitle title="实时告警">
      <template #extra>演示数据</template>
    </PanelTitle>
    <div class="counts">
      <div v-for="lv in LEVELS" :key="lv.level" :class="'l' + lv.level">
        <b class="num">{{ count(lv.level) }}</b>
        <span>{{ lv.name }}</span>
      </div>
    </div>
    <ul class="list">
      <li v-for="(a, i) in alarms" :key="i" :class="'l' + a.level">
        <span class="lv">{{ LEVELS[a.level - 1].name }}</span>
        <div class="txt">
          <p class="t">{{ a.text }}</p>
          <p class="p">{{ a.place }}</p>
        </div>
        <span class="time num">{{ a.time }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup>
  import PanelTitle from "./PanelTitle.vue"
  import { ALARMS as alarms } from "../data/city"

  const LEVELS = [
    { level: 1, name: "紧急" },
    { level: 2, name: "重要" },
    { level: 3, name: "一般" }
  ]
  const count = (lv) => alarms.filter((a) => a.level === lv).length
</script>

<style lang="scss" scoped>
  $l1: #ff4d5a;
  $l2: #ff9f43;
  $l3: #2f9bff;

  .counts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 12px;

    div {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 6px;
      padding: 5px 0;
      font-size: 12px;
      color: #a9b9cf;
    }

    b {
      font-size: 22px;
      font-weight: normal;
    }

    .l1 {
      background: rgba($l1, 0.12);
      b {
        color: $l1;
      }
    }

    .l2 {
      background: rgba($l2, 0.12);
      b {
        color: $l2;
      }
    }

    .l3 {
      background: rgba($l3, 0.12);
      b {
        color: $l3;
      }
    }
  }

  .list {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 4px;
      border-bottom: 1px dashed rgba(74, 144, 226, 0.2);
    }

    .lv {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: 2px;
      font-size: 12px;
    }

    .l1 .lv {
      background: rgba($l1, 0.2);
      color: $l1;
    }

    .l2 .lv {
      background: rgba($l2, 0.2);
      color: $l2;
    }

    .l3 .lv {
      background: rgba($l3, 0.2);
      color: $l3;
    }

    .txt {
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

    .time {
      flex-shrink: 0;
      font-size: 14px;
      color: #8aa0bd;
    }
  }
</style>
