<!--
  八大保护：选中皮带上跑偏 / 急停 / 烟雾 / 超温 / 张力 / 打滑 / 堆煤 / 撕裂 8 类保护的装置数和状态灯
  （正常绿、动作红、检修挂牌时旁路灰），动作时写出动作装置和事件
-->
<template>
  <Panel no="R7" title="八大保护" en="8 PROTECTIONS">
    <div class="pt">
      <div
        v-for="p in cells"
        :key="p.code"
        class="pt-c"
        :class="p.cls"
        :title="p.title"
      >
        <i></i><b>{{ p.name }}</b
        ><span class="code">×{{ p.n }}</span>
      </div>
    </div>
    <p class="pt-st" :class="trip ? 'trip' : ''">
      <template v-if="trip">{{ trip }}</template>
      <template v-else-if="bypass">检修挂牌：保护旁路，禁止启车</template>
      <template v-else
        >{{ total }} 个保护装置全部正常 · 与集控硬接线联锁</template
      >
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { PROTS, ST } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    id: { type: String, required: true }
  })

  const st = computed(() => props.f.s.belts[props.id])
  const bypass = computed(() => st.value.state === ST.MAINT)
  const cells = computed(() =>
    PROTS.map(([code, name, kind]) => {
      const n = layout.devices.filter(
        (d) => d.belt === props.id && d.kind === kind
      ).length
      const on = st.value.protection === code
      return {
        code,
        name,
        n,
        cls: on ? "on" : bypass.value ? "bypass" : "ok",
        title: `${name}保护（${code}）${n} 个`
      }
    })
  )
  const total = computed(() => cells.value.reduce((a, x) => a + x.n, 0))
  const trip = computed(() =>
    st.value.protection
      ? `${PROTS.find((p) => p[0] === st.value.protection)?.[1] || ""}保护动作 · ${st.value.tripTitle || "集控急停"}`
      : ""
  )
</script>
