<!--
  园区级：成都金融城双子塔 · 天府国际金融中心
  三维（../../scene/park/ParkScene.js）铺满整屏在底层，左右面板与面包屑叠在上面；
  点击楼栋 / 楼栋一览 / 告警 → 三维里选中该楼，并在楼顶上方弹出楼栋信息卡。
  设计稿：docs/design/building/11-draft-park.png
-->
<template>
  <div class="level park-level">
    <div ref="stageRef" class="stage">
      <canvas ref="canvasRef"></canvas>
      <div ref="labelRef" class="label-layer"></div>
    </div>

    <div class="crumb">
      <span class="up" @click="$emit('back')">‹ 返回城市</span>
      <span>成都高新区</span><span>› 桂溪街道</span>
      <span>› <b>成都金融城双子塔园区</b></span>
    </div>

    <div class="side side-left">
      <ParkSummary />
      <BuildingList :selected="selected" @select="select" />
      <EnergyPanel />
    </div>

    <div class="side side-right">
      <SecurityPanel />
      <DevicePanel />
      <ParkAlarms @locate="select" />
    </div>

    <!-- 选中楼栋的信息卡：跟随楼顶在屏幕上的位置 -->
    <div
      v-if="card && cardPos"
      class="bld-card"
      :class="{ gold: card.kind === 'tower' }"
      :style="{ left: cardPos.x + 'px', top: cardPos.y + 'px' }"
    >
      <div class="hd">
        <span
          >{{
            card.kind === "tower"
              ? "成都金融城双子塔 · "
              : "天府国际金融中心 · "
          }}{{ card.short }}</span
        >
        <i @click="select(null)">×</i>
      </div>
      <div class="kv">
        <span
          >高度<b class="num">{{ card.height }}</b
          >m</span
        >
        <span
          >楼层<b class="num">{{ card.levels }}</b
          >F</span
        >
        <span
          >入驻率<b class="num">{{ card.occupancy }}</b
          >%</span
        >
        <span v-if="card.tenants"
          >企业<b class="num">{{ card.tenants }}</b
          >家</span
        >
      </div>
      <div v-if="card.status === 'alarm'" class="warn">
        冷却塔 2# 风机振动偏大 · 16:05
      </div>
      <button
        v-if="card.kind === 'tower'"
        class="enter on"
        @click="$emit('enter-building', card.key)"
      >
        进入楼宇 ›
      </button>
      <button v-else class="enter" disabled>楼宇级仅开放双子塔</button>
    </div>

    <div v-if="loading" class="scene-tip">园区模型加载中</div>
    <div v-if="error" class="scene-tip err">{{ error }}</div>

    <div class="bottom-tip">
      点击楼栋查看信息 · 点击告警定位 · 拖动旋转、滚轮缩放 &nbsp;|&nbsp;
      园区布局与楼高来自 OpenStreetMap，运营指标为演示数据
    </div>
  </div>
</template>

<script setup>
  import { ParkScene } from "../../scene/park/ParkScene"
  import {
    PARK_BUILDINGS,
    PARK_ROADS,
    PARK_PATHS,
    PARK_WATERS,
    PARK_BOUNDS
  } from "../../data/parkData"
  import { BUILDING_LIST, BUILDING_STATUS } from "../../data/park"
  import ParkSummary from "../park/ParkSummary.vue"
  import BuildingList from "../park/BuildingList.vue"
  import EnergyPanel from "../park/EnergyPanel.vue"
  import SecurityPanel from "../park/SecurityPanel.vue"
  import DevicePanel from "../park/DevicePanel.vue"
  import ParkAlarms from "../park/ParkAlarms.vue"

  defineEmits(["back", "enter-building"])

  const stageRef = ref(null)
  const canvasRef = ref(null)
  const labelRef = ref(null)
  const loading = ref(true)
  const error = ref("")
  const selected = ref(null)
  const cardPos = ref(null)

  const card = computed(
    () => BUILDING_LIST.find((b) => b.key === selected.value) || null
  )

  let scene = null
  let alive = true
  let raf = 0

  /** 选中楼栋（列表 / 告警 / 三维点击都走这里），三维侧选中后回调 onPick 同步 selected */
  function select(key) {
    if (scene) scene.select(key)
    else selected.value = key
  }

  /** 信息卡跟随楼顶：相机会被拖动或空闲回位，每帧更新一次位置 */
  function trackCard() {
    if (scene && selected.value) {
      const p = scene.screenPos(selected.value)
      const rect = stageRef.value?.getBoundingClientRect()
      const pageRect = stageRef.value?.parentElement.getBoundingClientRect()
      cardPos.value =
        p && rect
          ? {
              x: p.x + rect.left - pageRect.left,
              y: p.y + rect.top - pageRect.top
            }
          : null
    }
    raf = requestAnimationFrame(trackCard)
  }

  onMounted(async () => {
    try {
      scene = new ParkScene({
        canvas: canvasRef.value,
        container: stageRef.value,
        labelLayer: labelRef.value,
        baseUrl: import.meta.env.BASE_URL,
        buildings: PARK_BUILDINGS,
        roads: PARK_ROADS,
        paths: PARK_PATHS,
        waters: PARK_WATERS,
        bounds: PARK_BOUNDS,
        status: BUILDING_STATUS,
        onPick: (key) => (selected.value = key)
      })
      await scene.load()
      if (import.meta.env.DEV) window.__parkScene = scene
    } catch (err) {
      console.error(err)
      error.value = "园区模型加载失败"
    }
    if (!alive) return
    loading.value = false
    trackCard()
  })

  onUnmounted(() => {
    alive = false
    cancelAnimationFrame(raf)
    scene?.dispose()
    scene = null
    if (import.meta.env.DEV) delete window.__parkScene
  })
