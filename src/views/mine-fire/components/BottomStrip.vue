<!--
  底部条：DS-04 传感器趋势（两张单轴小图，dataviz 规则：不用双轴）+ 火警硐室平面（定稿 v1.js 的 trendPanel / planPanel）
  趋势窗口 6 分 18 秒（同定稿）；平面里分区、装置、探测器数量都取自 data/site.js，状态取自仿真。
-->
<template>
  <div class="bottom">
    <Panel title="DS-04 传感器趋势" en="TREND">
      <template #tool>预警 → 确认 → 喷放 → 回落</template>
      <svg class="chart" :viewBox="`0 0 ${TW} ${TH_}`" :style="sz(TW, TH_)">
        <g v-for="r in rows" :key="r.key">
          <line
            class="axis"
            :x1="TL"
            :x2="TW - TR"
            :y1="r.top + rowH"
            :y2="r.top + rowH"
          />
          <text class="lbl" :x="TL + 4" :y="r.top + 11">
            {{ r.name }} {{ r.unit }}
          </text>
          <g v-for="t in r.th" :key="t.v">
            <line
              :x1="TL"
              :x2="TW - TR"
              :y1="r.y(t.v)"
              :y2="r.y(t.v)"
              :stroke="t.c"
              stroke-dasharray="4 3"
              opacity=".75"
            />
            <text
              :x="TL - 5"
              :y="r.y(t.v) + t.dy"
              text-anchor="end"
              :style="{ fill: t.c }"
            >
              {{ t.v }}
            </text>
          </g>
          <polygon
            :points="r.area"
            :fill="r.color"
            opacity=".1"
            stroke="none"
          />
          <polyline
            :points="r.line"
            :stroke="r.color"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <template v-if="r.peak">
            <circle
              :cx="r.peak.x"
              :cy="r.peak.y"
              r="4"
              :fill="r.color"
              stroke="var(--panel-solid)"
              stroke-width="2"
            />
            <text
              :x="r.peak.x + 7"
              :y="r.peak.y + 4"
              style="fill: var(--text-2)"
            >
              峰值 {{ r.peak.v }} · {{ r.peak.t }}
            </text>
          </template>
          <circle
            :cx="r.last.x"
            :cy="r.last.y"
            r="4"
            :fill="r.color"
            stroke="var(--panel-solid)"
            stroke-width="2"
          />
          <text class="val" :x="r.last.x + 8" :y="r.last.y + 5">
            {{ r.last.v }} {{ r.unit }}
          </text>
        </g>
        <g v-for="m in marks" :key="m.k">
          <line
            :x1="m.x"
            :x2="m.x"
            :y1="TT - 4"
            :y2="TH_ - 18"
            :stroke="m.c"
            stroke-dasharray="2 3"
            opacity=".8"
          />
          <text
            :x="m.x"
            :y="TT - 7"
            text-anchor="middle"
            :style="{ fill: m.c, fontFamily: 'var(--font-body)' }"
          >
            {{ m.k }}
          </text>
        </g>
        <text
          v-for="t in ticks"
          :key="t.s"
          :x="t.x"
          :y="TH_ - 4"
          text-anchor="middle"
        >
          {{ t.label }}
        </text>
      </svg>
    </Panel>

    <Panel :class="{ alarm: fireOn }" title="火警硐室平面" en="CHAMBER PLAN">
      <template #tool>{{
        fireOn ? `${st.fire.zone} 已锁定` : "高防开关区 监测中"
      }}</template>
      <svg class="plan" :viewBox="`0 0 ${PW} ${PH}`" :style="sz(PW, PH)">
        <text :x="x0" :y="y0 - 9" style="fill: var(--text-3)">
          {{ ds.id }} {{ ds.name }} · 平面示意（44 × 6 m，假设）
        </text>
        <rect
          :x="x0"
          :y="y0"
          :width="x1 - x0"
          :height="y1 - y0"
          stroke="rgba(148,190,230,.55)"
          stroke-width="1.5"
          fill="rgba(10,32,58,.4)"
        />
        <!-- 柜列分区（沿北墙） -->
        <g v-for="z in zoneBoxes" :key="z.name">
          <rect
            :x="z.x"
            :y="y0 + 5"
            :width="z.w"
            height="38"
            :stroke="z.hot ? 'var(--fire)' : 'rgba(43,217,254,.4)'"
            :stroke-dasharray="z.hot ? '0' : '3 3'"
            :fill="z.hot ? 'rgba(255,59,48,.18)' : 'none'"
          />
          <g v-for="(cx, i) in z.cabs" :key="i">
            <rect
              :x="cx"
              :y="y0 + 10"
              :width="z.cw"
              height="16"
              :fill="z.hot ? 'rgba(255,59,48,.55)' : 'rgba(148,190,230,.28)'"
              :stroke="z.hot ? '#ffb3ad' : 'rgba(148,190,230,.6)'"
            />
            <rect
              :x="cx + z.cw / 2 - 2.5"
              :y="y0 + 14"
              width="5"
              height="5"
              :fill="z.sprayed ? '#fff' : 'var(--ok)'"
              stroke="none"
            />
          </g>
          <text
            class="zl"
            :x="z.x + z.w / 2"
            :y="y0 + 41"
            text-anchor="middle"
            :style="{ fill: z.hot ? '#ffb3ad' : 'var(--text-2)' }"
          >
            {{ z.name }} {{ z.units }}{{ z.sprayed ? " · 已喷放" : "" }}
          </text>
        </g>
        <!-- 电缆沟 + 光纤 + 悬挂装置（沿南墙） -->
        <rect
          :x="x0 + 10"
          :y="y1 - 20"
          :width="x1 - x0 - 20"
          height="14"
          stroke="rgba(43,217,254,.4)"
          stroke-dasharray="3 3"
        />
        <line
          :x1="x0 + 12"
          :x2="x1 - 12"
          :y1="y1 - 13"
          :y2="y1 - 13"
          stroke="var(--brand)"
          stroke-width="2"
          opacity=".8"
        />
        <line
          v-if="dtsLevel"
          :x1="hx - 14"
          :x2="hx + 14"
          :y1="y1 - 13"
          :y2="y1 - 13"
          :stroke="dtsLevel === 'alarm' ? 'var(--fire)' : 'var(--warn)'"
          stroke-width="3"
        />
        <rect
          v-for="(tx, i) in trenchUnits"
          :key="'t' + i"
          :x="tx - 3"
          :y="y1 - 18"
          width="6"
          height="10"
          fill="var(--ok)"
          stroke="none"
          opacity=".9"
        />
        <text class="zl" :x="x1 - 14" :y="y1 - 25" text-anchor="end">
          电缆沟 · 光纤 {{ ds.fiber }} m · 悬挂装置 {{ trenchUnits.length }}
        </text>
        <!-- 点式探测器 -->
        <template v-for="d in detectors" :key="d.id">
          <circle
            v-if="d.k === 'smoke'"
            :cx="d.x"
            :cy="y0 + 56"
            r="4.5"
            :fill="d.c"
            stroke="none"
          />
          <path
            v-else-if="d.k === 'co'"
            :d="`M${d.x} ${y0 + 51}l5 9h-10z`"
            :fill="d.c"
            stroke="none"
          />
          <path
            v-else-if="d.k === 'flame'"
            :d="`M${d.x} ${y0 + 51}l5 5-5 5-5-5z`"
            :fill="d.c"
            stroke="none"
          />
          <rect
            v-else
            :x="d.x - 4"
            :y="y0 + 52"
            width="8"
            height="8"
            :fill="d.c"
            stroke="none"
          />
        </template>
        <!-- 两端出入口与防火阀 -->
        <g v-for="dr in doors" :key="dr.label">
          <rect
            :x="dr.x - 3"
            :y="y0 + 44"
            width="6"
            height="24"
            fill="var(--panel-solid)"
            stroke="none"
          />
          <path
            v-if="st.fire.dampers"
            :d="`M${dr.x - 5} ${y0 + 48}l10 16M${dr.x + 5} ${y0 + 48}l-10 16`"
            stroke="var(--fire)"
            stroke-width="1.6"
          />
          <text
            :x="dr.x"
            :y="y1 + 15"
            :text-anchor="dr.anchor"
            style="fill: var(--text-2)"
          >
            {{ dr.label }} · {{ st.fire.dampers ? "已关" : "常开" }}
          </text>
        </g>
        <g :transform="`translate(${x0 + 140},${PH - 6})`">
          <circle
            cx="0"
            cy="-4"
            r="4.5"
            fill="rgba(169,195,223,.85)"
            stroke="none"
          />
          <text x="8" y="0">烟雾</text>
          <path
            d="M44 -9l5 9h-10z"
            fill="rgba(169,195,223,.85)"
            stroke="none"
          />
          <text x="52" y="0">CO</text>
          <path
            d="M84 -9l5 5-5 5-5-5z"
            fill="rgba(169,195,223,.85)"
            stroke="none"
          />
          <text x="92" y="0">火焰</text>
          <rect
            x="122"
            y="-8"
            width="8"
            height="8"
            fill="rgba(169,195,223,.85)"
            stroke="none"
          />
          <text x="134" y="0">温度</text>
          <rect
            x="166"
            y="-8"
            width="5"
            height="5"
            fill="var(--ok)"
            stroke="none"
          />
          <text x="176" y="0">装置</text>
        </g>
      </svg>
    </Panel>
  </div>
