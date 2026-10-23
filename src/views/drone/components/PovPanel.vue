<!--
  机载画面窗：画面本身由三维的第二相机直接画在主画布上这块区域（scene/pov.js），
  这里只有透明的取景框 + OSD（编号、状态、可见光 / 红外切换、高度 / 速度 / 航向 / 电量 / RTK、AI 识别框）。
  窗口元素通过 frame 暴露给页面，用来告诉三维该画在哪。
-->
<template>
  <div class="pov-wrap">
    <div class="cap">
      <span class="ttl">机载画面</span> · {{ follow ? "跟随" : "查看" }}
      {{ drone.id }} · 点任一架无人机切换
    </div>
    <div ref="frame" class="pov">
      <div class="osd">
        <div class="tl">
          <span class="rec"></span
          ><b class="ttl">{{ drone.id }} · {{ DRONES[drone.id].name }}</b
          ><span>{{ stateText }}</span>
        </div>
        <div class="tr">
          <span
            class="seg"
            @click="$emit('mode', mode === 'ir' ? 'visible' : 'ir')"
            ><i :class="{ on: mode === 'visible' }">可见光</i
            ><i :class="{ on: mode === 'ir' }">红外</i></span
          >
          <!-- 放大图标（定稿右上角有；示意，暂不响应点击） -->
          <span class="zoom">⤢</span>
        </div>
        <div v-if="drone.state !== 'docked'" class="cross"></div>
        <div v-if="event" class="aibox">
          <span
            >{{ TYPES[event.type].label }} {{ pct(event.conf) }}%<template
              v-if="event.type === 'gas'"
            >
              · {{ thousands(event.reading) }} ppm·m</template
            ></span
          >
        </div>
        <div class="bar">
          <span
            >高度<b class="num">{{ drone.altRel.toFixed(0) }}</b> m</span
          >
          <span
            >速度<b class="num">{{ drone.speed.toFixed(1) }}</b> m/s</span
          >
          <span
            >航向<b class="num">{{
              String(Math.round(drone.heading)).padStart(3, "0")
            }}</b
            >°</span
          >
          <span
            >电量<b class="num">{{ drone.battery.toFixed(0) }}</b
            >%</span
          >
          <span v-if="drone.rtk === 'float'" class="warn">RTK 浮点</span>
          <span v-else>RTK 固定</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { DRONE_STATE, EVENT_TYPES as TYPES } from "../data/catalog.js"
  import { DRONES, TARGETS } from "../data/layout.js"
  import { pct, thousands } from "../utils.js"

  const props = defineProps({
    drone: { type: Object, required: true },
    events: { type: Array, default: () => [] },
    mode: { type: String, default: "ir" },
    follow: { type: Boolean, default: false }
  })
  defineEmits(["mode"])
  const frame = ref(null)
  defineExpose({ frame })

  // 正在监视的事件（AI 识别框）
  const event = computed(() =>
    props.drone.eventId
      ? props.events.find((e) => e.id === props.drone.eventId)
      : null
  )
  const stateText = computed(() => {
    const s = DRONE_STATE[props.drone.state]
    const tg = props.drone.targets?.[0] || event.value?.target
    return tg ? `${s} · ${TARGETS[tg]?.name || tg}` : s
  })
</script>

<style lang="scss" scoped>
  .pov-wrap {
    position: absolute;
    left: 1046px;
    top: 666px;
    width: 432px;
    z-index: 4;
  }
  .cap {
    height: 24px;
    font-size: 13px;
    color: var(--sub);
    .ttl {
      color: var(--text);
      font-size: 15px;
    }
  }
  .pov {
    position: relative;
    width: 432px;
    height: 243px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(120, 170, 230, 0.25);
  }
  .osd {
    position: absolute;
    inset: 0;
    color: #fff;
    font-size: 12px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }
  .tl {
    position: absolute;
    left: 10px;
    top: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
    b {
      font-weight: normal;
      font-size: 13px;
    }
  }
  .rec {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff3b30;
  }
  .tr {
    position: absolute;
    right: 10px;
    top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zoom {
    font-size: 14px;
    line-height: 1;
  }
  .seg {
    display: inline-flex;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 3px;
    overflow: hidden;
    cursor: pointer;
    i {
      font-style: normal;
      padding: 1px 7px;
      font-size: 11px;
      &.on {
        background: rgba(255, 255, 255, 0.9);
        color: #111;
        text-shadow: none;
      }
    }
  }
  .cross {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 28px;
    height: 28px;
    margin: -14px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 50%;
  }
  .aibox {
    position: absolute;
    left: 40%;
    top: 34%;
    width: 30%;
    height: 34%;
    border: 2px solid #ff4d4f;
    span {
      position: absolute;
      left: -2px;
      bottom: 100%;
      white-space: nowrap;
      background: #ff4d4f;
      color: #fff;
      font-size: 12px;
      padding: 2px 6px;
      text-shadow: none;
    }
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    gap: 14px;
    padding: 6px 10px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    white-space: nowrap;
    b {
      font-weight: normal;
      font-size: 14px;
      margin-left: 3px;
    }
    .warn {
      color: #ffb020;
    }
  }
</style>
