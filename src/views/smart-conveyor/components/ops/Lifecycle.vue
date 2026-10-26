<!--
  O5 设备全生命周期：6 条输送带的投运时间、累计运行小时 / 设计寿命、接头数（主斜井来自 X 光）、上次整带更换；
  托辊近 30 天更换数（劣化消缺派生）
-->
<template>
  <Panel no="M5" title="设备全生命周期" en="LIFECYCLE · BELTS">
    <table class="lc">
      <thead>
        <tr>
          <th>输送带</th>
          <th>投运</th>
          <th>累计运行 / 寿命</th>
          <th>接头</th>
          <th>上次换带</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            <b class="code">{{ r.id }}</b
            ><span>{{ r.belt }}</span>
          </td>
          <td class="num">{{ r.since.slice(2, 7).replace("-", "/") }}</td>
          <td>
            <div class="lc-bar">
              <i
                :style="{ width: `${Math.min(100, r.used * 100).toFixed(0)}%` }"
                :class="{ old: r.used > 0.8 }"
              ></i>
            </div>
            <span class="num">{{ fmt(r.hours) }} h · {{ pct(r.used) }}</span>
          </td>
          <td class="num">{{ r.splices }}</td>
          <td class="num">{{ r.last.slice(2, 7).replace("-", "/") }}</td>
        </tr>
      </tbody>
    </table>
    <p class="lc-note">
      近 30 天更换托辊 <b>{{ idlers }}</b> 组 · 全部由平台预警发现，零非计划停机
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, pct } from "../ui.js"
  import { BELT_LEDGER } from "../../data/ops.js"
  import layout from "../../data/layout.json"

  const props = defineProps({ w: { type: Object, required: true } })
  const sim = inject("sim")
  const DAY = 24 * 3600000

  const rows = computed(() =>
    layout.belts.map((b) => {
      const L = BELT_LEDGER[b.id]
      // 累计运行：自上次整带更换起，每天约 17 h（两个生产班 + 零点班部分时段）
      const days = Math.max(
        0,
        (props.w.ms - Date.parse(`${L.lastReplace}T00:00:00+08:00`)) / DAY
      )
      const hours = days * 17
      // 接头：主斜井取 X 光检测结果；其余按每卷带 200 m 一个接头估算
      const splices =
        b.id === "BC02" ? props.w.xr.splices.length : Math.ceil((b.L * 2) / 200)
      return {
        id: b.id,
        belt: b.belt.split(" ")[0],
        since: L.since,
        last: L.lastReplace,
        hours,
        used: hours / L.lifeH,
        splices
      }
    })
  )
  const idlers = computed(
    () =>
      sim
        .tracksBetween(props.w.ms - 30 * DAY, props.w.ms)
        .filter((t) => t.kind === "idlerBearing" && t.tFix <= props.w.ms).length
  )
</script>
