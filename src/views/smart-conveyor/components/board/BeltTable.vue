<!-- 02 皮带运行：按煤流方向（工作面 → 地面）列 6 条皮带的状态、带速、装载率、功率；点一行飞到那条皮带 -->
<template>
  <Panel no="02" title="皮带运行" en="BELT STATUS · 料流均衡">
    <table class="bt">
      <thead>
        <tr>
          <th>皮带（煤流 ↓）</th>
          <th>状态</th>
          <th>带速 m/s</th>
          <th>装载率</th>
          <th>功率 kW</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in rows"
          :key="r.id"
          :class="{ sel: r.id === selected }"
          @click="emit('pick', r.id)"
        >
          <td>
            <b class="code">{{ r.id }}</b
            ><span>{{ r.short }}</span>
          </td>
          <td><StDot :st="r.st.state" /></td>
          <td class="num">
            {{ fmt(r.st.v, 2) }}<i>/{{ fmt(r.v, 1) }}</i>
          </td>
          <td>
            <div class="bar">
              <i :style="{ width: `${(r.fill * 100).toFixed(0)}%` }"></i>
            </div>
            <span class="num s">{{ pct(r.fill) }}</span>
          </td>
          <td class="num" :class="{ regen: r.st.power < 0 }">
            {{ fmt(r.st.power) }}
          </td>
        </tr>
      </tbody>
    </table>
    <p class="note"><Ic name="leaf" />{{ note }}</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { StDot } from "../tags.js"
  import { fmt, pct } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  const emit = defineEmits(["pick"])

  // 煤流方向：掘进 / 顺槽在上，地面栈桥在下
  const rows = computed(() =>
    [...layout.belts].reverse().map((b) => {
      const st = props.f.s.belts[b.id]
      return { ...b, st, fill: Math.min(1, st.fill) }
    })
  )
  /** 底注：有几条皮带在额定带速以下运行（料流均衡调速） */
  const note = computed(() => {
    const run = rows.value.filter((r) => r.st.v > 0.05)
    const slow = run.filter((r) => r.st.v < r.v * 0.98).length
    if (!run.length) return "全线停车"
    return `料多快转、料少慢转、无料待机：当前 ${slow} 条皮带带速低于额定`
  })
</script>
