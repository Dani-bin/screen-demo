<!--
  05 换电与能源：两个换电站的工位占用、排队，电池池（满电 / 充电中），今日光伏出力曲线、发电量与绿电占比（设计稿 #c-swap 的移植）
  点换电站行 = 选中该站；悬停工位方块看工位状态，悬停曲线看某时刻的光伏出力
-->
<template>
  <section class="card c-swap" :class="{ hl: isHl('swap') }">
    <h3>
      <i>05</i>换电与能源<em
        >{{ fast.stations.length }} 站 · {{ bayTotal }} 工位</em
      >
    </h3>
    <div
      v-for="st in fast.stations"
      :key="st.id"
      class="pick"
      :class="{ sel: selection === st.id }"
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 24px;
      "
      @click="select(st.id)"
    >
      <span
        ><span class="num mute" style="font-size: 13px">{{ st.id }}</span
        >{{ " "
        }}<span style="margin-left: 4px"
          ><i
            v-for="n in st.bays"
            :key="n"
            style="
              display: inline-block;
              width: 22px;
              height: 14px;
              margin-right: 4px;
              border: 1px solid var(--c-swap);
            "
            :style="{
              background: n <= st.busy ? 'var(--c-swap)' : 'transparent'
            }"
            @mousemove="
              showTip($event, `${st.id} 工位 ${n}`, [
                { k: '状态', v: n <= st.busy ? '换电中' : '空闲' }
              ])
            "
            @mouseleave="hideTip"
          ></i></span
      ></span>
      <span class="mute"
        >在换 <span class="num" style="color: var(--ink)">{{ st.busy }}</span> ·
        排队
        <span class="num" style="color: var(--ink)">{{ st.queue }}</span></span
      >
    </div>
    <div
      style="
        margin-top: 4px;
        display: flex;
        justify-content: space-between;
        font-size: 12.5px;
      "
    >
      <span class="dim">电池池 {{ tot }} 包</span
      ><span
        ><span class="num" style="color: var(--c-run)">{{
          fast.pool.full
        }}</span>
        满电 ·
        <span class="num" style="color: var(--neon-amber)">{{
          fast.pool.charging
        }}</span>
        充电中</span
      >
    </div>
    <div class="seg" style="height: 7px; margin-top: 4px">
      <i
        :style="{
          width: (fast.pool.full / tot) * 100 + '%',
          background: 'var(--c-run)'
        }"
      ></i>
      <i style="flex: 1; background: var(--neon-amber); opacity: 0.85"></i>
    </div>
    <svg
      :width="W"
      :height="H"
      :viewBox="`0 0 ${W} ${H}`"
      style="margin-top: 6px"
    >
      <line
        :x1="L"
        :x2="W"
        :y1="ys(0)"
        :y2="ys(0)"
        stroke="rgba(120,160,190,.25)"
      />
      <line
        :x1="L"
        :x2="W"
        :y1="ys(maxKw / 2)"
        :y2="ys(maxKw / 2)"
        stroke="rgba(120,160,190,.14)"
      />
      <path :d="area" fill="rgba(251,191,36,.20)" />
      <polyline :points="pts" fill="none" stroke="#bf8700" stroke-width="2" />
      <line
        :x1="nowX"
        :x2="nowX"
        y1="2"
        :y2="ys(0)"
        stroke="#22d3ee"
        stroke-dasharray="3 3"
      />
      <text
        :x="nowLeft ? nowX + 4 : nowX - 4"
        y="12"
        :text-anchor="nowLeft ? 'start' : 'end'"
        font-size="12"
        fill="#22d3ee"
      >
        现在 {{ nowText }}
      </text>
      <template v-for="h in [6, 9, 12, 15, 18, 21]" :key="h">
        <text
          :x="xs(h)"
          :y="H - 3"
          :text-anchor="h === 21 ? 'end' : 'middle'"
          font-size="12"
          fill="#6b8296"
        >
          {{ p2(h) }}
        </text>
      </template>
      <!-- 悬停：竖线 + 该时刻光伏出力 -->
      <line
        v-if="hovH != null"
        :x1="xs(hovH)"
        :x2="xs(hovH)"
        y1="2"
        :y2="ys(0)"
        stroke="rgba(230,241,247,.55)"
      />
      <rect
        :x="L"
        y="0"
        :width="W - L"
        :height="H - 14"
        fill="transparent"
        @mousemove="onMove"
        @mouseleave="onLeave"
      />
    </svg>
    <div
      style="
        display: flex;
        justify-content: space-between;
        font-size: 12.5px;
        margin-top: 1px;
      "
    >
      <span class="dim"
        >今日发电
        <span class="num" style="color: var(--ink); font-size: 14px">{{
          f1(fast.energy.pvKwh / 1000)
        }}</span>
        MWh</span
      ><span class="dim"
        >绿电占比
        <span class="num" style="color: var(--ink); font-size: 14px">{{
          f1(fast.energy.greenRatio)
        }}</span
        >%</span
      >
    </div>
  </section>
