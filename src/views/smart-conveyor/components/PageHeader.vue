<!--
  顶栏：标识 + 平台名、五个页签（四维六感一平台的五个中心）、班次 / 安全天数 / 北京时间
-->
<template>
  <div class="hd">
    <div class="hd-l">
      <!-- eslint-disable-next-line vue/no-v-html -- 内置 SVG -->
      <div class="logo" v-html="ICON.logo"></div>
      <div class="hd-title">
        <h1>主煤流带式输送机安全预警与智能运维平台</h1>
        <p>
          QINGLAN MINE · MAIN COAL FLOW · BELT CONVEYOR SAFETY &amp; PHM
          <span>/ 青岚煤矿（虚构）· 演示数据</span>
        </p>
      </div>
    </div>
    <nav class="hd-nav">
      <a
        v-for="t in TABS"
        :key="t.key"
        :class="{ on: t.key === tab }"
        @click="emit('tab', t.key)"
        ><span>{{ t.name }}</span></a
      >
    </nav>
    <div class="hd-r">
      <div class="hd-shift">
        <b>{{ shift.name }}</b
        ><span>{{ shiftText }}</span>
      </div>
      <div class="hd-safe">
        <span>安全生产</span><b>{{ fmt(s.kpi.safeDays) }}</b
        ><i>天</i>
      </div>
      <div class="hd-clock">
        <b>{{ hms(now) }}</b
        ><span>{{ dateText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ICON, fmt, hms } from "./ui.js"
  import { beijing, shiftAt } from "../sim/simulator.js"

  /** 五个页签：智能看板（总览）+ 四个中心 */
  const TABS = [
    { key: "board", name: "智能看板" },
    { key: "run", name: "运行中心" },
    { key: "alarm", name: "预警中心" },
    { key: "diag", name: "诊断中心" },
    { key: "ops", name: "运维中心" }
  ]
  const props = defineProps({
    s: { type: Object, required: true },
    now: { type: Number, required: true },
    tab: { type: String, default: "board" }
  })
  const emit = defineEmits(["tab"])

  const shift = computed(() => shiftAt(props.now))
  const shiftText = computed(() => {
    const a = String(shift.value.start).padStart(2, "0")
    const b = String(shift.value.start + 8).padStart(2, "0")
    return `${shift.value.kind === "prod" ? "生产" : "检修"} · ${a}:00–${b}:00`
  })
  const WEEK = "日一二三四五六"
  const dateText = computed(() => {
    const b = beijing(props.now)
    return `${b.date.replaceAll("-", "/")} 周${WEEK[b.dow]}`
  })
</script>
