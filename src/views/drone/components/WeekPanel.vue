<!--
  近 7 天事件：前 6 天整天 + 今天截至当前（虚线框标出），11 种事件类型并成 6 类堆叠，
  标题右侧给处置率、误报率（误报 ÷（已确认 + 误报））。
-->
<template>
  <section class="panel week">
    <div class="ph">
      <h3>近 7 天事件</h3>
      <span class="meta"
        >处置率 {{ pct(K.disposalRate) }}% · 误报率 {{ pct(falseRate) }}%</span
      >
    </div>
    <svg v-if="days" class="chart" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="v in ticks" :key="v">
        <line :x1="X0" :x2="W" :y1="Y(v)" :y2="Y(v)" class="grid" />
        <text x="0" :y="Y(v) + 4" class="tick num">{{ v }}</text>
      </g>
      <g v-for="(d, i) in days" :key="d.date">
        <template v-for="(seg, j) in d.segs" :key="j">
          <rect
            v-if="seg.n"
            :x="bx(i)"
            :y="Y(seg.top)"
            :width="bw"
            :height="Math.max(0, Y(seg.base) - Y(seg.top) - 1)"
            :fill="PALETTE[j]"
            :opacity="d.today ? 0.95 : 0.8"
          />
        </template>
        <text
          :x="bx(i) + bw / 2"
          :y="Y(d.total) - 4"
          class="total num"
          text-anchor="middle"
        >
          {{ d.total }}
        </text>
        <text
          :x="bx(i) + bw / 2"
          :y="H - 4"
          class="tick"
          :class="{ today: d.today }"
          text-anchor="middle"
        >
          {{ d.today ? "今天" : d.label }}
        </text>
        <rect
          v-if="d.today"
          :x="bx(i) - 3"
          :y="Y(d.total) - 18"
          :width="bw + 6"
          :height="H - 18 - Y(d.total) + 18"
          class="today-box"
        />
      </g>
    </svg>
    <div v-else class="wait">统计中…</div>
    <div class="legend">
      <span v-for="(c, j) in CATS" :key="c.key"
        ><i :style="{ background: PALETTE[j] }"></i>{{ c.name }}</span
      >
    </div>
  </section>
</template>

<script setup>
  import { pct } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    week: { type: Array, default: null }
  })

  // 11 种类型并成 6 类，图上颜色才分得开（与定稿一致）
  const CATS = [
    { key: "fire", name: "烟火 · 动火", of: ["fire", "hotwork"] },
    { key: "gas", name: "气体泄漏", of: ["gas"] },
    { key: "temp", name: "温度 · 保温", of: ["temp", "insulation"] },
    { key: "leak", name: "跑冒滴漏 · 异物", of: ["leak", "debris"] },
    {
      key: "person",
      name: "人员 · 周界",
      of: ["intrusion", "perimeter", "helmet"]
    },
    { key: "car", name: "车辆违停", of: ["parking"] }
  ]
  const PALETTE = [
    "#5b8def",
    "#36e3d8",
    "#9b7bea",
    "#4fb6ff",
    "#7fd38f",
    "#c9a86a"
  ]
  const W = 372
  const H = 200
  const X0 = 22
  const bw = ((W - X0) / 7) * 0.56
  const bx = (i) => X0 + (i * (W - X0)) / 7 + ((W - X0) / 7) * 0.22

  const K = computed(() => props.state.kpi)
  const falseRate = computed(() => {
    const k = K.value
    const n = k.inProgress + k.closed + k.falseAlarm
    return n ? k.falseAlarm / n : 0
  })
  const days = computed(() => {
    if (!props.week) return null
    return props.week.map((d) => {
      let acc = 0
      const segs = CATS.map((c) => {
        const n = c.of.reduce((s, k) => s + (d.counts[k] || 0), 0)
        const seg = { n, base: acc, top: acc + n }
        acc += n
        return seg
      })
      return {
        date: d.date,
        label: d.date.slice(5).replace("-", "/"),
        today: !!d.today,
        total: d.total,
        segs
      }
    })
  })
  const top = computed(() =>
    Math.max(
      5,
      Math.ceil(
        Math.max(...(days.value || [{ total: 5 }]).map((d) => d.total)) / 5
      ) * 5
    )
  )
  const ticks = computed(() =>
    Array.from({ length: top.value / 5 + 1 }, (_, i) => i * 5)
  )
  const Y = (v) => H - 18 - (v / top.value) * (H - 30)
</script>

<style lang="scss" scoped>
  .week {
    left: 1496px;
    top: 694px;
    width: 400px;
    height: 294px;
    // 行高回到 normal（设计稿未设行高，页面继承的 1.5 会让图表和图例整体下移）
    line-height: normal;
  }
  .chart {
    display: block;
    width: 372px;
    height: 200px;
    margin: 0 14px;
  }
  .wait {
    height: 200px;
    display: grid;
    place-items: center;
    color: var(--dim);
  }
  .grid {
    stroke: var(--line);
  }
  .tick {
    fill: var(--dim);
    font-size: 10px;
    &.today {
      fill: var(--text);
    }
  }
  .total {
    fill: var(--text);
    font-size: 11px;
  }
  .today-box {
    fill: none;
    stroke: var(--text);
    stroke-dasharray: 2 3;
    opacity: 0.5;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    // 与设计稿 .legend 一致：行、列间距都是 12px（图例折成两行）
    gap: 12px;
    margin: 4px 14px 0;
    font-size: 12px;
    color: var(--sub);
    i {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 4px;
      vertical-align: -1px;
    }
  }
</style>
