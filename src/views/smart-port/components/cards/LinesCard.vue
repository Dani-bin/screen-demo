<!-- 作业路协同：岸桥 → AGV → 箱区，一路一行；最慢的路标出瓶颈原因；点一行飞到那台岸桥 -->
<template>
  <Panel title="作业路协同" en="QC → AGV → YARD">
    <template #tools
      ><a class="pn-tool sel" title="切换排序" @click="sortBy = SORTS[sortBy]"
        >{{ sortBy }} ▾</a
      ></template
    >
    <table class="tbl">
      <thead>
        <tr>
          <th>岸桥</th>
          <th>船舶</th>
          <th>当前效率 · 自然箱/h</th>
          <th>剩余</th>
          <th>AGV</th>
          <th>箱区</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in rows.slice(0, limit)"
          :key="c.id"
          :class="[
            c.state,
            { sel: c.id === selected, tracked: track && c.vessel === track }
          ]"
          @click="$emit('crane', c.id)"
        >
          <td>
            <span class="code">{{ c.id }}</span>
          </td>
          <td>{{ c.ship }}</td>
          <td>
            <div class="rt">
              <s :style="{ width: Math.min(1, c.rate / 45) * 100 + '%' }"></s>
            </div>
            <b>{{ c.state === "fault" ? "停机" : fmt(c.rate) }}</b>
          </td>
          <td class="num">{{ fmt(c.remain) }}</td>
          <td class="num">{{ c.agv }}</td>
          <td>
            <span class="code">{{ c.target || "—" }}</span
            ><em v-if="c.why" class="badge" :class="c.why[1]">{{
              c.why[0]
            }}</em>
          </td>
        </tr>
      </tbody>
    </table>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    selected: { type: String, default: "" },
    track: { type: String, default: "" },
    limit: { type: Number, default: 7 }
  })
  defineEmits(["crane"])
  /**
   * 排序：按岸桥编号 ⇄ 按效率（从低到高，停机和瓶颈排前面）；点标题栏的下拉切换。
   * 默认按岸桥：定稿表里的行就是按岸桥编号排的（它标的"按效率"只是占位字，不能标着按效率却按编号排）
   */
  const SORTS = { 按岸桥: "按效率", 按效率: "按岸桥" }
  const sortBy = ref("按岸桥")
  const rows = computed(() => {
    const s = props.state
    const vById = new Map(s.vessels.map((v) => [v.id, v]))
    const agvN = new Map()
    for (const a of s.agvs)
      if (a.crane) agvN.set(a.crane, (agvN.get(a.crane) || 0) + 1)
    const rmgFault = new Set(
      s.blocks.flatMap((b) =>
        b.rmg.filter((r) => r.state === "fault").map((r) => r.id)
      )
    )
    const list = s.cranes
      .filter((c) => c.state === "work" || c.state === "fault")
      .map((c) => ({
        ...c,
        ship: vById.get(c.vessel)?.name || "—",
        agv: agvN.get(c.id) || 0,
        why:
          c.state === "fault"
            ? ["岸桥故障", "fault"]
            : rmgFault.has(`${c.target}-S`)
              ? ["轨道吊故障", "fault"]
              : c.rate < 31
                ? ["效率偏低", "warn"]
                : null
      }))
    const eff = (c) => (c.state === "fault" ? -1 : c.rate)
    if (sortBy.value === "按效率") list.sort((a, b) => eff(a) - eff(b))
    // 跟踪某条船时，把为它服务的岸桥排在前面（稳定排序，组内保持上面的顺序）
    if (props.track)
      list.sort(
        (a, b) => (b.vessel === props.track) - (a.vessel === props.track)
      )
    return list
  })
</script>
