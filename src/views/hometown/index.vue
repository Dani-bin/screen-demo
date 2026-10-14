<!--
  老家沙盘（营山 · 五通村）
  按卫星图与老照片还原的盛夏傍晚沙盘：开场"卫星图 → 沙盘"，全景看村子和回家的路，
  点"我家"推进到照片机位，对照老照片；傍晚 / 夜晚切换，环境音默认静音。
  设计稿：docs/design/hometown/08-draft-dusk.png、09-draft-night.png、10-draft-home.png
-->
<template>
  <div ref="root" class="hometown" :class="{ night }">
    <canvas ref="canvas" class="stage"></canvas>
    <!-- 四周相册式的暗角与细边框 -->
    <div class="frame"></div>

    <HomeHeader
      v-show="!loading"
      :night="night"
      :muted="muted"
      @night="setNight"
      @mute="toggleMute"
      @replay="replay"
    />

    <template v-if="anchors && view === 'overview' && !anchors.moving">
      <MapPins :anchors="anchors" :photo="photo" @home="goHome" />
    </template>
    <Transition name="fade">
      <RouteRibbon v-if="!intro && !loading && view === 'overview'" />
    </Transition>
    <HomeDetail
      v-if="view === 'home' && anchors && !anchors.moving"
      :photo="photo"
      @back="goOverview"
    />

    <!-- 开场时可跳过 -->
    <button v-if="intro" class="skip" @click="skip">跳过 ›</button>

    <Transition name="fade">
      <!-- scene-loading：首页预览截图脚本据此判断场景是否加载完 -->
      <div v-if="loading" class="loading scene-loading">
        <div class="seal">老<br />家</div>
        <p>{{ error || "正在回家…" }}</p>
      </div>
    </Transition>
  </div>
</template>

<script setup>
  import HomeHeader from "./components/HomeHeader.vue"
  import MapPins from "./components/MapPins.vue"
  import RouteRibbon from "./components/RouteRibbon.vue"
  import HomeDetail from "./components/HomeDetail.vue"
  import { HometownScene } from "./scene/HometownScene"
  import { Ambience } from "./scene/ambience"

  const root = ref(null)
  const canvas = ref(null)
  const loading = ref(true)
  const error = ref("")
  const intro = ref(false)
  const night = ref(false)
  const muted = ref(true)
  const view = ref("overview")
  /** 场景每帧投影出的锚点（设计稿坐标）；用 shallowRef，每帧整体替换 */
  const anchors = shallowRef(null)
  const photo = `${import.meta.env.BASE_URL}hometown/photo.webp`

  let scene = null
  const ambience = new Ambience()

  function setNight(on) {
    night.value = on
    scene?.setNight(on)
    ambience.setNight(on ? 1 : 0)
  }
  function toggleMute() {
    muted.value = !muted.value
    ambience.setMuted(muted.value)
  }
  function goHome() {
    view.value = "home"
    scene?.setView("home")
  }
  function goOverview() {
    view.value = "overview"
    scene?.setView("overview")
  }
  function replay() {
    view.value = "overview"
    scene?.playIntro()
  }
  function skip() {
    scene?.skipIntro()
  }
  function onKey(e) {
    if (e.key === "Escape" && view.value === "home") goOverview()
  }

  onMounted(async () => {
    scene = new HometownScene({
      canvas: canvas.value,
      container: root.value,
      baseUrl: import.meta.env.BASE_URL,
      onAnchors: (a) => (anchors.value = a),
      onIntro: (playing) => (intro.value = playing)
    })
    try {
      await scene.load()
      loading.value = false
      // ?skip=1 跳过开场（截图 / 调试用）；?view=home 直接进近景；?night=1 夜晚
      const q = new URLSearchParams(location.hash.split("?")[1] || "")
      if (q.get("night") === "1") setNight(true)
      if (q.get("view") === "home") {
        view.value = "home"
        scene.setView("home", 0.01)
      } else if (q.get("skip") !== "1") scene.playIntro()
    } catch (e) {
      console.error(e)
      error.value = "模型加载失败"
    }
    window.addEventListener("keydown", onKey)
  })

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKey)
    scene?.dispose()
    ambience.dispose()
  })
</script>

<style lang="scss" scoped>
  .hometown {
    /* 纪念册风配色（设计稿 drafts-v2.html） */
    --paper: #f6efe1;
    --ink: #3d2f22;
    --ink-2: #7a6650;
    --warm: #e9a84b;
    --seal: #b8392b;
    --cream: #fff7e8;
    --pin-bg: rgba(246, 239, 225, 0.92);
    --pin-ink: #3d2f22;
    --ribbon-bg: #f6efe1;
    --ribbon-line: transparent;
    --ribbon-head: #3d2f22;
    --step-dot: #fff7e8;
    --step-ink: #3d2f22;
    --step-ink-2: #7a6650;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #2b2620;
    font-family: "Source Han Sans CN", sans-serif;
    color: var(--ink);
    &.night {
      --pin-bg: rgba(30, 34, 52, 0.78);
      --pin-ink: #f1e6cf;
      --ribbon-bg: rgba(28, 26, 34, 0.86);
      --ribbon-line: rgba(255, 220, 160, 0.18);
      --ribbon-head: rgba(0, 0, 0, 0.35);
      --step-dot: #2c2a33;
      --step-ink: #f1e6cf;
      --step-ink-2: #b9ad97;
    }
  }
  .stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .frame {
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background: linear-gradient(rgba(40, 26, 12, 0.5), transparent 22%),
      linear-gradient(0deg, rgba(40, 26, 12, 0.45), transparent 28%);
    transition: background 0.8s;
    &::after {
      content: "";
      position: absolute;
      inset: 18px;
      border: 1px solid rgba(255, 240, 210, 0.35);
      border-radius: 4px;
    }
  }
  .night .frame {
    background: linear-gradient(rgba(4, 8, 20, 0.55), transparent 22%),
      linear-gradient(0deg, rgba(4, 8, 20, 0.5), transparent 28%);
  }
  .skip {
    position: absolute;
    right: 76px;
    bottom: 60px;
    z-index: 6;
    padding: 10px 22px;
    border-radius: 4px;
    background: rgba(246, 239, 225, 0.9);
    color: var(--ink);
    font-size: 17px;
    letter-spacing: 3px;
    cursor: pointer;
  }
  .loading {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 22px;
    background: #2b2620;
    color: var(--cream);
    font-size: 20px;
    letter-spacing: 6px;
    .seal {
      width: 76px;
      height: 76px;
      border: 3px solid var(--seal);
      border-radius: 8px;
      color: var(--seal);
      background: rgba(255, 240, 220, 0.92);
      font-family: "Alimama ShuHeiTi";
      font-size: 28px;
      line-height: 1.05;
      display: grid;
      place-items: center;
      text-align: center;
      transform: rotate(-8deg);
      animation: breathe 1.6s ease-in-out infinite;
    }
  }
  @keyframes breathe {
    50% {
      transform: rotate(-8deg) scale(1.08);
    }
  }
  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.6s;
  }
  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }
</style>
