<!--
  驱动部：选中皮带每套驱动（电机 + 减速机 + 变频器）一行：电流、功率、绕组 / 两端轴承温度、振动、减速机油温、变频输出频率。
  超过预警线的数字标黄（定温规则：绕组 105 °C、轴承 75 °C、振动 4.5 mm/s、油温 75 °C）；点一行去诊断中心。
-->
<template>
  <Panel no="R6" title="驱动部" en="DRIVES · MOTOR / REDUCER / VFD">
    <table class="du">
      <thead>
        <tr>
          <th>驱动</th>
          <th>电流 A</th>
          <th>功率 kW</th>
          <th>绕组 °C</th>
          <th>轴承 °C</th>
          <th>振动 mm/s</th>
          <th>油温 °C</th>
          <th>频率 Hz</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" @click="emit('diag', r.id)">
          <td>
            <b class="code">{{ r.short }}</b>
          </td>
          <td class="num">{{ fmt(r.m.current, 0) }}</td>
          <td class="num" :class="{ regen: r.m.power < 0 }">
            {{ fmt(r.m.power) }}
          </td>
          <td class="num" :class="warn(r.m.tWinding, 105)">
            {{ fmt(r.m.tWinding, 1) }}
          </td>
          <td class="num" :class="warn(Math.max(r.m.tDE, r.m.tNDE), 75)">
            {{ fmt(r.m.tDE, 0) }}/{{ fmt(r.m.tNDE, 0) }}
          </td>
          <td class="num" :class="warn(Math.max(r.m.vibDE, r.m.vibNDE), 4.5)">
            {{ fmt(Math.max(r.m.vibDE, r.m.vibNDE), 2) }}
          </td>
          <td class="num" :class="warn(r.r.tOil, 75)">
            {{ fmt(r.r.tOil, 1) }}
          </td>
          <td class="num">{{ fmt(r.hz, 1) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="du-note"><Ic name="bolt" />{{ note }}</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    id: { type: String, required: true }
  })
  const emit = defineEmits(["diag"])

  const cfg = computed(() => layout.belts.find((b) => b.id === props.id))
  const rows = computed(() => {
    const st = props.f.s.belts[props.id]
    return st.motors.map((m, k) => ({
      id: m.id,
      short: m.id.split("-")[1],
      m,
      r: st.reducers[k],
      // 变频输出频率 ∝ 带速（额定带速对应 50 Hz）
      hz: (50 * st.v) / cfg.value.v
    }))
  })
  const warn = (v, lim) => (v >= lim ? "warn" : "")
  const note = computed(() => {
    const st = props.f.s.belts[props.id]
    if (st.power < 0) return "下运发电工况：变频器回馈制动，电能回送电网"
    if (st.v < 0.05) return "停车：驱动部处于热备用"
    const share = st.motors.map((m) => m.power)
    const spread =
      (Math.max(...share) - Math.min(...share)) /
      Math.max(1, Math.abs(st.power))
    return `多机功率平衡 · 偏差 ${fmt(spread * 100, 1)}%（主从控制）`
  })
</script>
