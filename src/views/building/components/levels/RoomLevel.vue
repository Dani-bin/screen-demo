<!--
  房间级：大会议室剖切近景（设计稿 docs/design/building/14-draft-room.png）
  三维（../../scene/room/RoomScene.js）铺满整屏在底层，左右面板、面包屑与资产分类切换叠在上面；
  资产清单、三维设备、设备图标三者联动：悬浮高亮、点击选中，右侧资产详情 / 实时曲线 / 运维记录跟着切换。
  所有楼层的大会议室共用一个房间模型（scripts/blender/tower/room.py），数据按塔楼 + 楼层生成。
-->
<template>
  <div class="level room-level">
    <div ref="stageRef" class="stage">
      <canvas ref="canvasRef"></canvas>
      <div ref="labelRef" class="label-layer"></div>
    </div>

    <div class="crumb">
      <span class="up" @click="$emit('back')">‹ 返回楼层</span>
      <span>{{ towerName }}</span
      ><span>› {{ detail.floor.key }}</span>
      <span
        >› <b>{{ detail.room.id }} {{ detail.room.name }}</b></span
      >
    </div>

    <!-- 资产分类：全部 / 暖通 / 安防 / 消防 / 照明 -->
    <div class="modes">
      <span
        v-for="c in ASSET_CATS"
        :key="c.key"
        :class="{ on: c.key === cat }"
        @click="setCat(c.key)"
        >{{ c.name }}</span
      >
    </div>

    <div class="side side-left">
      <RoomInfo
        :room="detail.room"
        :info="detail.info"
        :bookings="detail.bookings"
        :hour="detail.hour"
      />
      <RoomEnv :env="detail.env" />
      <AssetList
        :assets="detail.assets"
        :cat="cat"
        :selected="selected"
        :hovered="hovered"
        @select="select"
        @hover="hoverFromList"
      />
    </div>

    <div class="side side-right">
      <AssetDetail v-if="current" :asset="current" />
      <AssetCurve
        v-if="current"
        :values="current.curve"
        :name="current.curveName"
        :hour="detail.hour"
      />
      <OpsRecords v-if="current" :records="current.records" />
    </div>

    <!-- 悬浮设备提示卡 -->
    <div
      v-if="tip"
      class="dev-tip"
      :class="tip.asset.level"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
    >
      <div class="hd">{{ tip.asset.name }}</div>
      <div class="kv">
        <span class="num">{{ tip.asset.id }}</span>
        <b>{{ tip.asset.reading }}</b>
      </div>
      <div class="hint">点击查看资产卡片</div>
    </div>

    <div v-if="loading" class="scene-tip">房间模型加载中</div>
    <div v-if="error" class="scene-tip err">{{ error }}</div>

    <div class="bottom-tip">
      点击设备或资产清单查看资产卡片 · 悬停查看实时读数 · 拖动旋转、滚轮缩放
      &nbsp;|&nbsp; 房间布局、设备、品牌型号与运营数据为演示数据
    </div>
  </div>
</template>

<script setup>
  import { RoomScene } from "../../scene/room/RoomScene"
  import { ASSET_CATS, roomDetail } from "../../data/room"
  import RoomInfo from "../room/RoomInfo.vue"
  import RoomEnv from "../room/RoomEnv.vue"
  import AssetList from "../room/AssetList.vue"
  import AssetDetail from "../room/AssetDetail.vue"
  import AssetCurve from "../room/AssetCurve.vue"
  import OpsRecords from "../room/OpsRecords.vue"

  const props = defineProps({
    towerKey: { type: String, default: "tower_S" },
    floorKey: { type: String, default: "32F" }
  })
  defineEmits(["back"])

  const towerName = props.towerKey === "tower_N" ? "北塔" : "南塔"
  // 换房间时父组件用 :key 重建本组件，这里只算一次
  const detail = roomDetail(props.towerKey, props.floorKey)

  const stageRef = ref(null)
  const canvasRef = ref(null)
  const labelRef = ref(null)
  const cat = ref("all")
  // 默认选中空调内机 AC-01（设计稿资产卡片展示的那台）
  const selected = ref(detail.assets[0].id)
  const hovered = ref(null)
  const tip = shallowRef(null)
  const loading = ref(true)
  const error = ref("")
  const current = computed(() =>
    detail.assets.find((a) => a.id === selected.value)
  )

  let scene = null

  function select(id) {
    if (!id) return // 点空白处不取消选中：右侧资产卡片始终有内容
    selected.value = id
    scene?.select(id)
  }

  function setCat(c) {
    cat.value = c
    scene?.setCategory(c)
    // 当前选中的资产不在新分类里：选中该分类的第一件
    const a = current.value
    if (c !== "all" && a && a.cat !== c) {
      const first = detail.assets.find((x) => x.cat === c)
      if (first) select(first.id)
    }
  }

  function hoverFromList(id) {
    hovered.value = id
    scene?._setHover(id)
  }

  onMounted(() => {
    scene = new RoomScene({
      canvas: canvasRef.value,
      container: stageRef.value,
      labelLayer: labelRef.value,
      data: detail,
      onHover: (p) => {
        hovered.value = p?.id || null
        const asset = p && detail.assets.find((a) => a.id === p.id)
        tip.value = asset && p.x != null ? { asset, x: p.x, y: p.y } : null
      },
      onPick: (id) => select(id),
      modelUrl: `${import.meta.env.BASE_URL}building/room.glb`
    })
    scene.select(selected.value)
    if (import.meta.env.DEV) window.__roomScene = scene
    scene.ready
      .catch((err) => {
        console.error(err)
        error.value = "房间模型加载失败"
      })
      .finally(() => (loading.value = false))
  })

  onUnmounted(() => {
    scene?.dispose()
    scene = null
    if (import.meta.env.DEV) delete window.__roomScene
  })
