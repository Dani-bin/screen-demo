<!--
  地层柱状：在采工作面处从地表到 B 煤底板以下 70 m，按米等比；
  地层名写在色块里，B / E / F 煤标在右侧（标签自动错开），埋深按真实地表高程算
-->
<template>
  <section class="panel" :class="{ grow }">
    <h3>
      地层柱状<small>{{ face }} 工作面处（示意）</small>
    </h3>
    <svg class="col" :viewBox="`0 0 ${W0} ${H + 8}`">
      <g v-for="s in col.layers" :key="s.key">
        <rect x="0" :y="s.y" :width="CW" :height="s.h" :fill="s.color" />
        <line
          v-for="y in s.beds"
          :key="y"
          x1="0"
          :x2="CW"
          :y1="y"
          :y2="y"
          stroke="rgba(0,0,0,.12)"
        />
        <text
          v-if="s.h > 17"
          :x="CW / 2"
          :y="s.y + s.h / 2 + 4"
          font-size="12"
          stroke-width="3"
          class="ln"
        >
          {{ s.name }}
        </text>
      </g>
      <rect
        v-for="s in col.seams"
        :key="s.key"
        x="0"
        :y="s.y"
        :width="CW"
        :height="s.h"
        :fill="s.on ? '#ff9a3d' : '#0b0c0f'"
        :class="{ on: s.on }"
      />
      <g v-for="s in col.labels" :key="s.key" :fill="s.c">
        <polyline
          :points="`${CW},${s.y} ${CW + 14},${s.ly} ${CW + 22},${s.ly}`"
          fill="none"
          :stroke="s.c"
        />
        <text :x="CW + 26" :y="s.ly + 4" font-size="13">{{ s.name }}</text>
        <text :x="W0" :y="s.ly + 4" font-size="14" class="d">
          {{ fmt(s.depth) }} m
        </text>
      </g>
      <text :x="CW + 26" :y="14" font-size="12" fill="#8ea6c8">
        地表 · 海拔 {{ fmt(facts.faceSurf) }} m
      </text>
      <text :x="W0" :y="14" font-size="13" fill="#8ea6c8" class="d">0 m</text>
      <rect
        x="0.5"
        y="4"
        :width="CW - 1"
        :height="H"
        fill="none"
        stroke="rgba(160,190,230,.35)"
      />
    </svg>
  </section>
</template>

<script setup>
  import { fmt } from "../utils"

  const props = defineProps({
    layout: { type: Object, required: true },
    face: { type: String, default: "LW-B05" },
    grow: { type: Boolean, default: false }
  })
  const facts = computed(() => props.layout.facts)
  const W0 = 370
  const CW = 150
  const H = 236
  const LO = -70
  const NAMES = { B: "B 煤 · 在采", E: "E 煤 · 已采", F: "F 煤 · 主平硐" }

  const col = computed(() => {
    const L = props.layout
    const depth = facts.value.faceDepth
    const k = H / (depth - LO)
    // h = 相对 B 煤底板的高差 → 柱内纵坐标
    const Y = (h) => 4 + (depth - h) * k
    const layers = []
    let prev = -1e9
    for (const st of L.strata) {
      const a = Math.max(prev, LO)
      const b = Math.min(st.top, depth)
      prev = st.top
      if (b <= a) continue
      const beds = []
      for (let hh = a + 7; hh < b; hh += 9) beds.push(Y(hh))
      layers.push({ ...st, y: Y(b), h: (b - a) * k, beds })
    }
    const seams = L.seams.map((s) => {
      const on = s.key === "B"
      return {
        key: s.key,
        on,
        y: Y(s.base + s.thick) - (on ? 1.5 : 1),
        h: Math.max(on ? 4 : 2.5, s.thick * k)
      }
    })
    // 右侧标签：按纵坐标排序后两两推开，至少隔 17
    const labels = L.seams
      .filter((s) => NAMES[s.key])
      .map((s) => ({
        key: s.key,
        name: NAMES[s.key],
        c: s.key === "B" ? "#ff9a3d" : "#cfe0f5",
        y: Y(s.base + s.thick / 2),
        depth: depth - s.base
      }))
      .sort((p, q) => p.y - q.y)
    const ys = labels.map((s) => s.y)
    for (let it = 0; it < 20; it++)
      for (let i = 1; i < ys.length; i++) {
        const gap = ys[i] - ys[i - 1]
        if (gap < 17) {
          ys[i] += (17 - gap) / 2
          ys[i - 1] -= (17 - gap) / 2
        }
      }
    labels.forEach((s, i) => (s.ly = ys[i]))
    return { layers, seams, labels }
  })
</script>

<style lang="scss" scoped>
  .col {
    display: block;
    width: 100%;
    height: auto;
  }

  /* 字号写在 SVG 属性里（见 BarChart.vue） */
  .ln {
    fill: #fff;
    text-anchor: middle;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.55);
  }

  .d {
    font-family: "DIN", sans-serif;
    text-anchor: end;
  }

  .on {
    filter: drop-shadow(0 0 4px #ff9a3d);
  }
</style>
