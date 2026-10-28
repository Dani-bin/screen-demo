<!--
  底部两张图：10 光纤测温剖面（103 全线，含定温 / 差温阈值）、11 今日运量（逐小时，检修班留白）
  （故障剧本按钮没做功能，用户 2026-10-28 要求去掉，运量图加高填满面板）
-->
<template>
  <div class="bottom">
    <section class="panel dts">
      <header class="ph">
        <b class="no">10</b>
        <h3>光纤测温 · 103 全线</h3>
        <i>DTS · 1 m · 均值 {{ fmt(d.dts.refMean, 1) }} ℃</i>
        <span class="peak"
          >最高 <b>{{ fmt(d.dts.peak, 1) }} ℃</b> @ {{ d.dts.peakAt }} m</span
        >
      </header>
      <svg viewBox="0 0 560 150" class="chart">
        <g v-for="t in [10, 20, 30, 40]" :key="t">
          <line x1="36" x2="548" :y1="TY(t)" :y2="TY(t)" class="grid" />
          <text x="28" :y="TY(t) + 4" class="ax" text-anchor="end">
            {{ t }}
          </text>
        </g>
        <text
          v-for="m in [0, 50, 100, 150, 200, 248]"
          :key="m"
          :x="TX(m)"
          y="146"
          class="ax"
          :text-anchor="m === 248 ? 'end' : m === 0 ? 'start' : 'middle'"
        >
          {{ m }}
        </text>
        <line
          x1="36"
          x2="548"
          :y1="TY(s.dtsRule.fixed)"
          :y2="TY(s.dtsRule.fixed)"
          class="thr fixed"
        />
        <text
          x="546"
          :y="TY(s.dtsRule.fixed) - 5"
          class="thr-t"
          text-anchor="end"
        >
          定温 {{ s.dtsRule.fixed }} ℃
        </text>
        <line
          x1="36"
          x2="548"
          :y1="TY(diffLine)"
          :y2="TY(diffLine)"
          class="thr diff"
        />
        <text x="546" :y="TY(diffLine) - 5" class="thr-t" text-anchor="end">
          差温阈值 均值 + {{ s.dtsRule.diff }} ℃
        </text>
        <polyline :points="dtsPts" class="line" />
        <template v-if="s.idler35.level">
          <circle
            :cx="TX(d.dts.peakAt)"
            :cy="TY(d.dts.peak)"
            r="5"
            class="pk"
          />
          <text :x="TX(d.dts.peakAt) + 10" :y="TY(d.dts.peak) - 8" class="pk-t">
            第 {{ d.dts.group }} 组 · 差温 +{{ fmt(d.dts.diff, 1) }} ℃
          </text>
        </template>
        <text x="546" y="132" class="ax" text-anchor="end">机尾受料点 →</text>
      </svg>
    </section>
    <section class="panel hoist">
      <header class="ph">
        <b class="no">11</b>
        <h3>今日运量 · 103</h3>
        <i>t/h · 累计 {{ fmt(s.flowToday) }} t</i>
      </header>
      <svg viewBox="0 0 380 148" class="chart">
        <rect
          :x="FX(0)"
          y="6"
          :width="FX(8) - FX(0)"
          height="124"
          class="maint"
        />
        <text :x="(FX(0) + FX(8)) / 2" y="74" class="ax" text-anchor="middle">
          检修班
        </text>
        <line
          x1="30"
          x2="370"
          :y1="FY(1000)"
          :y2="FY(1000)"
          class="thr fixed"
        />
        <text x="34" :y="FY(1000) + 12" class="thr-t">额定 1,000</text>
        <polygon :points="flowArea" class="area" />
        <polyline :points="flowPts" class="line warm" />
        <line :x1="FX(now)" :x2="FX(now)" y1="4" y2="130" class="nowl" />
        <text :x="FX(now) + 4" y="14" class="now-t">
          现在 {{ s.time.hms.slice(0, 5) }}
        </text>
        <text
          v-for="h in [0, 6, 12, 18, 24]"
          :key="h"
          :x="FX(h)"
          y="144"
          class="ax"
          :text-anchor="h === 24 ? 'end' : h === 0 ? 'start' : 'middle'"
        >
          {{ String(h).padStart(2, "0") }}:00
        </text>
      </svg>
    </section>
  </div>
</template>

<script setup>
  import { fmt } from "./fmt.js"

  const props = defineProps({ d: { type: Object, required: true } })
  const s = computed(() => props.d.s)

  // 光纤测温剖面：x 0–248 m，y 8–48 ℃
  const TX = (m) => 36 + (m / 248) * 512
  const TY = (t) => 8 + (1 - (t - 8) / 40) * 120
  const diffLine = computed(() => props.d.dts.refMean + s.value.dtsRule.diff)
  const dtsPts = computed(() =>
    s.value.dts
      .map((t, m) => `${TX(m).toFixed(1)},${TY(t).toFixed(1)}`)
      .join(" ")
  )

  // 今日运量：0–24 点，0–1000 t/h，阶梯线到"现在"为止
  const FX = (h) => 30 + (h / 24) * 340
  const FY = (v) => 6 + (1 - v / 1000) * 124
  const now = computed(() => s.value.time.hour + s.value.time.minute / 60)
  const steps = computed(() => {
    const pts = []
    s.value.flowHourly.forEach((v, h) => {
      if (h >= now.value) return
      const end = Math.min(h + 1, now.value)
      pts.push(`${FX(h)},${FY(v)}`, `${FX(end)},${FY(v)}`)
    })
    return pts
  })
  const flowPts = computed(() => steps.value.join(" "))
  const flowArea = computed(
    () => `${FX(0)},${FY(0)} ${flowPts.value} ${FX(now.value)},${FY(0)}`
  )
</script>
