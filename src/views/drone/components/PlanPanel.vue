<!--
  今日巡检计划：8 条航线 × 06:00–23:00 时间轴上的 49 趟，按状态着色（已完成 / 执行中 / 顺延 / 漏巡 / 待执行），
  顺延的那趟画计划时刻的虚线框 + 已顺延的时长；竖线为当前时刻。点某趟 = 回放到它起飞并跟随那架无人机。
-->
<template>
  <section class="panel plan">
    <div class="ph">
      <h3>今日巡检计划</h3>
      <span class="meta"
        >{{ K.planDone }}/{{ K.planTotal }} 趟 · 完成率
        {{ pct(K.planRate) }}%</span
      >
    </div>
    <!-- SVG 尺寸写在 CSS 里（会被换算成 rem 随屏缩放），内部坐标用 viewBox -->
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="hr in hours" :key="hr">
        <line :x1="X(hr)" :x2="X(hr)" y1="0" :y2="H - 18" class="grid" />
        <text :x="X(hr)" :y="H - 4" class="tick num" text-anchor="middle">
          {{ pad(hr) }}
        </text>
      </g>
      <g v-for="(id, i) in routeIds" :key="id">
        <text x="0" :y="i * rowH + 2 + rowH / 2 + 4" class="label">
          {{ id }} {{ ROUTES[id].name.slice(0, 4) }}
        </text>
        <template v-for="p in byRoute[id]" :key="p.id">
          <template v-if="p.status === 'postponed'">
            <rect
              :x="X(h(p.plannedAt))"
              :y="i * rowH + 5"
              :width="Math.max(2, X(nowH) - X(h(p.plannedAt)))"
              :height="rowH - 6"
              class="postponed-fill"
            />
            <rect
              :x="X(h(p.plannedAt))"
              :y="i * rowH + 5"
              :width="
                Math.max(3, X(h(p.plannedAt) + len(id)) - X(h(p.plannedAt)))
              "
              :height="rowH - 6"
              class="postponed"
            />
          </template>
          <rect
            v-else
            :x="X(h(p.startedAt || p.plannedAt))"
            :y="i * rowH + 5"
            :width="
              Math.max(
                3,
                X(h(p.startedAt || p.plannedAt) + len(id)) -
                  X(h(p.startedAt || p.plannedAt))
              )
            "
            :height="rowH - 6"
            rx="1"
            :class="['trip', p.status]"
            @click="p.startedAt && $emit('seek', p)"
          >
            <title>
              {{ p.id }} · {{ PLAN_STATUS[p.status]
              }}{{ p.reason ? " · " + p.reason : "" }}
            </title>
          </rect>
        </template>
      </g>
      <line :x1="X(nowH)" :x2="X(nowH)" y1="0" :y2="H - 18" class="now" />
      <text :x="X(nowH) + 4" y="10" class="now-t num">
        {{ hms(cursor, false) }}
      </text>
    </svg>
    <div class="legend">
      <span><i class="done"></i>已完成</span
      ><span><i class="running"></i>执行中</span
      ><span><i class="postponed"></i>顺延</span>
      <span><i class="missed"></i>漏巡</span
      ><span><i class="pending"></i>待执行</span>
    </div>
  </section>
</template>

<script setup>
  import { PLAN_STATUS } from "../data/catalog.js"
  import { ROUTES } from "../data/layout.js"
  import { ROUTE_MIN } from "../sim/simulator.js"
  import { hms, pad, pct } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    cursor: { type: Number, required: true },
    dayStart: { type: Number, required: true }
  })
  defineEmits(["seek"])

  const W = 376
  const H = 230
  const X0 = 78
  const T0 = 6
  const T1 = 23
  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22]
  const routeIds = Object.keys(ROUTES)
  const rowH = (H - 22) / routeIds.length
  const X = (hr) => X0 + ((hr - T0) / (T1 - T0)) * (W - X0 - 6)
  const h = (t) => (t - props.dayStart) / 3600e3
  const len = (id) => ROUTE_MIN[id] / 60
  const K = computed(() => props.state.kpi)
  const nowH = computed(() => h(props.cursor))
  const byRoute = computed(() => {
    const m = Object.fromEntries(routeIds.map((id) => [id, []]))
    for (const p of props.state.plan) m[p.route].push(p)
    return m
  })
</script>

<style lang="scss" scoped>
  .plan {
    left: 24px;
    top: 674px;
    width: 400px;
    height: 314px;
    // 行高回到 normal（设计稿未设行高，页面继承的 1.5 会让图表和图例整体下移）
    line-height: normal;
  }
  .chart {
    display: block;
    width: 376px;
    height: 230px;
    margin: 0 12px;
  }
  .grid {
    stroke: var(--line);
  }
  .tick {
    fill: var(--dim);
    font-size: 10px;
  }
  .label {
    fill: var(--sub);
    font-size: 11px;
  }
  .trip {
    fill: var(--dim);
    opacity: 0.35;
    &.done,
    &.partial {
      fill: var(--ok);
      opacity: 0.55;
      cursor: pointer;
    }
    &.running {
      fill: var(--run);
      opacity: 1;
      cursor: pointer;
    }
    &.missed {
      fill: var(--major);
      opacity: 1;
    }
  }
  .postponed-fill {
    fill: var(--warn);
    opacity: 0.3;
  }
  .postponed {
    fill: none;
    stroke: var(--warn);
    stroke-dasharray: 2 2;
  }
  .now {
    stroke: var(--text);
    stroke-width: 1.5;
  }
  .now-t {
    fill: var(--text);
    font-size: 11px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 6px 12px 0;
    font-size: 12px;
    color: var(--sub);
    i {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 4px;
      vertical-align: -1px;
      &.done {
        background: var(--ok);
        opacity: 0.55;
      }
      &.running {
        background: var(--run);
      }
      &.postponed {
        background: var(--warn);
      }
      &.missed {
        background: var(--major);
      }
      &.pending {
        background: var(--dim);
        opacity: 0.35;
      }
    }
  }
</style>
