<!--
  综合能源补给站（油 / 气 / 电 / 换电）数字孪生大屏
  ----------------------------------------------------------
  页面只负责布局与数据转接：
    - 三维场站：./scene（加载 Blender 导出的 public/energy/*.glb，不依赖 Vue）；
      进入页面先播放「现状航拍 → 规划」开场动画，顶栏「规划回顾」可重播
    - 运行数据：./sim/simulator.js 按真实时刻仿真（补给车次、超充会话、库存、告警），每 3 秒刷新面板
  场址为假定地块，规划由甲方设施清单设计（docs/design/energy/）；
  模型构建脚本：scripts/blender/energy/，规划数据：scripts/energy/draw_plan.py
-->
<template>
  <div ref="pageRef" class="energy-page" :class="{ intro: introPlaying }">
    <canvas ref="canvasRef" class="scene-canvas"></canvas>

    <SceneTags v-if="snap && !introPlaying" :anchors="anchors" :snap="snap" />
    <SceneLegend v-if="!introPlaying && !loading" />

    <EnergyHead
      :now="now"
      :urgent="snap?.alarmCount || 0"
      :intro-playing="introPlaying"
      @replay="scene?.playIntro()"
    />

    <template v-if="snap">
      <div class="col col-left">
        <SupplyPanel :today="snap.today" :now="now" />
        <InventoryPanel :inv="snap.inventory" />
        <SafetyPanel :safety="snap.safety" />
      </div>
      <div class="col col-right">
        <TruckPanel :bays="snap.bays" :charge="snap.charge" @pick="pickBay" />
        <SwapPvPanel
          :swap="snap.swap"
          :pv="snap.pv"
          :load="snap.transformerLoad"
        />
        <AlarmPanel :alarms="snap.alarms" :count="snap.alarmCount" />
      </div>
      <div class="bottom-row">
        <TrendPanel class="trend" :trend="trend" :now="hour" />
        <DevicePanel
          class="devices"
          :faults="snap.charge.faults"
          :filling="snap.inventory.lngFilling"
        />
      </div>
    </template>

    <BayCard
      v-if="picked && pickedBay && !introPlaying"
      :pick="picked"
      :bay="pickedBay"
      :now="now"
      @close="picked = null"
    />

    <div class="bottom-tip">
      提示：点击重卡超充位查看详情 ·
      拖动旋转、滚轮缩放&nbsp;&nbsp;|&nbsp;&nbsp;场址为假定地块，运行数据为仿真
    </div>

    <!-- 外部模型署名（CC BY 要求）：一行概要，悬停显示每个模型的作者与出处 -->
    <div
      v-if="MODEL_CREDITS.length"
      class="model-credits"
      :title="creditsDetail"
    >
      车辆模型 · Sketchfab（CC BY 4.0）· {{ MODEL_CREDITS.length }} 位作者
    </div>

    <div v-if="loading" class="scene-loading">场站模型加载中</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { EnergyScene } from "./scene/EnergyScene"
  import { Simulator } from "./sim/simulator"
  import { MODEL_CREDITS } from "./data/station"
  import EnergyHead from "./components/EnergyHead.vue"
  import SupplyPanel from "./components/SupplyPanel.vue"
  import InventoryPanel from "./components/InventoryPanel.vue"
  import SafetyPanel from "./components/SafetyPanel.vue"
  import TruckPanel from "./components/TruckPanel.vue"
  import SwapPvPanel from "./components/SwapPvPanel.vue"
  import AlarmPanel from "./components/AlarmPanel.vue"
  import TrendPanel from "./components/TrendPanel.vue"
  import DevicePanel from "./components/DevicePanel.vue"
  import SceneTags from "./components/SceneTags.vue"
  import SceneLegend from "./components/SceneLegend.vue"
  import BayCard from "./components/BayCard.vue"

  /** 面板刷新间隔（毫秒） */
  const REFRESH = 3000

  /** 署名悬停提示：每个模型一行（标题、作者、许可、出处） */
  const creditsDetail = MODEL_CREDITS.map(
    (c) => `"${c.title}" by ${c.author}, ${c.license} — ${c.url}`
  ).join("\n")

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const loading = ref(true)
  const error = ref("")
  /** 开场动画播放中：面板与标签隐藏 */
  const introPlaying = ref(false)

  /** 面板数据快照：整体替换，不需要深层响应 */
  const snap = shallowRef(null)
  const trend = shallowRef(null)
  const now = ref(new Date())
  const hour = computed(
    () => now.value.getHours() + now.value.getMinutes() / 60
  )
  /** 设施标签锚点（设计稿坐标），场景每帧回调 */
  const anchors = shallowRef(null)
  /** 选中的超充位：{ id, x, y } */
  const picked = ref(null)
  const pickedBay = computed(() =>
    snap.value?.bays.find((b) => b.id === picked.value?.id)
  )

  const scene = shallowRef(null)
  let sim = null
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

  /** 面板里点超充位：在场景里定位到对应终端并弹出详情 */
  function pickBay(id) {
    const p = scene.value?.locate(id)
    picked.value = p ? { id, ...p } : null
  }

  onMounted(async () => {
    // 仿真先跑起来：面板不依赖三维，WebGL 不可用时照常显示（车次直接计数）
    sim = new Simulator({
      onBay: (b) => {
        scene.value?.updateBay(b)
        if (picked.value?.id === b.id) refresh()
      },
      onTrip: (e) => (scene.value ? scene.value.handleTrip(e) : true)
    })
    sim.start()
    trend.value = sim.trend()
    refresh()
    timers.push(setInterval(refresh, REFRESH))
    timers.push(
      setInterval(() => {
        now.value = new Date()
        if (now.value.getMinutes() % 10 === 0 && now.value.getSeconds() === 0)
          trend.value = sim.trend()
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
      const s = new EnergyScene({
        canvas: canvasRef.value,
        container: pageRef.value,
        sim,
        baseUrl: import.meta.env.BASE_URL,
        onPick: (p) => (picked.value = p),
        onAnchors: (a) => {
          anchors.value = a
          // 浮窗跟随所选终端（镜头摆动时位置会变）
          if (picked.value && scene.value)
            Object.assign(picked.value, scene.value.locate(picked.value.id))
        },
        onIntro: (playing) => (introPlaying.value = playing)
      })
      await s.load()
      if (!alive) return s.dispose()
      scene.value = s
      s.playIntro()
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
    scene.value?.dispose()
    scene.value = null
  })
</script>

<style lang="scss">
  /*
   * 页面级共用样式（不加 scoped，统一挂在 .energy-page 下，避免影响其他演示）：
   * 面板外框、标题栏——各面板组件直接使用这些类名
   */
  .energy-page {
    --cyan: #2de2e6;
    --red: #ff4d5a;
    --text: #e6f0ff;
    --muted: #8ea6c8;
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

      .unit {
        margin-left: auto;
        font-size: 13px;
        color: var(--muted);
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

  .col,
  .bottom-row {
    transition:
      opacity 0.8s,
      transform 0.8s;
  }

  .col {
    position: absolute;
    top: 76px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 390px;
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
    height: 214px;

    .trend {
      flex: 1.3;
    }

    .devices {
      flex: 1;
    }
  }

  /* 开场动画期间面板退到画面外，结束后滑回 */
  .intro {
    .col,
    .bottom-row {
      opacity: 0;
      pointer-events: none;
    }

    .col-left {
      transform: translateX(-40px);
    }

    .col-right {
      transform: translateX(40px);
    }

    .bottom-row {
      transform: translateY(40px);
    }
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
    color: rgba(142, 166, 200, 0.7);
    pointer-events: none;
  }

  .model-credits {
    position: absolute;
    right: 24px;
    bottom: 7px;
    z-index: 4;
    font-size: 11px;
    color: rgba(142, 166, 200, 0.45);
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
