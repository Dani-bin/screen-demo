<!--
  中央场景上的叠加层（坐标都是设计稿场景框 1024 × 529 内的像素）：
  皮带切换条、部件标签（锚点由三维投影实时给出，文字偏移照定稿）、平台预警热点卡片、机器人标签、KPI、图层开关
-->
<template>
  <div class="scene-ui">
    <div class="belt-pick">
      <span>皮带 · 健康</span>
      <a
        v-for="b in d.belts"
        :key="b.id"
        :class="{ on: b.id === d.F.id, off: b.offline }"
        :title="b.id === d.F.id ? '' : '演示版只建了 103 的机头模型'"
      >
        <b>{{ b.id }}</b
        ><small>{{ b.health }}</small>
      </a>
    </div>

    <!-- 部件标签 -->
    <div
      v-for="t in tags"
      v-show="t.a?.visible"
      :key="t.key"
      class="stag part"
      :class="[t.cls, { sel: selected === t.device }]"
      :style="{ left: `${t.a?.x}px`, top: `${t.a?.y}px` }"
      @click="t.device && $emit('pick', t.device)"
    >
      <svg class="ldr"><line x1="0" y1="0" :x2="t.dx" :y2="t.dy" /></svg>
      <span :style="{ transform: `translate(${t.dx}px, ${t.dy}px)` }"
        ><b v-if="t.id">{{ t.id }}</b> {{ t.text }}</span
      >
      <i class="pt"></i>
    </div>

    <!-- 平台预警热点（劣化托辊组，定稿时刻是第 5 组） -->
    <template v-if="hot && layers.alarm">
      <div
        class="hot"
        :class="{ off: hot.off }"
        :style="{ left: `${hot.x}px`, top: `${hot.y}px` }"
      >
        <i class="pulse"></i><i class="pulse p2"></i><i class="core"></i>
        <!-- 热点在画面外（镜头被拖走、飞走时）：钉在画面边缘，箭头指向它的方向 -->
        <em v-if="hot.off" class="hot-arrow">◀ {{ d.dts.hotAt }} m</em>
      </div>
      <svg class="hot-lead">
        <polyline :points="callout.lead" />
      </svg>
      <div
        class="callout"
        :style="{ left: `${callout.x}px`, top: `${callout.y}px` }"
        @click="$emit('alarm')"
      >
        <header>
          <span class="pf-tag">平台预警</span>
          <span class="lv" :class="`l${id35.level}`">{{ LV[id35.level] }}</span>
          <b>第 {{ id35.group }} 组上托辊 · {{ d.dts.hotAt }} m</b>
        </header>
        <p>
          {{ id35.level === 4 ? "听诊异响" : "轴承劣化" }} ·
          <b>{{ fmt(d.dts.peak, 1) }} ℃</b> 差温 +{{
            fmt(Math.max(0, d.dts.diff), 1)
          }}
          ℃ · 听诊 {{ id35.score }} 分
        </p>
        <p class="sub">
          {{ alarm?.status || "跟踪中" }} · {{ id35.steps[3].t }} 更换 · RB01
          {{ d.s.robot.target === d.dts.hotAt ? "红外复核中" : d.s.robot.task }}
        </p>
        <p v-if="hot.off" class="go">在画面外 · 点击飞过去查看</p>
      </div>
    </template>

    <!-- 机器人 -->
    <div
      v-if="anchors.robot?.visible && layers.robot"
      class="stag part"
      :style="{ left: `${anchors.robot.x}px`, top: `${anchors.robot.y}px` }"
    >
      <!-- 偏移照定稿：主机位下标签落在定稿位置 LABEL_AT.robot（锚点按首次投影时机器人的位置算） -->
      <svg class="ldr">
        <line x1="0" y1="0" :x2="rbOff[0]" :y2="rbOff[1]" />
      </svg>
      <span
        class="rb-tag"
        :style="{ transform: `translate(${rbOff[0]}px, ${rbOff[1]}px)` }"
        ><b>RB01</b> 吊轨机器人{{
          d.s.robot.target ? ` → ${d.s.robot.target} m` : ` · ${d.s.robot.task}`
        }}</span
      >
      <i class="pt"></i>
    </div>

    <div class="hud">
      <div v-for="k in hud" :key="k[0]">
        <small>{{ k[0] }}</small>
        <b
          >{{ k[1] }}<u>{{ k[2] }}</u></b
        >
      </div>
    </div>
    <div class="view-tag">
      VIEW / 103 机头驱动部 · 栈桥剖切 · 黄昏 {{ d.s.time.hms.slice(0, 5) }}
    </div>
    <div class="layers">
      <span>图层</span>
      <a
        v-for="l in LAYERS"
        :key="l.key"
        :class="{ on: layers[l.key] }"
        @click="$emit('layer', l.key)"
        >{{ l.name }}</a
      >
    </div>
    <button v-if="moved" class="home-btn" @click="$emit('home')">
      回到主机位
    </button>
  </div>
