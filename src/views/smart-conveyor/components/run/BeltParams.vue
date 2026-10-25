<!-- 皮带运行参数：选中皮带的状态、带速、运量、功率、张紧力、打滑率、跑偏量、带上存煤、今日运行时长 / 电耗 -->
<template>
  <Panel no="R5" title="皮带运行参数" en="BELT PARAMETERS">
    <template #tools>
      <div class="bp-pick">
        <a
          v-for="b in layout.belts"
          :key="b.id"
          :class="{ on: b.id === id }"
          @click="emit('pick', b.id)"
          >{{ b.id.slice(2) }}</a
        >
      </div>
    </template>
    <div class="bp-hd">
      <b class="code">{{ id }}</b
      ><span>{{ cfg.name }}</span
      ><StDot :st="st.state" />
      <em v-if="st.manual" class="man">人工干预</em>
    </div>
    <div class="bp-g">
      <div v-for="x in items" :key="x.k" :class="x.cls">
        <span>{{ x.k }}</span
        ><b
          >{{ x.v }}<i>{{ x.u }}</i></b
        >
        <div v-if="x.bar != null" class="bar">
          <i
            :style="{ width: `${Math.min(100, x.bar * 100).toFixed(0)}%` }"
          ></i>
        </div>
      </div>
    </div>
    <p class="bp-spec">
      {{ cfg.belt }} · 带宽 {{ cfg.B }} mm · 长 {{ fmt(cfg.L) }} m ·
      {{ cfg.lift >= 0 ? "提升" : "下运" }} {{ fmt(Math.abs(cfg.lift)) }} m ·
      {{ cfg.drives.length }}×{{ cfg.drives[0].kW }} kW · {{ cfg.takeUp }}
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { StDot } from "../tags.js"
  import { fmt, pct } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    id: { type: String, required: true }
  })
  const emit = defineEmits(["pick"])

  const cfg = computed(() => layout.belts.find((b) => b.id === props.id))
  const st = computed(() => props.f.s.belts[props.id])
  const items = computed(() => {
    const b = cfg.value
    const x = st.value
    return [
      { k: "带速", v: fmt(x.v, 2), u: `/ ${fmt(b.v, 1)} m/s`, bar: x.v / b.v },
      {
        k: "运量",
        v: fmt(x.flowOut),
        u: "t/h",
        bar: x.flowOut / b.Q,
        cls: "coal"
      },
      {
        k: "功率",
        v: fmt(x.power),
        u: "kW",
        bar: Math.abs(x.power) / b.power,
        cls: x.power < 0 ? "regen" : ""
      },
      { k: "装载率", v: pct(Math.min(1.2, x.fill)), u: "", bar: x.fill },
      { k: "张紧力", v: fmt(x.tension, 0), u: "kN" },
      { k: "打滑率", v: fmt(x.slip, 2), u: "%", cls: x.slip > 1 ? "warn" : "" },
      {
        k: "跑偏量",
        v: fmt(x.deviation, 0),
        u: "mm",
        cls: x.deviation > 40 ? "warn" : ""
      },
      { k: "带上存煤", v: fmt(x.load, 1), u: "t" },
      { k: "今日运行", v: fmt(x.runHoursToday, 1), u: "h" }
    ]
  })
</script>
