<!-- 选中对象详情（畜群 / 分区 / 饮水点 / 单元 / 场部）：浮在地图左上角 -->
<template>
  <div v-if="info" class="detail">
    <header>
      <b>{{ info.title }}</b
      ><span>{{ info.sub }}</span>
      <i class="x" @click="$emit('close')">×</i>
    </header>
    <dl>
      <template v-for="r in info.rows" :key="r[0]">
        <dt>{{ r[0] }}</dt>
        <dd :class="r[2]">{{ r[1] }}</dd>
      </template>
    </dl>
  </div>
</template>

<script setup>
  import { ACT, fmt, sign } from "../utils.js"

  const props = defineProps({
    sel: { type: Object, default: null },
    state: { type: Object, required: true },
    layout: { type: Object, required: true }
  })
  defineEmits(["close"])

  const STATUS = { grazing: "放牧中", resting: "休牧恢复", ready: "待牧" }
  const info = computed(() => {
    const s = props.sel
    const st = props.state
    if (!s) return null
    if (s.type === "herd") {
      const h = st.herds.find((x) => x.id === s.id)
      const u = st.units.find((x) => x.id === h.unit)
      const p = st.paddocks.find((x) => x.id === h.paddock)
      return {
        title: h.id,
        sub:
          h.kind === "sheep" ? "羊群 · 头羊项圈 3 个" : "牛群 · 每头一个项圈",
        rows: [
          [
            "头数",
            `${fmt(h.head)} ${h.kind === "sheep" ? "只" : "头"}（${fmt(h.su)} 羊单位）`
          ],
          ["所在分区", `${h.paddock} · 剩 ${p.remainDays?.toFixed(1)} 天`],
          ["状态", ACT[h.activity]],
          ["今日行走", `${h.walkKm.toFixed(2)} km`],
          ["单元平衡", `${sign(u.balance)}%`, u.balance > 10 ? "bad" : ""]
        ]
      }
    }
    if (s.type === "paddock") {
      const p = st.paddocks.find((x) => x.id === s.id)
      const lp = props.layout.paddocks.find((x) => x.id === s.id)
      return {
        title: `分区 ${p.id}`,
        sub: `${fmt(lp.areaMu)} 亩 · 海拔 ${Math.round(lp.elev)} m`,
        rows: [
          ["状态", STATUS[p.status]],
          [
            "当月 NDVI",
            `${p.ndvi.toFixed(2)}（去年同期 ${p.ndviLastYear.toFixed(2)}）`
          ],
          ["可食草量", `${p.forage.toFixed(0)} kg/亩（示意）`],
          p.status === "grazing"
            ? [
                "放牧",
                `第 ${p.grazedDays.toFixed(1)} 天 · 剩 ${p.remainDays.toFixed(1)} 天 · ${p.herd}`
              ]
            : ["休牧", `${p.restDays.toFixed(0)} 天`]
        ]
      }
    }
    if (s.type === "water") {
      const w = st.water.find((x) => x.id === s.id)
      return {
        title: `饮水点 ${w.id}`,
        sub: `${w.unit} · 机井 + 光伏提水`,
        rows: [
          ["水罐液位", `${w.level.toFixed(0)}%`, w.level < 20 ? "bad" : ""],
          [
            "提水泵",
            { run: "运行", stop: "停机", fault: "故障" }[w.pump],
            w.pump === "fault" ? "bad" : ""
          ],
          ["光伏功率", `${w.solarKw} kW`],
          [
            "今日供水",
            `${w.supplied.toFixed(2)} m³${w.flowQuality === "uncertain" ? "（读数不确定）" : ""}`
          ]
        ]
      }
    }
    if (s.type === "unit") {
      const u = st.units.find((x) => x.id === s.id)
      return {
        title: `轮牧单元 ${u.id}`,
        sub: `${u.kind === "sheep" ? "养羊" : "养牛"} · ${u.herd}`,
        rows: [
          ["实际载畜", `${fmt(u.su)} 羊单位`],
          ["合理载畜", `${fmt(u.capacity)} 羊单位`],
          ["草畜平衡", `${sign(u.balance)}%`, u.balance > 10 ? "bad" : ""],
          ["当前放牧", u.grazing]
        ]
      }
    }
    return {
      title: "合作社场部 HQ-01",
      sub: "称重通道 WS-01 · 药浴池 DP-01 · 储草棚 HS-01",
      rows: st.ops
        .slice(1, 4)
        .map((o) => [
          o.name,
          o.unit ? `${fmt(o.done)} / ${fmt(o.total)} ${o.unit}` : o.state
        ])
    }
  })
</script>
