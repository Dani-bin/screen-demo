<!--
  场景标签：皮带 / 煤仓 / 工作面 / 地面设施的名牌 + 引线，最严重平台预警的告警卡，次一条平台预警的紫色标签，离线基站的过期标记。
  ----------------------------------------------------------
  每个标签的锚点是三维点（scene.anchorNear 在候选点里挑主机位下离定稿标注最近的），每帧投影成设计稿像素，
  镜头拖动 / 飞行时标签跟着物体走；标签相对锚点的偏移（dx, dy）照搬定稿。
  定稿标注是概念图（1536 × 864）里的像素，按 camera.json 的 place / scale 换算到整屏。
-->
<template>
  <div class="scene-tags">
    <svg class="tg-ln" :style="stageSize" viewBox="0 0 1920 1080">
      <g v-for="t in shown" :key="t.key">
        <line
          :x1="t.p[0]"
          :y1="t.p[1]"
          :x2="t.p[0] + t.dx"
          :y2="t.p[1] + t.dy + 14"
        />
        <circle :cx="t.p[0]" :cy="t.p[1]" r="3" />
      </g>
      <polyline
        v-if="card && card.p"
        :points="`${card.x},${card.p[1] - 70} ${card.x - 28},${card.p[1] - 70} ${card.p[0]},${card.p[1] - 4}`"
      />
    </svg>
    <div
      v-for="t in shown"
      :key="t.key"
      class="tg"
      :class="t.cls"
      :style="{ left: rem(t.p[0] + t.dx), top: rem(t.p[1] + t.dy) }"
      @click="emit('pick', t.pick)"
    >
      <b class="code">{{ t.code }}</b
      ><span>{{ t.name }}</span>
      <em v-for="(e, i) in t.lines" :key="i">{{ e }}</em>
    </div>

    <!-- 最严重的平台预警：告警卡 -->
    <div
      v-if="card && card.p"
      class="beam-card"
      :style="{ left: rem(card.x), top: rem(card.p[1] - 132) }"
      @click="emit('alarm', card.a)"
    >
      <header>
        <span class="tag-pred">平台预警</span><LvTag :l="card.a.level" /><b>{{
          card.tr.where
        }}</b>
      </header>
      <p>{{ card.text }}</p>
      <footer>
        <em>{{ card.fix }}</em
        ><span>首次预警 {{ md(card.tr.tWarn) }}</span>
      </footer>
    </div>
    <!-- 次一条平台预警：紫色标签（定稿里"只有光纤听诊发现"的那条） -->
    <div
      v-if="second && second.p"
      class="tg pred"
      :style="{ left: rem(second.p[0] - 60), top: rem(second.p[1] + 30) }"
      @click="emit('alarm', second.a)"
    >
      <b class="code">{{ second.code }}</b
      ><span>{{ second.tr.stage }}</span>
      <em>只有光纤听诊发现 · 严重度 {{ pct(second.tr.s) }}</em>
    </div>
    <!-- 离线基站：覆盖人数过期 -->
    <div
      v-for="u in stale"
      :key="u.id"
      class="stale-pin"
      :style="{ left: rem(u.p[0] + 14), top: rem(u.p[1] - 22) }"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- 内置 SVG -->
      <i v-html="ICON.pin"></i><span>{{ u.id }} 离线 · 过期</span>
    </div>
  </div>
</template>

