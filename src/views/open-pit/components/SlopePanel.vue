<!--
  06 边坡与水文：三座雷达的预警等级与位移速率、最需关注那座近 6 小时的速率走势、升高的 GNSS 站、
  基站离线造成的数据过期、地下水位范围与读数待复核（设计稿 #c-slope 的移植）
  点雷达行 = 选中它（详情卡 + 三维里飞到雷达）；悬停走势折线看某时刻速率
-->
<template>
  <section class="card c-slope" :class="{ hl: isHl('slope') }">
    <h3>
      <i>06</i>边坡与水文<em :class="{ warn: top.level >= 1 }">{{
        headNote
      }}</em>
    </h3>
    <div class="tbl">
      <div
        v-for="r in sl.radar"
        :key="r.id"
        class="r pick"
        :class="{ sel: selection === r.id }"
        style="
          height: 27px;
          display: grid;
          grid-template-columns: 50px 58px 1fr 76px;
          gap: 6px;
        "
        @click="select(r.id)"
      >
        <span class="num" style="font-size: 14.5px">{{ r.id }}</span
        ><span class="dim">{{ SECTOR_NAME[r.id] }}</span>
        <span class="chip" :style="{ color: LEVEL_COLOR[r.level] }"
          ><b :style="{ background: LEVEL_COLOR[r.level] }"></b
          >{{ LEVEL_NAME[r.level] }}</span
        >
        <span
          class="num"
          :style="{
            textAlign: 'right',
            fontSize: '15px',
            color: r.level >= 2 ? 'var(--warn)' : 'var(--ink)'
          }"
          >{{ f2(r.velMmH)
          }}<span
            class="dim"
            style="font-size: 12px; font-family: var(--f-body)"
          >
            mm/h</span
          ></span
        >
      </div>
    </div>
    <svg
      :width="W"
      :height="H"
      :viewBox="`0 0 ${W} ${H}`"
      style="margin-top: 5px"
    >
      <template v-for="t in THRESH" :key="t.v">
        <line
          :x1="L"
          :x2="W - 32"
          :y1="ys(t.v)"
          :y2="ys(t.v)"
          :stroke="t.line"
          stroke-dasharray="4 3"
        />
        <text :x="W - 30" :y="ys(t.v) + 4" font-size="12" :fill="t.text">
          {{ t.n }}
        </text>
      </template>
      <polyline :points="line" fill="none" stroke="#fb923c" stroke-width="2" />
      <circle :cx="xs(0)" :cy="ys(lastP.v)" r="4" fill="#fb923c" />
      <text
        :x="xs(0) - 6"
        :y="ys(lastP.v) - 7"
        text-anchor="end"
        font-size="12"
        fill="#fb923c"
      >
        {{ f2(lastP.v) }}
      </text>
      <text :x="L" :y="H - 3" font-size="12" fill="#6b8296">−6 h</text>
      <text
        :x="xs(0)"
        :y="H - 3"
        text-anchor="end"
        font-size="12"
        fill="#6b8296"
      >
        现在
      </text>
      <line
        v-if="hov"
        :x1="xs(hov.min)"
        :x2="xs(hov.min)"
        y1="2"
        :y2="H - 14"
        stroke="rgba(230,241,247,.55)"
      />
      <rect
        :x="L"
        y="0"
        :width="xs(0) - L + 4"
        :height="H - 14"
        fill="transparent"
        @mousemove="onMove"
        @mouseleave="onLeave"
      />
    </svg>
    <div
      style="
        font-size: 12.5px;
        margin-top: 3px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      "
    >
      <div>
        <span class="dim">{{ gnssLabel }}</span
        ><template v-for="(g, i) in sl.topGnss.slice(0, 3)" :key="g.id"
          ><template v-if="i">&#12288;</template
          ><span class="num" style="font-size: 13px">{{ g.id }}</span
          >{{ " "
          }}<span
            class="num"
            :style="{
              color: g.velMmH >= 0.3 ? 'var(--warn)' : 'var(--ink)',
              fontSize: '13px'
            }"
            >{{ f2(g.velMmH) }}</span
          ></template
        >
      </div>
      <div v-if="sl.stale">
        <span class="chip" style="color: var(--offline)"
          ><b style="background: var(--offline)"></b
          >{{ sl.stale.sites || "部分 GNSS" }} 数据过期</span
        ><span class="mute"> · {{ sl.stale.bsId }} 离线</span
        ><span
          v-if="sl.stale.minutesAgo != null"
          class="badge"
          style="color: var(--offline)"
          >{{ sl.stale.minutesAgo }} min 前</span
        >
      </div>
      <div v-else>
        <span class="chip" style="color: var(--ok)"
          ><b style="background: var(--ok)"></b>{{ gnssN }} 个 GNSS
          站数据正常</span
        >
      </div>
      <div>
        <span class="dim"
          >地下水位 {{ sl.groundwater.n }} 点 {{ f1(sl.groundwater.minM) }}–{{
            f1(sl.groundwater.maxM)
          }}
          m</span
        ><span
          v-if="sl.groundwater.drift"
          class="badge"
          style="color: var(--neon-amber)"
          >{{ sl.groundwater.drift }} 待复核 ?</span
        >
      </div>
    </div>
  </section>
