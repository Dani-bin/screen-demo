<!--
  08 车队状态 · 近 6 小时：六类状态占 100 台的比例，随时间堆叠的面积图（设计稿 #c-timeline 的移植）
  悬停某一时刻显示当时六类状态的台数；右上角是最新一条事件
-->
<template>
  <section class="card c-timeline" :class="{ hl: isHl('timeline') }">
    <h3 style="margin-bottom: 5px">
      <i>08</i>车队状态 · 近 6 小时<em
        style="
          max-width: 260px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        "
        ><template v-if="evLast"
          ><span style="color: var(--warn)">●</span> {{ evLast.from }}
          {{ evLast.title }}</template
        ></em
      >
    </h3>
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
      <polygon
        v-for="(a, k) in areas"
        :key="k"
        :points="a"
        :fill="ST[k].c"
        stroke="#0a1420"
        stroke-width="1.2"
      />
      <text
        v-for="a in axis"
        :key="a.m"
        :x="xs(a.m)"
        :y="H - 3"
        :text-anchor="a.m === 0 ? 'end' : a.m === -360 ? 'start' : 'middle'"
        font-size="12"
        fill="#6b8296"
      >
        {{ a.t }}
      </text>
      <line
        v-if="hov"
        :x1="xs(hov.min)"
        :x2="xs(hov.min)"
        y1="0"
        :y2="H - 14"
        stroke="rgba(230,241,247,.85)"
      />
      <rect
        x="0"
        y="0"
        :width="W"
        :height="H - 14"
        fill="transparent"
        @mousemove="onMove"
        @mouseleave="onLeave"
      />
    </svg>
    <div class="legend" style="margin-top: 2px">
      <span v-for="s in ST" :key="s.k"
        ><b :style="{ background: s.c }"></b>{{ s.n }}</span
      ><span class="mute">占 {{ total }} 台的比例</span>
    </div>
  </section>
</template>

<script setup>
  import { ST, hhmm } from "../store/derive.js"
  import { svgX } from "../store/chart.js"

  const { fast, slow, isHl, showTip, hideTip } = inject("board")
  const W = 524
  const H = 50
  const L = 2
  const xs = (m) => L + ((m + 360) / 360) * (W - L - 2)
  const ys = (frac) => 3 + (H - 17) * (1 - frac)
  const tl = computed(() => slow.value.fleetTimeline)
  const sum = (c, n) => c.slice(0, n).reduce((a, b) => a + b, 0)
  // 六层堆叠面积：第 k 层的上沿 = 前 k+1 类之和，下沿 = 前 k 类之和
  const areas = computed(() =>
    ST.map((_, k) => {
      const top = tl.value.map(
        (p) => `${xs(p.min)},${ys(sum(p.counts, k + 1) / sum(p.counts, 6))}`
      )
      const bot = tl.value
        .slice()
        .reverse()
        .map((p) => `${xs(p.min)},${ys(sum(p.counts, k) / sum(p.counts, 6))}`)
      return `${top.join(" ")} ${bot.join(" ")}`
    })
  )
  const axis = computed(() =>
    [-360, -270, -180, -90, 0].map((m) => ({
      m,
      t: hhmm(fast.value.ms + m * 60000)
    }))
  )
  // 总台数取最新一点的六类之和
  const total = computed(() => sum(tl.value[tl.value.length - 1].counts, 6))
  // 最新一条事件（快数据按时间从近到远排好）
  const evLast = computed(() => fast.value.events[0] ?? null)

  const hov = ref(null)
  function onMove(e) {
    const m = ((svgX(e, W) - L) / (W - L - 2)) * 360 - 360
    const p = tl.value.reduce((a, b) =>
      Math.abs(b.min - m) < Math.abs(a.min - m) ? b : a
    )
    hov.value = p
    showTip(
      e,
      hhmm(fast.value.ms + p.min * 60000),
      ST.map((s, i) => ({ c: s.c, k: s.n, v: `${p.counts[i]} 台` }))
    )
  }
  function onLeave() {
    hov.value = null
    hideTip()
  }
</script>
