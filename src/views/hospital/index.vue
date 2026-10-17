<!--
  医院院内导航（虚构的三层门诊医技综合楼）
  自己选起点 / 终点 → 按路网规划跨楼层路线（推荐 / 无障碍）→ 提示走楼梯、电梯还是扶梯 → 人员沿路线模拟走过去。
  设计稿：docs/design/hospital/01-draft-light.png（浅色"医院导视"版）；布局、路线以 CAD（data/plan.json）为准。
  URL 参数：?from=<地点 id>&to=<地点 id>&mode=accessible（地点 id：房间号如 309，入口 gateS / gateN / gateE）
-->
<template>
  <div ref="root" class="hospital" @pointerdown="touch">
    <header class="top">
      <h1>××医院院内导航</h1>
      <p class="sub">门诊医技综合楼 · 3 层 · 60 个诊室与检查室</p>
      <p class="clock">
        <span>{{ dateText }}</span>
        <b>{{ timeText }}</b>
      </p>
    </header>

    <PlacePanel
      :start="startPlace"
      :end="endPlace"
      :pick="pick"
      :floor="tabFloor"
      :query="query"
      :items="listItems"
      :active-id="pick === 'start' ? startId : endId"
      @pick="(p) => (pick = pick === p && p === 'start' ? 'end' : p)"
      @swap="swap"
      @search="(q) => (query = q)"
      @floor="(f) => ((tabFloor = f), (query = ''))"
      @select="select"
    />

    <!-- 中央三维场景 -->
    <div ref="stage" class="stage">
      <canvas ref="canvas"></canvas>
      <div v-if="anchors" class="labels">
        <div
          v-for="a in anchors.floors"
          :key="a.f"
          class="floor-label"
          :style="{ left: `${a.x}px`, top: `${a.y}px` }"
        >
          <b>{{ FLOORS[a.f] }}</b>
          <span>{{ FLOOR_TITLES[a.f] }}</span>
        </div>
        <span
          v-if="anchors.start"
          class="tag start"
          :style="{ left: `${anchors.start.x}px`, top: `${anchors.start.y}px` }"
        >
          {{ shortName(startPlace) }} 起点
        </span>
        <span
          v-if="anchors.end"
          class="tag end"
          :style="{ left: `${anchors.end.x}px`, top: `${anchors.end.y}px` }"
        >
          {{ endPlace.name }}{{ endPlace.num ? " " + endPlace.num : "" }}
        </span>
      </div>
    </div>

    <FloorStrip
      :route="route"
      :graph="G"
      :floor="progress.floor"
      @focus="(f) => (tabFloor = f)"
    />

    <GuidePanel
      v-if="route"
      :route="route"
      :step-index="stepIndex"
      :frac="progress.frac"
      :arrived="progress.arrived"
      :mode="mode"
      @mode="(m) => (mode = m)"
      @jump="jump"
    />

    <!-- scene-loading：首页预览截图脚本据此判断场景是否就绪 -->
    <div v-if="loading" class="loading scene-loading">正在生成院内地图…</div>
  </div>
</template>

