<!--
  楼盘沙盘（虚构楼盘「澜岸云境」· 实体沙盘质感的三维展示）
  ----------------------------------------------------------
  还原基准：docs/design/estate/design/final.png（风格 A 展厅暖光 · 象牙白实体沙盘）。页面只负责面板与交互的转接：
    - 三维：./scene/EstateScene.js（不依赖 Vue），主机位 = 定稿反求的相机（data/camera.json）
    - 数据：./data/layout.json（编号与布局，scripts/estate/layout.mjs 生成）、./data/sales.json（销售状态，模拟数据）
    - 面板：./components（定稿 HTML 面板的移植），样式 ./styles/estate.no-convert.css
  版面：画布铺满窗口，面板放在按 1920×1080 居中缩放的"舞台"里；三维投影中心按同一个缩放和原点换算，
  窗口比 16:9 宽或高时沙盘和面板仍然对齐。
  交互：点楼栋 / 插牌出信息卡；底部四个页签（总览 / 楼栋 / 配套 / 景观）；时间滑块看一天的光影；自动导览；
  45 秒无人操作自动开始导览。
  深链：?at=2026-10-30T18:00 钉住场景时刻（定稿的一刻）；?tour=0 关闭自动导览；?select=B08 选中；
  ?tab=building|amenity|scenic；?room=1（配合 ?select=B08）直接进样板间；?roomUrl=<https 链接> 换一个 VR 页面；?skip=1 跳过开场动画；?mode=live 强制用实时三维版（默认用预渲染的照片模式，
  见 scene/PhotoScene.js；没有照片时自动退回实时版）。
-->
<template>
  <div ref="pageRef" class="estate-page">
    <canvas ref="canvasRef" class="scene"></canvas>
    <div class="veil"></div>
    <div ref="spotRef" class="spot"></div>

    <div ref="stageRef" class="stage" :style="stageStyle">
      <PinLayer
        ref="pinsRef"
        :layout="layout"
        :selected-id="selectedId"
        :show-pins="tab === 'overview' || tab === 'building'"
        :tags="tags"
        @pick="onPick"
      />
      <svg class="leader no-pointer">
        <path
          ref="leaderRef"
          d=""
          fill="none"
          stroke="#FFD27A"
          stroke-opacity=".75"
          stroke-width="1.5"
        />
        <circle ref="leaderDotRef" r="4" fill="#FFD27A" cx="-10" cy="-10" />
      </svg>

      <TopBar
        :layout="layout"
        :time="timeText"
        :date="dateText"
        :period="period"
      />

      <InfoCard
        v-if="selBuilding"
        :key="selBuilding.id"
        :b="selBuilding"
        :s="saleOf(selBuilding.id)"
        @close="clearSelection()"
        @focus="focusSelected"
        @room="openRoom"
      />
      <AmenityCard
        v-else-if="selAmenity"
        :key="selAmenity.id"
        :a="selAmenity"
        :layer-name="layerNameOf(selAmenity)"
        @close="clearSelection()"
        @focus="focusSelected"
      />

      <div v-if="orbitHint" class="orbit-hint">‹ 左右拖动画面 · 环绕查看 ›</div>

      <!-- 指北针：随镜头转 -->
      <svg
        ref="compassRef"
        class="compass"
        width="92"
        height="92"
        viewBox="0 0 92 92"
        fill="none"
      >
        <circle
          cx="46"
          cy="46"
          r="40"
          fill="rgba(26,21,16,.78)"
          stroke="#C9A86A"
          stroke-opacity=".5"
        />
        <circle
          cx="46"
          cy="46"
          r="33"
          stroke="#C9A86A"
          stroke-opacity=".22"
          stroke-dasharray="2 4"
        />
        <g ref="compassNeedle" style="transform-origin: 46px 46px">
          <path d="M46 16l7 30h-14z" fill="#FFD27A" />
          <path d="M46 76l-7-30h14z" fill="#8F8372" fill-opacity=".7" />
          <text
            x="46"
            y="12"
            text-anchor="middle"
            font-family="DIN"
            font-size="13"
            fill="#F3EBDD"
          >
            N
          </text>
        </g>
        <circle cx="46" cy="46" r="3" fill="#1A1510" />
      </svg>

      <!-- 导览讲解词 / 图层选择条 -->
      <div v-if="touring && tourStop" :key="tourIdx" class="shell caption">
        <div class="core">
          <div class="hd">
            <b>{{ tourIdx + 1 }} / {{ tour?.stops.length }}</b
            >{{ tourStop.name }}
            <span class="dots"
              ><i
                v-for="(s, i) in tour?.stops"
                :key="i"
                :class="{ on: i === tourIdx }"
              ></i
            ></span>
          </div>
          <p>{{ tourStop.text }}</p>
        </div>
      </div>
      <div v-else-if="chips.length" class="shell chips">
        <div class="core">
          <div
            v-for="c in chips"
            :key="c.id"
            class="chip"
            :class="{ on: chipId === c.id }"
            @click="pickChip(c.id)"
          >
            {{ c.name }}
          </div>
        </div>
      </div>

      <BottomBar
        :tab="tab"
        :hour="hour"
        :time="timeText"
        :period="period"
        :touring="touring"
        :stops="tour?.stops.length ?? 8"
        @tab="setTab"
        @time="onTime"
        @tour="toggleTour"
        @reset="resetAll"
      />

      <!-- 销售状态图例 -->
      <aside class="shell sale">
        <div class="core">
          <div class="cap">销售状态</div>
          <div v-for="s in ['open', 'hot', 'out']" :key="s" class="row">
            <i :style="{ background: `var(--sale-${s})` }"></i>{{ STATE_NAME[s]
            }}<b>{{ counts[s] }} 栋</b>
          </div>
        </div>
      </aside>
    </div>

    <!-- 样板间 VR 看房浮层（盖满窗口，在舞台之外） -->
    <RoomTour v-if="roomOpen" :b="selBuilding" @close="closeRoom" />

    <div v-if="!ready" class="loading scene-loading">
      <div class="box">
        <div class="name">{{ layout.name }}</div>
        <div class="sub">湖居改善 · 正在布置沙盘</div>
        <div class="prog"><i :style="{ width: progress * 100 + '%' }"></i></div>
      </div>
    </div>
  </div>
