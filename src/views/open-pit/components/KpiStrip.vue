<!--
  顶部五个指标：今日煤岩运量、年累运量、车队出勤率、今日换电、边坡安全（设计稿 .kpi 的移植）
  数字都从快数据派生；边坡卡的颜色按最高预警等级走（设计时刻为二级预警 = 橙）
-->
<template>
  <div class="kpi">
    <div class="card">
      <div class="k">
        <span>今日煤岩运量</span
        ><span class="mute">煤 {{ Math.round(k.coalPct) }}%</span>
      </div>
      <div class="v">{{ f2(k.todayWt) }}<u>万吨</u></div>
      <div class="seg" style="height: 5px; margin-top: 5px">
        <i :style="{ width: k.coalPct + '%', background: 'var(--c-coal)' }"></i>
        <i style="flex: 1; background: var(--c-strip)"></i>
      </div>
      <div class="s">
        煤 <span class="num">{{ f2(k.coalWt) }}</span> · 剥离
        <span class="num">{{ f2(k.stripWt) }}</span>
      </div>
    </div>
    <div class="card">
      <div class="k">
        <span>年累煤岩运量</span><span class="mute">{{ year }} 年</span>
      </div>
      <div class="v">{{ f1(k.ytdWt) }}<u>万吨</u></div>
      <div class="s" style="margin-top: 9px">
        煤 <span class="num">{{ f1(k.ytdCoalWt) }}</span> · 剥离
        <span class="num">{{ f1(k.ytdStripWt) }}</span>
      </div>
    </div>
    <div class="card">
      <div class="k">
        <span>车队出勤率</span><span class="mute">{{ k.trucksN }} 台</span>
      </div>
      <div class="v">{{ f1(k.attendance) }}<u>%</u></div>
      <div class="s" style="margin-top: 9px">
        <span class="num">{{ k.onlineN }}</span> 台在线 · 故障
        <span class="num" style="color: var(--fault)">{{ k.faultN }}</span>
      </div>
    </div>
    <div class="card" :class="{ hl: isHl('kpiSwap') }">
      <div class="k">
        <span>今日换电</span><span class="mute">{{ k.swapMin }} min / 次</span>
      </div>
      <div class="v">{{ k.swaps }}<u>次</u></div>
      <div class="s" style="margin-top: 9px">
        排队 <span class="num">{{ k.queueSum }}</span> · 满电备用
        <span class="num">{{ k.poolFull }}</span> 包
      </div>
    </div>
    <div class="card lv" :class="['lv' + r.level, { hl: isHl('kpiSlope') }]">
      <div class="k">
        <span>边坡安全</span
        ><span class="mute">{{ fast.slope.pointN }} 个点位</span>
      </div>
      <div class="v">{{ LEVEL_NAME[r.level] }}</div>
      <div class="s" style="margin-top: 7px">
        {{ r.id }} {{ SECTOR_NAME[r.id] }}
        <span class="num" :style="{ color: levelColor }">{{
          f2(r.velMmH)
        }}</span>
        mm/h
      </div>
    </div>
  </div>
</template>

<script setup>
  import {
    LEVEL_COLOR,
    LEVEL_NAME,
    SECTOR_NAME,
    f1,
    f2
  } from "../store/derive.js"

  const { fast, isHl } = inject("board")
  const k = computed(() => fast.value.kpi)
  const r = computed(() => fast.value.slope.topRadar)
  // 速率数字：一级以上才染预警色，正常时保持白
  const levelColor = computed(() =>
    r.value.level >= 1 ? LEVEL_COLOR[r.value.level] : "var(--ink)"
  )
  // 年份取时钟，不写死
  const year = computed(() => fast.value.clock.date.slice(0, 4))
</script>