</template>

<script setup>
  import {
    LEVEL_COLOR,
    LEVEL_NAME,
    SECTOR_NAME,
    f1,
    f2,
    hhmm
  } from "../store/derive.js"
  import { svgX } from "../store/chart.js"

  const { fast, slow, selection, select, isHl, showTip, hideTip } =
    inject("board")
  const sl = computed(() => fast.value.slope)
  const top = computed(() => sl.value.topRadar)
  const headNote = computed(() =>
    top.value.level >= 1
      ? `${top.value.id} ${SECTOR_NAME[top.value.id]} ${LEVEL_NAME[top.value.level]}`
      : "三座雷达均正常"
  )
  // 速率走势里 GNSS 一栏的标题：有站超过一级阈值才叫「升高的」
  const gnssLabel = computed(() =>
    sl.value.topGnss[0].velMmH >= 0.3 ? "升高的 GNSS：" : "速率最高的 GNSS："
  )
  const gnssN = computed(() => fast.value.m.gnss.length)

  // 走势图（和设计稿一致）：横轴 −360…0 min，纵轴 0–2 mm/h，两条预警阈值线
  const W = 392
  const H = 62
  const L = 4
  const xs = (m) => L + ((m + 360) / 360) * (W - L - 34)
  const ys = (v) => 4 + (H - 18) * (1 - Math.min(v, 2) / 2)
  const THRESH = [
    { v: 0.3, n: "一级 0.3", line: "rgba(251,191,36,.4)", text: "#fbbf24" },
    { v: 1.0, n: "二级 1.0", line: "rgba(251,146,60,.6)", text: "#fb923c" }
  ]
  const sp = computed(() => slow.value.sparkRadar.points)
  const line = computed(() =>
    sp.value.map((p) => `${xs(p.min)},${ys(p.v)}`).join(" ")
  )
  const lastP = computed(() => sp.value[sp.value.length - 1])

  const hov = ref(null)
  function onMove(e) {
    const m = ((svgX(e, W) - L) / (W - L - 34)) * 360 - 360
    const p = sp.value.reduce((a, b) =>
      Math.abs(b.min - m) < Math.abs(a.min - m) ? b : a
    )
    hov.value = p
    showTip(e, hhmm(fast.value.ms + p.min * 60000), [
      { k: `${slow.value.sparkRadar.id} 速率`, v: `${f2(p.v)} mm/h` }
    ])
  }
  function onLeave() {
    hov.value = null
    hideTip()
  }
</script>
