<!-- 小地图：OSM 真实码头面轮廓 + 箱区 + 岸线 + 当前视野框；点哪里镜头飞到哪里（不标经纬度、比例尺） -->
<template>
  <div class="mm">
    <div class="mm-h">码头全景<span>MINIMAP</span></div>
    <svg
      :width="W"
      :height="H + 6"
      :viewBox="`0 0 ${W} ${H + 6}`"
      @click="click"
    >
      <polygon :points="poly" class="mm-t" />
      <g class="mm-b">
        <rect
          v-for="b in blocks"
          :key="b.id"
          :x="b.x"
          :y="b.y"
          :width="b.w"
          :height="b.h"
        />
      </g>
      <line
        :x1="X(0)"
        :x2="X(layout.quay.u1)"
        :y1="Y(-2)"
        :y2="Y(-2)"
        class="mm-q"
      />
      <rect
        v-if="vp"
        :x="vp.x"
        :y="vp.y"
        :width="vp.w"
        :height="vp.h"
        class="mm-v"
      />
    </svg>
  </div>
</template>

<script setup>
  const props = defineProps({
    layout: { type: Object, required: true },
    site: { type: Object, required: true },
    /** 当前镜头（target [u, v]、dist） */
    view: { type: Object, default: null }
  })
  const emit = defineEmits(["goto"])
  const U0 = -150
  const U1 = 3050
  const V0 = -300
  const V1 = 760
  const W = 220
  const H = (W * (V1 - V0)) / (U1 - U0)
  const X = (u) => ((u - U0) / (U1 - U0)) * W
  const Y = (v) => ((V1 - v) / (V1 - V0)) * H
  const poly = props.site.terminal
    .map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`)
    .join(" ")
  const blocks = props.layout.blocks.map((b) => ({
    id: b.id,
    x: X(b.u - 14),
    y: Y(b.v1),
    w: X(b.u + 14) - X(b.u - 14),
    h: Y(b.v0) - Y(b.v1)
  }))
  /** 视野框：注视点两侧按距离估一个范围（示意） */
  const vp = computed(() => {
    if (!props.view) return null
    const [u, v] = props.view.target
    const hw = Math.min(1600, props.view.dist * 0.42)
    const hh = Math.min(520, props.view.dist * 0.16)
    return {
      x: X(u - hw),
      y: Y(v + hh),
      w: X(u + hw) - X(u - hw),
      h: Y(v - hh) - Y(v + hh)
    }
  })
  function click(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const u = U0 + ((e.clientX - r.left) / r.width) * (U1 - U0)
    const v = V1 - ((e.clientY - r.top) / r.height) * (V1 - V0) * ((H + 6) / H)
    emit("goto", [u, v])
  }
</script>
