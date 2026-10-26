<!--
  底部时间轴：今日主斜井皮带秤运量曲线（三个班次分区，零点班检修底色偏蓝），今日告警按级别打刻度，
  "现在"竖线；点曲线回放到那一刻。右侧是三段故障剧本和"实时"按钮。
-->
<template>
  <div class="tl">
    <div class="tl-l"><b>今日运量</b><em>主斜井皮带秤 t/h</em></div>
    <svg
      :style="{ width: rem(W), height: rem(H + 26), cursor: 'pointer' }"
      :viewBox="`0 0 ${W} ${H + 26}`"
      @click="onSeek"
    >
      <g v-for="(sh, i) in SHIFTS" :key="sh[2]">
        <rect
          :x="(sh[0] / 24) * W"
          y="0"
          :width="((sh[1] - sh[0]) / 24) * W"
          :height="H"
          :fill="i === 0 ? 'rgba(96,165,250,0.06)' : 'transparent'"
        />
        <text :x="(sh[0] / 24) * W + 4" y="11" class="ax">{{ sh[2] }}</text>
        <line
          :x1="(sh[0] / 24) * W"
          :x2="(sh[0] / 24) * W"
          y1="0"
          :y2="H"
          stroke="var(--hair-soft)"
        />
      </g>
      <path
        v-if="curve.path"
        :d="`${curve.path}L${curve.lastX},${H}L0,${H}Z`"
        fill="var(--coal)"
        opacity="0.14"
        stroke="none"
      />
      <path :d="curve.path" stroke="var(--coal)" stroke-width="2" />
      <line x1="0" :x2="W" :y1="H" :y2="H" stroke="var(--hair)" />
      <line
        v-for="m in marks"
        :key="m.id"
        :x1="m.x"
        :x2="m.x"
        :y1="H + 3"
        :y2="H + 9"
        :stroke="`var(${LV_VAR[m.level]})`"
        stroke-width="2"
      />
      <line
        :x1="nowX"
        :x2="nowX"
        y1="0"
        :y2="H + 10"
        stroke="var(--data)"
        stroke-width="1.5"
      />
      <text :x="Math.min(nowX + 4, W - 60)" :y="H + 22" class="ax now">
        {{ live ? "现在" : "回放" }} {{ hm(f.ms) }}
      </text>
      <text
        v-for="t in axisHours"
        :key="t"
        :x="(t / 24) * W"
        :y="H + 22"
        class="ax"
        :text-anchor="t === 0 ? 'start' : 'middle'"
      >
        {{ String(t).padStart(2, "0") }}:00
      </text>
    </svg>
    <div class="tl-r">
      <span class="code">故障剧本</span>
      <a
        v-for="sc in SCRIPTS"
        :key="sc.key"
        :class="{ on: script === sc.key }"
        @click="emit('script', sc.key)"
        ><Ic name="play" />{{ sc.name }}</a
      >
      <a class="live" :class="{ on: live }" @click="emit('live')"
        ><Ic name="live" />实时</a
      >
    </div>
  </div>
</template>

<script setup>
  import Ic from "./Ic.vue"
  import { LV_VAR, hm, rem } from "./ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    live: { type: Boolean, default: true },
    script: { type: String, default: null }
  })
  const emit = defineEmits(["seek", "script", "live"])

  /** 三段故障剧本（store/scenarios.js） */
  const SCRIPTS = [
    { key: "idler", name: "托辊劣化预警" },
    { key: "tear", name: "纵撕急停" },
    { key: "intrude", name: "人员越界闭锁" }
  ]
  const SHIFTS = [
    [0, 8, "零点班 · 检修"],
    [8, 16, "八点班"],
    [16, 24, "四点班"]
  ]
  // 曲线区 700 × 48（设计稿 px），纵轴 0–3200 t/h
  const W = 700
  const H = 48
  const MAX = 3200
  const DAY = 24 * 3600000

  const X = (t) => ((t - props.w.d0) / DAY) * W
  const curve = computed(() => {
    const pts = props.w.series.map((p) => [
      X(p.t),
      H - (Math.min(MAX, p.v) / MAX) * H
    ])
    return {
      path: pts
        .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(""),
      lastX: pts.length ? pts[pts.length - 1][0] : 0
    }
  })
  // 今日告警刻度（读数存疑 / 过期这类数据质量提示不打）
  const marks = computed(() =>
    props.w.today
      .filter((e) => !e.quality)
      .map((e) => ({ id: e.id, level: e.level, x: X(e.at) }))
  )
  const nowX = computed(() => Math.max(0, Math.min(W, X(props.f.ms))))
  // 刻度：离"现在 / 回放"文字太近的那个不画，免得叠在一起
  const axisHours = computed(() =>
    [0, 6, 12, 18].filter((t) => {
      const x = (t / 24) * W
      return x < nowX.value - 20 || x > nowX.value + 90
    })
  )

  /** 点曲线：回放到那一刻（不超过现在） */
  function onSeek(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const k = (e.clientX - r.left) / r.width
    emit("seek", props.w.d0 + Math.max(0, Math.min(1, k)) * DAY)
  }
</script>
