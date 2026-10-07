<!--
  智慧充电站（光储充一体化超充站）数字孪生大屏
  ----------------------------------------------------------
  页面只负责布局与数据转接：
    - 三维场站：./scene（加载 Blender 导出的 public/charging/*.glb，不依赖 Vue）
    - 运行数据：./sim/simulator.js 按真实时刻仿真（车辆进出、充放电、告警），每 5 秒刷新一次面板
  模型源文件与构建脚本：models/charging/station.blend、scripts/blender/charging/
-->
<template>
  <div ref="pageRef" class="charging-page">
    <canvas ref="canvasRef" class="scene-canvas"></canvas>

    <!-- 四个能量节点 + 指向场站设备的连线（随镜头实时跟随） -->
    <EnergyNodes
      v-if="snap"
      :anchors="anchors"
      :power="snap.power"
      :ess="snap.ess"
    />

    <ChargingHead
      :now="now"
      :period="snap?.period"
      :price="snap?.price"
      :service-fee="snap?.serviceFee"
      :urgent="snap?.alarmCount[0] || 0"
    />

    <template v-if="snap">
      <div class="col col-left">
        <EnergyOverview :snap="snap" />
        <PvPanel :pv="snap.pv" :trend="pvTrend" :hour="hour" />
        <EssPanel :ess="snap.ess" />
      </div>
      <div class="col col-right">
        <OpsPanel :piles="snap.piles" :today="snap.today" />
        <PowerPanel :power="snap.power" />
        <AlarmPanel :alarms="snap.alarms" :count="snap.alarmCount" />
      </div>
      <div class="bottom-row">
        <TrendPanel :trend="trend" :hour="hour" />
        <DevicePanel :piles="snap.piles" />
      </div>
    </template>

    <PileCard
      v-if="picked && snap"
      :pick="picked"
      :sim="sim"
      :tick="tick"
      @close="picked = null"
    />

    <div class="bottom-tip">
      提示：点击充电桩查看实时详情 ·
      拖动旋转、滚轮缩放&nbsp;&nbsp;|&nbsp;&nbsp;数据每 5
      秒刷新一次（运行数据为仿真）
    </div>

    <!-- 外部模型署名（CC BY / CC BY-NC-SA 要求），悬停显示完整出处 -->
    <div class="model-credits" :title="creditsDetail">
      模型 · {{ creditsAuthors }}（Sketchfab，CC BY / BY-NC-SA 4.0）
    </div>

    <div v-if="loading" class="scene-loading">场站模型加载中</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { ChargingScene } from "./scene/ChargingScene"
  import { Simulator } from "./sim/simulator"
  import { MODEL_CREDITS } from "./data/station"
  import ChargingHead from "./components/ChargingHead.vue"
  import EnergyOverview from "./components/EnergyOverview.vue"
  import PvPanel from "./components/PvPanel.vue"
  import EssPanel from "./components/EssPanel.vue"
  import OpsPanel from "./components/OpsPanel.vue"
  import PowerPanel from "./components/PowerPanel.vue"
  import AlarmPanel from "./components/AlarmPanel.vue"
  import TrendPanel from "./components/TrendPanel.vue"
  import DevicePanel from "./components/DevicePanel.vue"
  import EnergyNodes from "./components/EnergyNodes.vue"
  import PileCard from "./components/PileCard.vue"

  /** 面板刷新间隔（毫秒） */
  const REFRESH = 5000

  /** 署名：作者去重后一行显示，完整出处放在悬停提示里 */
  const creditsAuthors = [...new Set(MODEL_CREDITS.map((c) => c.author))].join(
    " · "
  )
  const creditsDetail = MODEL_CREDITS.map(
    (c) => `"${c.title}" by ${c.author}, ${c.license} — ${c.url}`
  ).join("\n")

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const loading = ref(true)
  const error = ref("")

  /** 面板数据快照：整体替换，不需要深层响应 */
  const snap = shallowRef(null)
  const trend = shallowRef(null)
  const pvTrend = shallowRef(null)
  /** 每秒更新的时钟与当前小时（趋势图游标） */
  const now = ref(new Date())
  const hour = computed(
    () => now.value.getHours() + now.value.getMinutes() / 60
  )
  /** 能量节点锚点（设计稿坐标），场景每帧回调 */
  const anchors = shallowRef(null)
  /** 点击选中的桩：{ pile, x, y } */
  const picked = ref(null)
  /** 每秒自增，供桩详情浮窗刷新实时数据 */
  const tick = ref(0)

  let sim = null
  let scene = null
  let timers = []
  let alive = true

  function refresh() {
    snap.value = sim.snapshot()
  }

  function hasWebGL() {
    const c = document.createElement("canvas")
    const gl = c.getContext("webgl2") || c.getContext("webgl")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    return Boolean(gl)
  }

  onMounted(async () => {
    // 仿真先跑起来：面板不依赖三维，WebGL 不可用时照常显示
    sim = new Simulator({
      onGun: (g) => scene?.updateGun(g)
    })
    sim.start()
    trend.value = sim.trend()
    pvTrend.value = sim.pvTrend()
    refresh()
    timers.push(setInterval(refresh, REFRESH))
    timers.push(
      setInterval(() => {
        now.value = new Date()
        tick.value++
      }, 1000)
    )

    if (!hasWebGL()) {
      error.value = "当前浏览器不支持三维展示"
      loading.value = false
      return
    }
    await nextTick()
    if (!alive) return
    try {
      scene = new ChargingScene({
        canvas: canvasRef.value,
        container: pageRef.value,
        sim,
        baseUrl: import.meta.env.BASE_URL,
        onPick: (p) => (picked.value = p),
        onAnchors: (a) => (anchors.value = a)
      })
      await scene.load()
    } catch (err) {
      console.error(err)
      error.value = "场站模型加载失败"
    }
    if (!alive) return
    requestAnimationFrame(() => (loading.value = false))
  })

  onUnmounted(() => {
    alive = false
    timers.forEach(clearInterval)
    timers = []
    sim?.dispose()
    scene?.dispose()
    scene = null
  })
