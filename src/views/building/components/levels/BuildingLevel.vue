<!--
  楼宇级：成都金融城双子塔（南塔 / 北塔）全息剖切
  三维（../../scene/tower/BuildingScene.js）铺满整屏在底层，左右面板、面包屑与视图切换叠在上面；
  楼层导航、三维点击联动选中楼层（抽屉抽出），悬浮楼层弹出提示卡。
  设计稿：docs/design/building/12-draft-building.png
-->
<template>
  <div class="level tower-level">
    <div ref="stageRef" class="stage">
      <canvas ref="canvasRef"></canvas>
      <div ref="labelRef" class="label-layer"></div>
    </div>

    <div class="crumb">
      <span class="up" @click="$emit('back')">‹ 返回园区</span>
      <span>成都高新区</span><span>› 金融城双子塔园区</span>
      <span
        >› <b>{{ profile.short }}</b></span
      >
      <span class="switch">
        <i
          v-for="t in TOWERS"
          :key="t.key"
          :class="{ on: t.key === towerKey }"
          @click="$emit('switch', t.key)"
          >{{ t.name }}</i
        >
      </span>
    </div>

    <!-- 视图切换：楼层剖切 / 透视外立面 / 机电系统 / 人员热力 -->
    <div class="modes">
      <span
        v-for="m in MODES"
        :key="m.key"
        :class="{ on: m.key === mode }"
        @click="setMode(m.key)"
        >{{ m.name }}</span
      >
    </div>
    <div v-if="mode === 'heat'" class="heat-legend">
      <span>在岗密度</span><i></i><span>低</span><span>高</span>
    </div>
    <div v-if="mode === 'mep'" class="heat-legend mep">
      <span v-for="r in RISER_LEGEND" :key="r.name"
        ><i :style="{ background: r.color }"></i>{{ r.name }}</span
      >
    </div>

    <div class="side side-left">
      <BuildingProfile :profile="profile" />
      <FloorNav
        :floors="floors"
        :selected="selected"
        :hovered="hovered"
        @select="select"
        @hover="hoverFromNav"
        @enter="(f) => $emit('enter-floor', f)"
      />
      <StaffPanel :profile="profile" :curve="staffCurve" />
    </div>

    <div class="side side-right">
      <AssetBars :items="assets" />
      <ElevatorGrid :initial="elevators" :levels="profile.levels" />
      <EnergySplit :items="energy" />
    </div>

    <!-- 悬浮楼层提示卡：跟随鼠标 -->
    <div
      v-if="tip"
      class="floor-tip"
      :class="{ alarm: tip.floor.alarm }"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
    >
      <div class="hd">
        <b class="num">{{ tip.floor.key }}</b
        >{{ tip.floor.name }}
      </div>
      <div class="kv">
        <span v-if="tip.floor.occupancy != null"
          >入驻率<b class="num">{{ tip.floor.occupancy }}</b
          >%</span
        >
        <span
          >在岗<b class="num">{{ tip.floor.staff }}</b
          >人</span
        >
      </div>
      <div v-if="tip.floor.alarm" class="warn">{{ tip.floor.alarm }}</div>
      <div class="hint">点击抽出该层</div>
    </div>

    <div v-if="loading" class="scene-tip">楼层模型加载中</div>
    <div v-if="error" class="scene-tip err">{{ error }}</div>

    <div class="bottom-tip">
      点击楼层或楼层导航抽出该层 · 悬浮查看楼层信息 · 拖动旋转、滚轮缩放
      &nbsp;|&nbsp; 塔高、层数、平面与屋顶来自
      OpenStreetMap（竖向按示意比例压缩），业态与运营指标为演示数据
    </div>
  </div>
</template>