</template>

<script setup>
  import Panel from "./Panel.vue"
  import { TH } from "../data/site.js"
  import { hms } from "../sim/simulator.js"

  const props = defineProps({ st: Object, trend: Object })
  // svg 的宽高写在属性上不会被 postcss 转 rem，用 viewBox + rem 尺寸，跟着舞台缩放
  const sz = (w, h) => ({ width: `${w / 192}rem`, height: `${h / 192}rem` })
  const fireOn = computed(() =>
    ["countdown", "sprayed"].includes(props.st.fire.phase)
  )
  const ds = computed(() =>
    props.st.chambers.find((c) => c.id === props.st.fire.ds)
  )

  /* ---------------- 趋势：两张小图共用时间轴 ---------------- */
  const TW = 534
  const TH_ = 172
  const TL = 40
  const TR = 62
  const TT = 18
  const GAP = 12
  const rowH = (TH_ - TT - 18 - GAP) / 2
  const x = (t) =>
    TL +
    ((t - props.trend.x0) / (props.trend.x1 - props.trend.x0)) * (TW - TL - TR)
  const rows = computed(() => {
    const tr = props.trend
    const mk = (i, key, name, max, color, unit, th) => {
      const top = TT + i * (rowH + GAP)
      const y = (v) => top + rowH - (Math.min(v, max) / max) * rowH
      const pts = tr[key]
      const line = pts.map(([t, v]) => `${x(t)},${y(v)}`).join(" ")
      const last = pts[pts.length - 1]
      const peak = pts.reduce((a, b) => (b[1] > a[1] ? b : a))
      return {
        key,
        name,
        unit,
        color,
        top,
        y,
        line,
        area: `${x(pts[0][0])},${top + rowH} ${line} ${x(last[0])},${top + rowH}`,
        // 峰值明显高于起点才标（平稳段不标）
        peak:
          peak[1] - pts[0][1] > 8 && peak[0] < last[0] - 15
            ? {
                x: x(peak[0]),
                y: y(peak[1]),
                v: Math.round(peak[1]),
                t: hms(peak[0])
              }
            : null,
        last: { x: x(last[0]), y: y(last[1]), v: Math.round(last[1]) },
        th: [
          { v: th.warn, c: "var(--warn)", dy: 9 },
          { v: th.alarm, c: "var(--fire)", dy: 1 }
        ]
      }
    }
    return [
      mk(0, "dts", "光纤最高温", 140, "var(--brand)", "℃", TH.dts),
      mk(1, "co", "一氧化碳", 35, "var(--cat-2)", "ppm", TH.co)
    ]
  })
  const MARK_C = {
    预警: "var(--warn)",
    确认: "var(--fire)",
    喷放: "var(--brand)"
  }
  const marks = computed(() =>
    props.trend.marks.map((m) => ({ k: m.k, x: x(m.s), c: MARK_C[m.k] }))
  )
  // 刻度：每 2 分钟一个（整分）
  const ticks = computed(() => {
    const out = []
    const { x0, x1 } = props.trend
    for (let s = Math.ceil(x0 / 120) * 120; s <= x1; s += 120)
      out.push({ s, x: x(s), label: hms(s).slice(0, 5) })
    return out
  })

  /* ---------------- 平面 ---------------- */
  const PW = 440
  const PH = 172
  const x0 = 26
  const x1 = PW - 22
  const y0 = 30
  const y1 = 134
  const ZONE_W = { 高防开关区: 0.3, 低压开关区: 0.36, 变压器区: 0.22 }
  const zoneBoxes = computed(() => {
    let zx = x0 + 10
    const f = props.st.fire
    return ds.value.zones
      .filter((z) => z.name !== "电缆沟")
      .map((z) => {
        const w = (x1 - x0 - 20) * ZONE_W[z.name]
        const big = z.name === "变压器区"
        const cw = big ? 24 : 11
        const g = big ? 10 : 4
        const total = z.units * cw + (z.units - 1) * g
        const start = zx + (w - 6 - total) / 2
        const hot =
          z.name === f.zone && ["countdown", "sprayed"].includes(f.phase)
        const box = {
          name: z.name,
          units: z.units,
          x: zx,
          w: w - 6,
          cw,
          hot,
          sprayed: z.name === f.zone && f.sprayed > 0,
          cabs: Array.from({ length: z.units }, (_, i) => start + i * (cw + g))
        }
        zx += w
        return box
      })
  })
  const trenchUnits = computed(() => {
    const t = ds.value.zones.find((z) => z.name === "电缆沟")
    return Array.from(
      { length: t.units },
      (_, i) => x0 + 10 + ((x1 - x0 - 20) * (i + 0.5)) / t.units
    )
  })
  // 光纤超温段：12 m 处（按 44 m 长折算）
  const hx = x0 + 10 + ((x1 - x0 - 20) * 12) / 44
  const dtsLevel = computed(
    () => props.st.events.find((e) => e.id === "DTS-04")?.level
  )
  // 点式探测器沿中线排开：烟雾 / CO / 火焰 / 温度按编号交错
  const detectors = computed(() => {
    const lv = Object.fromEntries(props.st.events.map((e) => [e.id, e.level]))
    const col = { alarm: "var(--fire)", warn: "var(--warn)", off: "var(--off)" }
    const prefix = { smoke: "SM", co: "CO", flame: "FL", temp: "TP" }
    const pts = []
    for (const k of ["smoke", "co", "flame", "temp"])
      for (let i = 1; i <= ds.value.sensors[k]; i++)
        pts.push({ k, id: `${prefix[k]}-04-0${i}`, n: i })
    pts.sort((a, b) => a.n - b.n)
    return pts.map((p, i) => ({
      ...p,
      x: x0 + 22 + ((x1 - x0 - 44) * i) / (pts.length - 1),
      c: col[lv[p.id]] || "rgba(169,195,223,.85)"
    }))
  })
  const doors = [
    { x: x0, label: "FD-04-1 进风", anchor: "start" },
    { x: x1, label: "FD-04-2 回风", anchor: "end" }
  ]
</script>
