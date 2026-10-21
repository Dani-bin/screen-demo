<!-- 底部工具条：图层开关、视角切换、自动巡游状态，下面一条今日事件时间轴（刻度 = 告警发生时刻） -->
<template>
  <div class="tb">
    <div class="tb-g">
      <i v-html="ICON.layers"></i><span class="tb-t">图层</span>
      <a
        v-for="l in LAYERS"
        :key="l.key"
        :class="{ on: layers[l.key] }"
        @click="$emit('layer', l.key)"
        >{{ l.name }}</a
      >
    </div>
    <div class="tb-g">
      <i v-html="ICON.eye"></i><span class="tb-t">视角</span>
      <a
        v-for="v in VIEWS"
        :key="v.key"
        :class="{ on: view === v.key }"
        @click="$emit('view', v.key)"
        >{{ v.name }}</a
      >
    </div>
    <div class="tb-g tour" @click="$emit('tour')">
      <i v-html="touring ? ICON.play : ICON.pause"></i>
      <span>{{
        touring
          ? tourStep
            ? `自动巡游中 · ${tourStep}`
            : "自动巡游中"
          : idleText
      }}</span>
    </div>
    <div class="tl">
      <div class="tl-bar">
        <s :style="{ width: X(state.t) + '%' }"></s>
        <i
          v-for="e in ticks"
          :key="e.id"
          class="tk"
          :class="e.level"
          :style="{ left: X(e.at) + '%' }"
        ></i>
        <b :style="{ left: X(state.t) + '%' }"></b>
      </div>
      <div class="tl-ax">
        <span
          v-for="h in [0, 6, 12, 18, 24]"
          :key="h"
          :style="{ left: (h / 24) * 100 + '%' }"
          >{{ String(h).padStart(2, "0") }}:00</span
        >
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ICON } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    layers: { type: Object, required: true },
    view: { type: String, default: "overview" },
    touring: { type: Boolean, default: true },
    tourStep: { type: String, default: "" },
    idleText: { type: String, default: "手动 · 30 秒后恢复巡游" }
  })
  defineEmits(["layer", "view", "tour"])
  const LAYERS = [
    { key: "ships", name: "船舶" },
    { key: "cranes", name: "岸桥" },
    { key: "trails", name: "AGV 光迹" },
    { key: "ribbons", name: "作业路光带" },
    { key: "heat", name: "箱区热度" },
    { key: "alarm", name: "告警" }
  ]
  const VIEWS = [
    { key: "overview", name: "总览" },
    { key: "berth", name: "泊位" },
    { key: "yard", name: "箱区" },
    { key: "track", name: "单船跟踪" }
  ]
  const D = 86400000
  const X = (t) =>
    Math.max(0, Math.min(100, ((t - props.state.clock.dayStart) / D) * 100))
  const ticks = computed(() =>
    props.state.events.filter((e) => e.at >= props.state.clock.dayStart)
  )
</script>
