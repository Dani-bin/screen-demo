<!-- 本次任务：当前（或最近一次）出动的事件，四步流水线 + 四个指标 + 误差收敛小图（走失搜寻） -->
<template>
  <div
    class="card"
    style="left: 1434px; top: 112px; width: 450px; height: 324px"
  >
    <div class="hd">
      <Icon name="mission" /><span class="t"
        >本次任务 · {{ TYPE[m.type] }}</span
      >
      <span v-if="m.urgent" class="chip alarm" style="margin-left: auto"
        >紧急</span
      >
      <span
        v-else
        class="chip"
        :class="m.live ? 'gold' : ''"
        style="margin-left: auto"
        >{{ m.live ? "进行中" : "已结束" }}</span
      >
    </div>
    <div style="font-size: 13px; color: var(--ink-3); margin: -2px 0 6px">
      {{ m.id }} · {{ m.sub
      }}{{ m.live ? `，已进行 ${m.elapsedMin} 分钟` : "" }}
    </div>
    <div class="steps">
      <template v-for="(st, i) in m.steps" :key="st.name">
        <span v-if="i" class="bar-sep"></span>
        <span
          class="step"
          :class="
            st.state === 'done' ? 'done' : st.state === 'now' ? 'now' : ''
          "
        >
          <span class="d"
            ><svg v-if="st.state === 'done'" viewBox="0 0 24 24">
              <path d="M20 6 9 17l-5-5" /></svg></span
          >{{ st.name }}
        </span>
      </template>
    </div>
    <div class="tiles">
      <div v-for="t in tiles" :key="t.l" class="tile">
        <div
          class="v"
          :style="{
            ...(t.warn ? { color: 'var(--warn)' } : {}),
            ...(isWord(t.v)
              ? { fontSize: '20px', lineHeight: '28px', whiteSpace: 'nowrap' }
              : {})
          }"
        >
          {{ t.v }}<small v-if="t.u">{{ t.u }}</small>
        </div>
        <div class="l">{{ t.l }}</div>
        <div class="m">
          <i
            :style="{
              width: t.pct + '%',
              background: t.warn ? 'var(--warn)' : ''
            }"
          ></i>
        </div>
      </div>
    </div>
    <div class="rule">
      <Icon name="shield" :size="14" style="margin-top: 2px" />
      <span v-html="rule"></span>
    </div>
    <template v-if="m.isSR">
      <div class="hd" style="margin: 10px 0 0; height: 20px">
        <span style="font-size: 13px; color: var(--ink-2)"
          >融合定位误差收敛（m）</span
        >
        <span class="s" style="font-size: 12px">目标 ≤ 1.5</span>
      </div>
      <svg width="420" height="62" viewBox="0 0 420 62">
        <line
          x1="24"
          x2="396"
          :y1="Y(1.5)"
          :y2="Y(1.5)"
          stroke="#e8b04a"
          stroke-dasharray="5 4"
          stroke-width="1.3"
        />
        <polyline
          :points="line(true)"
          fill="none"
          stroke="#ffd27a"
          stroke-width="2"
          stroke-linecap="round"
        />
        <polyline
          :points="line(false)"
          fill="none"
          stroke="#ffd27a"
          stroke-opacity=".5"
          stroke-width="2"
          stroke-dasharray="2 5"
          stroke-linecap="round"
        />
        <g v-for="(p, i) in marks" :key="i">
          <circle
            :cx="X(i)"
            :cy="Y(p.err)"
            r="5"
            :fill="p.past ? '#ffd27a' : '#c9a86a'"
            stroke="#1a1510"
            stroke-width="2"
          />
          <text
            :x="X(i)"
            :y="Y(p.err) - 8"
            :fill="p.past ? '#f3ebdd' : '#bfb19b'"
            font-size="12"
            text-anchor="middle"
            font-family="DIN"
          >
            {{ p.err }}
          </text>
          <text
            :x="X(i)"
            y="60"
            fill="#8f8372"
            font-size="11"
            text-anchor="middle"
            font-family="DIN"
          >
            {{ p.clock }}
          </text>
        </g>
      </svg>
    </template>
    <div v-else class="rule" style="margin-top: 10px">
      <Icon name="flow" :size="14" style="margin-top: 2px" />
      <span
        >识别置信度 ≥ 0.7 才判真目标；可见光有效 +
        红外热源匹配，伪目标（野猫、反光物）自动过滤。</span
      >
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import Icon from "./Icon.vue"

  const props = defineProps({ snap: { type: Object, required: true } })
  const TYPE = {
    SR: "走失老人搜寻",
    PT: "周界入侵",
    TH: "热源异常",
    FP: "消防通道占用",
    FC: "外立面隐患"
  }
  const m = computed(() => props.snap.mission)
  /** 文字型的磁贴值（如“已派单”）用小一号字，免得折行 */
  const isWord = (v) => typeof v === "string" && !/^[±\d.]+$/.test(v)

  /** 四个指标：走失搜寻用覆盖率 / 盲区 / 置信度 / 误差，其余任务用用时 / 置信度 / 误差 / 工单 */
  const tiles = computed(() => {
    const s = props.snap
    const mm = m.value
    if (mm.isSR) {
      const tg = s.target
      return [
        { v: s.coverage.toFixed(1), u: "%", l: "区域覆盖", pct: s.coverage },
        {
          v: s.blind.checked,
          u: `/ ${s.blind.total}`,
          l: "盲区核验",
          pct: s.blind.rate * 100
        },
        {
          v: tg.conf.toFixed(2),
          l: "置信度 ≥0.7",
          pct: tg.conf * 100,
          warn: tg.status === 1
        },
        {
          v: `±${tg.err.toFixed(1)}`,
          u: "m",
          l: "误差 ≤1.5 m",
          pct: tg.err ? Math.min(100, 100 - (tg.err / 4.2) * 100 + 20) : 0
        }
      ]
    }
    return [
      {
        v: mm.elapsedMin,
        u: "min",
        l: "已用时",
        pct: Math.min(100, mm.elapsedMin * 4)
      },
      { v: mm.kpi.conf.toFixed(2), l: "置信度 ≥0.7", pct: mm.kpi.conf * 100 },
      {
        v: `±${mm.kpi.err.toFixed(1)}`,
        u: "m",
        l: "误差 ≤1.5 m",
        pct: 100 - mm.kpi.err * 40
      },
      {
        v: s.events.find((e) => e.id === mm.id)?.statusText ?? "待命",
        l: "工单状态",
        pct: 100
      }
    ]
  })

  const rule = computed(() => {
    const w = (t) => `<b style="color:var(--warn);font-weight:normal">${t}</b>`
    if (!m.value.isSR)
      return `${w(TYPE[m.value.type])}：${m.value.title}，由 ${props.snap.events.find((e) => e.id === m.value.id)?.by ?? "—"} 处置。`
    return `双模态：可见光遮挡 + 红外热源 → ${w("疑似")} → 三号机抵近核验`
  })

  // 误差收敛小图
  const marks = computed(() => props.snap.target.marks)
  const X = (i) => 24 + i * (372 / Math.max(1, marks.value.length - 1))
  const Y = (v) => 14 + (1 - v / 5.5) * 36
  const line = (past) => {
    const ms = marks.value
    const last = ms.filter((p) => p.past).length - 1
    const sel = past ? ms.slice(0, last + 1) : ms.slice(Math.max(0, last))
    const off = past ? 0 : Math.max(0, last)
    return sel.map((p, i) => `${X(i + off)},${Y(p.err)}`).join(" ")
  }
</script>
