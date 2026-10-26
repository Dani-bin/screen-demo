<!-- A5 分级汇总：今日告警按一到四级的条数（含已结束）+ 处置状态（未处理 / 处理中 / 已派单 / 已处理） -->
<template>
  <Panel no="A5" title="分级汇总" en="LEVELS · DISPOSAL">
    <div class="ls">
      <div class="ls-lv">
        <div
          v-for="x in levels"
          :key="x.l"
          class="ls-c"
          :style="{ '--c': `var(${LV_VAR[x.l]})` }"
        >
          <span>{{ LV[x.l] }}</span
          ><b>{{ x.n }}</b
          ><em>未结束 {{ x.open }}</em>
          <div class="bar">
            <i :style="{ width: `${(x.n / maxN) * 100}%` }"></i>
          </div>
        </div>
      </div>
      <div class="ls-st">
        <div v-for="x in status" :key="x.k" :class="x.cls">
          <i></i><span>{{ x.k }}</span
          ><b>{{ x.n }}</b>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { LV, LV_VAR } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const levels = computed(() =>
    [0, 1, 2, 3].map((l) => ({
      l,
      n:
        props.w.today.filter((e) => e.level === l).length +
        props.f.s.alarms.filter((a) => a.predictive && a.level === l).length,
      open: props.f.s.alarms.filter((a) => a.level === l).length
    }))
  )
  const maxN = computed(() => Math.max(1, ...levels.value.map((x) => x.n)))
  const status = computed(() => {
    const a = props.f.s.alarms
    const n = (k) => a.filter((x) => x.status === k).length
    return [
      { k: "未处理", n: n("未处理"), cls: "s-new" },
      { k: "处理中", n: n("处理中"), cls: "s-doing" },
      { k: "待确认 / 已派单", n: n("待确认") + n("已派单"), cls: "s-pred" },
      { k: "今日已处理", n: props.w.closed.length, cls: "s-done" }
    ]
  })
</script>
