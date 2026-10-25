<!--
  全线温度条（诊断中心底部）：4 条敷设了测温光纤的井下皮带按煤流顺序拼成一条（宽度按长度），
  每米温度映射成颜色（冷青 → 琥珀 → 紫色热点），标出每条的最高温和位置；点一段选中那条皮带
-->
<template>
  <div class="cs tstrip">
    <div class="cs-hd">
      <b>全线温度条</b><em>DTS · 4 BELTS · 1 m</em>
      <span class="lg"
        ><i class="cold"></i>{{ fmt(range[0], 0) }} °C <i class="warm"></i>
        <i class="hot"></i>{{ fmt(range[1], 0) }} °C · 紫色 = 超过温差线</span
      >
    </div>
    <div class="ts-row">
      <div
        v-for="p in parts"
        :key="p.id"
        class="ts-b"
        :style="{ width: `${p.wk}%` }"
        @click="emit('pick', p.id)"
      >
        <header>
          <b class="code">{{ p.id }}</b
          ><span>{{ p.name }}</span
          ><em :class="{ hot: p.hot }"
            >最高 {{ fmt(p.max, 1) }} °C @ {{ fmt(p.at) }} m</em
          >
        </header>
        <canvas :ref="(el) => (cvs[p.id] = el)"></canvas>
        <footer>{{ fmt(p.L) }} m</footer>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { DTS_BELTS } from "../../store/board.js"
  import { fmt } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ w: { type: Object, required: true } })
  const emit = defineEmits(["pick"])
  const cvs = {}

  // 煤流顺序：顺槽 → 上山 → 大巷 → 主斜井
  const ORDER = ["BC05", "BC04", "BC03", "BC02"].filter((id) =>
    DTS_BELTS.includes(id)
  )
  const total = ORDER.reduce(
    (a, id) => a + layout.belts.find((b) => b.id === id).L,
    0
  )

  const range = computed(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const id of ORDER)
      for (const v of props.w.dts[id]) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    return [lo, Math.max(hi, lo + 5)]
  })
  const parts = computed(() =>
    ORDER.map((id) => {
      const b = layout.belts.find((x) => x.id === id)
      const T = props.w.dts[id]
      let max = -Infinity
      let at = 0
      let sum = 0
      T.forEach((v, i) => {
        sum += v
        if (v > max) [max, at] = [v, i]
      })
      return {
        id,
        name: b.short,
        L: b.L,
        wk: (b.L / total) * 100,
        max,
        at,
        avg: sum / T.length,
        hot: max > sum / T.length + 10
      }
    })
  )
  /** 温度 → 颜色：深蓝 → 青 → 琥珀三段色阶；超过温差线（均温 + 10）用紫 */
  const STOPS = [
    [13, 42, 58],
    [30, 143, 176],
    [255, 178, 62]
  ]
  function color(v, lo, hi, avg) {
    if (v > avg + 10) return [167, 139, 250]
    const k = Math.max(0, Math.min(1, (v - lo) / (avg + 10 - lo))) * 2
    const i = Math.min(1, Math.floor(k))
    const t = k - i
    return STOPS[i].map((x, j) => Math.round(x + (STOPS[i + 1][j] - x) * t))
  }
  function draw() {
    const [lo, hi] = range.value
    for (const p of parts.value) {
      const c = cvs[p.id]
      if (!c) continue
      const T = props.w.dts[p.id]
      const w = Math.max(1, Math.round(c.clientWidth))
      if (c.width !== w) {
        c.width = w
        c.height = 1
      }
      const g = c.getContext("2d")
      const img = g.createImageData(w, 1)
      for (let x = 0; x < w; x++) {
        // 每个像素取该段的最大值，热点不会被平均掉
        let v = -Infinity
        const a = Math.floor((x * T.length) / w)
        const b = Math.max(a + 1, Math.floor(((x + 1) * T.length) / w))
        for (let k = a; k < b; k++) v = Math.max(v, T[k])
        const [r, gg, bb] = color(v, lo, hi, p.avg)
        img.data.set([r, gg, bb, 255], x * 4)
      }
      g.putImageData(img, 0, 0)
    }
  }
  watch(
    () => props.w,
    () => nextTick(draw)
  )
  onMounted(() => nextTick(draw))
</script>
