<!--
  左栏：四个硐室的防护底数（定稿 v1.js 的 kpiPanel / chamberPanel / unitPanel / sensorPanel / warnPanel）
  数字全部来自仿真状态 st（sim.at(s)），汇总由明细算出。
-->
<template>
  <aside class="col left">
    <!-- 防护总览 -->
    <Panel title="防护总览" en="PROTECTION">
      <template #tool
        >数据更新 <b>{{ st.hms }}</b></template
      >
      <div class="kpis">
        <div class="kpi">
          <label><Ic name="chamber" />监控硐室</label><b>{{ k.chambers }}</b
          ><i>个</i>
        </div>
        <div class="kpi">
          <label><Ic name="layers" />防护分区</label><b>{{ k.zones }}</b
          ><i>个</i>
        </div>
        <div class="kpi">
          <label><Ic name="ext" />灭火装置</label><b>{{ k.units }}</b
          ><i>台</i>
        </div>
        <div class="kpi">
          <label><Ic name="radar" />探测器</label><b>{{ k.sensors }}</b
          ><i>台</i>
        </div>
        <div class="kpi" :class="{ w: k.warnToday > 0 }">
          <label><Ic name="alert" />今日预警</label><b>{{ k.warnToday }}</b
          ><i>次</i>
        </div>
        <div class="kpi" :class="{ f: k.fireToday > 0 }">
          <label><Ic name="flame" />今日火警</label><b>{{ k.fireToday }}</b
          ><i>起</i>
        </div>
      </div>
    </Panel>

    <!-- 硐室防护状态 -->
    <Panel title="硐室防护状态" en="CHAMBERS">
      <template #tool>全氟己酮 · 柜内</template>
      <div
        v-for="c in st.chambers"
        :key="c.id"
        class="ds pick"
        :class="[c.state, { sel: selected === c.id }]"
        @click="$emit('select', c.id)"
      >
        <div class="ds-name">
          <span class="code">{{ c.id }}</span
          ><b>{{ c.name }}</b
          ><small>{{ c.loc }}</small>
        </div>
        <span class="pill" :class="pill(c).cls"
          ><Ic :name="pill(c).icon" />{{ pill(c).txt }}</span
        >
        <div class="ds-meta">
          <span
            >分区<b>{{ c.zones.length }}</b></span
          >
          <span
            >装置<b>{{ c.units }}</b></span
          >
          <span
            >探测器<b>{{ c.online }}/{{ c.sensorCount }}</b></span
          >
          <span class="hot"
            >最高温<b>{{ c.read.dts.toFixed(1) }}</b
            >℃</span
          >
          <span class="hot"
            >CO<b>{{ Math.round(c.read.co) }}</b
            >ppm</span
          >
        </div>
      </div>
    </Panel>

    <!-- 灭火装置状态 -->
    <Panel title="灭火装置状态" en="SUPPRESSION UNITS">
      <template #tool>热敏 68℃ + 电启动</template>
      <div class="units">
        <svg class="donut" viewBox="0 0 110 110" :style="sz(110, 110)">
          <circle
            cx="55"
            cy="55"
            :r="R"
            stroke="rgba(52,80,111,.35)"
            stroke-width="12"
          />
          <circle
            v-for="a in arcs"
            :key="a.k"
            cx="55"
            cy="55"
            :r="R"
            :stroke="a.c"
            stroke-width="12"
            :stroke-dasharray="`${a.len} ${C}`"
            :stroke-dashoffset="a.off"
            transform="rotate(-90 55 55)"
          />
          <text class="big" x="55" y="58">{{ st.units.total }}</text>
          <text class="sub" x="55" y="76">台</text>
        </svg>
        <div>
          <div v-for="s in segs" :key="s.k" class="leg-row">
            <i :style="{ background: s.c }"></i
            ><span
              >{{ s.k }}<small>{{ s.note }}</small></span
            ><b>{{ s.v }}</b>
          </div>
        </div>
      </div>
    </Panel>

    <!-- 探测器在线 -->
    <Panel title="探测器在线" en="DETECTORS">
      <template #tool
        >在线 <b>{{ k.online }}/{{ k.sensors }}</b></template
      >
      <div v-for="t in st.sensorsByType" :key="t.key" class="sr">
        <label>{{ t.name }}</label>
        <div class="bar">
          <s
            v-for="[n, c] in [
              [t.ok, 'var(--ok)'],
              [t.warn, 'var(--warn)'],
              [t.alarm, 'var(--fire)'],
              [t.off, 'var(--off)']
            ].filter((x) => x[0] > 0)"
            :key="c"
            :style="{ width: (n / t.total) * 100 + '%', background: c }"
          ></s>
        </div>
        <span class="v"
          >{{ t.total - t.off }}<small>/{{ t.total }}</small></span
        >
      </div>
    </Panel>

    <!-- 近 7 日预警 -->
    <Panel class="fill" title="近 7 日预警" en="7-DAY WARNINGS">
      <template #tool
        >合计 <b>{{ st.warn7dTotal }}</b> 次</template
      >
      <div class="legend">
        <span v-for="kk in KEYS" :key="kk[0]"
          ><i :style="{ background: kk[1] }"></i>{{ kk[2] }}</span
        >
        <span
          ><i
            style="background: var(--fire); transform: rotate(45deg) scale(0.8)"
          ></i
          >火警</span
        >
      </div>
      <svg class="chart" :viewBox="`0 0 ${W} ${H}`" :style="sz(W, H)">
        <g v-for="v in [0, 2, 4]" :key="v">
          <line class="grid" :x1="L" :x2="W" :y1="y(v)" :y2="y(v)" />
          <text :x="L - 6" :y="y(v) + 4" text-anchor="end">{{ v }}</text>
        </g>
        <g v-for="(r, i) in st.warn7d" :key="r.day">
          <template v-for="b in stack(r, i)" :key="b.k">
            <rect
              :x="b.x"
              :y="b.y"
              :width="BW"
              :height="b.h"
              :fill="b.c"
              stroke="none"
            />
          </template>
          <text
            v-if="tot(r)"
            class="val"
            :x="cx(i)"
            :y="y(tot(r)) - 4"
            text-anchor="middle"
          >
            {{ tot(r) }}
          </text>
          <template v-if="r.fire">
            <path
              :d="`M${cx(i) + BW / 2 + 8} ${y(tot(r)) - 12}l5 5-5 5-5-5z`"
              fill="var(--fire)"
              stroke="none"
            />
            <text
              :x="cx(i) + BW / 2 + 2"
              :y="y(tot(r)) - 18"
              text-anchor="end"
              style="fill: #ff8a80"
            >
              火警 {{ r.fire }}
            </text>
          </template>
          <text :x="cx(i)" :y="H - 3" text-anchor="middle">{{ r.day }}</text>
        </g>
      </svg>
    </Panel>
  </aside>
