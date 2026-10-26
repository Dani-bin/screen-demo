<!-- D1 劣化设备：正在劣化的设备，按严重度排序：阶段、严重度条、已提前预警天数、计划消缺时间；点一项选中 -->
<template>
  <Panel no="D1" title="劣化设备" en="DEGRADATION · PHM">
    <ul class="dg">
      <li
        v-for="t in list"
        :key="t.id"
        :class="{ on: t.id === selected }"
        @click="emit('select', t.id)"
      >
        <div class="dg-t">
          <b>{{ t.where }}</b
          ><em :class="t.cls">{{ t.stage }}</em>
        </div>
        <div class="dg-m">
          <span>{{ t.name }}</span>
          <div class="sev">
            <i
              :style="{
                width: `${(t.s * 100).toFixed(0)}%`,
                background: `var(${t.cvar})`
              }"
            ></i>
            <u style="left: 35%"></u><u style="left: 70%"></u>
          </div>
          <strong>{{ pct(t.s) }}</strong>
        </div>
        <div class="dg-f">
          <span v-if="t.lead > 0"
            >已提前 <b>{{ fmt(t.lead, 1) }}</b> 天预警</span
          >
          <span v-else>观察中 · 未到预警线</span>
          <em>计划消缺 {{ md(t.fixAt) }} {{ hm(t.fixAt) }}</em>
        </div>
      </li>
      <li v-if="!list.length" class="none">当前没有在发展的劣化</li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, hm, md, pct } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  const emit = defineEmits(["select"])
  const DAY = 24 * 3600000

  const list = computed(() =>
    [...props.f.s.tracks]
      .sort((a, b) => b.s - a.s)
      .map((t) => {
        const wo = props.w.tonight.find((x) => x.track === t.id)
        return {
          ...t,
          lead: (props.f.ms - t.tWarn) / DAY,
          fixAt: wo ? wo.start : t.tFix,
          cvar: t.s >= 0.7 ? "--l2" : t.s >= 0.35 ? "--l3" : "--predict",
          cls: t.s >= 0.7 ? "l2" : t.s >= 0.35 ? "l3" : "obs"
        }
      })
  )
</script>
