<!--
  D4 振动频谱：驱动部设备的速度谱（0–1000 Hz）和包络谱（0–200 Hz），标出转频 1× / 2×、齿轮啮合频率 GMF、
  轴承外圈故障频率 BPFO 及倍频；按特征峰给出诊断结论。托辊劣化没有单独的振动测点，这时看劣化最重的驱动设备。
-->
<template>
  <Panel no="D4" title="振动频谱" en="SPECTRUM · VELOCITY / ENVELOPE">
    <div class="spc-h">
      <b class="code">{{ dev }}</b
      ><span>{{ devName }}</span
      ><em>{{ fmt(sp.rpm, 0) }} rpm · 1× {{ fmt(sp.f1, 1) }} Hz</em>
    </div>
    <div v-for="c in charts" :key="c.key" class="spc-c">
      <span class="spc-t">{{ c.title }}</span>
      <svg
        :style="{ width: rem(W), height: rem(c.h + 12) }"
        :viewBox="`0 0 ${W} ${c.h + 12}`"
      >
        <line x1="0" :x2="W" :y1="c.h" :y2="c.h" stroke="var(--hair)" />
        <path :d="c.path" stroke="var(--data)" stroke-width="1.2" fill="none" />
        <g v-for="m in c.marks" :key="m.label">
          <line
            :x1="m.x"
            :x2="m.x"
            y1="8"
            :y2="c.h"
            :stroke="`var(${m.c})`"
            stroke-dasharray="2 2"
          />
          <text :x="m.x + 2" y="9" class="ax" :style="{ fill: `var(${m.c})` }">
            {{ m.label }}
          </text>
        </g>
        <text x="0" :y="c.h + 11" class="ax">0</text>
        <text :x="W" :y="c.h + 11" class="ax" text-anchor="end">
          {{ c.max }} Hz
        </text>
      </svg>
    </div>
    <p class="spc-d" :class="verdict.cls">
      <Ic name="wave" />{{ verdict.text }}
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt, rem } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    tr: { type: Object, default: null },
    device: { type: String, default: null }
  })
  const sim = inject("sim")
  const W = 396

  /** 看哪台设备：指定的驱动设备 > 选中劣化（若是驱动设备）> 劣化最重的驱动设备 > 主斜井 1 号电机 */
  const isDrive = (id) => /-(M|R|DP)\d$/.test(id || "")
  const dev = computed(() => {
    if (isDrive(props.device)) return props.device
    if (props.tr && isDrive(props.tr.device)) return props.tr.device
    const t = [...props.f.s.tracks]
      .filter((x) => isDrive(x.device))
      .sort((a, b) => b.s - a.s)[0]
    return t ? t.device : "BC02-M1"
  })
  const devName = computed(
    () => layout.devices.find((d) => d.id === dev.value)?.name || ""
  )
  // 频谱每分钟一帧（仿真器按分钟取随机底噪）
  const minKey = computed(() => Math.floor(props.f.ms / 60000))
  const sp = computed(() => {
    void minKey.value
    return sim.spectrum(dev.value, props.f.ms)
  })
  const toPath = (arr, df, max, h) => {
    const top = Math.max(0.2, ...arr)
    let d = ""
    for (let k = 0; k < arr.length; k++) {
      const x = ((k * df) / max) * W
      const y = h - (arr[k] / top) * (h - 10)
      d += `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`
    }
    return d
  }
  const charts = computed(() => {
    const s = sp.value
    const mk = (f, label, c, max) =>
      f > 0 && f < max ? { x: (f / max) * W, label, c } : null
    return [
      {
        key: "vel",
        title: "速度谱 mm/s",
        h: 62,
        max: 1000,
        path: toPath(s.vel, s.df.vel, 1000, 62),
        marks: [
          mk(s.f1, "1×", "--text-3", 1000),
          mk(2 * s.f1, "2×", "--text-3", 1000),
          mk(s.gmf, "GMF", "--coal", 1000)
        ].filter(Boolean)
      },
      {
        key: "env",
        title: "包络谱 gE",
        h: 52,
        max: 200,
        path: toPath(s.env, s.df.env, 200, 52),
        marks: [1, 2, 3]
          .map((h) =>
            mk(h * s.bpfo, h === 1 ? "BPFO" : `${h}×`, "--predict", 200)
          )
          .filter(Boolean)
      }
    ]
  })
  /** 诊断结论：看包络谱 BPFO 处和速度谱 GMF 处的峰值 */
  const verdict = computed(() => {
    const s = sp.value
    if (s.f1 <= 0) return { text: "停机中，无频谱", cls: "" }
    const at = (arr, df, f) => arr[Math.round(f / df)] || 0
    const bp = at(s.env, s.df.env, s.bpfo)
    const gm = at(s.vel, s.df.vel, s.gmf)
    if (bp > 0.15)
      return {
        text: `包络谱 BPFO 及倍频突出（${fmt(bp, 2)} gE）：轴承外圈早期故障`,
        cls: "bad"
      }
    if (gm > 0.9)
      return {
        text: `啮合频率边带增多（${fmt(gm, 2)} mm/s）：齿面点蚀`,
        cls: "bad"
      }
    return { text: "1× 为主，无明显故障特征频率：运行良好", cls: "ok" }
  })
</script>