<script setup>
  import * as THREE from "three"
  import { LvTag } from "./tags.js"
  import { ICON, fmt, hm, md, pct, rem } from "./ui.js"
  import camera from "../data/camera.json"
  import layout from "../data/layout.json"
  import { chainageToPoint, BELTS } from "../scene/section.js"

  const props = defineProps({
    scene: { type: Object, required: true },
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    // 剧本对照卡出现时只留告警卡，名牌让位
    quiet: { type: Boolean, default: false }
  })
  const emit = defineEmits(["pick", "alarm"])

  const stageSize = { width: rem(1920), height: rem(1080) }
  /** 概念图像素 → 整屏设计稿像素 */
  const at = (x, y) => [
    camera.place.x + x * camera.scale,
    camera.place.y + y * camera.scale
  ]
  const beltName = (id) => layout.belts.find((b) => b.id === id).short
  const bunkerName = (id) => layout.bunkers.find((b) => b.id === id).name

  /*
   * 标签定义：key、锚点候选（spec）、定稿标注像素（概念图坐标）、偏移、样式
   * 文字在 texts() 里按当前状态生成
   */
  const DEFS = [
    { key: "WF12301", spec: { face: true }, px: [240, 335], dx: -80, dy: -86 },
    { key: "BC05", spec: { belt: "BC05" }, px: [520, 333], dx: -112, dy: -70 },
    {
      key: "BC06",
      spec: { belt: "BC06" },
      px: [470, 378],
      dx: -40,
      dy: 40,
      cls: "dimmed"
    },
    { key: "BC04", spec: { belt: "BC04" }, px: [612, 372], dx: 34, dy: -46 },
    { key: "MC01", spec: { bunker: "MC01" }, px: [680, 470], dx: -150, dy: 60 },
    { key: "BC03", spec: { belt: "BC03" }, px: [980, 648], dx: -190, dy: 30 },
    {
      key: "MC02",
      spec: { bunker: "MC02" },
      px: [1338, 560],
      dx: 12,
      dy: 40,
      cls: "right"
    },
    { key: "BC02", spec: { belt: "BC02" }, px: [1318, 410], dx: -136, dy: 74 },
    {
      key: "DRV",
      spec: { surface: "driveHouse" },
      px: [1170, 112],
      dx: -140,
      dy: -40,
      cls: "small"
    },
    {
      key: "MC03",
      spec: { surface: "MC03" },
      px: [1410, 120],
      dx: -152,
      dy: -70,
      cls: "right"
    }
  ]

  /** 当前状态下每个标签的文字 */
  function texts(s) {
    const B = s.belts
    const belt = (id) => ({
      code: id,
      name: beltName(id),
      lines: [`${fmt(B[id].v, 2)} m/s · ${fmt(B[id].flowOut)} t/h`],
      pick: id
    })
    const bunker = (id) => ({
      code: id,
      name: bunkerName(id),
      lines: [
        `煤位 ${pct(s.bunkers[id].level)} · ${fmt(s.bunkers[id].tons)} t`
      ],
      pick: id
    })
    const face = s.faces.WF12301
    const PHASE = {
      sump: "斜切进刀",
      cut: "割煤",
      end: "端头作业",
      stop: "停机",
      idle: "未生产",
      support: "支护"
    }
    return {
      WF12301: {
        code: "WF12301",
        name: "综采工作面",
        lines: [
          `${PHASE[face.phase]} · ${fmt(face.output)} t/h · 第 ${face.cutsToday + (face.output > 0 ? 1 : 0)} 刀`
        ],
        pick: "BC05"
      },
      BC05: belt("BC05"),
      BC06: belt("BC06"),
      BC04: {
        code: "BC04",
        name: "运输上山 · 下运",
        lines: [
          `${fmt(B.BC04.v, 2)} m/s · 回馈 ${fmt(Math.max(0, -B.BC04.power))} kW`
        ],
        pick: "BC04"
      },
      MC01: bunker("MC01"),
      BC03: belt("BC03"),
      MC02: bunker("MC02"),
      BC02: {
        code: "BC02",
        name: "主斜井 · 4×1400 kW",
        lines: [`${fmt(B.BC02.v, 2)} m/s · ${fmt(B.BC02.power)} kW`],
        pick: "BC02"
      },
      DRV: { code: "DRV", name: "主斜井驱动机房", lines: [], pick: "BC02" },
      MC03: {
        ...bunker("MC03"),
        lines: [...bunker("MC03").lines, `BC01 栈桥 ${fmt(B.BC01.v, 2)} m/s`]
      }
    }
  }

  // 锚点（三维），场景建好后算一次
  const anchors = {}
  for (const d of DEFS)
    anchors[d.key] = props.scene.anchorNear(d.spec, at(...d.px))

  // 每帧把锚点投影到设计稿像素；镜头不动时不更新（省得每帧触发 Vue 更新）
  const pos = shallowRef({})
  let raf = 0
  let lastKey = ""
  const tmp = new THREE.Vector3()
  const alarmAnchor = (a) => {
    const p = props.scene.beacons.anchor(a.id)
    if (p) return p
    if (a.belt && a.chainage != null && BELTS[a.belt])
      return chainageToPoint(a.belt, a.chainage)
    return null
  }
  function frame() {
    raf = requestAnimationFrame(frame)
    const cam = props.scene.camera
    const key = `${cam.matrixWorld.elements.map((x) => x.toFixed(2)).join()}|${props.scene.unit().toFixed(4)}|${props.f.ms}`
    if (key === lastKey) return
    lastKey = key
    const out = {}
    for (const d of DEFS) {
      const p = anchors[d.key]
      out[d.key] = p ? props.scene.toDesign(tmp.copy(p)) : null
    }
    for (const a of props.f.s.alarms) {
      const p = alarmAnchor(a)
      out[a.id] = p ? props.scene.toDesign(p.clone()) : null
    }
    for (const u of props.f.uwb) {
      const d = layout.devices.find((x) => x.id === u.id)
      if (d?.belt && BELTS[d.belt] && d.chainage != null)
        out[u.id] = props.scene.toDesign(chainageToPoint(d.belt, d.chainage))
    }
    pos.value = out
  }
  onMounted(() => (raf = requestAnimationFrame(frame)))
  onBeforeUnmount(() => cancelAnimationFrame(raf))

  /** 只在三维区里显示（两侧栏之间、指标条以下、底部一张图以上） */
  const inStage = (p) =>
    p && p[0] > 470 && p[0] < 1450 && p[1] > 175 && p[1] < 760

  const shown = computed(() => {
    if (props.quiet) return []
    const tx = texts(props.f.s)
    return DEFS.map((d) => ({
      ...d,
      ...tx[d.key],
      p: pos.value[d.key]
    })).filter((t) => inStage(t.p))
  })

  // 平台预警按严重度排序：第一条出告警卡，第二条出紫色标签
  const predictive = computed(() => {
    const tracks = props.f.s.tracks
    return props.f.s.alarms
      .filter((a) => a.predictive && a.track)
      .map((a) => ({ a, tr: tracks.find((t) => t.id === a.track) }))
      .filter((x) => x.tr)
      .sort((x, y) => y.tr.s - x.tr.s)
  })
  const card = computed(() => {
    const x = predictive.value[0]
    if (!x) return null
    const p = pos.value[x.a.id]
    if (!inStage(p)) return null
    // 该处光纤测温：里程 ±10 m 内的最高温度
    const T = props.w.dts[x.tr.belt]
    const c = Math.round(x.tr.chainage)
    const temp = T ? Math.max(...T.slice(Math.max(0, c - 10), c + 11)) : null
    const fix = props.w.tonight.find((wo) => wo.track === x.tr.id)
    return {
      ...x,
      p,
      // 卡片宽 270：不要伸进右侧栏
      x: Math.min(p[0] + 40, 1450 - 270),
      text: `${x.tr.name} · 严重度 ${pct(x.tr.s)}${temp != null ? ` · 光纤测温 ${fmt(temp, 1)} °C` : ""} · 听诊异响`,
      fix: fix ? `已派单 · 今晚 ${hm(fix.start)} 更换` : x.a.status || "待派单"
    }
  })
  const second = computed(() => {
    const x = predictive.value[1]
    if (!x) return null
    const p = pos.value[x.a.id]
    if (!inStage(p)) return null
    return { ...x, p, code: x.tr.device.replace(/^([A-Z]+\d+)#/, "$1 #") }
  })
  const stale = computed(() =>
    props.f.uwb
      .filter((u) => !u.online && inStage(pos.value[u.id]))
      .map((u) => ({ ...u, p: pos.value[u.id] }))
  )
</script>
