<!--
  下钻（第 2 / 3 级）的 DOM 标签：细节模型给出锚点（scene.detail.labels()），每帧投影到设计稿像素；
  标签里的读数每秒从仿真器取（托辊温速、环境、摄像机、机器人、人员、劣化托辊、驱动部各部件）
-->
<template>
  <div class="dtags">
    <div
      v-for="t in shown"
      :key="t.id"
      class="dtag"
      :class="t.kind"
      :style="{ left: rem(t.p[0]), top: rem(t.p[1]) }"
      @click="emit('pick', t)"
    >
      <i></i>
      <!-- 有竖向偏移的标签：锚点到标签框画一根引线 -->
      <u
        v-if="t.oy"
        :style="{
          height: rem(Math.abs(t.oy)),
          top: t.oy < 0 ? rem(t.oy + 8) : rem(8)
        }"
      ></u>
      <div :style="t.oy ? { transform: `translateY(${rem(t.oy)})` } : null">
        <b>{{ t.title }}</b>
        <em v-for="(x, i) in t.lines" :key="i">{{ x }}</em>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { fmt, pct, rem } from "./ui.js"

  const props = defineProps({
    scene: { type: Object, required: true },
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const emit = defineEmits(["pick"])
  const sim = inject("sim")

  /** 每类标签的读数行 */
  function lines(l) {
    const ms = props.f.ms
    const s = props.f.s
    switch (l.kind) {
      case "idler": {
        const r = sim.idlerReading(l.id, ms)
        return [`${fmt(r.temp, 1)} °C · ${fmt(r.rpm, 0)} rpm`]
      }
      case "xray": {
        const x = props.w.xr
        return x && x.belt === l.id.split("-")[0]
          ? [`接头 ${x.splices.length} 个 · 损伤 ${x.damages.length} 处`]
          : ["钢丝绳芯在线检测"]
      }
      case "laser":
        return ["底面撕裂检测 · 输出停机信号"]
      case "env": {
        const r = sim.envReading(l.id, ms)
        return [
          `CO ${fmt(r.co, 1)} ppm · CH₄ ${fmt(r.ch4, 2)} %`,
          `粉尘 ${fmt(r.dust, 1)} mg/m³`
        ]
      }
      case "camera": {
        const r = sim.cameraReading(l.id, ms)
        return [`${l.name} · AI ${fmt(r.conf, 0)}%`]
      }
      case "robot": {
        const r = s.robots[l.id]
        return r ? [`${r.stateName} · 电量 ${fmt(r.battery)}%`] : []
      }
      case "fault": {
        const tr =
          s.tracks.find((t) => t.id === l.id) || props.scene.detail?.track
        if (!tr) return []
        const T = props.w.dts?.[tr.belt]
        const temp = T ? T[Math.round(tr.chainage)] : null
        return [
          `${tr.name} · 严重度 ${pct(tr.s)}`,
          temp != null ? `光纤测温 ${fmt(temp, 1)} °C · ${tr.stage}` : tr.stage
        ]
      }
      case "part":
        return partLines(l)
      case "drive":
        return ["点击查看驱动部拆解"]
      default:
        return []
    }
  }
  /** 驱动部各部件的读数 */
  function partLines(l) {
    const d = props.scene.detail
    if (!d?.motorId)
      return l.id === "brg" ? ["外圈剥落 → 包络谱 BPFO 突出"] : []
    const ms = props.f.ms
    const m = sim.motorReading(d.motorId, ms)
    const r = sim.reducerReading(d.motorId.replace("-M", "-R"), ms)
    if (l.id === "motor")
      return [
        `${fmt(m.current, 0)} A · ${fmt(m.power, 0)} kW · 绕组 ${fmt(m.tWinding, 1)} °C`,
        `轴承 DE ${fmt(m.tDE, 0)} / NDE ${fmt(m.tNDE, 0)} °C · 振动 ${fmt(Math.max(m.vibDE, m.vibNDE), 2)} mm/s`
      ]
    if (l.id === "reducer")
      return [`油温 ${fmt(r.tOil, 1)} °C · 振动 ${fmt(r.vib, 2)} mm/s`]
    if (l.id === "pulley") {
      const pid = d.belt.drives.find((x) => x.id === d.motorId)?.pulley
      const p = pid ? sim.pulleyReading(pid, ms) : null
      return p
        ? [`轴承 ${fmt(p.tBearing, 1)} °C · 振动 ${fmt(p.vib, 2)} mm/s`]
        : []
    }
    return ["弹性柱销联轴器"]
  }

  // 每帧投影；读数每秒刷新
  const pos = shallowRef([])
  let raf = 0
  let last = ""
  function frame() {
    raf = requestAnimationFrame(frame)
    const d = props.scene.detail
    if (!d) {
      if (pos.value.length) pos.value = []
      return
    }
    const cam = props.scene.camera
    const key = `${cam.matrixWorld.elements.map((x) => x.toFixed(3)).join()}|${props.f.ms}|${d.labelList?.length}`
    if (key === last) return
    last = key
    pos.value = d
      .labels()
      .map((l) => ({ ...l, p: props.scene.toDesign(l.pos) }))
  }
  onMounted(() => (raf = requestAnimationFrame(frame)))
  onBeforeUnmount(() => cancelAnimationFrame(raf))

  // 只显示三维区内的；人员、急停、跑偏开关这类多的只在离镜头近时显示（按投影后间距去重）
  const shown = computed(() => {
    void props.f.ms
    const out = []
    // 重要的先占位置：劣化 / 驱动部 / 部件 > 机器人 / 摄像机 > 传感器 > 人员 > 开关类
    const RANK = {
      fault: 0,
      drive: 0,
      part: 0,
      robot: 1,
      camera: 1,
      xray: 1,
      laser: 1,
      idler: 2,
      env: 2,
      person: 3,
      dev: 4,
      estop: 5
    }
    const list = [...pos.value].sort(
      (a, b) => (RANK[a.kind] ?? 6) - (RANK[b.kind] ?? 6)
    )
    for (const l of list) {
      const p = l.p
      if (!p || p[0] < 470 || p[0] > 1450 || p[1] < 200 || p[1] > 760) continue
      // 部件标签自己错开（oy），不参与去重
      if (
        !l.oy &&
        out.some(
          (o) =>
            !o.oy &&
            Math.abs(o.p[0] - p[0]) < 90 &&
            Math.abs(o.p[1] - p[1]) < 34
        )
      )
        continue
      out.push({
        ...l,
        title:
          l.kind === "part" || l.kind === "fault" || l.kind === "drive"
            ? l.name
            : `${l.id} ${l.name || ""}`,
        lines: lines(l)
      })
    }
    return out
  })
</script>
