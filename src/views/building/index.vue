<!--
  数字楼宇大屏：城市 → 园区 → 楼宇 → 楼层 → 房间 五级钻取
  ----------------------------------------------------------
  本页只管级别切换与公共样式，每一级是 ./components/levels/ 下的一个组件：
    - 城市级 CityLevel：成都高新区三维地图（移植自射阳应急大屏首页的 Map3DScene）
    - 园区级 ParkLevel：成都金融城双子塔园区（Blender 建模 + 烘焙，three.js 展示，见 scene/park/）
    - 楼宇级 BuildingLevel：双子塔南塔 / 北塔全息剖切（烘焙楼层 + three.js，见 scene/tower/）
    - 楼层级 FloorLevel：标准办公层去顶俯视（Blender 精细楼层 + 烘焙，见 scene/floor/）
    - 房间级 RoomLevel：大会议室剖切近景与资产（Blender 房间模型 + 烘焙，设备实时光照，见 scene/room/）
  当前级别同步到路由参数 ?level=（楼宇级 / 楼层级另有 ?b=tower_S|tower_N，楼层级再加 ?f=32F），
  便于直接打开某一级（如 #/building?level=floor&b=tower_N&f=32F）；房间级目前只有各层的大会议室（#/building?level=room&b=tower_S&f=32F）。
-->
<template>
  <div class="building-page">
    <BuildingHead
      title="高新区数字楼宇"
      :current="level"
      :levels="LEVELS"
      @go="go"
    />
    <Transition name="lv" mode="out-in">
      <CityLevel v-if="level === 'city'" @enter-park="go('park')" />
      <ParkLevel
        v-else-if="level === 'park'"
        @back="go('city')"
        @enter-building="(b) => go('building', { b })"
      />
      <!-- 切换南北塔时 key 变化，整级重建（三维场景与面板数据都按塔楼生成） -->
      <BuildingLevel
        v-else-if="level === 'building'"
        :key="tower"
        :tower-key="tower"
        @back="go('park')"
        @switch="(b) => go('building', { b })"
        @enter-floor="(f) => go('floor', { f })"
      />
      <!-- 换塔整级重建（楼层模型按塔加载）；同一座塔换楼层只换数据 -->
      <FloorLevel
        v-else-if="level === 'floor'"
        :key="tower"
        :tower-key="tower"
        :floor-key="floorKey"
        @back="go('building')"
        @switch-floor="(f) => go('floor', { f })"
        @enter-room="go('room')"
      />
      <!-- 大会议室：换塔 / 换楼层都整级重建 -->
      <RoomLevel
        v-else-if="level === 'room'"
        :key="`${tower}-${floorKey}`"
        :tower-key="tower"
        :floor-key="floorKey"
        @back="go('floor')"
      />
    </Transition>
  </div>
</template>

<script setup>
  import BuildingHead from "./components/BuildingHead.vue"
  import CityLevel from "./components/levels/CityLevel.vue"
  import ParkLevel from "./components/levels/ParkLevel.vue"
  import BuildingLevel from "./components/levels/BuildingLevel.vue"
  import FloorLevel from "./components/levels/FloorLevel.vue"
  import RoomLevel from "./components/levels/RoomLevel.vue"
  import { towerFloors } from "./data/building"
  import { hasFloorModel } from "./data/floor"

  /** 五级钻取；ready 为已实现的级别（顶栏里可点击跳转） */
  const LEVELS = [
    { key: "city", name: "城市", label: "成都高新区", ready: true },
    { key: "park", name: "园区", label: "成都金融城双子塔", ready: true },
    { key: "building", name: "楼宇", label: "南塔 / 北塔", ready: true },
    { key: "floor", name: "楼层", label: "楼层平面", ready: true },
    { key: "room", name: "房间", label: "房间与资产", ready: true }
  ]

  const route = useRoute()
  const router = useRouter()
  const level = computed(() => {
    const q = route.query.level
    return LEVELS.some((l) => l.key === q && l.ready) ? q : "city"
  })

  /** 楼宇级当前塔楼：?b=tower_S | tower_N，默认南塔 */
  const tower = computed(() =>
    route.query.b === "tower_N" ? "tower_N" : "tower_S"
  )

  /** 楼层级当前楼层：?f=32F，只接受有精细模型的办公层，否则回到 32F */
  const floorKey = computed(() => {
    const f = towerFloors(tower.value).find((x) => x.key === route.query.f)
    return hasFloorModel(f) ? f.key : "32F"
  })

  /** 切换级别；extra 为附带的路由参数（如楼宇级的塔楼 b） */
  function go(key, extra = {}) {
    if (key === level.value && !Object.keys(extra).length) return
    router.replace({ query: { ...route.query, level: key, ...extra } })
  }
</script>

<style lang="scss">
  /*
   * 页面级共用样式（不加 scoped，统一挂在 .building-page 下）：两侧栏、底部提示。
   * 各级组件直接使用这些类名
   */
  .building-page {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: #e2ecf8;
    font-family: "Source Han Sans CN", sans-serif;
    font-size: 14px;
    background: #000b27;

    .num {
      font-family: "DIN", sans-serif;
      font-variant-numeric: tabular-nums;
    }

    /* 两侧栏：400 宽，背后各垫一张 550 × 1080 的侧边光晕 */
    .side {
      position: absolute;
      top: 96px;
      bottom: 40px;
      z-index: 3;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 400px;

      &::before {
        content: "";
        position: absolute;
        top: -96px;
        z-index: -1;
        width: 550px;
        height: 1080px;
        background-repeat: no-repeat;
        background-size: 550px 1080px;
        pointer-events: none;
      }
    }

    .side-left {
      left: 46px;

      &::before {
        left: -46px;
        background-image: url("./assets/left-bg.svg");
      }
    }

    .side-right {
      right: 46px;

      &::before {
        right: -46px;
        background-image: url("./assets/right-bg.svg");
      }
    }

    /* 面板通用：内容区、三列指标格（园区级、楼宇级共用） */
    .body {
      padding: 12px 4px 0;
    }

    .cells {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .cell {
      padding: 8px 0 6px;
      border-bottom: 2px solid rgba(47, 155, 255, 0.5);
      background: linear-gradient(
        180deg,
        rgba(20, 70, 140, 0) 0%,
        rgba(20, 70, 140, 0.35) 100%
      );
      text-align: center;

      b {
        font-size: 22px;
        font-weight: normal;
        color: #fff;
      }

      small {
        margin-left: 2px;
        font-size: 11px;
        color: #8aa0bd;
      }

      span {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: #8aa0bd;
      }

      &.gold {
        border-color: rgba(255, 198, 90, 0.7);
        background: linear-gradient(
          180deg,
          rgba(120, 80, 10, 0) 0%,
          rgba(120, 80, 10, 0.35) 100%
        );

        b {
          color: #ffd27a;
        }
      }

      &.cyan b {
        color: #2de2e6;
      }

      &.green b {
        color: #3ddc97;
      }
    }

    .bottom-tip {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 10px;
      z-index: 4;
      text-align: center;
      font-size: 12px;
      letter-spacing: 1px;
      color: rgba(138, 160, 189, 0.7);
      pointer-events: none;
    }
  }

  /* 级别切换：淡入淡出 */
  .lv-enter-active,
  .lv-leave-active {
    transition: opacity 0.45s ease;
  }

  .lv-enter-from,
  .lv-leave-to {
    opacity: 0;
  }
</style>
