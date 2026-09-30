<!--
  城市三维总览页
  ----------------------------------------------------------
  页面只负责布局、取数与事件转接；三维逻辑全部在 ./scene 下，
  不含任何 Vue 依赖，可独立调试。

  与应急指挥各页面完全独立：不加载百度地图、不使用 useSharedMap、
  不复用 Head.vue。
-->
<template>
  <div ref="pageRef" class="city-page">
    <!-- 三维城市：铺满整页，所有面板浮于其上 -->
    <canvas ref="canvasRef" class="city-canvas"></canvas>
    <!-- CSS2D 标签层：与画布同尺寸，不拦截鼠标 -->
    <div ref="labelRef" class="city-labels"></div>

    <CityHead :info="info" :playing="playing" />

    <!-- 左栏：城市总览 + 热门景点客流 -->
    <div class="col-left">
      <OverviewPanel :metrics="metrics" :tags="tags" />
      <FlowPanel :flow="flow" />
    </div>

    <!-- 右栏：当前景点介绍，随巡览站点切换 -->
    <div class="col-right">
      <SpotPanel
        v-if="currentSpot"
        :spot="currentSpot"
        :index="current"
        :total="spots.length"
      />
    </div>

    <!-- 右侧工具栏：scene 非响应式，模板不直接依赖它，事件统一经 script 内的方法转接 -->
    <MapTools
      :playing="playing"
      @reset="handleReset"
      @zoom-in="handleZoomIn"
      @zoom-out="handleZoomOut"
      @fullscreen="toggleFullscreen"
      @toggle-play="handleTogglePlay"
    />

    <TourBar :spots="spots" :current="current" @select="handleSelectStop" />

    <Compass :heading="view.heading" :scale-meters="view.scaleMeters" />

    <!-- 第二行随巡览状态切换；空闲秒数取自 THEME.tour.idle，与巡览逻辑同源 -->
    <div class="operate-hint">
      拖动旋转 · 滚轮缩放 · 点击楼体查看<br />
      <template v-if="playing">景点自动巡览中</template>
      <template v-else>
        已接管，<em>{{ idleSeconds }}s</em> 无操作后自动恢复巡览
      </template>
    </div>

    <!-- OpenStreetMap 数据按 ODbL 协议使用，必须保留署名 -->
    <div class="osm-credit">
      地图数据 ©
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener"
        >OpenStreetMap contributors</a
      >
    </div>

    <div v-if="loading" class="scene-loading">城市场景构建中</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { CityScene } from "./scene/CityScene"
  import { fetchCityData } from "./data/cityData"
  import CityHead from "./components/CityHead.vue"
  import OverviewPanel from "./components/OverviewPanel.vue"
  import FlowPanel from "./components/FlowPanel.vue"
  import SpotPanel from "./components/SpotPanel.vue"
  import TourBar from "./components/TourBar.vue"
  import MapTools from "./components/MapTools.vue"
  import Compass from "./components/Compass.vue"
  import screenfull from "screenfull"
  import { THEME } from "./scene/theme"

  /** 人工接管后恢复巡览的空闲秒数，供操作提示显示 */
  const idleSeconds = THEME.tour.idle

  /**
   * 景点标签避让的顶部保留带（设计稿 px）：CityHead 顶栏高 74px（标题、时钟、天气都在其中），
   * 再留 6px 余量。标签框顶压进这一带时由场景避让（当前站先下压、压不下再隐藏，其余隐藏）
   */
  const LABEL_SAFE_TOP = 80

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const labelRef = ref(null)
  const loading = ref(true)
  const error = ref("")

  const info = ref({})
  const metrics = ref([])
  const tags = ref([])
  const flow = ref([])
  const spots = ref([])

  /** 当前停靠的景点索引 */
  const current = ref(0)
  /** 是否处于自动巡览状态 */
  const playing = ref(true)
  /** 视角信息：指北针方位与比例尺 */
  // 每次都整体替换对象，无需深层响应，用 shallowRef 省去代理开销
  const view = shallowRef({ heading: 0, scaleMeters: 0 })

  /*
   * 深链接起始站：#/city?spot=N 让巡览从第 N 站开始（飞抵后照常停留、再去下一站），
   * 用于分享某个景点的大屏画面、逐景点截图验收。缺省或非法时为 NaN，由场景回退到第 0 站
   */
  const route = useRoute()
  const startStop = Number.parseInt(route.query.spot, 10)

  /** 三维场景实例，不做成响应式：内部持有大量 WebGL 对象，无需被 Vue 代理 */
  let scene = null
  /** 组件是否仍存活：异步取数期间用户可能已切走路由，之后不能再写状态或建场景 */
  let alive = true

  /** 当前停靠的景点数据；数据未到位时为 null，右栏不渲染 */
  const currentSpot = computed(() => spots.value[current.value] || null)

  /*
   * 工具栏与导览条的事件处理。
   * scene 不是响应式的，模板不宜直接依赖它；
   * 统一经 script 内的方法转接，场景未就绪（加载中或降级）时静默忽略。
   */
  /** 点击底部导览条，飞往指定景点 */
  const handleSelectStop = (index) => scene?.gotoStop(index)
  /** 复位到城市总览视角 */
  const handleReset = () => scene?.gotoOverview()
  const handleZoomIn = () => scene?.zoomIn()
  const handleZoomOut = () => scene?.zoomOut()
  /** 暂停 / 恢复自动巡览；playing 由场景回调同步，不在这里直接改 */
  const handleTogglePlay = () => scene?.setPlaying(!playing.value)

  /** 全屏切换：以整页为全屏元素，面板一起进入全屏 */
  const toggleFullscreen = () => {
    if (!screenfull.isEnabled) return
    // 浏览器拒绝全屏（权限策略、非用户手势等）时只记录，不打断页面
    screenfull.toggle(pageRef.value).catch((err) => console.warn(err))
  }

  /** 几何数据路径：生产环境 base 为 /bi/，必须经 BASE_URL 拼接 */
  const GEOMETRY_URL = `${import.meta.env.BASE_URL}city/chengdu.json`

  /** 拉取预处理好的几何数据 */
  async function fetchGeometry() {
    const res = await fetch(GEOMETRY_URL)
    if (!res.ok) throw new Error(`几何数据请求失败：HTTP ${res.status}`)
    return res.json()
  }

  /** 浏览器是否支持 WebGL */
  function hasWebGL() {
    const c = document.createElement("canvas")
    const gl = c.getContext("webgl2") || c.getContext("webgl")
    // 探测用的上下文立即丢弃，不占用浏览器有限的 WebGL 上下文名额
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    return Boolean(gl)
  }

  onMounted(async () => {
    // 业务数据为静态，先到位，面板可先渲染；
    // 放在 WebGL 检测之前，浏览器不支持三维时面板照常显示
    const data = await fetchCityData()
    if (!alive) return
    info.value = data.info
    metrics.value = data.metrics
    tags.value = data.tags
    flow.value = data.flow
    spots.value = data.spots

    // 不支持 WebGL：只降级三维场景，跳过几何数据请求
    if (!hasWebGL()) {
      error.value = "当前浏览器不支持三维展示"
      loading.value = false
      return
    }

    // 几何数据失败只影响三维场景，面板照常显示
    let geometry
    try {
      geometry = await fetchGeometry()
    } catch (err) {
      console.error(err)
      error.value = "城市数据加载失败"
      loading.value = false
      return
    }
    if (!alive) return

    // 等面板渲染完成、容器尺寸确定后再创建场景，避免首帧按 0 尺寸初始化
    await nextTick()
    if (!alive) return
    // 构造失败（WebGL 上下文创建失败等）时 CityScene 已自行释放资源，这里只做降级提示
    try {
      scene = new CityScene({
        canvas: canvasRef.value,
        labelLayer: labelRef.value,
        container: pageRef.value,
        geometry,
        spots: data.spots,
        startStop,
        labelSafeTop: LABEL_SAFE_TOP,
        onStopChange: (index) => {
          current.value = index
        },
        onPlayingChange: (value) => {
          playing.value = value
        },
        onViewChange: (v) => {
          view.value = v
        }
      })
    } catch (err) {
      console.error(err)
      error.value = "三维场景初始化失败"
      loading.value = false
      return
    }
    // 首帧渲染完成后再撤掉加载提示
    requestAnimationFrame(() => {
      loading.value = false
    })
  })

  onUnmounted(() => {
    alive = false
    if (scene) {
      scene.dispose()
      scene = null
    }
  })
