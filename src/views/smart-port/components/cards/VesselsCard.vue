<!-- 在泊船舶：卸 / 装两段进度（船形游标）、作业阶段、船时效率、作业岸桥、离泊时刻；点一行进入单船跟踪 -->
<template>
  <Panel title="在泊船舶" en="VESSELS AT BERTH">
    <div
      v-for="v in list"
      :key="v.id"
      class="vs"
      :class="{ late: v.delayMin >= 30, sel: v.id === track }"
      @click="$emit('vessel', v.id)"
    >
      <div class="vs-h">
        <i v-html="ICON.ship"></i><b>{{ v.name }}</b
        ><span class="code">{{ v.voyage }}</span
        ><em class="tag">{{ v.clsName }}</em
        ><span class="vs-b">{{ v.berths.join("·") }}</span>
      </div>
      <div class="vs-bar">
        <label>卸</label>
        <div class="tr">
          <s :style="{ width: p(v.disDone, v.dis) }"></s
          ><i :style="{ left: p(v.disDone, v.dis) }"></i>
        </div>
        <span
          >{{ fmt(v.disDone) }}<small>/{{ fmt(v.dis) }}</small></span
        >
      </div>
      <div class="vs-bar load">
        <label>装</label>
        <div class="tr">
          <s :style="{ width: p(v.loadDone, v.load) }"></s
          ><i :style="{ left: p(v.loadDone, v.load) }"></i>
        </div>
        <span
          >{{ fmt(v.loadDone) }}<small>/{{ fmt(v.load) }}</small></span
        >
      </div>
      <div class="vs-f">
        <span
          >{{ STAGE_CN[v.stage] }} <b>{{ pct(v.done / v.moves) }}</b></span
        >
        <span
          >船时 <b>{{ v.rate ? fmt(v.rate) : "—" }}</b></span
        >
        <span
          >岸桥 <b>{{ v.lines.filter((l) => l.working).length }}</b></span
        >
        <span :class="{ bad: v.delayMin >= 30 }"
          >离泊 <b>{{ hm(v.depart) }}</b></span
        >
      </div>
    </div>
    <div v-if="!list.length" class="empty">当前没有在泊船舶</div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { ICON, STAGE_CN, fmt, hm, pct } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    track: { type: String, default: "" }
  })
  defineEmits(["vessel"])
  const list = computed(() =>
    props.state.vessels.filter((v) =>
      ["moored", "working", "finishing", "berthing", "anchor"].includes(v.stage)
    )
  )
  const p = (a, b) => `${(b ? a / b : 1) * 100}%`
</script>
