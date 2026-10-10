<!--
  楼层级：标准办公层去顶俯视（设计稿 docs/design/building/13-draft-floor.png）
  三维（../../scene/floor/FloorScene.js）铺满整屏在底层，左右面板、面包屑、视图切换与楼层条叠在上面；
  房间列表、三维点选 / 悬浮房间双向联动，告警可点击定位到房间。换楼层只换数据（同一座塔共用一个楼层模型），换塔整级重建。
-->
<template>
  <div class="level floor-level">
    <div ref="stageRef" class="stage">
      <canvas ref="canvasRef"></canvas>
      <div ref="labelRef" class="label-layer"></div>
    </div>

    <div class="crumb">
      <span class="up" @click="$emit('back')">‹ 返回楼宇</span>
      <span>金融城双子塔园区</span><span>› {{ towerName }}</span>
      <span
        >› <b>{{ detail.floor.key }}</b></span
      >
    </div>

    <!-- 视图切换：房间 / 设备 / 温度热力 / 工位 -->
    <div class="modes">
      <span
        v-for="m in MODES"
        :key="m.key"
        :class="{ on: m.key === mode }"
        @click="setMode(m.key)"
        >{{ m.name }}</span
      >
    </div>
    <div v-if="mode === 'heat'" class="legend heat">
      <span>温度</span><i></i><span>22°C</span><span>28°C</span>
    </div>
    <div v-if="mode === 'device'" class="legend">
      <span v-for="(t, k) in DEVICE_TYPES" :key="k"
        ><i class="dot" :style="{ background: t.color }"></i>{{ t.name }}</span
      >
      <span><i class="dot" style="background: #ff4d5a"></i>告警</span>
    </div>
    <div v-if="mode === 'desk'" class="legend">
      <span><i class="dot" style="background: #3ddc97"></i>在岗</span>
      <span><i class="dot" style="background: #ffc65a"></i>已预约</span>
      <span><i class="dot" style="background: #4a6aa0"></i>空闲</span>
    </div>

    <FloorStrip
      class="floor-strip"
      :items="strip"
      :current="detail.floor.key"
      @go="(f) => $emit('switch-floor', f)"
    />

    <div class="side side-left">
      <FloorInfo :floor="detail.floor" :stats="detail.stats" />
      <RoomList
        :rooms="detail.rooms"
        :selected="selected"
        :hovered="hovered"
        @select="select"
        @hover="hoverFromList"
      />
      <DeskPanel :desks="detail.desks" :curve="detail.deskCurve" />
    </div>

    <div class="side side-right">
      <EnvPanel :env="detail.env" />
      <DeviceDist :items="detail.deviceCounts" />
      <FloorAlarms :alarms="detail.alarms" @locate="select" />
    </div>

    <!-- 悬浮房间提示卡 -->
    <div
      v-if="tip"
      class="room-tip"
      :class="tip.room.level"
      :style="{ left: tip.x + 'px', top: tip.y + 'px' }"
    >
      <div class="hd">
        <b class="num">{{ tip.room.id }}</b
        >{{ tip.room.name }}
      </div>
      <div class="kv">
        <span
          >{{ tip.room.typeName }} ·
          <b class="num">{{ tip.room.area.toFixed(0) }}</b
          >m²</span
        >
        <span
          >温度<b class="num">{{ tip.room.temp }}</b
          >°C</span
        >
        <span v-if="tip.room.status !== '—'">{{ tip.room.status }}</span>
      </div>
      <div class="hint">
        {{
          tip.room.type === "conference"
            ? "点击选中 · 再点一次进入房间"
            : "点击选中"
        }}
      </div>
    </div>

    <div v-if="loading" class="scene-tip">楼层模型加载中</div>
    <div v-if="error" class="scene-tip err">{{ error }}</div>

    <div class="bottom-tip">
      上下层线框剥离 · 悬浮查看房间、点击选中 · 右侧楼层条切换楼层 ·
      拖动旋转、滚轮缩放 &nbsp;|&nbsp; 平面轮廓来自
      OpenStreetMap，房间布局、设备与运营数据为演示数据
    </div>
  </div>
</template>