<script setup>
  import PlacePanel from "./components/PlacePanel.vue"
  import GuidePanel from "./components/GuidePanel.vue"
  import FloorStrip from "./components/FloorStrip.vue"
  import { HospitalScene } from "./scene/HospitalScene"
  import {
    buildGraph,
    FLOORS,
    FLOOR_TITLES,
    PLACES,
    planRoute,
    shortest
  } from "./route"
  import { minutes } from "./utils"
  import PLAN from "./data/plan.json"

  const G = buildGraph()
  const placeById = Object.fromEntries(PLACES.map((p) => [p.id, p]))
  const roomByNum = Object.fromEntries(
    PLAN.rooms.filter((r) => r.num).map((r) => [r.num, r])
  )

  // 闲置时自动轮播的演示路线（推荐 / 无障碍 / 楼梯 / 扶梯下行 / 急诊）
  const DEMO_ROUTES = [
    ["gateS", "309", "recommend"],
    ["gateS", "309", "accessible"],
    ["101", "201", "recommend"],
    ["316", "120", "recommend"],
    ["gateE", "307", "accessible"],
    ["gateS", "108", "recommend"]
  ]

  const root = ref(null)
  const stage = ref(null)
  const canvas = ref(null)
  const loading = ref(true)
  const startId = ref("gateS")
  const endId = ref("309")
  const mode = ref("recommend")
  const pick = ref("end") // 列表点选时设起点还是终点
  const tabFloor = ref(2)
  const query = ref("")
  const anchors = shallowRef(null)
  const progress = ref({ edge: 0, frac: 0, floor: 0, arrived: false })
  let scene = null
  let lastTouch = performance.now()
  let demoIndex = 0
  let demoTimer = 0

  const startPlace = computed(() => placeById[startId.value])
  const endPlace = computed(() => placeById[endId.value])
  const route = computed(() =>
    planRoute(G, startPlace.value.node, endPlace.value.node, mode.value)
  )

  /** 当前步：最后一个"开始位置 ≤ 人员所在路径边"的步骤 */
  const stepIndex = computed(() => {
    const steps = route.value?.steps || []
    if (progress.value.arrived) return steps.length - 1
    let k = 0
    steps.forEach((s, i) => {
      if (s.at <= progress.value.edge) k = i
    })
    return k
  })

  /** 左栏列表：搜索时跨楼层匹配，否则列出所选楼层的目的地房间 + 公共设施；附从起点步行几分钟 */
  const listItems = computed(() => {
    const q = query.value.trim()
    let list
    if (q)
      list = PLACES.filter(
        (p) => p.name.includes(q) || (p.num && p.num.includes(q))
      )
    else {
      const f = tabFloor.value
      const rooms = PLACES.filter(
        (p) => p.floor === f && p.kind === "room"
      ).sort((a, b) => a.num.localeCompare(b.num))
      const others = PLACES.filter((p) => p.floor === f && p.kind !== "room")
      list = [...rooms, ...others]
    }
    const from = pick.value === "start" ? endPlace.value : startPlace.value
    return list.slice(0, 40).map((p) => ({
      ...p,
      minutes:
        p.id === from.id
          ? null
          : minutes(shortest(G, from.node, p.node, mode.value).cost)
    }))
  })

  function select(id) {
    if (pick.value === "start") {
      if (id !== endId.value) startId.value = id
      pick.value = "end"
    } else if (id !== startId.value) endId.value = id
    query.value = ""
  }
  function swap() {
    ;[startId.value, endId.value] = [endId.value, startId.value]
  }
  function jump(i) {
    scene?.jumpTo(route.value.steps[i].at)
  }
  const shortName = (p) => p.name.replace(/（.*）/, "")

  // 用户操作过就暂停自动轮播
  function touch() {
    lastTouch = performance.now()
  }

  // ---------- 时钟
  const now = ref(new Date())
  const timeText = computed(() => now.value.toTimeString().slice(0, 5))
  const dateText = computed(() => {
    const d = now.value
    return `${d.getMonth() + 1}月${d.getDate()}日  周${"日一二三四五六"[d.getDay()]}`
  })
  const clockTimer = setInterval(() => (now.value = new Date()), 10000)

  // 路线变化 → 三维重画路线、人员从头走；左栏楼层切到终点所在层
  watch(
    route,
    (r) => {
      progress.value = {
        edge: 0,
        frac: 0,
        floor: startPlace.value.floor,
        arrived: false
      }
      const dest = endPlace.value.num ? roomByNum[endPlace.value.num] : null
      scene?.setRoute(r, G, dest)
    },
    { flush: "post" }
  )
  watch(endId, () => (tabFloor.value = endPlace.value.floor))

  // 到达后，若闲置超过 40 秒，换下一条演示路线
  watch(
    () => progress.value.arrived,
    (arrived) => {
      clearTimeout(demoTimer)
      if (!arrived) return
      demoTimer = setTimeout(() => {
        if (performance.now() - lastTouch < 40000) return
        demoIndex = (demoIndex + 1) % DEMO_ROUTES.length
        const [a, b, m] = DEMO_ROUTES[demoIndex]
        startId.value = a
        endId.value = b
        mode.value = m
      }, 5000)
    }
  )

  onMounted(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] || "")
    if (placeById[q.get("from")]) startId.value = q.get("from")
    if (placeById[q.get("to")]) endId.value = q.get("to")
    if (q.get("mode") === "accessible") mode.value = "accessible"
    tabFloor.value = endPlace.value.floor

    scene = new HospitalScene({
      canvas: canvas.value,
      container: stage.value,
      onAnchors: (a) => (anchors.value = a),
      onProgress: (p) => (progress.value = p),
      onPick: (room) => {
        touch()
        const p = placeById[room.num]
        if (p) select(p.id)
      }
    })
    scene.setRoute(
      route.value,
      G,
      endPlace.value.num ? roomByNum[endPlace.value.num] : null
    )
    requestAnimationFrame(() => (loading.value = false))
  })

  onBeforeUnmount(() => {
    clearInterval(clockTimer)
    clearTimeout(demoTimer)
    scene?.dispose()
  })
