<!--
  场景标签：跟随三维锚点（井筒、硐室、火点、避难硐室、避灾路线、未响应人员、盘区名）
  ----------------------------------------------------------
  位置 = 锚点投影 + 偏移。偏移在主机位下算：让主机位时每个标签正好落在定稿里画的位置（DESIGN 表），
  镜头拉近 / 转动后标签跟着锚点走。坐标都换算成设计稿像素（舞台 1920 × 1080），再用 rem 定位。
-->
<template>
  <div class="tags">
    <svg class="leaders" viewBox="0 0 1920 1080" preserveAspectRatio="none">
      <line
        v-for="l in lines"
        :key="l.k"
        :class="l.cls"
        :x1="l.a[0]"
        :y1="l.a[1]"
        :x2="l.b[0]"
        :y2="l.b[1]"
      />
    </svg>

    <div v-for="z in pos.zones" :key="z.name" class="zone" :style="at(z.p)">
      {{ z.name }}
    </div>

    <div v-for="s in pos.shafts" :key="s.id" class="shaft" :style="at(s.p)">
      <b>{{ s.label }}</b>
    </div>

    <!-- 硐室标签（DS-04 起火 / 预警 / 复位时换成火点卡） -->
    <template v-for="c in pos.chambers" :key="c.id">
      <i class="anc-pt" :class="c.cls" :style="at(c.a)"></i>
      <div
        class="tg pick"
        :class="c.cls"
        :style="center(c.p)"
        @click="$emit('select', c.id)"
      >
        <span class="code">{{ c.id }}</span
        >{{ c.name }}<i class="dot" :class="c.dot"></i
        ><small>{{ c.txt }}</small>
      </div>
    </template>

    <template v-for="r in pos.refuges" :key="r.id">
      <i class="anc-pt rf" :style="at(r.a)"></i>
      <div
        class="tg rf pick"
        :style="center(r.p)"
        @click="$emit('refuge', r.id)"
      >
        <span class="code">{{ r.id }}</span
        >{{ r.name
        }}<small
          >在避 {{ r.inside }}{{ r.coming ? ` · 途中 ${r.coming}` : "" }} /
          {{ r.cap }}</small
        >
      </div>
    </template>

    <template v-if="st.scene.routes">
      <div v-for="r in pos.routes" :key="r.id" class="rlab" :style="at(r.p)">
        <span class="code">{{ r.id }}</span
        ><Ic :name="r.id === 'R1' ? 'up' : 'down'" />{{ r.side }}
        {{ r.total }} 人<small style="color: var(--text-3)">{{ r.note }}</small>
      </div>
    </template>

    <i v-for="(p, i) in pos.lost" :key="'l' + i" class="lostpt" :style="at(p)"
      ><Ic name="user"
    /></i>
    <div v-if="pos.lostTag" class="tg lost" :style="at(pos.lostTag)">
      <Ic name="alert" :size="14" />未响应 {{ st.people.lost }} 人<small
        style="color: #f3c4c0"
        >{{
          st.people.lostList
            .map((l) => `${l.card} 静止 ${l.still}s`)
            .join(" · ")
        }}</small
      >
    </div>

    <!-- 火点卡 -->
    <template v-if="pos.fire">
      <div class="firept" :class="fcls" :style="at(pos.fire.a)"></div>
      <div
        class="firecard pick"
        :class="fcls"
        :style="at(pos.fire.p)"
        @click="$emit('select', 'DS-04')"
      >
        <h4>
          <Ic
            :name="
              st.phase === 'warn'
                ? 'alert'
                : st.phase === 'reset'
                  ? 'reset'
                  : 'flame'
            "
            :size="16"
          />{{ ds.name }}<span class="code">{{ ds.id }}</span>
        </h4>
        <template v-if="st.phase === 'warn'">
          <div class="fc-row">
            <span>{{ st.fire.zone }} · 一级预警</span
            ><b>{{ st.fire.warnAt }}</b>
          </div>
          <div class="fc-row">
            <span>光纤最高温</span><b>{{ ds.read.dts.toFixed(1) }} ℃ ↑</b>
          </div>
          <div class="fc-row">
            <span>CO</span><b>{{ Math.round(ds.read.co) }} ppm</b>
          </div>
          <div class="fc-row"><span>判定</span><b>单一类型 · 不联动</b></div>
        </template>
        <template v-else>
          <div class="fc-row">
            <span>{{ st.fire.zone }} · {{ st.fire.combo }}确认</span
            ><b>{{ st.fire.confirmAt }}</b>
          </div>
          <div class="fc-row">
            <span>光纤最高温</span
            ><b>{{ ds.read.dts.toFixed(1) }} ℃ {{ trendArrow() }}</b>
          </div>
          <div class="fc-row">
            <span>CO</span
            ><b>{{ Math.round(ds.read.co) }} ppm {{ trendArrow() }}</b>
          </div>
          <div class="fc-row">
            <span>全氟己酮装置</span
            ><b>{{
              st.phase === "countdown"
                ? `延时 ${st.fire.countdown} s`
                : `已喷放 ${st.units.sprayed}/${st.fire.zoneUnits}`
            }}</b>
          </div>
          <div class="fc-row">
            <span>高压馈电 / 防火阀</span
            ><b>{{ st.phase === "reset" ? "已复位" : "已切断 / 已关闭" }}</b>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
  import * as THREE from "three"
  import Ic from "./Ic.vue"

  const props = defineProps({
    scene: Object,
    st: Object,
    sim: Object,
    unit: Function,
    origin: Function
  })
  defineEmits(["select", "refuge"])

  const ds = computed(() =>
    props.st.chambers.find((c) => c.id === props.st.fire.ds)
  )
  const fcls = computed(
    () => ({ warn: "warn", reset: "reset" })[props.st.phase] || ""
  )

  // 定稿里各标签的位置（设计稿像素）：标签卡 = 中心点，路线 / 未响应 / 火点卡 = 左上角，井筒名 = 底边中点
  const DESIGN = {
    "DS-01": [786, 338],
    "DS-02": [800, 262],
    "DS-03": [1084, 300],
    "DS-04": [800, 470],
    "RC-01": [1046, 738],
    "RC-02": [1124, 428],
    R1: [949.2, 458.2],
    R2: [913.2, 604],
    lostTag: [560, 646],
    fire: [458, 372],
    "SH-1": [890.7, 230.5],
    // 井筒按 CAD 分开后右井更靠右，标签往右挪 30 px，免得井筒竖线穿过"副井"两个字
    "SH-2": [1006.5, 230.5],
    一盘区: [744, 451],
    二盘区: [1266, 298],
    三盘区: [582, 586],
    四盘区: [1437, 460]
  }
  const SHAFT_LABEL = { "SH-1": "主井", "SH-2": "副井 · 安全出口" }
  // 离开主机位（拉近、拖动）后标签改贴着锚点放：相对锚点的默认偏移（设计稿像素）
  const NEAR = {
    chamber: [0, -46],
    refuge: [0, -42],
    route: [18, -12],
    lostTag: [-310, 18],
    fire: [-290, -160],
    shaft: [0, -8],
    zone: [0, 0]
  }
  // 主机位权重：1 = 按定稿位置，0 = 贴着锚点；镜头切换时平滑过渡，标签不会一下跳走
  let homeW = 1

  const rem = (v) => `${v / 192}rem`
  const at = (p) =>
    p ? { left: rem(p[0]), top: rem(p[1]) } : { display: "none" }
  const center = (p) =>
    p
      ? { left: rem(p[0]), top: rem(p[1]), transform: "translate(-50%, -50%)" }
      : { display: "none" }

  const pos = shallowRef({
    zones: [],
    shafts: [],
    chambers: [],
    refuges: [],
    routes: [],
    lost: []
  })
  const lines = shallowRef([])

  // 定稿那一刻（14:06:18）第一名未响应人员的位置：未响应标签的偏移按它算
  let lostDesign = null
  function lostAnchorDesign() {
    if (lostDesign) return lostDesign
    const buf = new Float32Array(props.sim.count * 3)
    const n = props.sim.peopleAt(378, buf)
    for (let i = 0; i < n; i++)
      if (buf[i * 3 + 2] === 2) {
        lostDesign = new THREE.Vector3(buf[i * 3], 0, -buf[i * 3 + 1])
        break
      }
    return lostDesign
  }

  /** 光纤、CO 的走向：喷放前在升、之后在降 */
  function trendArrow() {
    return props.st.s < 268 ? "↑" : "↓"
  }

  /** 每帧：投影锚点 → 设计稿像素，加上主机位偏移 */
  function update() {
    const sc = props.scene
    if (!sc) return
    const u = props.unit()
    const [ox, oy] = props.origin()
    const toD = (p) => (p ? [(p[0] - ox) / u, (p[1] - oy) / u] : null)
    const P = (v) => toD(sc.project(v))
    const H = (v) => toD(sc.projectHome(v))
    homeW += ((sc.mode === "home" ? 1 : 0) - homeW) * 0.12
    // 标签位置：当前投影 + 主机位权重 ×（定稿位置 - 主机位投影）+ (1 - 权重) × 贴锚点偏移
    const place = (v, key, near) => {
      const p = P(v)
      const h = H(v)
      const d = DESIGN[key]
      if (!p || !h || !d) return p
      return [
        p[0] + homeW * (d[0] - h[0]) + (1 - homeW) * near[0],
        p[1] + homeW * (d[1] - h[1]) + (1 - homeW) * near[1]
      ]
    }
    const a = sc.anchors()
    const st = props.st
    const L = []

    const zones = a.zones.map((z) => ({
      name: z.name,
      p: place(z.p, z.name, NEAR.zone)
    }))
    const shafts = a.shafts.map((s) => ({
      id: s.id,
      label: SHAFT_LABEL[s.id],
      p: place(s.top, s.id, NEAR.shaft)
    }))

    const chambers = []
    for (const c of st.chambers) {
      // DS-04 预警 / 起火 / 复位时由火点卡代替
      if (c.id === "DS-04" && st.phase !== "normal") continue
      const v = a.chambers[c.id]
      const p = place(v, c.id, NEAR.chamber)
      const an = P(v)
      if (!p || !an) continue
      const fault = c.state === "fault"
      L.push({ k: c.id, a: an, b: p, cls: fault ? "fault" : "" })
      chambers.push({
        id: c.id,
        name: c.name,
        a: an,
        p,
        cls: fault ? "fault" : "",
        dot: { ok: "ok", fault: "fault", off: "off" }[c.state] || "ok",
        txt:
          c.state === "fault"
            ? `装置故障 ${c.fault}`
            : c.state === "off"
              ? `离线 ${c.off}`
              : "正常"
      })
    }

    const refuges = st.refuges.map((r) => {
      const v = a.refuges[r.id]
      const an = P(v)
      const p = place(v, r.id, NEAR.refuge)
      if (an && p) L.push({ k: r.id, a: an, b: p, cls: "rf" })
      return { ...r, a: an, p }
    })

    const routes = st.people.routes.map((r) => ({
      ...r,
      p: place(a.routes[r.id], r.id, NEAR.route)
    }))

    const lost = a.lost.map((v) => P(v)).filter(Boolean)
    let lostTag = null
    if (lost.length) {
      const ld = lostAnchorDesign()
      const h = ld && H(ld)
      const d = DESIGN.lostTag
      const p0 = P(a.lost[0])
      const n = NEAR.lostTag
      lostTag =
        h && p0
          ? [
              p0[0] + homeW * (d[0] - h[0]) + (1 - homeW) * n[0],
              p0[1] + homeW * (d[1] - h[1]) + (1 - homeW) * n[1]
            ]
          : null
    }

    let fire = null
    if (st.phase !== "normal") {
      const an = P(a.fire)
      const p = place(a.fire, "fire", NEAR.fire)
      if (an && p) {
        fire = { a: an, p }
        // 引线：火点卡右侧中部 → 火点
        L.push({
          k: "fire",
          a: [p[0] + 236, p[1] + 96],
          b: an,
          cls:
            st.phase === "warn" ? "warn" : st.phase === "reset" ? "rf" : "fire"
        })
      }
    }
    pos.value = {
      zones,
      shafts,
      chambers,
      refuges,
      routes,
      lost,
      lostTag,
      fire
    }
    lines.value = L
  }

  // 订阅场景的每帧回调，卸载时取消
  let off = null
  onMounted(() => {
    off = props.scene.addFrameListener(update)
  })
  onBeforeUnmount(() => {
    off?.()
  })
</script>
