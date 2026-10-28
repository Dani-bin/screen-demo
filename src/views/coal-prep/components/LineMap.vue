<!--
  09 沿线一张图：0 m 机头 → 248 m 机尾受料点，四行：托辊组（异常组按级着色）、光纤测温热力带、传感器、吊轨机器人
-->
<template>
  <section class="panel linemap">
    <header class="ph">
      <b class="no">09</b>
      <h3>103 沿线一张图</h3>
      <i>LINE VIEW · 0 m 机头 → {{ L }} m 机尾受料点</i>
      <span class="legend"
        ><i class="lg hot"></i>平台预警热点<i class="lg heat"></i
        >光纤温度（越亮越热）<i class="lg es"></i>急停拉线开关</span
      >
    </header>
    <svg viewBox="0 0 1000 130" class="lm">
      <text x="4" y="32" class="lane">托辊组</text>
      <text x="4" y="56" class="lane">光纤测温</text>
      <text x="4" y="78" class="lane">传感器</text>
      <text x="4" y="110" class="lane">吊轨机器人</text>
      <line :x1="X(0)" :x2="X(L)" y1="34" y2="34" class="base" />
      <line
        v-for="t in ticks"
        :key="t.g"
        :x1="t.x"
        :x2="t.x"
        :y1="t.cls ? 16 : 22"
        y2="34"
        class="tk"
        :class="t.cls"
      />
      <rect
        v-for="h in heat"
        :key="h.m"
        :x="h.x"
        y="44"
        :width="h.w"
        height="14"
        :fill="h.fill"
      />
      <rect
        v-for="(sn, i) in sensors"
        :key="i"
        :x="X(sn.at) - 4"
        y="70"
        width="8"
        height="8"
        class="sn"
        :class="{ es: sn.t === '急停' }"
      />
      <text
        v-for="l in senLabels"
        :key="l.t"
        :x="l.x"
        y="92"
        class="ax"
        :text-anchor="l.anchor"
      >
        {{ l.t }}
      </text>
      <line :x1="X(0)" :x2="X(L)" y1="106" y2="106" class="rail" />
      <line
        v-if="s.robot.target"
        :x1="X(s.robot.at) + 6"
        :x2="X(s.robot.target) - 6"
        y1="106"
        y2="106"
        class="rbt-go"
      />
      <circle :cx="X(s.robot.at)" cy="106" r="5" class="rbt" />
      <template v-if="s.idler35.level">
        <line
          :x1="X(d.dts.peakAt)"
          :x2="X(d.dts.peakAt)"
          y1="10"
          y2="112"
          class="hotline"
        />
        <text :x="X(d.dts.peakAt) + 6" y="12" class="hot-t">
          #{{ d.dts.group }} · {{ d.dts.peakAt }} m · {{ fmt(d.dts.peak, 1) }} ℃
        </text>
      </template>
      <text
        v-for="i in otherIssues"
        :key="i.group"
        :x="X(i.at)"
        y="12"
        class="iss-t"
        text-anchor="middle"
      >
        #{{ i.group }} {{ LV[i.level] }}
      </text>
      <text
        v-for="m in scale"
        :key="m"
        :x="X(m)"
        y="126"
        class="ax"
        :text-anchor="m === L ? 'end' : 'middle'"
      >
        {{ m }} m
      </text>
    </svg>
  </section>
</template>

<script setup>
  import { fmt, LV } from "./fmt.js"

  const props = defineProps({ d: { type: Object, required: true } })
  const s = computed(() => props.d.s)
  const L = 248
  const X = (m) => 64 + (m / L) * 916

  /** 托辊组刻度：正常组隔一画一根，异常组按级着色并加长 */
  const ticks = computed(() => {
    const out = []
    for (let g = 1; g <= props.d.groups; g++) {
      const is = props.d.issues.find((x) => x.group === g)
      if (g % 2 && !is) continue
      out.push({ g, x: X(g * 1.2), cls: is ? `l${is.level}` : "" })
    }
    return out
  })
  /** 光纤测温热力带：每 2 m 一格，单色顺序色（越亮越热） */
  const heat = computed(() => {
    const out = []
    for (let m = 0; m < L; m += 2) {
      const k = Math.max(0, Math.min(1, (s.value.dts[m] - 10) / 12))
      out.push({
        m,
        x: X(m),
        w: X(m + 2) - X(m) + 0.5,
        fill: `rgba(249,115,22,${(0.1 + 0.9 * k ** 1.6).toFixed(2)})`
      })
    }
    return out
  })
  const sensors = computed(() => [
    { at: 2, t: "温振" },
    ...s.value.sway.map((w) => ({ at: w.at, t: "跑偏" })),
    { at: s.value.tear.at, t: "纵撕" },
    ...[40, 80, 120, 160, 200].map((m) => ({ at: m, t: "急停" }))
  ])
  // 机头的温振 + 跑偏、机尾的纵撕 + 跑偏挨得太近，各合并成一个文字标签
  const senLabels = [
    { x: X(3) - 4, t: "温振 · 跑偏", anchor: "start" },
    { x: X(124), t: "跑偏", anchor: "middle" },
    { x: X(238) + 4, t: "纵撕 · 跑偏", anchor: "end" }
  ]
  const otherIssues = computed(() =>
    props.d.issues.filter((i) => i.group !== s.value.idler35.group)
  )
  const scale = [0, 50, 100, 150, 200, L]
</script>
