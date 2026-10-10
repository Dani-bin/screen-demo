<!--
  城市级三维地图：成都高新区（../scene/map/CityWorld.js）
  透明 WebGL 画布叠在底座光环图上（同射阳应急大屏首页的做法）；
  悬浮街道显示街道卡片，悬浮高层楼宇显示名称与高度，点击双子塔园区卡片 / 光柱抛出 pick-park。
-->
<template>
  <div class="city-map">
    <div class="map-canvas">
      <img class="map-base" src="../assets/map-base.png" alt="" />
      <div class="map-gl map3d-scene">
        <canvas ref="canvasRef"></canvas>
      </div>

      <!-- 街道悬浮卡片 -->
      <div
        v-if="hoverStreet && streetPos"
        class="hover-card"
        :style="{ left: streetPos.left, top: streetPos.top }"
      >
        <div class="hc-name">
          {{ hoverStreet.name }}<small>高新区{{ hoverStreet.zone }}</small>
        </div>
        <div class="hc-row">
          <span>辖区面积</span><b class="num">{{ hoverStreet.area }}</b
          >km²
        </div>
        <div class="hc-row">
          <span>接入楼宇</span><b class="num">{{ hoverStreet.value }}</b
          >栋
        </div>
      </div>

      <!-- 高层楼宇悬浮提示 -->
      <div
        v-if="hoverTower && towerPos"
        class="hover-card tower"
        :style="{ left: towerPos.left, top: towerPos.top }"
      >
        <div class="hc-name">{{ hoverTower.tower.name }}</div>
        <div class="hc-row">
          <span>高度</span><b class="num">{{ hoverTower.tower.height }}</b
          >m
          <template v-if="hoverTower.tower.levels">
            <span class="gap">层数</span
            ><b class="num">{{ hoverTower.tower.levels }}</b
            >层
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { CityWorld } from "../scene/map/CityWorld"
  import { Assets } from "../scene/map/assets"
  import "../scene/map/labels.no-convert.css"
  import { MAP_CONFIG, NEIGHBORS, PARK, TOWERS } from "../data/mapData"
  import { STREET_BARS } from "../data/city"

  const emit = defineEmits(["pick-park", "ready"])

  const canvasRef = ref(null)
  let world = null
  let assets = null
  let destroyed = false

  /** 画布向上扩展的高度（设计稿 px，与样式 $gl-extend 一致），弹窗坐标要减掉 */
  const GL_EXTEND = 55
  /** 设计稿 px → 实际像素（amfe-flexible：根字号 = 屏宽 / 10，设计稿 1920 对应 192） */
  const remScale = () =>
    parseFloat(getComputedStyle(document.documentElement).fontSize) / 192

  const hoverName = ref(null)
  const hoverStreet = computed(
    () => STREET_BARS.find((s) => s.name === hoverName.value) || null
  )
  /** { tower, top }：top 为光柱顶部在地图局部坐标系的高度 */
  const hoverTower = shallowRef(null)

  /** 画布内像素 → .map-canvas 内坐标（画布顶部比容器高出 GL_EXTEND） */
  const toPos = (p) =>
    p ? { left: `${p.x}px`, top: `${p.y - GL_EXTEND * remScale()}px` } : null

  // 相机固定，锚点算一次即可；入场动画期间相机还在动，所以悬浮时再算
  const streetPos = computed(() =>
    world && hoverStreet.value
      ? toPos(world.toScreen(hoverStreet.value.center, world.depth + 0.9))
      : null
  )
  const towerPos = computed(() =>
    world && hoverTower.value
      ? toPos(
          world.toScreen(hoverTower.value.tower.center, hoverTower.value.top)
        )
      : null
  )

  onMounted(() => {
    assets = new Assets()
    assets.instance.on("onLoad", () => {
      if (destroyed || !canvasRef.value) return
      world = new CityWorld(canvasRef.value, assets, {
        mapConfig: MAP_CONFIG,
        streets: STREET_BARS,
        barUnit: "栋",
        // 立牌只给前 3 名：北部几个街道挨得近，5 块立牌加园区卡片会挤在一起
        labelLimit: 3,
        // 没有立牌的芳草街、肖家河街道在南区北端，名称挪到锚点北侧（上方空着），避开石羊街道的立牌
        flatNameOffset: -0.75,
        park: PARK,
        towers: TOWERS,
        neighbors: NEIGHBORS,
        // 地图在画布里的取景：南区居中，视点略偏南让地图上移、给南缘的大标题留位置
        camera: {
          end: [0, 11.8, 17.8],
          target: [0, 0, 2.8]
        },
        onHover: (name) => (hoverName.value = name),
        onHoverTower: (tower, top) =>
          (hoverTower.value = tower ? { tower, top } : null),
        onPickPark: () => emit("pick-park"),
        onPlayComplete: () => emit("ready")
      })
      world.play()
    })
  })

  onBeforeUnmount(() => {
    destroyed = true
    world?.destroy()
    world = null
    assets?.instance.destroy()
  })
</script>

<style lang="scss" scoped>
  /* 底座图 1053 × 914，等比缩到 977 宽 */
  $canvas-w: 977px;
  $canvas-h: 848px;
  /* WebGL 画布比底座图往上多出一段，北部立牌错开时有地方可去 */
  $gl-extend: 55px;

  .city-map {
    display: flex;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .map-canvas {
    position: relative;
    flex-shrink: 0;
    width: $canvas-w;
    height: $canvas-h;
  }

  .map-base {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .map-gl {
    position: absolute;
    inset: 0;
    top: -$gl-extend;

    /* 画布四周羽化：成都区县底图会铺到画布边缘，不羽化会露出一块方形亮区 */
    canvas {
      display: block;
      mask-image: radial-gradient(
        ellipse 50% 50% at 50% 50%,
        #000 72%,
        transparent 100%
      );
    }
  }

  .hover-card {
    position: absolute;
    z-index: 5;
    min-width: 168px;
    padding: 10px 14px;
    border: 1px solid rgba(74, 170, 255, 0.6);
    border-radius: 2px;
    background: rgba(6, 26, 56, 0.9);
    box-shadow: 0 0 16px rgba(30, 140, 255, 0.35);
    transform: translate(16px, -50%);
    pointer-events: none;
    white-space: nowrap;

    .hc-name {
      margin-bottom: 6px;
      font-size: 16px;
      font-weight: bold;
      color: #fff;

      small {
        margin-left: 8px;
        font-size: 12px;
        font-weight: normal;
        color: #7fb4e8;
      }
    }

    .hc-row {
      display: flex;
      align-items: baseline;
      gap: 4px;
      font-size: 12px;
      color: #8aa0bd;

      span {
        margin-right: 6px;
      }

      .gap {
        margin-left: 14px;
      }

      b {
        font-size: 18px;
        font-weight: normal;
        color: #2de2e6;
      }
    }

    &.tower {
      border-color: rgba(255, 198, 90, 0.6);

      .hc-row b {
        color: #ffd27a;
      }
    }
  }
</style>
