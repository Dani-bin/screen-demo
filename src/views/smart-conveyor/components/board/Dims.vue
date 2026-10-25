<!-- 06 人机料环 · 四维告警：四维未结束 / 今日条数 + 按一到四级分段的告警环 -->
<template>
  <Panel no="06" title="人机料环 · 四维告警" en="4 DIMENSIONS · 6 SENSES">
    <div class="dims">
      <div class="dims-g">
        <div
          v-for="d in dims"
          :key="d.k"
          class="dm"
          :style="{ '--c': `var(${d.v})` }"
        >
          <span>{{ d.name }}</span
          ><b>{{ d.n }}</b
          ><em>今日 {{ d.today }}</em>
        </div>
      </div>
      <div class="dims-r">
        <svg class="ring" :style="ringSize" :viewBox="`0 0 ${SIZE} ${SIZE}`">
          <circle
            :cx="SIZE / 2"
            :cy="SIZE / 2"
            :r="R"
            stroke="var(--hair-soft)"
            :stroke-width="W"
          />
          <circle
            v-for="a in arcs"
            :key="a.l"
            :cx="SIZE / 2"
            :cy="SIZE / 2"
            :r="R"
            :stroke="`var(${LV_VAR[a.l]})`"
            :stroke-width="W"
            :stroke-dasharray="`${a.len} ${C}`"
            :stroke-dashoffset="-a.off"
            :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`"
          />
        </svg>
        <div class="dims-c">
          <b>{{ alarms.length }}</b
          ><span>未结束</span>
        </div>
        <ul>
          <li
            v-for="x in lv"
            :key="x.l"
            :style="{ '--c': `var(${LV_VAR[x.l]})` }"
          >
            <i></i>{{ LV[x.l] }}<b>{{ x.v }}</b>
          </li>
        </ul>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { DIM, LV, LV_VAR, rem } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  // 分段环：半径 30、线宽 7，段间留 2 px 缝
  const R = 30
  const W = 7
  const SIZE = (R + W) * 2
  const C = 2 * Math.PI * R
  const ringSize = { width: rem(SIZE), height: rem(SIZE) }

  const alarms = computed(() => props.f.s.alarms)
  const dims = computed(() =>
    Object.entries(DIM).map(([k, [name, v]]) => ({
      k,
      name,
      v,
      n: alarms.value.filter((a) => a.dim === k).length,
      today: props.w.today.filter((e) => e.dim === k).length
    }))
  )
  const lv = computed(() =>
    [0, 1, 2, 3].map((l) => ({
      l,
      v: alarms.value.filter((a) => a.level === l).length
    }))
  )
  const arcs = computed(() => {
    const total = lv.value.reduce((a, x) => a + x.v, 0) || 1
    let off = 0
    const out = []
    for (const x of lv.value) {
      if (!x.v) continue
      out.push({ l: x.l, len: Math.max(1, (x.v / total) * C - 2), off })
      off += (x.v / total) * C
    }
    return out
  })
</script>
