<!--
  D6 光纤测温（DTS）：选中皮带全线温度曲线（1 m 分辨率，按 200 段取最大值），
  定温线 60 °C、温差线（全线均温 + 10 °C），热点标注；鼠标移上去读任一位置的温度
-->
<template>
  <Panel no="D6" title="光纤测温" en="DTS · 1 m">
    <div class="dt-h">
      <span><Ic name="temp" />{{ beltName }}</span
      ><b>{{ fmt(st.max, 1) }} °C</b
      ><em>@ {{ fmt(st.at) }} m · 均温 {{ fmt(st.avg, 1) }} °C</em>
    </div>
    <svg
      :style="{ width: rem(W), height: rem(H + 14) }"
      :viewBox="`0 0 ${W} ${H + 14}`"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <line
        x1="0"
        :x2="W"
        :y1="y(st.avg + 10)"
        :y2="y(st.avg + 10)"
        class="tc-th l3"
      />
      <text :x="W - 2" :y="y(st.avg + 10) - 3" class="ax" text-anchor="end">
        温差线 {{ fmt(st.avg + 10, 1) }}
      </text>
      <template v-if="y(60) > 4">
        <line x1="0" :x2="W" :y1="y(60)" :y2="y(60)" class="tc-th l1" />
        <text :x="W - 2" :y="y(60) - 3" class="ax" text-anchor="end">
          定温 60
        </text>
      </template>
      <path
        :d="`${path}L${W},${H}L0,${H}Z`"
        fill="var(--coal)"
        opacity="0.1"
        stroke="none"
      />
      <path :d="path" stroke="var(--coal)" stroke-width="1.5" />
      <circle
        :cx="(st.at / (T.length - 1)) * W"
        :cy="y(st.max)"
        r="3.5"
        fill="var(--predict)"
      />
      <g v-if="hover">
        <line :x1="hover.x" :x2="hover.x" y1="0" :y2="H" stroke="var(--data)" />
        <text :x="Math.min(hover.x + 4, W - 90)" y="12" class="ax now">
          {{ fmt(hover.m) }} m · {{ fmt(hover.v, 1) }} °C
        </text>
      </g>
      <text x="0" :y="H + 12" class="ax">0</text>
      <text :x="W" :y="H + 12" class="ax" text-anchor="end">
        {{ fmt(T.length - 1) }} m
      </text>
    </svg>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { beltShort, fmt, rem } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    w: { type: Object, required: true },
    tr: { type: Object, default: null }
  })
  const W = 396
  const H = 80
  const N = 200

  const belt = computed(() =>
    props.tr && props.w.dts[props.tr.belt] ? props.tr.belt : "BC03"
  )
  const beltName = computed(
    () => `${belt.value} ${beltShort(layout, belt.value)}`
  )
  const T = computed(() => props.w.dts[belt.value])
  const vals = computed(() =>
    Array.from({ length: N }, (_, i) => {
      let m = -Infinity
      const a = Math.floor((i * T.value.length) / N)
      const b = Math.max(a + 1, Math.floor(((i + 1) * T.value.length) / N))
      for (let k = a; k < b; k++) m = Math.max(m, T.value[k])
      return m
    })
  )
  const st = computed(() => {
    let max = -Infinity
    let at = 0
    let sum = 0
    T.value.forEach((v, i) => {
      sum += v
      if (v > max) [max, at] = [v, i]
    })
    return { max, at, avg: sum / T.value.length }
  })
  const range = computed(() => [
    Math.min(...vals.value) - 1,
    Math.max(st.value.max, st.value.avg + 10) + 3
  ])
  const y = (v) =>
    H - ((v - range.value[0]) / (range.value[1] - range.value[0])) * (H - 4) - 2
  const path = computed(() =>
    vals.value
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${((i / (N - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`
      )
      .join("")
  )
  const hover = ref(null)
  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const m = Math.round(k * (T.value.length - 1))
    hover.value = { x: k * W, m, v: T.value[m] }
  }
</script>