</template>

<script setup>
  import "./styles/estate.no-convert.css"
  import { PhotoScene } from "./scene/PhotoScene.js"
  import { createTour } from "./scene/tour.js"
  import { lightAt, hhmm, periodName } from "./scene/sun.js"
  import layout from "./data/layout.json"
  import {
    STATE_NAME,
    saleOf,
    stateCounts,
    dateLabel,
    parseAt
  } from "./utils.js"
  import TopBar from "./components/TopBar.vue"
  import InfoCard from "./components/InfoCard.vue"
  import AmenityCard from "./components/AmenityCard.vue"
  import BottomBar from "./components/BottomBar.vue"
  import PinLayer from "./components/PinLayer.vue"
  import RoomTour from "./components/RoomTour.vue"

  const route = useRoute()
  const q = route.query
  const at = parseAt(q.at)

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const stageRef = ref(null)
  const spotRef = ref(null)
  const pinsRef = ref(null)
  const leaderRef = ref(null)
  const leaderDotRef = ref(null)
  const compassNeedle = ref(null)

  const ready = ref(false)
  const progress = ref(0)
  const hour = ref(at.hour)
  const tab = ref("overview")
  const selectedId = ref(null)
  const chipId = ref(null)
  const touring = ref(false)
  const roomOpen = ref(false) // 样板间 VR 浮层
  const orbitHint = ref(false) // 照片模式：提示可以左右拖动环绕，第一次操作后收起
  const tourIdx = ref(0)
  const tourStop = ref(null)
  const stageStyle = ref({})
  const counts = stateCounts()

  let scene = null
  let tour = null
  let idleTimer = 0

  // ---------------------------------------------------------------- 派生

  const selBuilding = computed(
    () => layout.buildings.find((b) => b.id === selectedId.value) ?? null
  )
  const selAmenity = computed(
    () => layout.amenities.find((a) => a.id === selectedId.value) ?? null
  )
  const timeText = computed(() => hhmm(hour.value))
  const dateText = computed(() => dateLabel(at.month, at.day))
  const period = computed(() =>
    periodName(hour.value, lightAt(at.month, at.day, hour.value).el)
  )

  const layerNameOf = (a) =>
    layout.layers.find((l) => l.ids.includes(a.id))?.name ?? "配套"
  const layerOf = (id) =>
    layout.layers.find((l) => l.ids.includes(id))?.id ?? null

  /** 配套页签的图层条（医疗并入末尾）；景观页签的条目 */
  const chips = computed(() => {
    if (tab.value === "amenity")
      return layout.layers
        .filter((l) => l.id !== "scenic")
        .map((l) => ({ id: l.id, name: l.name }))
    if (tab.value === "scenic") {
      const ids = ["LK01", "AX01", "TR01", "PK01", "RV01"]
      return [
        { id: "ALL", name: "全部" },
        ...ids.map((id) => ({
          id,
          name: layout.amenities.find((a) => a.id === id).name
        }))
      ]
    }
    return []
  })

  /** 当前要贴名称标签的配套对象 */
  const tags = computed(() => {
    let ids = []
    if (tab.value === "amenity" && chipId.value)
      ids = layout.layers.find((l) => l.id === chipId.value)?.ids ?? []
    else if (tab.value === "scenic") {
      if (chipId.value === "ALL")
        ids = layout.layers.find((l) => l.id === "scenic").ids
      else if (chipId.value) ids = [chipId.value]
    }
    return ids
      .map((id) => layout.amenities.find((a) => a.id === id))
      .filter(Boolean)
  })

  // ---------------------------------------------------------------- 舞台缩放

  function layoutStage() {
    const w = window.innerWidth
    const h = window.innerHeight
    const u = Math.min(w / 1920, h / 1080)
    stageStyle.value = {
      transform: `translate(${(w - 1920 * u) / 2}px, ${(h - 1080 * u) / 2}px) scale(${u})`
    }
  }

  // ---------------------------------------------------------------- 选中、页签、图层

  function selectItem(id, fly = false) {
    selectedId.value = id
    scene.select(id, { fly })
  }

  function clearSelection() {
    selectedId.value = null
    scene?.select(null)
  }

  /** 页签切换。quiet = 只改页签和图层，不动镜头（点击三维里的对象时用） */
  function setTab(t, quiet = false) {
    stopTour()
    bumpIdle()
    tab.value = t
    clearSelection()
    if (t === "overview") {
      scene.setLayer(null)
      chipId.value = null
      if (!quiet) scene.goHome()
    } else if (t === "building") {
      scene.setLayer(null)
      chipId.value = null
    } else if (t === "amenity") {
      chipId.value = "club"
      scene.setLayer("club", { fly: !quiet })
    } else if (t === "scenic") {
      chipId.value = "ALL"
      scene.setLayer("scenic", { fly: !quiet })
    }
  }

  function pickChip(id) {
    stopTour()
    bumpIdle()
    clearSelection()
    chipId.value = id
    if (tab.value === "amenity") scene.setLayer(id)
    else if (id === "ALL") scene.setLayer("scenic")
    else {
      scene.setLayer(null)
      selectItem(id, true)
    }
  }

  /** 点三维里的对象 / 插牌 / 标签 */
  function onPick(id) {
    stopTour()
    bumpIdle()
    if (!id) {
      if (selectedId.value) clearSelection()
      return
    }
    if (id.startsWith("B")) {
      // 再点一次已选中的楼栋 = 进入样板间
      if (id === selectedId.value && !roomOpen.value) {
        openRoom()
        return
      }
      if (tab.value !== "building") {
        tab.value = "building"
        scene.setLayer(null)
        chipId.value = null
      }
      selectItem(id)
      return
    }
    const layerId = layerOf(id)
    if (layerId === "scenic") {
      if (tab.value !== "scenic") {
        tab.value = "scenic"
        chipId.value = id
        scene.setLayer(null)
      }
    } else if (tab.value !== "amenity") {
      tab.value = "amenity"
      chipId.value = layerId
      scene.setLayer(layerId, { fly: false })
    }
    selectItem(id)
  }

  /** 进入样板间：停导览、停空闲计时、冻结三维（浮层盖住了，不用再渲染） */
  function openRoom() {
    stopTour()
    clearTimeout(idleTimer)
    roomOpen.value = true
    scene?.setFrozen(true)
  }

  function closeRoom() {
    roomOpen.value = false
    scene?.setFrozen(false)
    bumpIdle()
  }

  function focusSelected() {
    if (selectedId.value) scene.select(selectedId.value, { fly: true })
  }

  function resetAll() {
    stopTour()
    bumpIdle()
    tab.value = "overview"
    chipId.value = null
    clearSelection()
    scene.setLayer(null)
    scene.goHome()
  }

  // ---------------------------------------------------------------- 时间、导览

  function onTime(v) {
    stopTour()
    bumpIdle()
    scene._timeTween = null
    hour.value = v
    scene.setTime(v)
  }

  function toggleTour() {
    bumpIdle()
    if (touring.value) {
      stopTour()
      return
    }
    clearSelection()
    tab.value = "overview"
    chipId.value = null
    tour.start()
  }

  function stopTour() {
    if (tour?.running) {
      tour.stop()
      scene.setLayer(null)
    }
  }

  /** 45 秒没人操作就自动导览；有人操作就重新计时 */
  function bumpIdle() {
    clearTimeout(idleTimer)
    if (q.tour === "0" || !ready.value || roomOpen.value) return
    idleTimer = setTimeout(() => {
      if (!touring.value && !selectedId.value) toggleTour()
    }, 45000)
  }

  // ---------------------------------------------------------------- 每帧：面板跟着三维走

  function onFrame(s) {
    const { u, ox, oy } = s.stage()
    const toStage = (p) => ({
      x: (p.x - ox) / u,
      y: (p.y - oy) / u,
      visible: p.visible
    })
    pinsRef.value?.update(s, toStage)

    // 指北针：相机朝向在地面上的投影
    const heading = s.headingDeg()
    if (compassNeedle.value)
      compassNeedle.value.style.transform = `rotate(${(-heading).toFixed(1)}deg)`

    // 选中：周围压暗 + 引线
    const sel = selBuilding.value ?? selAmenity.value
    const spot = spotRef.value
    const path = leaderRef.value
    const dot = leaderDotRef.value
    if (sel && spot) {
      const c = s.projectPlan(sel.cx, sel.cy, 0)
      const rx = Math.min(520, 340 * u + sel.w * u * 1.2)
      const ry = rx * 0.68
      spot.classList.add("on")
      spot.style.background = `radial-gradient(ellipse ${rx.toFixed(0)}px ${ry.toFixed(0)}px at ${c.x.toFixed(0)}px ${c.y.toFixed(0)}px, rgba(0,0,0,0) 0%, rgba(8,6,4,0.1) 55%, rgba(8,6,4,0.4) 100%)`
      // 引线：从信息卡右边缘水平连到楼体前沿左下角
      const e = toStage(
        s.projectPlan(
          sel.cx - Math.min(sel.w, 60) / 2,
          sel.cy - Math.min(sel.d, 40) / 2,
          0
        )
      )
      if (e.visible && e.x > 520 && path) {
        path.setAttribute(
          "d",
          `M 490 ${e.y.toFixed(1)} L ${e.x.toFixed(1)} ${e.y.toFixed(1)}`
        )
        dot.setAttribute("cx", e.x.toFixed(1))
        dot.setAttribute("cy", e.y.toFixed(1))
      } else if (path) {
        path.setAttribute("d", "")
        dot.setAttribute("cx", "-10")
      }
    } else if (spot) {
      spot.classList.remove("on")
      path?.setAttribute("d", "")
      dot?.setAttribute("cx", "-10")
    }
  }

  // ---------------------------------------------------------------- 生命周期

  /** 照片清单读得到才算有（开发服务器对不存在的文件会回 index.html，所以要看内容类型） */
  async function hasPhoto() {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}estate/photo/manifest.json`
      )
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json"))
        return false
      await r.json()
      return true
    } catch {
      return false
    }
  }

  onMounted(async () => {
    layoutStage()
    window.addEventListener("resize", layoutStage)
    const opts = {
      layout,
      month: at.month,
      day: at.day,
      hour: at.hour,
      onPick,
      onFrame,
      onProgress: (p) => (progress.value = p)
    }
    // 三种画面：默认是 img2threejs 按设计稿还原的实时三维版（RestoredScene，动态加载）；
    // ?mode=photo 用 Blender Cycles 离线渲染的照片版（没有照片时退回程序化版）；?mode=live 用最早的程序化实时版
    if (q.mode === "live") {
      const { EstateScene } = await import("./scene/EstateScene.js")
      scene = new EstateScene(canvasRef.value, opts)
    } else if (q.mode === "photo" && (await hasPhoto())) {
      scene = new PhotoScene(canvasRef.value, opts)
    } else {
      const { RestoredScene } = await import("./scene/RestoredScene.js")
      scene = new RestoredScene(canvasRef.value, opts)
    }
    scene.onInteract = () => {
      orbitHint.value = false
      stopTour()
      bumpIdle()
    }
    scene.onTime = (h) => (hour.value = h)
    tour = createTour(scene, layout, {
      onStop: (i, stop) => {
        touring.value = true
        tourIdx.value = i
        tourStop.value = stop
      },
      onEnd: () => {
        touring.value = false
        tourStop.value = null
      }
    })
    if (import.meta.env.DEV) {
      window.__estateScene = scene
      window.__estateTour = tour // 录屏用：缩短每站停留（tour.stops[i].dwell）
      installHooks()
    }
    await scene.ready
    ready.value = true
    if (scene instanceof PhotoScene) {
      orbitHint.value = true
      setTimeout(() => (orbitHint.value = false), 9000)
    }
    if (q.skip !== "1") scene.intro()
    if (q.tab && ["building", "amenity", "scenic"].includes(q.tab))
      setTab(q.tab, true)
    if (
      q.select &&
      (layout.buildings.some((b) => b.id === q.select) ||
        layout.amenities.some((a) => a.id === q.select))
    ) {
      if (q.select.startsWith("B")) {
        tab.value = "building"
        selectItem(q.select)
      } else onPick(q.select)
      // ?room=1：直接打开选中楼栋的样板间（演示 / 截图用）
      if (q.room === "1" && q.select.startsWith("B")) openRoom()
    }
    window.addEventListener("pointerdown", bumpIdle)
    window.addEventListener("keydown", bumpIdle)
    bumpIdle()
    if (window.__dashboard) window.__dashboard.ready = true
  })

  onBeforeUnmount(() => {
    window.removeEventListener("resize", layoutStage)
    window.removeEventListener("pointerdown", bumpIdle)
    window.removeEventListener("keydown", bumpIdle)
    clearTimeout(idleTimer)
    tour?.stop()
    scene?.dispose()
    if (import.meta.env.DEV) {
      delete window.__estateScene
      delete window.__estateTour
      delete window.__dashboard
    }
  })

  /**
   * 开发模式测试钩子：给 scripts/capture.mjs 固定画面用（契约见 build-3d-visual-dashboard 的 hooks.js）。
   * 数据状态 design = 定稿那一刻：18:00，选中 8 栋，楼栋页签，镜头在主机位。
   */
  function installHooks() {
    window.__dashboard = {
      ready: false,
      views: ["home"],
      states: ["design"],
      setView(name) {
        if (name === "home") {
          scene._tween = null
          scene._applyHome()
        }
      },
      async setState(name) {
        if (name !== "design") throw new Error(`未定义的数据状态 ${name}`)
        stopTour()
        clearTimeout(idleTimer)
        scene._tween = null
        hour.value = 18
        scene.setTime(18)
        tab.value = "building"
        scene.setLayer(null)
        scene._applyHome()
        selectItem("B08")
      },
      freeze(on = true) {
        scene.setFrozen(on)
        if (on) {
          stopTour()
          clearTimeout(idleTimer)
        }
      },
      hidePanels(on = true) {
        if (stageRef.value) stageRef.value.style.visibility = on ? "hidden" : ""
        if (spotRef.value) spotRef.value.style.visibility = on ? "hidden" : ""
      },
      renderIdMask: () => scene.renderIdMask(),
      stats: () => scene.stats()
    }
  }
</script>
