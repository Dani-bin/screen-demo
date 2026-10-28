<!-- 设备运行：岸桥 / 轨道吊 / AGV 三个环（作业率 + 各状态分段）+ 状态明细；点一类在三维里高亮 -->
<template>
  <Panel title="设备运行" en="EQUIPMENT">
    <div class="eqs">
      <div
        v-for="r in rings"
        :key="r.name"
        class="eq"
        @click="$emit('kind', r.kind)"
      >
        <svg width="80" height="80" viewBox="0 0 88 88">
          <circle cx="44" cy="44" :r="R" class="rg-bg" />
          <circle
            v-for="sg in r.segs"
            :key="sg.c"
            cx="44"
            cy="44"
            :r="R"
            class="rg"
            :class="sg.c"
            :stroke-dasharray="`${sg.len} ${C}`"
            :stroke-dashoffset="-sg.off"
            transform="rotate(-90 44 44)"
          />
          <!-- 数字和 % 之间不能留空白（SVG 里换行会渲染成一个空格），所以不让 Prettier 折行 -->
          <!-- prettier-ignore -->
          <text x="44" y="44" text-anchor="middle" class="rg-v">
            {{ r.rate }}<tspan class="rg-u">%</tspan>
          </text>
          <text x="44" y="60" text-anchor="middle" class="rg-l">作业率</text>
        </svg>
        <div class="eq-i">
          <div class="eq-n">
            <i v-html="r.icon"></i><b>{{ r.name }}</b
            ><span>{{ r.total }} 台</span>
          </div>
          <div v-for="p in r.parts" :key="p.l" class="eq-p">
            <i class="dot" :class="p.c"></i>{{ p.l }}<b>{{ p.n }}</b>
          </div>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { ICON } from "../../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  defineEmits(["kind"])
  const R = 30
  const C = 2 * Math.PI * R
  const rings = computed(() => {
    const k = props.state.kpi
    const def = [
      {
        kind: "qc",
        name: "岸桥",
        icon: ICON.crane,
        total: k.qc.total,
        parts: [
          { l: "作业", n: k.qc.work, c: "st-work" },
          { l: "待机", n: k.qc.idle, c: "st-idle" },
          { l: "故障", n: k.qc.fault, c: "st-fault" },
          { l: "检修", n: k.qc.maint, c: "st-maint" }
        ]
      },
      {
        kind: "rmg",
        name: "轨道吊",
        icon: ICON.crane,
        total: k.rmg.total,
        parts: [
          { l: "作业", n: k.rmg.work, c: "st-work" },
          { l: "待机", n: k.rmg.idle, c: "st-idle" },
          { l: "故障", n: k.rmg.fault, c: "st-fault" }
        ]
      },
      {
        kind: "agv",
        name: "AGV",
        icon: ICON.agv,
        total: k.agv.total,
        parts: [
          {
            l: "作业",
            n: k.agv.laden + k.agv.empty + k.agv.queue,
            c: "st-work"
          },
          { l: "空闲", n: k.agv.idle, c: "st-idle" },
          { l: "换电", n: k.agv.swap, c: "st-swap" },
          { l: "故障", n: k.agv.fault, c: "st-fault" }
        ]
      }
    ]
    return def.map((r) => {
      let off = 0
      const segs = r.parts
        .filter((p) => p.n > 0)
        .map((p) => {
          const len = (p.n / r.total) * C
          const sg = { c: p.c, len: Math.max(0, len - 2), off }
          off += len
          return sg
        })
      return { ...r, segs, rate: Math.round((r.parts[0].n / r.total) * 100) }
    })
  })
</script>
