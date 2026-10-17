<!--
  中下：分层路线小图（按 CAD 画：房间色块 + 中庭 + 电梯 + 本层要走的路线），三层并排
  每块标出本层要做的事（步行多少米、乘什么换层）；人员所在的楼层标"当前"。点一块可让三维镜头聚焦该层。
-->
<template>
  <section class="floor-strip">
    <div
      v-for="f in [0, 1, 2]"
      :key="f"
      class="panel"
      :class="{ on: f === floor }"
      @click="emit('focus', f)"
    >
      <header>
        <b>{{ FLOORS[f] }}</b>
        <span>{{ FLOOR_TITLES[f] }}{{ f === floor ? " · 当前" : "" }}</span>
        <em>{{ notes[f] }}</em>
      </header>
      <svg
        :viewBox="`-2 -2 ${W + 4} ${D + 4}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect
          class="outline"
          x="-0.6"
          y="-0.6"
          :width="W + 1.2"
          :height="D + 1.2"
        />
        <rect class="floor" x="0" y="0" :width="W" :height="D" />
        <rect
          v-for="(t, i) in tiles[f]"
          :key="i"
          :x="t[0] + 0.35"
          :y="D - t[3] + 0.35"
          :width="t[2] - t[0] - 0.7"
          :height="t[3] - t[1] - 0.7"
          :style="{ fill: zoneColor[t[4]] }"
        />
        <rect
          v-if="f > 0"
          class="void"
          :x="VOID[0]"
          :y="D - VOID[3]"
          :width="VOID[2] - VOID[0]"
          :height="VOID[3] - VOID[1]"
        />
        <rect
          v-for="(e, i) in ELEV"
          :key="'e' + i"
          class="elev"
          :x="e[0] + 0.35"
          :y="D - e[3] + 0.35"
          :width="e[2] - e[0] - 0.7"
          :height="e[3] - e[1] - 0.7"
        />
        <polyline
          v-for="(p, i) in lines[f]"
          :key="'r' + i"
          class="route"
          :points="p.map(([x, y]) => `${clampX(x)},${D - clampY(y)}`).join(' ')"
        />
        <rect
          v-for="(c, i) in conns[f]"
          :key="'c' + i"
          class="conn"
          :x="c[0] - 1.2"
          :y="D - c[1] - 1.2"
          width="2.4"
          height="2.4"
        />
        <circle
          v-if="startAt && startAt.f === f"
          class="start"
          :cx="clampX(startAt.x)"
          :cy="D - clampY(startAt.y)"
          r="1.6"
        />
        <circle
          v-if="endAt && endAt.f === f"
          class="end"
          :cx="endAt.x"
          :cy="D - endAt.y"
          r="1.6"
        />
      </svg>
    </div>
  </section>
</template>

<script setup>
  import PLAN from "../data/plan.json"
  import { FLOORS, FLOOR_TITLES, legs, routePolylines, walkLen } from "../route"
  import { THEME } from "../scene/theme"

  const props = defineProps({
    route: { type: Object, default: null },
    graph: { type: Object, required: true },
    floor: { type: Number, default: 0 }
  })
  const emit = defineEmits(["focus"])

  const [W, D] = PLAN.meta.size
  const VOID = PLAN.void
  const ELEV = Object.values(PLAN.elevators).map((e) => e.rect)
  // 房间色块用与三维场景同一套分区色（设计稿 v1 的做法）
  const zoneColor = THEME.colors.zones
  // 每层房间色块：[x0, y0, x1, y1, zone]（含楼梯间、卫生间）
  const tiles = [0, 1, 2].map((f) => [
    ...PLAN.rooms.filter((r) => r.floor === f).map((r) => [...r.rect, r.zone]),
    ...Object.values(PLAN.stairs).map((s) => [...s.rect, "traffic"]),
    ...Object.values(PLAN.wc).map((s) => [...s.rect, "wc"])
  ])
  // 楼外的点（主入口外的起点）夹到楼外 1.5 m 以内，不画出小图
  const clampX = (x) => Math.min(Math.max(x, -1.5), W + 1.5)
  const clampY = (y) => Math.min(Math.max(y, -1.5), D + 1.5)

  const lines = computed(() => {
    const out = [[], [], []]
    if (props.route)
      for (const l of routePolylines(props.graph, props.route.path))
        out[l.floor].push(l.pts)
    return out
  })
  const conns = computed(() => {
    const out = [[], [], []]
    if (!props.route) return out
    for (const l of legs(props.graph, props.route.path)) {
      if (l.kind === "walk") continue
      for (const id of [l.a, l.b]) {
        const n = props.graph.nodes[id]
        out[n.f].push([n.x, n.y])
      }
    }
    return out
  })
  const node = (i) =>
    props.route ? props.graph.nodes[props.route.path[i]] : null
  const startAt = computed(() => node(0))
  const endAt = computed(() =>
    props.route ? node(props.route.path.length - 1) : null
  )

  /** 每层的说明：步行多少米、怎么离开 / 到达这一层 */
  const notes = computed(() => {
    const out = ["不经过", "不经过", "不经过"]
    if (!props.route) return out
    const L = legs(props.graph, props.route.path)
    const walk = [0, 0, 0]
    const visited = new Set()
    for (const l of L) {
      if (l.kind === "walk") {
        walk[l.floor] += walkLen(props.graph, l)
        visited.add(l.floor)
      } else {
        visited.add(l.f0)
        visited.add(l.f1)
      }
    }
    const word = { escalator: "乘扶梯", elevator: "乘电梯", stair: "走楼梯" }
    const f0 = startAt.value.f
    const f1 = endAt.value.f
    for (const f of visited) {
      const m = Math.round(walk[f])
      const leave = L.find((l) => l.kind !== "walk" && l.f0 === f)
      if (f === f1) out[f] = `步行 ${m} 米到达`
      else if (f === f0)
        out[f] = leave ? `步行 ${m} 米，${word[leave.kind]}` : `步行 ${m} 米`
      else if (leave && leave.kind === "escalator" && m < 10)
        out[f] = "出扶梯掉头，换乘"
      else out[f] = leave ? `${word[leave.kind]}继续` : `步行 ${m} 米`
    }
    return out
  })
</script>

<style lang="scss" scoped>
  .floor-strip {
    position: absolute;
    left: 416px;
    top: 824px;
    width: 1088px;
    height: 216px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  .panel {
    padding: 14px 20px 0;
    background: var(--panel);
    cursor: pointer;
    transition: background 0.2s;
    &:hover,
    &.on {
      background: var(--panel2);
    }
    &.on header b {
      color: var(--route);
    }
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    height: 34px;
    b {
      font-family: "DIN";
      font-size: 22px;
    }
    span {
      font-size: 14px;
      color: var(--sub);
    }
    em {
      margin-left: auto;
      font-style: normal;
      font-size: 14px;
    }
  }
  svg {
    display: block;
    width: 100%;
    height: 162px;
  }
  .outline {
    fill: var(--plan-wall);
  }
  .floor {
    fill: var(--plan-floor);
  }
  .void {
    fill: var(--ground);
  }
  .elev,
  .conn {
    fill: var(--ink);
  }
  .route {
    fill: none;
    stroke: var(--route);
    stroke-width: 1.1;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .start {
    fill: var(--start);
  }
  .end {
    fill: var(--end);
  }
</style>
