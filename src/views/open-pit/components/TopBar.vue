<!--
  顶栏：标题、五个页签、北京时间、数据状态（设计稿 .hdr 的移植）
  页签点击 = 切 activeTab + 相机飞到该页签的视角（运输调度→车队、边坡安全→边坡雷达、采装与爆破→电铲装车、能源与环保→换电站），对应面板加亮
-->
<template>
  <header class="hdr">
    <svg
      class="logo"
      viewBox="0 0 40 40"
      fill="none"
      stroke="#22d3ee"
      stroke-width="1.6"
    >
      <path d="M3 30 L12 16 L20 24 L28 10 L37 30 Z" />
      <path
        d="M8 30 L12 23 M15 30 L20 24 M22 30 L28 18 M30 30 L33 24"
        stroke-width="1"
        opacity=".7"
      />
      <circle cx="30" cy="9" r="3" stroke="#fbbf24" />
    </svg>
    <div class="title">
      {{ layout.name }} · 无人矿卡运输调度<small
        >QINGYUAN OPEN-PIT · UNMANNED HAUL OPS</small
      >
    </div>
    <nav class="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ on: activeTab === t.key }"
        @click="setTab(t.key)"
      >
        {{ t.name }}
      </button>
    </nav>
    <div class="clock">
      <div class="t">{{ fast.clock.time }}</div>
      <div class="d">{{ fast.clock.date }}</div>
    </div>
    <div class="sync">
      <b :class="{ w: fast.alarmN > 0 }"></b>数据同步正常<br /><b class="w"></b
      >{{ fast.alarmN }} 项异常 · {{ fast.comms.online }}/{{ fast.comms.total }}
      基站在线
    </div>
  </header>
</template>

<script setup>
  import { TABS } from "../store/board.js"

  const { fast, activeTab, setTab, layout } = inject("board")
</script>
