<!--
  运行时序：今日每条皮带的状态色带（0–24 时，煤流方向从上到下）；零点班检修、起车预警、闭锁、保护停机一眼看出。
  集控起停序列进行中时，下方列出每台的"预警 → 启动 → 运行"进度。
-->
<template>
  <Panel no="R3" title="运行时序" en="START / STOP SEQUENCE">
    <div class="sb">
      <div v-for="r in rows" :key="r.id" class="sb-r">
        <b class="code">{{ r.id }}</b>
        <div class="sb-track">
          <i
            v-for="(x, i) in r.segs"
            :key="i"
            :style="{
              left: `${x.l}%`,
              width: `${x.w}%`,
              background: `var(${ST_VAR[x.st]})`
            }"
            :title="`${ST_NAME[x.st]} ${hm(x.t0)}–${hm(x.t1)}`"
          ></i>
          <u :style="{ left: `${nowK}%` }"></u>
        </div>
        <span>{{ r.runH }}<i>h</i></span>
      </div>
      <div class="sb-ax">
        <span v-for="t in [0, 6, 12, 18, 24]" :key="t">{{
          String(t).padStart(2, "0")
        }}</span>
      </div>
    </div>
    <div v-if="seq" class="sq">
      <header>
        <b>{{
          seq.kind === "start" ? "一键启动 · 逆煤流" : "一键停止 · 顺煤流"
        }}</b
        ><em>{{ seq.done }}/{{ seq.items.length }} 台完成</em>
      </header>
      <ol>
        <li v-for="x in seq.items" :key="x.id" :class="x.cls">
          <span class="code">{{ x.id }}</span
          ><i></i><em>{{ x.text }}</em>
        </li>
      </ol>
    </div>
    <div v-else class="sq-idle">
      <span
        >今日起车 <b>{{ starts }}</b> 次 · 停车 <b>{{ stops }}</b> 次</span
      ><em>零点班检修时段全线停车挂牌</em>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { ST, ST_NAME, ST_VAR, hm } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    ctl: { type: Object, required: true }
  })
  const DAY = 24 * 3600000
  // 煤流方向：工作面侧在上
  const ORDER = ["BC06", "BC05", "BC04", "BC03", "BC02", "BC01"]

  const rows = computed(() =>
    ORDER.map((id) => {
      const bands = props.w.bands[id] || []
      const segs = bands.map((x) => ({
        st: x.st,
        t0: x.t0,
        t1: x.t1,
        l: ((x.t0 - props.w.d0) / DAY) * 100,
        w: Math.max(0.15, ((x.t1 - x.t0) / DAY) * 100)
      }))
      const run = bands
        .filter((x) => x.st === ST.RUN || x.st === ST.STANDBY)
        .reduce((a, x) => a + (x.t1 - x.t0), 0)
      return { id, segs, runH: (run / 3600000).toFixed(1) }
    })
  )
  const nowK = computed(() => ((props.f.ms - props.w.d0) / DAY) * 100)
  // 今日起停次数：任一皮带从停车类状态进入预警算一次起车，从运行进入停车算一次停车（按主斜井计）
  const starts = computed(
    () => (props.w.bands.BC02 || []).filter((x) => x.st === ST.WARN).length
  )
  const stops = computed(
    () =>
      (props.w.bands.BC02 || []).filter(
        (x, i, a) => x.st === ST.STOP && i > 0 && a[i - 1].st !== ST.STOP
      ).length
  )

  /** 集控序列进度（覆盖层里的皮带状态） */
  const seq = computed(() => {
    const q = props.ctl.seq
    if (!props.ctl.active || !q) return null
    const order =
      q.kind === "start" ? layout.startOrder : [...layout.startOrder].reverse()
    const items = order.map((id) => {
      const st = props.f.s.belts[id]
      let cls = "wait"
      let text = "等待"
      if (q.kind === "start") {
        if (st.state === ST.WARN) [cls, text] = ["warn", "起车预警 · 语音提示"]
        else if (st.state === ST.START) [cls, text] = ["ramp", "软启动"]
        else if (st.state === ST.RUN) [cls, text] = ["done", "运行"]
      } else if (st.state === ST.STOP) [cls, text] = ["done", "已停车"]
      else if (st.v > 0.05 && st.manual) [cls, text] = ["run", "等上游拉空"]
      return { id, cls, text }
    })
    return {
      kind: q.kind,
      items,
      done: items.filter((x) => x.cls === "done").length
    }
  })
</script>