<script setup>
  import { BuildingScene } from "../../scene/tower/BuildingScene"
  import { PARK_TOWERS } from "../../data/parkData"
  import {
    towerAssets,
    towerElevators,
    towerEnergy,
    towerFloors,
    towerProfile,
    towerStaffCurve
  } from "../../data/building"
  import BuildingProfile from "../building/BuildingProfile.vue"
  import FloorNav from "../building/FloorNav.vue"
  import StaffPanel from "../building/StaffPanel.vue"
  import AssetBars from "../building/AssetBars.vue"
  import ElevatorGrid from "../building/ElevatorGrid.vue"
  import EnergySplit from "../building/EnergySplit.vue"

  const props = defineProps({
    /** tower_S 南塔 / tower_N 北塔 */
    towerKey: { type: String, default: "tower_S" }
  })
  defineEmits(["back", "switch", "enter-floor"])

  const TOWERS = [
    { key: "tower_S", name: "南塔" },
    { key: "tower_N", name: "北塔" }
  ]
  const MODES = [
    { key: "section", name: "楼层剖切" },
    { key: "facade", name: "透视外立面" },
    { key: "mep", name: "机电系统" },
    { key: "heat", name: "人员热力" }
  ]
  const RISER_LEGEND = [
    { name: "给水", color: "#3a8cff" },
    { name: "强电", color: "#b27bff" },
    { name: "新风", color: "#3ddc97" },
    { name: "消防", color: "#ff4d5a" },
    { name: "设备层", color: "rgba(61,220,151,0.5)" }
  ]

  // 塔楼切换时父组件用 :key 重建本组件，这里的数据只算一次
  const key = props.towerKey
  const profile = towerProfile(key)
  const floors = towerFloors(key)
  const assets = towerAssets(key)
  const elevators = towerElevators(key)
  const energy = towerEnergy(key)
  const staffCurve = towerStaffCurve(key)

  const stageRef = ref(null)
  const canvasRef = ref(null)
  const labelRef = ref(null)
  const mode = ref("section")
  // 默认选中 32F（设计稿里抽出的那一层）
  const selected = ref("32F")
  const hovered = ref(null)
  const tip = shallowRef(null)
  const loading = ref(true)
  const error = ref("")

  let scene = null

  function select(k) {
    selected.value = k
    scene?.select(k)
  }

  function setMode(m) {
    mode.value = m
    scene?.setMode(m)
  }

  /** 楼层导航悬浮 → 三维高亮（不弹提示卡，导航格子自己有 title） */
  function hoverFromNav(k) {
    hovered.value = k
    scene?._setHover(k)
  }

  onMounted(() => {
    scene = new BuildingScene({
      canvas: canvasRef.value,
      container: stageRef.value,
      labelLayer: labelRef.value,
      tower: PARK_TOWERS[key],
      floors,
      onHover: (p) => {
        hovered.value = p?.key || null
        const floor = p && floors.find((f) => f.key === p.key)
        tip.value = floor ? { floor, x: p.x, y: p.y } : null
      },
      onPick: (k) => select(k === selected.value ? null : k),
      // 烘焙楼层模型：tower_S.glb / tower_N.glb（scripts/blender/tower/）
      modelUrl: `${import.meta.env.BASE_URL}building/${key === "tower_N" ? "tower_N" : "tower_S"}.glb`
    })
    scene.select(selected.value)
    if (import.meta.env.DEV) window.__towerScene = scene
    scene.ready
      .catch((err) => {
        console.error(err)
        error.value = "楼层模型加载失败"
      })
      .finally(() => (loading.value = false))
  })

  onUnmounted(() => {
    scene?.dispose()
    scene = null
    if (import.meta.env.DEV) delete window.__towerScene
  })
</script>

<style lang="scss">
  /* 三维标签（CSS2D，DOM 由 scene/tower/BuildingScene.js 生成，scoped 样式够不着） */
  .tower-level .bd-label {
    padding: 4px 12px;
    border: 1px solid rgba(74, 170, 255, 0.75);
    background: rgba(5, 25, 60, 0.85);
    box-shadow: 0 0 10px rgba(30, 140, 255, 0.35);
    font-size: 13px;
    white-space: nowrap;
    color: #fff;
    pointer-events: none;

    &.left {
      transform: translateX(-60%);
    }

    &.right {
      transform: translateX(62%);
    }

    &.top {
      transform: translateY(-50%);
    }

    &.gold {
      border-color: #ffc65a;
      background: rgba(50, 32, 4, 0.9);
      box-shadow: 0 0 14px rgba(255, 190, 70, 0.5);
      color: #ffe6b0;
      transform: translate(55%, -60%);
    }

    &.red {
      border-color: #ff4d5a;
      background: rgba(60, 8, 14, 0.88);
      box-shadow: 0 0 14px rgba(255, 60, 70, 0.5);
      color: #ffd0d4;
    }
  }
