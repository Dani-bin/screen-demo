<!--
  集控组态图：主煤流二维流程（蛇形三行）
    工作面 → BC05 / BC06 → BC04 → MC01 ⇣ 给煤机 → BC03 → MC02 ⇣ 给煤机 → BC02 → BC01 → MC03 → 选煤厂
  皮带粗线按状态着色，运行时煤流箭头沿线流动（速度跟带速）；煤仓画料位；点皮带选中（三维飞过去）。
-->
<template>
  <Panel no="R1" title="集控组态图" en="SCADA · MAIN FLOW">
    <svg class="fd" :style="size" :viewBox="`0 0 ${W} ${H}`">
      <!-- 工作面 -->
      <g v-for="f in FACES" :key="f.id" class="fd-node">
        <rect :x="f.x" :y="f.y - 11" width="54" height="22" />
        <text :x="f.x + 27" :y="f.y + 4" text-anchor="middle">{{ f.id }}</text>
      </g>
      <!-- 皮带 -->
      <g
        v-for="b in beltsView"
        :key="b.id"
        class="fd-belt"
        :class="{ sel: b.id === selected }"
        :style="{ '--c': `var(${b.cvar})` }"
        @click="emit('pick', b.id)"
      >
        <path class="hit" :d="b.d" />
        <path class="base" :d="b.d" />
        <path
          v-if="b.run"
          class="flow"
          :d="b.d"
          :style="{ animationDuration: `${b.dur}s` }"
        />
        <text :x="b.lx" :y="b.ly" class="fd-id" :text-anchor="b.anchor">
          {{ b.id }}
          <tspan class="fd-v" dx="4">{{ fmt(b.st.v, 1) }} m/s</tspan>
        </text>
      </g>
      <!-- 煤仓（料位） -->
      <g
        v-for="m in bunkersView"
        :key="m.id"
        class="fd-bk"
        @click="emit('pick', m.id)"
      >
        <rect :x="m.x - 13" :y="m.y - 20" width="26" height="40" rx="3" />
        <rect
          class="lvl"
          :x="m.x - 12"
          :y="m.y + 19 - 38 * m.level"
          width="24"
          :height="38 * m.level"
        />
        <text :x="m.x" :y="m.y + 33" text-anchor="middle" class="fd-id">
          {{ m.id }}
        </text>
        <text :x="m.x" :y="m.y + 4" text-anchor="middle" class="fd-pct">
          {{ pct(m.level) }}
        </text>
      </g>
      <!-- 给煤机 -->
      <g
        v-for="g in feedersView"
        :key="g.id"
        class="fd-gm"
        :class="{ on: g.on }"
      >
        <rect :x="g.x - 9" :y="g.y - 6" width="18" height="12" />
        <text :x="g.x" :y="g.y + 3" text-anchor="middle">
          {{ g.id.slice(2) }}
        </text>
      </g>
      <!-- 去选煤厂 -->
      <g class="fd-node">
        <rect :x="W - 62" :y="Y3 - 11" width="54" height="22" />
        <text :x="W - 35" :y="Y3 + 4" text-anchor="middle">选煤厂</text>
      </g>
    </svg>
    <ul class="fd-lg">
      <li v-for="x in LEGEND" :key="x[0]" :style="{ '--c': `var(${x[1]})` }">
        <i></i>{{ x[0] }}
      </li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { ST_VAR, fmt, pct, rem } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  const emit = defineEmits(["pick"])

  // 画布 396 × 200（设计稿 px），三行
  const W = 396
  const H = 214
  const Y1 = 34
  const Y2 = 108
  const Y3 = 170
  const size = { width: rem(W), height: rem(H) }

  const FACES = [
    { id: "WF12301", x: 6, y: Y1 - 12 },
    { id: "WF12305", x: 6, y: Y1 + 22 }
  ]
  /** 皮带路径（煤流方向画）与标签位置 */
  const GEO = {
    BC05: {
      d: `M64,${Y1 - 12} L150,${Y1 - 12} L170,${Y1 + 4}`,
      lx: 104,
      ly: Y1 - 18,
      anchor: "middle"
    },
    BC06: {
      d: `M64,${Y1 + 22} L150,${Y1 + 22} L170,${Y1 + 8}`,
      lx: 104,
      ly: Y1 + 40,
      anchor: "middle"
    },
    BC04: {
      d: `M176,${Y1 + 6} L330,${Y1 + 6}`,
      lx: 250,
      ly: Y1 - 6,
      anchor: "middle"
    },
    BC03: { d: `M330,${Y2} L64,${Y2}`, lx: 196, ly: Y2 - 10, anchor: "middle" },
    BC02: {
      d: `M40,${Y2 + 26} L40,${Y3} L196,${Y3}`,
      lx: 120,
      ly: Y3 - 10,
      anchor: "middle"
    },
    BC01: { d: `M204,${Y3} L284,${Y3}`, lx: 244, ly: Y3 - 10, anchor: "middle" }
  }
  const BUNKERS = [
    { id: "MC01", x: 356, y: Y1 + 22 },
    { id: "MC02", x: 40, y: Y2 - 10 },
    { id: "MC03", x: 306, y: Y3 }
  ]
  const FEEDERS = [
    { id: "GM01", x: 344, y: Y2 - 14 },
    { id: "GM02", x: 368, y: Y2 - 14 },
    { id: "GM03", x: 28, y: Y2 + 18 },
    { id: "GM04", x: 52, y: Y2 + 18 }
  ]
  const LEGEND = [
    ["运行", "--ok"],
    ["待机", "--data"],
    ["预警 / 启动", "--l3"],
    ["闭锁", "--l2"],
    ["保护停机", "--l1"],
    ["停车", "--off"]
  ]

  const beltsView = computed(() =>
    Object.entries(GEO).map(([id, g]) => {
      const st = props.f.s.belts[id]
      const run = st.v > 0.05
      return {
        id,
        ...g,
        st,
        run,
        cvar: ST_VAR[st.state],
        // 箭头流动一个周期的时长：带速越快越短
        dur: (2.4 / Math.max(0.5, st.v)).toFixed(2)
      }
    })
  )
  const bunkersView = computed(() =>
    BUNKERS.map((m) => ({ ...m, level: props.f.s.bunkers[m.id].level }))
  )
  const feedersView = computed(() =>
    FEEDERS.map((g) => ({ ...g, on: props.f.s.feeders[g.id]?.on }))
  )
</script>