</script>

<style lang="scss">
  /* 设备图标与名称标签（CSS2D，DOM 由 RoomScene 生成）：标签层不接收鼠标，图标单独可点 */
  .room-level .rm-pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    transform: translateY(-40%);
    pointer-events: none;

    .tag {
      padding: 3px 10px;
      border: 1px solid rgba(74, 170, 255, 0.75);
      background: rgba(5, 25, 60, 0.85);
      box-shadow: 0 0 10px rgba(30, 140, 255, 0.35);
      font-size: 13px;
      white-space: nowrap;
      color: #fff;

      em {
        font-style: normal;
        color: #2de2e6;
      }
    }

    i {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 2px solid #3fc8ff;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        rgba(10, 50, 100, 0.95) 55%,
        rgba(30, 140, 255, 0.5)
      );
      box-shadow: 0 0 12px rgba(40, 170, 255, 0.8);
      color: #8fe3ff;
      cursor: pointer;
      pointer-events: auto;

      svg {
        width: 18px;
        height: 18px;
      }
    }

    &.hov i {
      transform: scale(1.12);
      box-shadow: 0 0 18px rgba(80, 200, 255, 1);
    }

    &.sel {
      .tag {
        border-color: #ffc65a;
        background: rgba(50, 32, 4, 0.92);
        box-shadow: 0 0 14px rgba(255, 190, 70, 0.55);
        color: #ffe6b0;

        em {
          color: #ffe6b0;
        }
      }

      i {
        border-color: #ffc65a;
        background: radial-gradient(
          circle,
          rgba(70, 45, 5, 0.95) 55%,
          rgba(255, 180, 60, 0.5)
        );
        box-shadow: 0 0 16px rgba(255, 190, 70, 0.9);
        color: #ffe3a0;
      }
    }

    &.warn {
      .tag {
        border-color: #ff4d5a;
        background: rgba(60, 8, 14, 0.9);
        box-shadow: 0 0 14px rgba(255, 60, 70, 0.5);
        color: #ffd0d4;

        em {
          color: #ffd0d4;
        }
      }

      i {
        border-color: #ff5a66;
        background: radial-gradient(
          circle,
          rgba(70, 8, 14, 0.95) 55%,
          rgba(255, 60, 70, 0.5)
        );
        box-shadow: 0 0 14px rgba(255, 60, 70, 0.9);
        color: #ffb3b9;
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

  .dev-tip {
    position: absolute;
    z-index: 6;
    min-width: 170px;
    padding: 8px 12px;
    border: 1px solid rgba(74, 170, 255, 0.7);
    background: rgba(5, 22, 52, 0.92);
    box-shadow: 0 0 14px rgba(30, 140, 255, 0.4);
    transform: translate(18px, -50%);
    pointer-events: none;

    .hd {
      font-size: 14px;
      color: #fff;
    }

    .kv {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 4px;
      font-size: 12px;
      color: #8aa0bd;

      b {
        font-weight: normal;
        color: #2de2e6;
      }
    }

    .hint {
      margin-top: 4px;
      font-size: 11px;
      color: rgba(138, 160, 189, 0.8);
    }

    &.warn {
      border-color: #ff9f43;

      .kv b {
        color: #ff9f43;
      }
    }
  }
</style>
