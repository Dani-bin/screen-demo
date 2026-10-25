<!--
  AI 视频：选中皮带的 4 路摄像机（机头 / 机尾受料点 / 沿线），画面是程序化示意（CamView），
  叠加识别结果：当前告警里属于这台摄像机的异物 / 大块 / 人员越界 / 未戴安全帽 / 堵料出红框，跑偏出黄线
-->
<template>
  <Panel no="R8" title="AI 视频" en="AI VISION · 4 CH">
    <div class="av">
      <CamView
        v-for="(c, i) in cams"
        :key="c.id"
        :cam="c"
        :use="c.use"
        :v="st.v"
        :load="Math.min(1, st.fill)"
        :hit="c.hit"
        :deviation="st.deviation"
        :now="f.ms"
        :seed="i + 3"
      />
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import CamView from "./CamView.vue"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    id: { type: String, required: true }
  })
  const sim = inject("sim")

  /** 告警类型 → 画面上的识别标签 */
  const HIT = {
    foreign: "异物 · 锚杆",
    bigLump: "大块煤",
    intrude: "人员越界",
    fence: "人员越界",
    helmet: "未戴安全帽",
    blockage: "堵料",
    tear: "纵向撕裂"
  }
  const st = computed(() => props.f.s.belts[props.id])
  const cams = computed(() => {
    const list = layout.devices.filter(
      (d) => d.kind === "camera" && d.belt === props.id
    )
    // 机尾受料点、机头优先，其余沿线
    const pick = [...list].sort((a, b) => a.chainage - b.chainage)
    const chosen =
      pick.length <= 4
        ? pick
        : [pick[0], pick[1], pick[pick.length - 2], pick[pick.length - 1]]
    return chosen.map((d) => {
      const a = props.f.s.alarms.find((x) => x.device === d.id && HIT[x.kind])
      return {
        ...sim.cameraReading(d.id, props.f.ms),
        use: d.use,
        hit: a ? HIT[a.kind] : ""
      }
    })
  })
</script>