<script setup>
  import { FloorScene } from "../../scene/floor/FloorScene"
  import { DEVICE_TYPES, floorDetail, floorStrip } from "../../data/floor"
  import FloorInfo from "../floor/FloorInfo.vue"
  import RoomList from "../floor/RoomList.vue"
  import DeskPanel from "../floor/DeskPanel.vue"
  import EnvPanel from "../floor/EnvPanel.vue"
  import DeviceDist from "../floor/DeviceDist.vue"
  import FloorAlarms from "../floor/FloorAlarms.vue"
  import FloorStrip from "../floor/FloorStrip.vue"

  const props = defineProps({
    /** tower_S 南塔 / tower_N 北塔 */
    towerKey: { type: String, default: "tower_S" },
    /** 楼层，如 "32F" */
    floorKey: { type: String, default: "32F" }
  })
  const emit = defineEmits(["back", "switch-floor", "enter-room"])

  const MODES = [
    { key: "room", name: "房间" },
    { key: "device", name: "设备" },
    { key: "heat", name: "温度热力" },
    { key: "desk", name: "工位" }
  ]

  const towerName = props.towerKey === "tower_N" ? "北塔" : "南塔"
  const detail = computed(() => floorDetail(props.towerKey, props.floorKey))
  const strip = computed(() => floorStrip(props.towerKey, props.floorKey))

  const stageRef = ref(null)
  const canvasRef = ref(null)
  const labelRef = ref(null)
  const mode = ref("room")
  const selected = ref(null)
  const hovered = ref(null)
  const tip = shallowRef(null)
  const loading = ref(true)
  const error = ref("")

  let scene = null

  function select(id) {
    selected.value = id
    scene?.select(id)
  }

  function setMode(m) {
    mode.value = m
    scene?.setMode(m)
  }

  function hoverFromList(id) {
    hovered.value = id
    if (scene) scene.hovered = id
  }

  // 换楼层：同一座塔共用楼层模型，只换数据；默认选中正在使用的大会议室（设计稿高亮的那间）
  watch(detail, (d) => {
    scene?.setData(d)
    select(defaultRoom(d))
    tip.value = null
  })

  function defaultRoom(d) {
    return d.rooms.find((r) => r.type === "conference")?.id || null
  }

  onMounted(() => {
    scene = new FloorScene({
      canvas: canvasRef.value,
      container: stageRef.value,
      labelLayer: labelRef.value,
      data: detail.value,
      onHover: (p) => {
        hovered.value = p?.room.id || null
        tip.value = p ? { room: p.room, x: p.x, y: p.y } : null
      },
      // 已选中的大会议室再点一次：进入房间级
      onPick: (id) => {
        const r = id && detail.value.rooms.find((x) => x.id === id)
        if (r && id === selected.value && r.type === "conference")
          emit("enter-room", id)
        else select(id === selected.value ? null : id)
      },
      onEnter: (id) => emit("enter-room", id),
      // 精细楼层模型：floor_S.glb / floor_N.glb（scripts/blender/tower/detail.py）
      modelUrl: `${import.meta.env.BASE_URL}building/floor_${props.towerKey === "tower_N" ? "N" : "S"}.glb`
    })
    select(defaultRoom(detail.value))
    if (import.meta.env.DEV) window.__floorScene = scene
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
    if (import.meta.env.DEV) delete window.__floorScene
  })
</script>

<style lang="scss">
  /* 三维房间标签（CSS2D，DOM 由 FloorScene 生成，scoped 样式够不着） */
  .floor-level .fl-label {
    padding: 3px 10px;
    border: 1px solid rgba(74, 170, 255, 0.75);
    background: rgba(5, 25, 60, 0.85);
    box-shadow: 0 0 10px rgba(30, 140, 255, 0.35);
    font-size: 13px;
    white-space: nowrap;
    color: #fff;
    pointer-events: none;
    transition: opacity 0.3s;

    em {
      margin-left: 6px;
      font-style: normal;
      color: #2de2e6;
    }

    &.gold {
      border-color: #ffc65a;
      background: rgba(50, 32, 4, 0.9);
      box-shadow: 0 0 14px rgba(255, 190, 70, 0.5);
      color: #ffe6b0;

      em {
        color: #ffe6b0;
      }
    }

    &.red {
      border-color: #ff4d5a;
      background: rgba(60, 8, 14, 0.88);
      box-shadow: 0 0 14px rgba(255, 60, 70, 0.5);
      color: #ffd0d4;

      em {
        color: #ff8a92;
      }
    }

    .enter {
      margin-left: 10px;
      padding: 1px 10px;
      border: 1px solid #ffc65a;
      background: linear-gradient(
        180deg,
        rgba(200, 140, 30, 0.85),
        rgba(140, 90, 10, 0.85)
      );
      font-size: 12px;
      color: #fff;
      cursor: pointer;
      pointer-events: auto;

      &:hover {
        background: linear-gradient(
          180deg,
          rgba(240, 175, 50, 0.95),
          rgba(180, 120, 20, 0.95)
        );
        box-shadow: 0 0 10px rgba(255, 198, 90, 0.7);
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

  /* 两侧压暗，面板文字清晰 */
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

  .legend {
    position: absolute;
    left: 470px;
    top: 172px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: #8aa0bd;

    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 4px;
      border-radius: 50%;
    }

    &.heat {
      gap: 8px;

      i {
        width: 120px;
        height: 8px;
        background: linear-gradient(90deg, #1a59ff, #1ae6f2, #ffd940, #ff4033);
      }
    }
  }

  .floor-strip {
    position: absolute;
    right: 470px;
    top: 50%;
    z-index: 5;
    transform: translateY(-50%);
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

  .room-tip {
    position: absolute;
    z-index: 6;
    min-width: 200px;
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
      gap: 12px;
      margin-top: 4px;
      font-size: 12px;
      color: #8aa0bd;

      b {
        margin: 0 2px 0 4px;
        font-size: 15px;
        font-weight: normal;
        color: #2de2e6;
      }
    }

    .hint {
      margin-top: 4px;
      font-size: 11px;
      color: rgba(138, 160, 189, 0.8);
    }

    &.alarm {
      border-color: #ff4d5a;
    }

    &.busy {
      border-color: #ffc65a;
    }
  }
</style>
