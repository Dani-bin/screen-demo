<!-- 选中对象的信息卡（楼栋 / 充电区 / 盲区 / 无人机）：贴在沙盘左上，右上角叉关闭，"飞过去"让镜头飞到该对象 -->
<template>
  <div v-if="card" class="card infocard">
    <div class="hd">
      <span class="t">{{ card.title }}</span>
      <span
        v-if="card.tag"
        class="chip"
        :class="card.tagCls"
        style="margin-left: 8px"
        >{{ card.tag }}</span
      >
      <span class="x" @click="$emit('close')">×</span>
    </div>
    <div v-for="r in card.rows" :key="r[0]" class="r">
      <span>{{ r[0] }}</span
      ><b>{{ r[1] }}</b>
    </div>
    <div class="btn" @click="$emit('focus')">飞到这里</div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import layout from "../data/layout.json"

  const props = defineProps({
    snap: { type: Object, required: true },
    id: { type: String, default: null }
  })
  defineEmits(["close", "focus"])

  const card = computed(() => {
    const id = props.id
    if (!id) return null
    const s = props.snap
    const b = layout.buildings.find((x) => x.id === id)
    if (b) {
      const rows = [
        ["类型", b.kindName ?? b.name],
        ["层数", `${b.floors} 层`],
        ["楼高（实际）", `${b.h.toFixed(0)} m`]
      ]
      if (b.units) rows.push(["户数", `${b.units} 户`])
      const ev = s.events.filter(
        (e) => e.zone === id && e.status !== "closed" && e.status !== "false"
      )
      if (ev.length)
        rows.push([
          "未办结事件",
          ev.map((e) => `${e.id} ${e.statusText}`).join("、")
        ])
      if (id === "PM-01")
        rows.push(["屋顶", "机库 HG-01 · 三机起降"], ["监控室", "地面站 GS-01"])
      return { title: b.name, tag: id, tagCls: "", rows }
    }
    const th = s.thermal[id]
    if (th) {
      const lv = { ok: "正常", warn: "预警", alarm: "告警", stale: "数据过期" }[
        th.level
      ]
      return {
        title: layout.points.find((p) => p.id === id).name,
        tag: lv,
        tagCls: th.level === "ok" ? "" : th.level,
        rows: [
          ["红外最高温度", `${th.temp.toFixed(1)} ℃`],
          ["预警线 / 告警线", "60 / 80 ℃"],
          ["最近验证", th.verifiedAt],
          ["数据质量", th.q === "good" ? "良好" : "不确定（过期）"]
        ]
      }
    }
    const z = s.blind.zones.find((x) => x.id === id)
    if (z)
      return {
        title: layout.points.find((p) => p.id === id).name,
        tag: z.checked ? "已核验" : "待补扫",
        tagCls: z.checked ? "gold" : "warn",
        rows: [
          ["核验时刻", z.checked ? z.at : "—"],
          ["判定依据", "建筑阴影 / 视场边缘"],
          ["补扫机", "三号机（补盲）"]
        ]
      }
    const d = s.drones.find((x) => x.id === id)
    if (d)
      return {
        title: d.name,
        tag: d.taskText,
        tagCls: "gold",
        rows: [
          ["电量", `${Math.round(d.batt)} %`],
          ["高度 / 地速", `${d.alt.toFixed(1)} m · ${d.spd.toFixed(1)} m/s`],
          ["链路", `${d.linkText} · ${Math.round(d.lat)} ms`],
          [
            "信号 5.8G / 2.4G",
            `${Math.round(d.rssi58)} / ${Math.round(d.rssi24)} dBm`
          ]
        ]
      }
    const p = layout.points.find((x) => x.id === id)
    return p
      ? {
          title: p.name,
          tag: id,
          tagCls: "",
          rows: [["位置", `(${p.x}, ${p.y}) m`]]
        }
      : null
  })
</script>
