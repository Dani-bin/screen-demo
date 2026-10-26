<!--
  D7 X 光钢丝绳芯：主斜井输送带（一整圈展开）的带面图 —— 钢丝绳芯是细横线，接头是竖向色带（标伸长量，
  ≥ 8 mm 标黄），断丝红点、锈蚀橙点、接头抽动黄点；鼠标移上看详情
-->
<template>
  <Panel no="D7" title="X 光钢丝绳芯" en="X-RAY · ST CORD BELT">
    <div class="xr-h">
      <span
        ><Ic name="xray" />BC02 主斜井 · 一圈 {{ fmt(xr.loop) }} m ·
        {{ xr.cords }} 根钢丝绳</span
      >
      <em>接头 {{ xr.splices.length }} · 损伤 {{ xr.damages.length }}</em>
    </div>
    <svg
      :style="{ width: rem(W), height: rem(H + 12) }"
      :viewBox="`0 0 ${W} ${H + 12}`"
    >
      <rect
        x="0"
        y="0"
        :width="W"
        :height="H"
        fill="rgba(255,255,255,0.02)"
        stroke="var(--hair)"
      />
      <line
        v-for="k in 16"
        :key="k"
        x1="0"
        :x2="W"
        :y1="(k / 17) * H"
        :y2="(k / 17) * H"
        stroke="rgba(150,180,210,0.08)"
      />
      <g v-for="j in xr.splices" :key="j.id">
        <rect
          :x="X(j.pos) - 2"
          y="0"
          width="4"
          :height="H"
          :fill="
            j.elong >= 8 ? 'rgba(250,204,21,0.55)' : 'rgba(61,224,255,0.3)'
          "
        >
          <title>{{ j.id }} 接头 @ {{ j.pos }} m · 伸长 {{ j.elong }} mm</title>
        </rect>
        <text :x="X(j.pos)" :y="H + 10" class="ax" text-anchor="middle">
          {{ j.id.slice(1) }}
        </text>
      </g>
      <circle
        v-for="d in xr.damages"
        :key="d.id"
        :cx="X(d.pos)"
        :cy="((d.cords[0] + d.cords[1]) / 2 / xr.cords) * H"
        :r="d.level === '重' ? 4 : 3"
        :fill="`var(${DMG[d.type]})`"
        stroke="#0b1018"
      >
        <title>
          {{ d.type }}（{{ d.level }}）@ {{ d.pos }} m · 第 {{ d.cords[0] }}–{{
            d.cords[1]
          }}
          根
        </title>
      </circle>
    </svg>
    <ul class="xr-lg">
      <li v-for="(c, k) in DMG" :key="k" :style="{ '--c': `var(${c})` }">
        <i></i>{{ k }} {{ count(k) }}
      </li>
      <li><i class="j"></i>接头伸长 ≥ 8 mm {{ longJ }}</li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt, rem } from "../ui.js"

  const props = defineProps({ w: { type: Object, required: true } })
  const W = 396
  const H = 64
  const DMG = { 断丝: "--l1", 锈蚀: "--l2", 接头抽动: "--l3" }

  const xr = computed(() => props.w.xr)
  const X = (pos) => (pos / xr.value.loop) * W
  const count = (k) => xr.value.damages.filter((d) => d.type === k).length
  const longJ = computed(
    () => xr.value.splices.filter((j) => j.elong >= 8).length
  )
</script>
