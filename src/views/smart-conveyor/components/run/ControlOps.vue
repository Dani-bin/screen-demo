<!--
  集控操作：模式（集控 / 就地 / 检修）、一键启动 / 一键停止 / 急停（选中的皮带）、料流均衡开关、就地手动带速。
  每个操作都发 "ask" 事件，由页面弹确认框（写清会影响哪些皮带），确认后才执行。
-->
<template>
  <Panel no="R2" title="集控操作" en="CENTRAL CONTROL">
    <div class="co">
      <div class="co-mode">
        <span>控制模式</span>
        <div class="seg">
          <a
            v-for="m in MODES"
            :key="m.key"
            :class="{ on: ctl.mode === m.key }"
            @click="
              m.key !== ctl.mode && emit('ask', { op: 'mode', mode: m.key })
            "
            >{{ m.name }}</a
          >
        </div>
      </div>
      <div class="co-btns">
        <a class="btn start" @click="emit('ask', { op: 'start' })"
          ><Ic name="play" />一键启动<em>逆煤流</em></a
        >
        <a class="btn stop" @click="emit('ask', { op: 'stop' })"
          ><Ic name="pause" />一键停止<em>顺煤流</em></a
        >
        <a
          class="btn estop"
          :class="{ off: !belt }"
          @click="belt && emit('ask', { op: 'estop', id: belt })"
          ><i class="mush"></i>急停<em>{{
            belt ? beltShort(belt) : "先选皮带"
          }}</em></a
        >
      </div>
      <div class="co-row">
        <span>料流均衡调速</span>
        <a
          class="sw"
          :class="{ on: ctl.balance }"
          @click="emit('ask', { op: 'balance', on: !ctl.balance })"
          ><i></i>{{ ctl.balance ? "开" : "关" }}</a
        >
        <em>{{ ctl.balance ? "料多快转、料少慢转" : "额定带速运行" }}</em>
      </div>
      <div class="co-row" :class="{ dis: ctl.mode !== 'local' || !belt }">
        <span>手动带速</span>
        <input
          type="range"
          :min="vMin"
          :max="vMax"
          step="0.1"
          :value="vNow"
          :disabled="ctl.mode !== 'local' || !belt"
          @change="onSpeed"
        />
        <b>{{ fmt(vNow, 1) }}<i>m/s</i></b>
      </div>
      <div class="co-st" :class="{ on: ctl.active }">
        <template v-if="ctl.active">
          <b>人工干预中</b><span>{{ idleText }}</span
          ><a @click="emit('reset')">恢复自动</a>
        </template>
        <template v-else>
          <Ic name="check" class="ok" /><span>全自动运行 · 平台与集控一体</span>
        </template>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { MODES } from "../../store/control.js"
  import { beltShort as short, fmt } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    ctl: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  const emit = defineEmits(["ask", "reset"])

  const beltShort = (id) => short(layout, id)
  /** 选中的是皮带才能急停 / 调速 */
  const belt = computed(() =>
    props.selected && props.selected.startsWith("BC") ? props.selected : null
  )
  const cfg = computed(() => layout.belts.find((b) => b.id === belt.value))
  const vMin = computed(() => cfg.value?.vMin ?? 0.5)
  const vMax = computed(() => cfg.value?.v ?? 5)
  const vNow = computed(() => (belt.value ? props.f.s.belts[belt.value].v : 0))
  function onSpeed(e) {
    emit("ask", { op: "speed", id: belt.value, v: Number(e.target.value) })
  }
  // 人工干预剩余时间（5 分钟无操作恢复自动）；每秒随状态刷新
  const idleText = computed(() => {
    void props.f.ms
    const left = 300 - (performance.now() - props.ctl.lastOp) / 1000
    const m = Math.max(0, Math.floor(left / 60))
    const s = Math.max(0, Math.floor(left % 60))
    return `${m}:${String(s).padStart(2, "0")} 后无操作自动恢复`
  })
</script>