</script>

<style lang="scss" scoped>
  .hospital {
    /* 设计稿 v1 浅色"医院导视"版的配色（scripts/hospital/draft.py THEMES.light） */
    --ground: #e2e8e6;
    --panel: #f2f5f4;
    --panel2: #e9eeec;
    --ink: #13201c;
    --sub: #56665f;
    --faint: #8c9a95;
    --sign: #0f5b4c;
    --sign-ink: #ffffff;
    --sign-sub: #b9d9d0;
    --route: #f26b1d;
    --route-tint: #fbe2d2;
    --start: #1f9d57;
    --end: #d7372c;
    --tag: #dde5e2;
    --plan-floor: #ffffff;
    --plan-wall: #2a3532;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--ground);
    color: var(--ink);
    font-family: "Source Han Sans CN", sans-serif;
  }
  .top {
    position: absolute;
    left: 40px;
    right: 40px;
    top: 24px;
    display: flex;
    align-items: baseline;
    gap: 20px;
    h1 {
      font-family: "Alimama ShuHeiTi";
      font-size: 30px;
      font-weight: normal;
    }
    .sub {
      font-size: 16px;
      color: var(--sub);
    }
    .clock {
      margin-left: auto;
      display: flex;
      align-items: baseline;
      gap: 16px;
      span {
        font-size: 16px;
        color: var(--sub);
        white-space: pre;
      }
      b {
        font-family: "DIN";
        font-size: 32px;
        font-weight: normal;
      }
    }
  }
  .stage {
    position: absolute;
    left: 416px;
    top: 78px;
    width: 1088px;
    height: 734px;
    overflow: hidden; // 镜头拉近时楼层名、标签不要飘到两侧面板上
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .floor-label {
    position: absolute;
    transform: translate(calc(-100% - 18px), -50%);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    b {
      font-family: "DIN";
      font-size: 34px;
      line-height: 1;
    }
    span {
      margin-top: 4px;
      font-size: 14px;
      color: var(--sub);
      white-space: nowrap;
    }
  }
  .tag {
    position: absolute;
    padding: 0 12px;
    height: 30px;
    line-height: 30px;
    font-size: 15px;
    color: #fff;
    white-space: nowrap;
    &.start {
      background: var(--start);
      transform: translate(14px, -100%);
    }
    &.end {
      background: var(--end);
      transform: translate(calc(-100% - 14px), -100%);
    }
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--ground);
    font-size: 20px;
    color: var(--sub);
  }
</style>
