<!--
  智能矿山综合管控平台（West Elk 煤矿，美国科罗拉多州）
  ----------------------------------------------------------
  页面只负责布局与数据转接：
    - 三维沙盘：./scene（不依赖 Vue）。地形用真实数据：USGS 3DEP 激光雷达高程 + NAIP 航拍（public/smart-mine/），
      由 scripts/smart-mine/prepare.py 导出；井下布置为示意（data/layout.json，同一脚本生成）
    - 运行数据：./sim/simulator.js 按矿区当地时间仿真（生产班 / 检修班、采煤机往返、瓦斯浓度），每 3 秒刷新面板
  底部五个专题：综合态势 / 井下透视 / 工业广场 / 通风瓦斯 / 生产运营；
  左下工具条切换显示方式：地表 / 透视 / 剖切（沿在采工作面切开）。
  链接参数：?view=overview|underground|plant|ventilation|production&mode=surface|ghost|section
  设计稿：docs/design/smart-mine/
-->
<template>
  <div ref="pageRef" class="mine-page">
    <canvas ref="canvasRef" class="scene-canvas"></canvas>

    <SceneTags
      v-if="snap && ready"
      :anchors="anchors"
      :set="tagSet"
      :snap="snap"
      :facts="LAYOUT.facts"
      @go="go"
    />

    <MineHead
      v-if="snap"
      :t="snap.time"
      :safe-days="snap.safeDays"
      :people="snap.people.total"
      :shift="snap.shift"
    />

    <Transition name="cols" mode="out-in">
      <div v-if="snap && cols" :key="view" class="cols">
        <div
          v-for="side in ['left', 'right']"
          :key="side"
          class="col"
          :class="side"
        >
          <component
            :is="p.c"
            v-for="(p, i) in cols[side]"
            :key="i"
            v-bind="p.props(snap)"
            :grow="cols.grow && i === cols[side].length - 1"
          />
        </div>
      </div>
    </Transition>

    <div v-if="view === 'plant'" class="caption">
      工业广场近景：由 <b>1 m 激光雷达高程</b> + <b>0.5 m 航拍影像</b>
      直接生成，建筑与设备尚未单独建模（贴在地面上）
    </div>

    <template v-if="ready">
      <SceneToolbar
        :mode="mode"
        :surface-only="view === 'plant'"
        @mode="setMode"
        @reset="scene?.resetCamera()"
      />
      <SceneLegend :set="tagSet" :class="{ wide: !cols }" />
      <div v-if="north !== null" class="compass">
        <div class="rose" :style="{ transform: `rotate(${north}deg)` }">
          <b>N</b><i></i>
        </div>
      </div>
    </template>

    <nav class="tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        :class="{ on: t.key === view }"
        :disabled="!ready"
        @click="go(t.key)"
      >
        {{ t.name }}
      </button>
    </nav>
    <div class="credit">
      地形：USGS 3DEP 激光雷达 DEM · 影像：USDA NAIP 航拍 · 地层：USGS /
      科罗拉多地调局资料 · 井下布置与运行数据为演示 · 拖动旋转、滚轮缩放
    </div>

    <div v-if="loading" class="scene-loading">{{ loadingText }}</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { MineScene } from "./scene/MineScene"
  import { VIEWS } from "./scene/theme"
  import { Simulator } from "./sim/simulator"
  import LAYOUT from "./data/layout.json"
  import MineHead from "./components/MineHead.vue"
  import SceneTags from "./components/SceneTags.vue"
  import SceneLegend from "./components/SceneLegend.vue"
  import SceneToolbar from "./components/SceneToolbar.vue"
  import ProfilePanel from "./components/ProfilePanel.vue"
  import ProductionPanel from "./components/ProductionPanel.vue"
  import FlowPanel from "./components/FlowPanel.vue"
  import SafetyPanel from "./components/SafetyPanel.vue"
  import DrainagePanel from "./components/DrainagePanel.vue"
  import AlarmPanel from "./components/AlarmPanel.vue"
  import FacePanel from "./components/FacePanel.vue"
  import StrataPanel from "./components/StrataPanel.vue"
  import SuccessionPanel from "./components/SuccessionPanel.vue"
  import VentPanel from "./components/VentPanel.vue"
  import GasPanel from "./components/GasPanel.vue"
  import PeoplePanel from "./components/PeoplePanel.vue"

  /** 面板刷新间隔（毫秒） */
  const REFRESH = 3000

  const TABS = [
    { key: "overview", name: "综合态势" },
    { key: "underground", name: "井下透视" },
    { key: "plant", name: "工业广场" },
    { key: "ventilation", name: "通风瓦斯" },
    { key: "production", name: "生产运营" }
  ]

  // 各专题两侧的面板：每项是组件 + 从快照取 props 的函数；每列最后一块撑满剩余高度
  const ACTIVE = LAYOUT.panels.find((p) => p.status === "active")
  const faceLen = Math.round(ACTIVE.rect[3] - ACTIVE.rect[1])
  const P = {
    profile: { c: ProfilePanel, props: () => ({}) },
    production: {
      c: ProductionPanel,
      props: (s) => ({ p: s.production, hm: s.time.hm })
    },
    flow: { c: FlowPanel, props: (s) => ({ f: s.flow }) },
    safety: {
      c: SafetyPanel,
      props: (s) => ({ g: s.gas, vent: s.vent, online: s.sensorsOnline })
    },
    drainage: { c: DrainagePanel, props: (s) => ({ d: s.drainage, g: s.gas }) },
    alarm: { c: AlarmPanel, props: (s) => ({ alarms: s.alarms }) },
    face: { c: FacePanel, props: (s) => ({ f: s.face, faceLen }) },
    strata: { c: StrataPanel, props: () => ({ layout: LAYOUT }) },
    succession: { c: SuccessionPanel, props: (s) => ({ list: s.succession }) },
    vent: { c: VentPanel, props: (s) => ({ v: s.vent }) },
    gas: { c: GasPanel, props: (s) => ({ g: s.gas }) },
    people: { c: PeoplePanel, props: (s) => ({ p: s.people }) }
  }
  const COLUMNS = {
    // grow：三块面板的列让最后一块撑满；两块的专题按内容高度排，下方露出场景
    overview: {
      grow: true,
      left: [P.profile, P.production, P.flow],
      right: [P.safety, P.drainage, P.alarm]
    },
    underground: {
      grow: true,
      left: [P.face, P.strata, P.succession],
      right: [P.vent, P.gas, P.people]
    },
    ventilation: { left: [P.vent, P.drainage], right: [P.gas, P.alarm] },
    production: { left: [P.production, P.succession], right: [P.flow, P.face] },
    plant: null
  }

  const route = useRoute()
  const router = useRouter()

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const loading = ref(true)
  const loadingText = ref("地形数据加载中")
  const error = ref("")
  const ready = ref(false)
  const view = ref(VIEWS[route.query.view] ? route.query.view : "overview")
  const mode = ref(VIEWS[view.value].mode)
  /** 面板数据快照：整体替换，不需要深层响应 */
  const snap = shallowRef(null)
  /** 标注锚点（设计稿坐标），场景每帧回调 */
  const anchors = shallowRef(null)
  const scene = shallowRef(null)

  const cols = computed(() => COLUMNS[view.value])
  const tagSet = computed(() => {
    if (view.value === "plant") return "plant"
    if (view.value === "ventilation" && mode.value === "ghost") return "vent"
    return mode.value
  })
  /** 指北针角度：底面上向北 1 km 的两点在屏幕上的方向 */
  const north = computed(() => {
    const a = anchors.value?.n0
    const b = anchors.value?.n1
    if (!a || !b) return null
    return (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI
  })

  let sim = null
  let timer = 0
  let alive = true

  function syncQuery() {
    const query = { ...route.query, view: view.value }
    if (mode.value !== VIEWS[view.value].mode) query.mode = mode.value
    else delete query.mode
    router.replace({ query })
  }

  /** 切专题：显示方式回到该专题的默认值 */
  function go(key) {
    if (!VIEWS[key] || !scene.value) return
    view.value = key
    mode.value = VIEWS[key].mode
    scene.value.setView(key)
    syncQuery()
  }

  function setMode(m) {
    if (!scene.value || m === mode.value) return
    mode.value = m
    scene.value.setMode(m)
    syncQuery()
  }

  function hasWebGL() {
    const c = document.createElement("canvas")
    const gl = c.getContext("webgl2")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    return Boolean(gl)
  }

  onMounted(async () => {
    // 仿真先跑起来：面板不依赖三维，WebGL 不可用时照常显示
    sim = new Simulator()
    snap.value = sim.snapshot()
    timer = setInterval(() => (snap.value = sim.snapshot()), REFRESH)

    if (!hasWebGL()) {
      error.value = "当前浏览器不支持三维展示（需要 WebGL 2）"
      loading.value = false
      return
    }
    await nextTick()
    if (!alive) return
    try {
      const s = new MineScene({
        canvas: canvasRef.value,
        container: pageRef.value,
        sim,
        baseUrl: import.meta.env.BASE_URL,
        onAnchors: (a) => (anchors.value = a),
        onBusy: (b) => {
          loadingText.value = "近景高程与影像加载中"
          loading.value = b
        }
      })
      await s.load()
      if (!alive) return s.dispose()
      scene.value = s
      ready.value = true
      // 链接里带了专题 / 显示方式就直接进入
      if (view.value !== "overview") await s.setView(view.value)
      const m = route.query.mode
      if (
        ["surface", "ghost", "section"].includes(m) &&
        view.value !== "plant"
      ) {
        mode.value = m
        s.setMode(m)
      }
    } catch (err) {
      console.error(err)
      error.value = "地形数据加载失败"
    }
    if (!alive) return
    requestAnimationFrame(() => (loading.value = false))
  })

  onUnmounted(() => {
    alive = false
    clearInterval(timer)
    sim?.dispose()
    scene.value?.dispose()
    scene.value = null
  })
</script>

<style lang="scss">
  /*
   * 页面级共用样式（不加 scoped，统一挂在 .mine-page 下）：面板外框、标题栏、指标格、监测卡片网格——
   * 各面板组件直接使用这些类名
   */
  .mine-page {
    --cyan: #36e0ff;
    --text: #e6f0ff;
    --sub: #8ea6c8;
    --dim: #5d7393;

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: "Source Han Sans CN", sans-serif;
    font-size: 14px;
    color: var(--text);
    background: #030912;

    .num {
      font-family: "DIN", sans-serif;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.5px;
    }

    .panel {
      position: relative;
      padding: 12px 16px 14px;
      border: 1px solid rgba(70, 160, 255, 0.24);
      border-radius: 4px;
      background: rgba(5, 14, 30, 0.74);
      backdrop-filter: blur(6px);
      box-shadow: inset 0 0 24px rgba(30, 110, 220, 0.12);
      pointer-events: auto;

      &.grow {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      // 左上、右下两个青色角标
      &::before,
      &::after {
        content: "";
        position: absolute;
        width: 10px;
        height: 10px;
        border: 2px solid var(--cyan);
        opacity: 0.8;
      }

      &::before {
        left: -1px;
        top: -1px;
        border-right: 0;
        border-bottom: 0;
      }

      &::after {
        right: -1px;
        bottom: -1px;
        border-left: 0;
        border-top: 0;
      }

      h3 {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 30px;
        margin: 0 0 10px;
        padding-left: 6px;
        font-family: "Alimama ShuHeiTi", sans-serif;
        font-size: 19px;
        font-weight: normal;
        letter-spacing: 1px;
        border-left: 3px solid var(--cyan);
        background: linear-gradient(
          90deg,
          rgba(54, 160, 255, 0.28),
          rgba(54, 160, 255, 0) 70%
        );

        small {
          margin-left: auto;
          font-family: "Source Han Sans CN", sans-serif;
          font-size: 13px;
          letter-spacing: 0;
          color: var(--sub);

          b {
            font-weight: normal;
            color: var(--text);
          }
        }
      }

      .cap {
        margin: 8px 0 2px;
        font-size: 13px;
        color: var(--sub);
      }
    }

    .kpis {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .kpi {
      padding: 7px 10px 6px;
      border: 1px solid rgba(80, 160, 255, 0.18);
      border-radius: 3px;
      background: linear-gradient(
        180deg,
        rgba(40, 110, 200, 0.2),
        rgba(40, 110, 200, 0.05)
      );

      span {
        display: block;
        font-size: 13px;
        color: var(--sub);
      }

      b {
        font-size: 26px;
        font-weight: normal;
        line-height: 32px;
      }

      i {
        margin-left: 3px;
        font-size: 12px;
        font-style: normal;
        color: var(--sub);
      }
    }

    .sensors {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
  }
</style>

<style lang="scss" scoped>
  .scene-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .col {
    position: absolute;
    top: 96px;
    bottom: 92px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 404px;

    &.left {
      left: 22px;
    }

    &.right {
      right: 22px;
    }
  }

  /* 专题切换：两侧面板向外滑出、滑回 */
  .cols-enter-active,
  .cols-leave-active {
    transition: opacity 0.35s;

    .col {
      transition: transform 0.35s;
    }
  }

  .cols-enter-from,
  .cols-leave-to {
    opacity: 0;

    .left {
      transform: translateX(-40px);
    }

    .right {
      transform: translateX(40px);
    }
  }

  .tabs {
    position: absolute;
    left: 50%;
    bottom: 26px;
    z-index: 5;
    display: flex;
    gap: 10px;
    transform: translateX(-50%);

    button {
      width: 132px;
      height: 42px;
      padding: 0;
      font-family: inherit;
      font-size: 17px;
      color: var(--sub);
      border: 1px solid rgba(80, 160, 255, 0.3);
      background: linear-gradient(
        180deg,
        rgba(20, 60, 120, 0.5),
        rgba(10, 30, 60, 0.6)
      );
      clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
      cursor: pointer;
      transition: color 0.2s;

      &:hover:not(:disabled) {
        color: #fff;
      }

      &.on {
        color: #fff;
        border-color: var(--cyan);
        background: linear-gradient(
          180deg,
          rgba(54, 224, 255, 0.55),
          rgba(30, 110, 220, 0.5)
        );
        text-shadow: 0 0 8px rgba(54, 224, 255, 0.8);
      }

      &:disabled {
        cursor: default;
      }
    }
  }

  /* 底部渐暗，托住专题标签 */
  .mine-page::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    height: 92px;
    pointer-events: none;
    background: linear-gradient(0deg, rgba(2, 8, 20, 0.9), rgba(2, 8, 20, 0));
  }

  .credit {
    position: absolute;
    left: 24px;
    bottom: 10px;
    z-index: 5;
    font-size: 12px;
    color: var(--dim);
    pointer-events: none;
  }

  .caption {
    position: absolute;
    left: 50%;
    bottom: 90px;
    z-index: 4;
    padding: 8px 18px;
    font-size: 15px;
    color: var(--sub);
    white-space: nowrap;
    border: 1px solid rgba(80, 160, 255, 0.25);
    border-radius: 3px;
    background: rgba(3, 10, 22, 0.72);
    transform: translateX(-50%);
    pointer-events: none;

    b {
      font-weight: normal;
      color: var(--text);
    }
  }

  /* 没有两侧面板时（工业广场），图例与工具条靠边 */
  .legend.wide {
    right: 24px;
  }

  .compass {
    position: absolute;
    left: 446px;
    top: 108px;
    z-index: 4;
    width: 56px;
    height: 56px;
    border: 1px solid rgba(80, 160, 255, 0.35);
    border-radius: 50%;
    background: rgba(3, 10, 22, 0.6);
    pointer-events: none;

    .rose {
      position: absolute;
      inset: 0;
    }

    b {
      position: absolute;
      left: 50%;
      top: 3px;
      font-family: "DIN", sans-serif;
      font-size: 13px;
      font-weight: normal;
      color: #ff5a5f;
      transform: translateX(-50%);
    }

    i {
      position: absolute;
      left: 50%;
      top: 20px;
      width: 0;
      height: 0;
      margin-left: -6px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 18px solid #ff5a5f;
    }
  }

  .scene-loading,
  .scene-error {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    letter-spacing: 3px;
    color: var(--cyan);
    pointer-events: none;
  }

  .scene-error {
    color: #ff4d5a;
  }
</style>