</script>

<style lang="scss">
  /*
   * 园区级共用样式（不加 scoped）：状态标签（面板通用的 body / 指标格在 index.vue），
   * 以及 three.js CSS2D 楼栋标签（DOM 由 scene/park/markers.js 生成，scoped 样式够不着）
   */
  .park-level {
    .tag {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: 2px;
      font-size: 12px;

      &.ok {
        background: rgba(61, 220, 151, 0.15);
        color: #3ddc97;
      }

      &.warn {
        background: rgba(255, 159, 67, 0.18);
        color: #ff9f43;
      }

      &.err {
        background: rgba(255, 77, 90, 0.2);
        color: #ff4d5a;
      }

      &.info {
        background: rgba(47, 155, 255, 0.2);
        color: #59b2ff;
      }
    }

    /* 楼栋标签（CSS2D）：标签框 + 竖线指向楼顶 */
    .pk-label {
      cursor: pointer;
      pointer-events: auto;
      white-space: nowrap;

      .pk-label-box {
        padding: 3px 10px;
        border: 1px solid rgba(74, 170, 255, 0.7);
        background: rgba(5, 25, 60, 0.85);
        box-shadow: 0 0 10px rgba(30, 140, 255, 0.35);
        font-size: 13px;
        color: #fff;
        transition:
          transform 0.2s,
          box-shadow 0.2s;

        small {
          margin-left: 6px;
          font-family: "DIN", sans-serif;
          font-size: 12px;
          color: #8fc3ff;
        }
      }

      .pk-label-stem {
        width: 1px;
        height: 22px;
        margin: 0 auto;
        background: linear-gradient(
          rgba(74, 170, 255, 0.9),
          rgba(74, 170, 255, 0)
        );
      }

      &.gold {
        .pk-label-box {
          border-color: #ffc65a;
          background: rgba(50, 32, 4, 0.88);
          color: #ffe6b0;
          box-shadow: 0 0 14px rgba(255, 190, 70, 0.45);

          small {
            color: #ffd27a;
          }
        }

        .pk-label-stem {
          background: linear-gradient(#ffc65a, rgba(255, 198, 90, 0));
        }
      }

      /* 向两侧错开的标签（双子塔）：竖线放在靠近楼的一端 */
      &.to-left .pk-label-stem {
        margin: 0 8% 0 auto;
      }

      &.to-right .pk-label-stem {
        margin: 0 auto 0 8%;
      }

      &.alarm .pk-label-box {
        border-color: #ff4d5a;
        box-shadow: 0 0 14px rgba(255, 60, 70, 0.45);
      }

      &.active .pk-label-box,
      &:hover .pk-label-box {
        transform: translateY(-3px);
        box-shadow: 0 0 18px rgba(80, 200, 255, 0.7);
      }
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

  /* 两侧压暗：沙盘两端伸到面板下面时，面板文字仍清晰；也呼应设计稿两侧暗、中间亮的构图 */
  .stage::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      rgba(2, 10, 28, 0.88) 0,
      rgba(2, 10, 28, 0.55) 20%,
      rgba(2, 10, 28, 0) 28%,
      rgba(2, 10, 28, 0) 72%,
      rgba(2, 10, 28, 0.55) 80%,
      rgba(2, 10, 28, 0.88) 100%
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
  }

  .bld-card {
    position: absolute;
    z-index: 6;
    width: 280px;
    padding: 10px 14px 12px;
    border: 1px solid rgba(74, 170, 255, 0.7);
    background: rgba(5, 22, 52, 0.92);
    box-shadow: 0 0 18px rgba(30, 140, 255, 0.4);
    transform: translate(28px, -110%);
    pointer-events: auto;

    .hd {
      display: flex;
      justify-content: space-between;
      font-size: 16px;
      font-weight: bold;
      color: #fff;

      i {
        font-style: normal;
        color: #8aa0bd;
        cursor: pointer;
      }
    }

    .kv {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 10px;
      margin-top: 8px;
      font-size: 12px;
      color: #8aa0bd;

      b {
        margin: 0 3px 0 6px;
        font-size: 18px;
        font-weight: normal;
        color: #2de2e6;
      }
    }

    .warn {
      margin-top: 8px;
      padding: 4px 8px;
      background: rgba(255, 77, 90, 0.15);
      font-size: 12px;
      color: #ff8089;
    }

    .enter {
      width: 100%;
      margin-top: 10px;
      padding: 5px 0;
      border: 1px solid rgba(74, 170, 255, 0.4);
      background: transparent;
      font-size: 13px;
      color: rgba(156, 210, 255, 0.6);

      &.on {
        border-color: #ffc65a;
        background: rgba(150, 100, 20, 0.45);
        color: #ffe6b0;
        cursor: pointer;

        &:hover {
          background: rgba(190, 130, 30, 0.6);
        }
      }
    }

    &.gold {
      border-color: #ffc65a;
      box-shadow: 0 0 18px rgba(255, 190, 70, 0.45);

      .hd {
        color: #ffe6b0;
      }

      .kv b {
        color: #ffd27a;
      }
    }
  }

  .scene-tip {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    letter-spacing: 3px;
    color: #2de2e6;
    pointer-events: none;

    &.err {
      color: #ff3b47;
    }
  }
</style>
