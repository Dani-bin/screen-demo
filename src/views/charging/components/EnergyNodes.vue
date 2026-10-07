<!--
  场站四角能量节点：光伏 / 储能 / 电网 / 充电桩的实时功率卡片，
  用带箭头的流光折线连到三维场景里对应设备（锚点随镜头每帧更新）
-->
<template>
  <svg
    ref="svgRef"
    class="links"
    :viewBox="`0 0 1920 ${Hd}`"
    preserveAspectRatio="xMinYMin meet"
  >
    <defs>
      <marker
        v-for="n in nodes"
        :id="`arrow-${n.key}`"
        :key="n.key"
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto"
      >
        <path d="M0,0L10,5L0,10Z" :fill="n.color" />
      </marker>
    </defs>
    <g v-for="n in nodes" v-show="paths[n.key]" :key="n.key">
      <polyline
        :points="paths[n.key]"
        fill="none"
        :stroke="n.color"
        stroke-opacity="0.22"
        stroke-width="6"
      />
      <polyline
        :points="paths[n.key]"
        fill="none"
        :stroke="n.color"
        stroke-width="2"
        stroke-dasharray="8 5"
        :marker-mid="`url(#arrow-${n.key})`"
        class="flow"
        :style="{ filter: `drop-shadow(0 0 4px ${n.color})` }"
      />
      <circle
        v-if="anchors"
        :cx="anchors[n.key].x"
        :cy="anchors[n.key].y"
        r="5"
        :fill="n.color"
        :style="{ filter: `drop-shadow(0 0 6px ${n.color})` }"
      />
      <circle
        v-if="anchors"
        :cx="anchors[n.key].x"
        :cy="anchors[n.key].y"
        r="11"
        fill="none"
        :stroke="n.color"
        stroke-opacity="0.5"
        class="pulse"
      />
    </g>
  </svg>
  <div
    v-for="n in nodes"
    :key="n.key"
    class="node"
    :style="{
      left: rem(n.x),
      top: rem(n.y),
      width: rem(n.w),
      borderColor: n.color + '88'
    }"
  >
    <div class="ic" :style="{ background: n.color + '1f', color: n.color }">
      <component :is="n.icon" />
    </div>
    <div>
      <span>{{ n.label }}</span>
      <b class="num">{{ fmt(n.value) }}<small>kW</small></b>
    </div>
  </div>
</template>

<script setup>
  import {
    BatteryCharging,
    PlugZap,
    SolarPanel,
    UtilityPole
  } from "lucide-vue-next"
  import { fmt, rem } from "../utils"

  const props = defineProps({
    /** 设计稿坐标：{ pv, ess, grid, piles: { x, y } } */
    anchors: { type: Object, default: null },
    power: { type: Object, required: true },
    ess: { type: Object, required: true }
  })

  /** 节点卡片位置（设计稿 px）与尺寸：左上光伏、上中储能、右上电网、左下充电桩 */
  const H = 56
  const nodes = computed(() => [
    {
      key: "pv",
      label: "光伏",
      value: props.power.pv,
      icon: SolarPanel,
      color: "#f5c242",
      x: 470,
      y: 84,
      w: 150
    },
    {
      key: "ess",
      label: `储能 · ${props.ess.mode}`,
      value: Math.abs(props.power.ess),
      icon: BatteryCharging,
      color: "#34e07a",
      x: 1000,
      y: 76,
      w: 172
    },
    {
      key: "grid",
      label: "电网",
      value: props.power.grid,
      icon: UtilityPole,
      color: "#ff9f43",
      x: 1296,
      y: 100,
      w: 158
    },
    {
      key: "piles",
      label: "充电桩",
      value: props.power.load,
      icon: PlugZap,
      color: "#2f9bff",
      x: 470,
      y: 770,
      w: 164
    }
  ])

  /** 连线：从卡片靠近锚点的一边出发，先横后竖（或先竖后横）折到锚点 */
  const paths = computed(() => {
    const out = {}
    if (!props.anchors) return out
    for (const n of nodes.value) {
      const a = props.anchors[n.key]
      if (!a) continue
      const r = { l: n.x, r: n.x + n.w, t: n.y, b: n.y + H }
      let sx, sy
      if (a.x > r.r) [sx, sy] = [r.r, n.y + H / 2]
      else if (a.x < r.l) [sx, sy] = [r.l, n.y + H / 2]
      else [sx, sy] = [n.x + n.w / 2, a.y > r.b ? r.b : r.t]
      const mid =
        Math.abs(a.x - sx) > Math.abs(a.y - sy)
          ? `${a.x},${sy}`
          : `${sx},${a.y}`
      out[n.key] = `${sx},${sy} ${mid} ${a.x},${a.y}`
    }
    return out
  })

  // SVG 用设计稿坐标系（宽 1920），高度随页面比例换算
  const svgRef = ref(null)
  const Hd = ref(1080)
  let ro = null
  onMounted(() => {
    ro = new ResizeObserver(() => {
      const el = svgRef.value
      if (el) Hd.value = (el.clientHeight / el.clientWidth) * 1920
    })
    ro.observe(svgRef.value)
  })
  onUnmounted(() => ro?.disconnect())
</script>

<style lang="scss" scoped>
  .links {
    position: absolute;
    inset: 0;
    z-index: 3;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .flow {
    animation: dash 1.2s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: -26;
    }
  }

  .pulse {
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse 1.6s ease-out infinite;
  }

  @keyframes pulse {
    from {
      opacity: 0.9;
      transform: scale(0.6);
    }
    to {
      opacity: 0;
      transform: scale(1.6);
    }
  }

  .node {
    position: absolute;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 56px;
    padding: 8px 14px 8px 10px;
    border: 1px solid;
    border-radius: 6px;
    background: rgba(8, 24, 50, 0.9);
    box-shadow: 0 0 18px rgba(40, 120, 255, 0.2);
    pointer-events: none;

    .ic {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 6px;

      svg {
        width: 24px;
        height: 24px;
      }
    }

    span {
      display: block;
      font-size: 13px;
      color: #c6d6ea;
    }

    b {
      font-size: 21px;
      font-weight: normal;
      color: #fff;

      small {
        margin-left: 3px;
        font-size: 12px;
        color: var(--muted);
      }
    }
  }
</style>