</script>

<style lang="scss" scoped>
  .city-page {
    --city-teal: #2f8f96;
    --city-ink: #1f2d3a;
    --city-ink-soft: #5c6b78;
    --city-panel: rgba(255, 255, 255, 0.88);
    --city-line: rgba(31, 45, 58, 0.1);

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f6f3ec;
  }

  .city-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    /* 大屏触摸屏：禁止浏览器接管手势，否则会发 pointercancel，拖拽转不动视角 */
    touch-action: none;
  }

  .city-labels {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  .scene-loading,
  .scene-error {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    letter-spacing: 3px;
    color: #2f8f96;
    background: #f6f3ec;
  }

  /*
   * 错误提示只替代三维场景，不遮挡面板：层级压到面板（4）与标签层（3）之下，
   * 背景透明、不拦截鼠标，面板与导览条照常可见
   */
  .scene-error {
    z-index: 2;
    color: #c0392b;
    background: transparent;
    pointer-events: none;
  }

  /* 左右两栏面板：浮于三维画布之上，右栏为右侧工具栏留出位置 */
  .col-left,
  .col-right {
    position: absolute;
    top: 92px;
    z-index: 4;
    width: 380px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .col-left {
    left: 28px;
  }

  .col-right {
    right: 88px;
  }

  /* 左下角操作提示 */
  .operate-hint {
    position: absolute;
    left: 28px;
    bottom: 26px;
    z-index: 4;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--city-panel);
    font-size: 12px;
    line-height: 1.8;
    color: var(--city-ink-soft);

    em {
      font-style: normal;
      font-weight: 600;
      color: var(--city-teal);
    }
  }

  /* OSM 署名：操作提示下方的一行小字，不与其他控件重叠；半透明白底保证压在地图上也看得清 */
  .osm-credit {
    position: absolute;
    left: 28px;
    bottom: 8px;
    z-index: 4;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.72);
    font-size: 11px;
    line-height: 14px;
    color: var(--city-ink-soft);

    a {
      color: inherit;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
</style>

<!--
  标签、气泡与面板外观为页面级共享样式，不加 scoped：
  CSS2D 元素由三维层动态创建，子组件内部元素也拿不到父组件的 scoped 属性，
  统一挂在 .city-page 下，既能命中，又不会泄漏到全局。
-->
<style lang="scss">
  .city-page {
    /* 定位由 CSS2DRenderer 内联 transform 接管（锚点见 markers.js 的 center），这里不写 transform */
    .city-label {
      /*
       * 标签底边锚在落点球顶上（markers.js 的 center 为底边中点），
       * 再用固定像素上抬 --lead（40px，与 markers.js 的 LABEL_LEAD 一致），竖线也是 --lead 长，
       * 正好连回锚点：远近镜头下引线长度一致，不随距离缩放。
       * 当前站标签压到顶栏时，场景在元素上内联改写 --lead（屏幕 px）缩短引线、把标签往下压。
       * 默认值必须写成普通声明而不是 var() 的回退值：pxtorem 不转换 var() 里的 px
       */
      --lead: 40px;

      margin-top: calc(-1 * var(--lead));
      padding: 7px 14px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 4px 14px rgba(31, 45, 58, 0.18);
      white-space: nowrap;
      font-size: 14px;
      font-weight: 600;
      color: var(--city-ink);
      /* 显示时 visibility 立即恢复、透明度淡入 */
      transition:
        opacity 0.3s,
        visibility 0s;

      &::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 100%;
        width: 2px;
        height: var(--lead);
        background: var(--city-ink);
        opacity: 0.55;
      }

      /*
       * 标签压到顶栏时淡出隐藏（当前站先缩短引线下压，压不下才隐藏，见 markers.js 的 avoidTop）。
       * 淡出结束（0.3s）后再设 visibility: hidden，隐藏的标签不再参与绘制与无障碍树
       */
      &.is-clipped {
        opacity: 0;
        visibility: hidden;
        transition:
          opacity 0.3s,
          visibility 0s 0.3s;
      }

      small {
        display: block;
        font-size: 9px;
        letter-spacing: 2px;
        color: var(--city-teal);
        font-weight: 500;
      }

      &.is-active {
        font-size: 16px;
        padding: 9px 18px;
        border: 2px solid var(--city-teal);
      }
    }

    .city-bubble {
      /* 与楼顶留出固定像素间距 */
      margin-top: -8px;
      padding: 6px 12px;
      border-radius: 6px;
      background: var(--city-ink);
      color: #fff;
      white-space: nowrap;
      font-size: 13px;
      box-shadow: 0 4px 14px rgba(31, 45, 58, 0.25);

      b {
        font-weight: 600;
        margin-right: 8px;
      }

      span {
        color: rgba(255, 255, 255, 0.75);
      }
    }

    /* 面板共享外观：半透明白色圆角卡片 */
    .panel {
      padding: 16px 18px;
      border-radius: 12px;
      background: var(--city-panel);
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 28px rgba(31, 45, 58, 0.12);
    }

    .panel-title {
      display: flex;
      align-items: baseline;
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 2px;
      color: var(--city-ink);

      /* 标题左侧的青绿色竖条 */
      &::before {
        content: "";
        display: inline-block;
        width: 4px;
        height: 14px;
        margin-right: 8px;
        border-radius: 2px;
        background: var(--city-teal);
        vertical-align: -1px;
      }
    }

    .title-en {
      margin-left: auto;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--city-teal);
    }
  }
</style>
