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

    <div v-if="loading" class="scene-loading">城市场景构建中</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { CityScene } from "./scene/CityScene"
  import { fetchCityData } from "./data/cityData"

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
  const view = ref({ heading: 0, scaleMeters: 0 })

  /** 三维场景实例，不做成响应式：内部持有大量 WebGL 对象，无需被 Vue 代理 */
  let scene = null
  /** 组件是否仍存活：异步取数期间用户可能已切走路由，之后不能再写状态或建场景 */
  let alive = true

  /** 几何数据路径：生产环境 base 为 /bi/，必须经 BASE_URL 拼接 */
  const GEOMETRY_URL = `${import.meta.env.BASE_URL}city/chengdu.json`

  async function fetchGeometry() {
    const res = await fetch(GEOMETRY_URL)
    if (!res.ok) throw new Error(`几何数据请求失败：HTTP ${res.status}`)
    return res.json()
  }

  /** 浏览器是否支持 WebGL */
  function hasWebGL() {
    const c = document.createElement("canvas")
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"))
  }

  onMounted(async () => {
    if (!hasWebGL()) {
      error.value = "当前浏览器不支持三维展示"
      loading.value = false
      return
    }
    // 业务数据为静态，先到位，面板可先渲染
    const data = await fetchCityData()
    if (!alive) return
    info.value = data.info
    metrics.value = data.metrics
    tags.value = data.tags
    flow.value = data.flow
    spots.value = data.spots

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
    scene = new CityScene({
      canvas: canvasRef.value,
      labelLayer: labelRef.value,
      container: pageRef.value,
      geometry,
      spots: data.spots,
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

  .scene-error {
    color: #c0392b;
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
       * 再用固定像素上抬 40px，竖线也固定 40px 正好连回锚点：
       * 远近镜头下引线长度一致，不随距离缩放
       */
      margin-top: -40px;
      padding: 7px 14px;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 4px 14px rgba(31, 45, 58, 0.18);
      white-space: nowrap;
      font-size: 14px;
      font-weight: 600;
      color: var(--city-ink);

      &::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 100%;
        width: 2px;
        height: 40px;
        background: var(--city-ink);
        opacity: 0.55;
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
  }
</style>