</template>

<script setup>
  import Panel from "./Panel.vue"
  import Ic from "./Ic.vue"

  const props = defineProps({ st: Object, selected: String })
  // svg 的宽高写在属性上不会被 postcss 转 rem，用 viewBox + rem 尺寸，跟着舞台缩放
  const sz = (w, h) => ({ width: `${w / 192}rem`, height: `${h / 192}rem` })
  defineEmits(["select"])
  const k = computed(() => props.st.kpi)

  /** 硐室状态胶囊：文字、图标、颜色 */
  function pill(c) {
    const f = props.st.fire
    if (c.state === "fire")
      return f.phase === "countdown"
        ? { cls: "fire", icon: "flame", txt: `火警 · 延时 ${f.countdown} s` }
        : { cls: "fire", icon: "flame", txt: "火警 · 已喷放" }
    if (c.state === "warn")
      return { cls: "warn", icon: "alert", txt: "一级预警" }
    if (c.state === "reset")
      return { cls: "ok", icon: "reset", txt: "已复位 · 待充装" }
    if (c.state === "fault")
      return { cls: "fault", icon: "alert", txt: `装置故障 ${c.fault}` }
    if (c.state === "off")
      return { cls: "off", icon: "signal", txt: `探测器离线 ${c.off}` }
    return { cls: "ok", icon: "check", txt: "正常" }
  }

  /* ---------- 环形图：分段之间留 2px 底色缝（dataviz 的间隔规则） */
  const R = 42
  const C = 2 * Math.PI * R
  const segs = computed(() => {
    const u = props.st.units
    return [
      { k: "待命", v: u.standby, c: "var(--ok)", note: "启动回路自检正常" },
      {
        k: "已喷放",
        v: u.sprayed,
        c: "var(--fire)",
        note: u.sprayed ? "DS-04 高防开关区 · 待充装" : "无"
      },
      {
        k: "故障",
        v: u.fault,
        c: "var(--fault)",
        note: `${u.faultUnit.id} · ${u.faultUnit.note}`
      }
    ]
  })
  const arcs = computed(() => {
    let off = 0
    return segs.value
      .filter((s) => s.v > 0)
      .map((s) => {
        const len = (s.v / props.st.units.total) * C
        const a = { k: s.k, c: s.c, len: Math.max(len - 2, 1), off: -off }
        off += len
        return a
      })
  })

  /* ---------- 近 7 日预警：按类型堆叠柱（超温 / CO / 烟雾），火警标红色菱形 */
  const W = 392
  const H = 96
  const L = 22
  const B = 18
  const MAX = 5
  const BW = 26
  const KEYS = [
    ["heat", "var(--cat-1)", "超温"],
    ["co", "var(--cat-2)", "CO"],
    ["smoke", "var(--cat-3)", "烟雾"]
  ]
  const step = (W - L) / 7
  const y = (v) => H - B - (v / MAX) * (H - B - 12)
  const cx = (i) => L + i * step + step / 2
  const tot = (r) => r.heat + r.co + r.smoke
  function stack(r, i) {
    const out = []
    let acc = 0
    for (const [key, c] of KEYS) {
      if (!r[key]) continue
      const y0 = y(acc)
      const y1 = y(acc + r[key])
      // 段与段之间留 2px 缝
      out.push({
        k: key,
        c,
        x: cx(i) - BW / 2,
        y: y1 + 1,
        h: Math.max(y0 - y1 - 2, 1)
      })
      acc += r[key]
    }
    return out
  }
</script>
