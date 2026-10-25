<!-- 03 煤仓煤位：三个煤仓的煤位、存煤、进 / 出煤量（给煤机联动） -->
<template>
  <Panel no="03" title="煤仓煤位" en="BUNKERS · 给煤联动">
    <div class="bks">
      <div v-for="m in list" :key="m.id" class="bk" @click="emit('pick', m.id)">
        <div class="silo">
          <i :style="{ height: `${(m.level * 100).toFixed(0)}%` }"></i
          ><span>{{ pct(m.level) }}</span>
        </div>
        <div class="bk-t">
          <b>{{ m.name }}</b
          ><span class="code">{{ m.id }} · {{ fmt(m.cap) }} t</span>
          <dl>
            <dt>存煤</dt>
            <dd>{{ fmt(m.tons) }} t</dd>
            <dt>进</dt>
            <dd>{{ fmt(m.inflow) }} t/h</dd>
            <dt>出</dt>
            <dd>{{ fmt(m.out) }} t/h</dd>
          </dl>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, pct } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ f: { type: Object, required: true } })
  const emit = defineEmits(["pick"])

  /** 每个煤仓的进煤皮带 */
  const FEED = { MC01: "BC04", MC02: "BC03", MC03: "BC01" }
  const list = computed(() => {
    const s = props.f.s
    return layout.bunkers.map((m) => {
      const b = s.bunkers[m.id]
      // 出煤：井下煤仓 = 仓下给煤机之和；地面原煤仓 = 装车外运
      const out = m.feeders.length
        ? m.feeders.reduce((a, f) => a + s.feeders[f].rate, 0)
        : s.draw
      return {
        ...m,
        level: b.level,
        tons: b.tons,
        inflow: s.belts[FEED[m.id]].flowOut,
        out
      }
    })
  })
</script>