</template>

<script setup>
  import { f1, pad as p2 } from "../store/derive.js"
  import { int, svgX } from "../store/chart.js"

  const { fast, slow, selection, select, isHl, showTip, hideTip } =
    inject("board")
  const bayTotal = computed(() =>
    fast.value.stations.reduce((a, s) => a + s.bays, 0)
  )
  const tot = computed(() => fast.value.pool.full + fast.value.pool.charging)

  // 光伏曲线坐标（和设计稿一致）：横轴 5–21 点
  const W = 392
  const H = 70
  const L = 4
  const x0 = 5
  const x1 = 21
  const xs = (h) => L + ((h - x0) / (x1 - x0)) * (W - L - 2)
  // 纵轴上限：默认 6 000 kW，夏季出力更大时按 1 000 进位
  const maxKw = computed(() =>
    Math.max(
      6000,
      Math.ceil(Math.max(...slow.value.pvCurve.map((p) => p.kw)) / 1000) * 1000
    )
  )
  const ys = (v) => 6 + (H - 22) * (1 - v / maxKw.value)
  const curve = computed(() => slow.value.pvCurve)
  const pts = computed(() =>
    curve.value.map((p) => `${xs(p.h)},${ys(p.kw)}`).join(" ")
  )
  const area = computed(() => {
    const c = curve.value
    return `M${xs(c[0].h)},${ys(0)} L${pts.value.split(" ").join(" L")} L${xs(c[c.length - 1].h)},${ys(0)} Z`
  })

  // 「现在」竖线：时钟换算成小时，夜间出力为 0
  const nowH = computed(() => {
    const [h, m, s] = fast.value.clock.time.split(":").map(Number)
    return Math.min(x1, Math.max(x0, h + m / 60 + s / 3600))
  })
  const nowX = computed(() => xs(nowH.value))
  const nowLeft = computed(() => nowX.value < 150)
  const nowText = computed(() => {
    const kw = fast.value.energy.pvKw
    return kw > 0 ? `${int(kw)} kW` : "夜间 0 kW"
  })

  // 悬停
  const hovH = ref(null)
  function onMove(e) {
    const x = svgX(e, W)
    const h = x0 + ((x - L) / (W - L - 2)) * (x1 - x0)
    const c = curve.value
    const p = c.reduce((a, b) =>
      Math.abs(b.h - h) < Math.abs(a.h - h) ? b : a
    )
    hovH.value = p.h
    const hh = Math.floor(p.h)
    showTip(e, `${p2(hh)}:${p2(Math.round((p.h - hh) * 60))}`, [
      { k: "光伏出力", v: `${int(p.kw)} kW` }
    ])
  }
  function onLeave() {
    hovH.value = null
    hideTip()
  }
</script>