</style>

<style lang="scss" scoped>
  .level {
    position: absolute;
    inset: 0;
  }

  .stage {
    position: absolute;
    inset: 0;
    z-index: 1;

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
  }

  /* 两侧压暗，面板文字清晰；中间的塔楼保持通透 */
  .stage::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      rgba(2, 10, 28, 0.85) 0,
      rgba(2, 10, 28, 0.5) 20%,
      rgba(2, 10, 28, 0) 28%,
      rgba(2, 10, 28, 0) 72%,
      rgba(2, 10, 28, 0.5) 80%,
      rgba(2, 10, 28, 0.85) 100%
    );
    pointer-events: none;
  }

  .label-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .crumb {
    position: absolute;
    left: 471px;
    top: 92px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 977px;
    font-size: 14px;
    color: #8fb4dc;

    b {
      font-weight: normal;
      color: #fff;
    }

    .up {
      margin-right: 10px;
      padding: 2px 12px;
      border: 1px solid rgba(74, 170, 255, 0.5);
      background: rgba(8, 40, 90, 0.6);
      color: #9cd2ff;
      cursor: pointer;

      &:hover {
        color: #fff;
        border-color: #4aa8ff;
      }
    }

    .switch {
      display: flex;
      margin-left: 14px;
      border: 1px solid rgba(255, 198, 90, 0.5);

      i {
        padding: 1px 12px;
        font-style: normal;
        color: #c9b48a;
        cursor: pointer;

        &.on {
          background: rgba(150, 100, 20, 0.6);
          color: #ffe6b0;
        }
      }
    }
  }

  .modes {
    position: absolute;
    left: 470px;
    top: 130px;
    z-index: 5;
    display: flex;

    span {
      padding: 6px 16px;
      border: 1px solid rgba(74, 170, 255, 0.45);
      margin-right: -1px;
      background: rgba(6, 30, 70, 0.7);
      font-size: 13px;
      color: #9cc4ec;
      cursor: pointer;

      &.on {
        border-color: #4aa8ff;
        background: linear-gradient(
          180deg,
          rgba(40, 120, 220, 0.55),
          rgba(20, 70, 150, 0.75)
        );
        color: #fff;
        box-shadow: inset 0 -2px 0 #59d6ff;
      }
    }
  }

  .heat-legend {
    position: absolute;
    left: 470px;
    top: 172px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #8aa0bd;

    i {
      width: 120px;
      height: 8px;
      background: linear-gradient(90deg, #1a59ff, #1ae6f2, #ffd940, #ff4033);
    }

    &.mep i {
      width: 14px;
      height: 3px;
      margin-right: 4px;
      vertical-align: 3px;
      display: inline-block;
    }
  }

  .scene-tip {
    position: absolute;
    left: 50%;
    bottom: 70px;
    z-index: 5;
    font-size: 14px;
    letter-spacing: 3px;
    color: #2de2e6;
    transform: translateX(-50%);
    pointer-events: none;

    &.err {
      color: #ff3b47;
    }
  }

  .floor-tip {
    position: absolute;
    z-index: 6;
    min-width: 190px;
    padding: 8px 12px;
    border: 1px solid rgba(74, 170, 255, 0.7);
    background: rgba(5, 22, 52, 0.92);
    box-shadow: 0 0 14px rgba(30, 140, 255, 0.4);
    transform: translate(18px, -50%);
    pointer-events: none;

    .hd {
      font-size: 14px;
      color: #fff;

      b {
        margin-right: 8px;
        font-size: 18px;
        font-weight: normal;
        color: #59d6ff;
      }
    }

    .kv {
      display: flex;
      gap: 14px;
      margin-top: 4px;
      font-size: 12px;
      color: #8aa0bd;

      b {
        margin: 0 3px 0 5px;
        font-size: 16px;
        font-weight: normal;
        color: #2de2e6;
      }
    }

    .warn {
      margin-top: 6px;
      padding: 2px 6px;
      background: rgba(255, 77, 90, 0.15);
      font-size: 12px;
      color: #ff8a92;
    }

    .hint {
      margin-top: 4px;
      font-size: 11px;
      color: rgba(138, 160, 189, 0.8);
    }

    &.alarm {
      border-color: #ff4d5a;
    }
  }
</style>