</script>

<style lang="scss">
  /*
   * 页面级共用样式（不加 scoped，统一挂在 .charging-page 下，避免影响其他演示）：
   * 面板外框、标题栏、两列指标行、底部统计条——各面板组件直接使用这些类名
   */
  .charging-page {
    --pv: #f5c242;
    --ess: #34e07a;
    --grid: #ff9f43;
    --load: #2f9bff;
    --cyan: #2de2e6;
    --red: #ff3b47;
    --text: #e2ecf8;
    --muted: #8aa0bd;
    --line: rgba(74, 144, 226, 0.32);

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--text);
    font-family: "Source Han Sans CN", sans-serif;
    font-size: 14px;
    background: #040a15;

    .num {
      font-family: "DIN", sans-serif;
      font-variant-numeric: tabular-nums;
    }

    .panel {
      position: relative;
      padding: 0 16px 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: linear-gradient(
        180deg,
        rgba(14, 34, 66, 0.88),
        rgba(8, 22, 46, 0.86)
      );
      box-shadow: inset 0 0 24px rgba(40, 120, 255, 0.08);
      pointer-events: auto;
    }

    .ptitle {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 44px;
      margin: 0 -16px 12px;
      padding: 0 16px;
      border-bottom: 1px solid rgba(74, 144, 226, 0.18);
      color: var(--cyan);

      svg {
        width: 20px;
        height: 20px;
      }

      h3 {
        margin: 0;
        font-size: 18px;
        font-weight: bold;
        letter-spacing: 1px;
        color: #fff;
      }

      .more {
        margin-left: auto;
        font-weight: bold;
        letter-spacing: 2px;
        color: var(--muted);
      }

      .unit {
        margin-left: auto;
        font-size: 12px;
        color: var(--muted);
      }
    }

    .row2 {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    /* 指标行：图标 + 名称 + 数值（+ 占比） */
    .rows {
      flex: 1;
      display: grid;
      gap: 8px;

      .r {
        display: grid;
        grid-template-columns: 18px 1fr auto;
        align-items: center;
        gap: 6px;
        font-size: 13.5px;

        &.p4 {
          grid-template-columns: 18px 1fr auto 52px;
        }

        svg {
          width: 16px;
          height: 16px;
        }

        .v {
          font-family: "DIN", sans-serif;
          font-size: 16px;
          color: #fff;
          text-align: right;

          small {
            margin-left: 3px;
            font-family: "Source Han Sans CN", sans-serif;
            font-size: 11px;
            color: var(--muted);
          }
        }

        .p {
          font-family: "DIN", sans-serif;
          text-align: right;
        }
      }
    }

    /* 底部统计条：3 或 4 格 */
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      margin-top: 12px;
      border-radius: 4px;
      background: rgba(40, 90, 160, 0.12);

      &.s4 {
        grid-template-columns: repeat(4, 1fr);
      }

      > div {
        position: relative;
        padding: 8px 0 7px;
        text-align: center;
      }

      > div + div::before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 1px;
        background: rgba(74, 144, 226, 0.2);
      }

      span {
        display: block;
        font-size: 12px;
        color: var(--muted);
      }

      b {
        font-family: "DIN", sans-serif;
        font-size: 19px;
        font-weight: normal;
        color: #fff;

        small {
          margin-left: 2px;
          font-family: "Source Han Sans CN", sans-serif;
          font-size: 11px;
          color: var(--muted);
        }
      }
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
    top: 72px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 422px;
  }

  .col-left {
    left: 20px;
  }

  .col-right {
    right: 20px;
  }

  .bottom-row {
    position: absolute;
    left: 20px;
    right: 20px;
    bottom: 30px;
    z-index: 4;
    display: flex;
    gap: 14px;
    height: 166px;
  }

  .bottom-tip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 7px;
    z-index: 4;
    text-align: center;
    font-size: 12px;
    letter-spacing: 1px;
    color: rgba(138, 160, 189, 0.7);
    pointer-events: none;
  }

  .model-credits {
    position: absolute;
    right: 24px;
    bottom: 7px;
    z-index: 4;
    font-size: 11px;
    color: rgba(138, 160, 189, 0.45);
    cursor: default;
  }

  .scene-loading,
  .scene-error {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    letter-spacing: 3px;
    color: var(--cyan);
    pointer-events: none;
  }

  .scene-error {
    color: var(--red);
  }
</style>
