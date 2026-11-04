<!--
  03 分时运量：今日每小时的运煤 / 剥离堆叠柱（设计稿 #c-hourly 的移植，手写 SVG）
  悬停某一小时显示该小时的煤 / 剥离吨数；最后一格是当前小时已过的部分
-->
<template>
  <section class="card c-hourly">
    <h3><i>03</i>分时运量<em>今日 · t / 小时</em></h3>
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
      <template v-for="v in ticks" :key="v">
        <line
          :x1="L"
          :x2="W"
          :y1="y(v)"
          :y2="y(v)"
          stroke="rgba(120,160,190,.18)"
        />
        <text
          :x="L - 5"
          :y="y(v) + 4"
          text-anchor="end"
          font-size="12"
          fill="#6b8296"
        >
          {{ v / 1000 }}k
        </text>
      </template>
      <template v-for="(d, i) in bars" :key="d.h">
        <rect
          :x="L + i * bw + 1.5"
          :y="y(d.coalT)"
          :width="bw - 3"
          :height="y(0) - y(d.coalT)"
          fill="var(--c-coal)"
        />
        <rect
          :x="L + i * bw + 1.5"
          :y="y(d.coalT + d.stripT) - 1.5"
          :width="bw - 3"
          :height="y(0) - y(d.stripT)"
          fill="var(--c-strip)"
        />
        <text
          v-if="i % 4 === 0"
          :x="L + i * bw + 1.5 + (bw - 3) / 2"
          :y="H - 3"
          text-anchor="middle"
          font-size="12"
          fill="#6b8296"
        >
          {{ p2(d.h) }}
        </text>
      </template>
      <!-- 悬停热区：整列都能触发，当前列加亮 -->
      <rect
        v-for="(d, i) in bars"
        :key="'hit' + d.h"
        :x="L + i * bw"
        :y="top"
        :width="bw"
        :height="H - B - top"
        :fill="hov === i ? 'rgba(34,211,238,.12)' : 'transparent'"
        @mousemove="onMove($event, d, i)"
        @mouseleave="onLeave"
      />
    </svg>
    <div class="legend">
      <span
        ><b style="background: var(--c-coal)"></b>运煤
        <span class="num">{{ f2(k.coalWt) }}</span> 万吨</span
      ><span
        ><b style="background: var(--c-strip)"></b>剥离
        <span class="num">{{ f2(k.stripWt) }}</span> 万吨</span
      ><span class="mute"
        >{{ p2(last.h) }} 时为 {{ p2(last.h) }}:00–{{ nowHm }}</span
      >
    </div>
  </section>
</template>

<script setup>
  import { f2, pad as p2 } from "../store/derive.js"
  import { int } from "../store/chart.js"

  const { fast, slow, showTip, hideTip } = inject("board")
  // 画布与坐标（和设计稿一致）
  const W = 392
  const H = 178
  const L = 34
  const B = 18
  const top = 6
  const k = computed(() => fast.value.kpi)
  const bars = computed(() => slow.value.hourly)
  const last = computed(() => bars.value[bars.value.length - 1])
  const nowHm = computed(() => fast.value.clock.time.slice(0, 5))
  const bw = computed(() => (W - L) / bars.value.length)
  // 纵轴上限：默认 1 万 t，某小时超过则按 5 000 t 进位
  const max = computed(() =>
    Math.max(
      10000,
      Math.ceil(Math.max(...bars.value.map((d) => d.coalT + d.stripT)) / 5000) *
        5000
    )
  )
  const ticks = computed(() => [0, max.value / 2, max.value])
  const y = (v) => top + (H - B - top) * (1 - v / max.value)

  const hov = ref(-1)
  function onMove(e, d, i) {
    hov.value = i
    const end = i === bars.value.length - 1 ? nowHm.value : `${p2(d.h + 1)}:00`
    showTip(e, `${p2(d.h)}:00–${end}`, [
      { c: "var(--c-coal)", k: "运煤", v: `${int(d.coalT)} t` },
      { c: "var(--c-strip)", k: "剥离", v: `${int(d.stripT)} t` },
      { k: "合计", v: `${int(d.coalT + d.stripT)} t` },
      { k: "换电", v: `${d.swaps} 次` }
    ])
  }
  function onLeave() {
    hov.value = -1
    hideTip()
  }
</script>