</template>

<script setup>
  import { fmt, LV } from "./fmt.js"

  const props = defineProps({
    d: { type: Object, required: true },
    anchors: { type: Object, required: true },
    layers: { type: Object, required: true },
    selected: { type: String, default: null },
    moved: { type: Boolean, default: false }
  })
  defineEmits(["pick", "alarm", "layer", "home"])

  const LAYERS = [
    { key: "sensors", name: "测点" },
    { key: "dts", name: "光纤测温" },
    { key: "idlers", name: "托辊健康" },
    { key: "robot", name: "机器人" },
    { key: "people", name: "人员" },
    { key: "alarm", name: "告警" }
  ]

  const id35 = computed(() => props.d.s.idler35)
  const alarm = computed(() => props.d.s.alarms.find((a) => a.platform))
  /**
   * 预警卡片位置：热点在画面里时照定稿放在右上方（引线折一下）；
   * 热点钉在画面边缘时放到箭头右下方，避开顶部的皮带切换条
   */
  const callout = computed(() => {
    const h = hot.value
    if (!h) return { x: 0, y: 0, lead: "" }
    if (h.off)
      return {
        x: h.x + 70,
        y: h.y + 26,
        lead: `${h.x},${h.y} ${h.x + 40},${h.y + 40} ${h.x + 70},${h.y + 40}`
      }
    return {
      x: h.x + 150,
      y: h.y - 70,
      lead: `${h.x},${h.y} ${h.x + 50},${h.y - 40} ${h.x + 150},${h.y - 40}`
    }
  })
  const hot = computed(() =>
    id35.value.level && props.anchors.hot?.visible ? props.anchors.hot : null
  )

  /**
   * 部件标签在定稿场景框里的位置（标签左边缘、垂直居中，设计像素）。
   * 主机位下标签正好落在这里：偏移 = 定稿位置 − 锚点的主机位投影；镜头动了以后保持这个偏移跟着锚点走
   */
  const LABEL_AT = {
    M1: [737, 82],
    M2: [822, 57],
    G2: [828, 372],
    D1: [505, 428],
    chute: [352, 434],
    estop: [26, 413],
    fiber: [93, 292],
    robot: [382, 77]
  }
  /** 机器人标签偏移：定稿位置 − 机器人锚点的主机位投影 */
  const rbOff = computed(() => {
    const h = props.anchors.home?.robot
    return h
      ? [
          Math.round(LABEL_AT.robot[0] - h.x),
          Math.round(LABEL_AT.robot[1] - h.y)
        ]
      : [36, -11]
  })

  /** 部件标签：锚点来自三维投影 */
  const tags = computed(() => {
    const a = props.anchors
    const dr = (id) => props.d.drive.find((x) => x.id === id)
    const tv = (id) => `${dr(id).temp} ℃ · ${fmt(dr(id).vib, 1)} mm/s`
    const list = [
      {
        key: "M1",
        id: "M1",
        device: "BC103-M1",
        text: `电机 · ${tv("M1")}`,
        a: a.M1
      },
      {
        key: "M2",
        id: "M2",
        device: "BC103-M2",
        text: `电机 · ${tv("M2")}`,
        a: a.M2
      },
      {
        key: "G2",
        id: "G2",
        device: "BC103-G2",
        text: `减速机 · ${tv("G2")}`,
        a: a.G2,
        cls: dr("G2").level ? "warn" : ""
      },
      {
        key: "D1",
        id: "D1",
        device: "BC103-D1",
        text: `驱动滚筒 · 轴承 ${dr("D1").temp} ℃`,
        a: a.D1
      },
      {
        key: "chute",
        text: "头部漏斗 · 清扫器",
        a: a.chute,
        cls: "dim"
      },
      {
        key: "estop",
        text: "拉线急停 · 跑偏开关 正常",
        a: a.estop,
        cls: "dim"
      },
      {
        key: "fiber",
        text: "测温 / 听诊光纤 · 沿机架",
        a: a.fiber,
        cls: "dim"
      }
    ]
    for (const t of list) {
      const h = a.home?.[t.key]
      const [lx, ly] = LABEL_AT[t.key]
      t.dx = h ? Math.round(lx - h.x) : 0
      t.dy = h ? Math.round(ly - h.y) : 0
    }
    return props.layers.sensors
      ? list
      : list.filter((t) => !["M1", "M2", "G2", "D1"].includes(t.key))
  })

  const hud = computed(() => {
    const d = props.d
    return [
      ["运量", fmt(d.F.flow), "t/h"],
      ["带速", fmt(d.F.v, 2), "m/s"],
      ["功率", fmt(d.kwTotal), "kW"],
      ["健康指数", d.health, ""],
      ["未结束告警", d.openCount, "条"]
    ]
  })
</script>
