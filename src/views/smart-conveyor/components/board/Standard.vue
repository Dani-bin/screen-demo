<!--
  05 智能化验收对标：国家能源局《煤矿智能化建设指南》（2021 年 69 号文）表 6「带式输送机运输系统」10 个评分项
  → 本平台对应的功能。只是功能对标演示，不是验收结论（屏上写明）。
-->
<template>
  <Panel no="05" title="智能化验收对标" en="NEA 2021-69 · TABLE 6">
    <div class="std">
      <div v-for="(x, i) in ITEMS" :key="x[0]" class="std-i" :title="x[2]">
        <b class="code">{{ String(i + 1).padStart(2, "0") }}</b
        ><span>{{ x[0] }}</span
        ><strong>{{ x[1] }}</strong
        ><Ic name="check" class="ok" />
      </div>
    </div>
    <p class="std-sum">
      评分项覆盖 <b>{{ ITEMS.length }}/{{ ITEMS.length }}</b> · 合计
      <b>{{ total }}</b> 分 <em>· 功能对标演示，非验收结论</em>
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"

  /** [评分项, 分值, 本平台对应功能] */
  const ITEMS = [
    ["互联互通 · 无人值守", 10, "集控 + 平台一体"],
    ["单机自动控制", 10, "传感器 / 执行器"],
    ["变频软启动", 10, "17 台电机全变频"],
    ["综合保护联动", 10, "八大保护 + 联锁"],
    ["煤仓给煤联动", 10, "煤位 → 给煤机"],
    ["AI 煤流均衡调速", 10, "双目视觉 + 调速"],
    ["多机协同 · 语音预警", 15, "逆煤流起车"],
    ["AI 识别跑偏异物越界", 10, "31 路 AI 视频"],
    ["驱动部在线诊断", 10, "温振 + 频谱"],
    ["环境监测预警", 5, "CO / 粉尘 / 烟雾"]
  ]
  const total = ITEMS.reduce((a, x) => a + x[1], 0)
</script>
