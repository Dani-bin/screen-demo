<!--
  底部时间轴：今天 00:00–24:00，已过部分着色、事件刻度按等级着色（重大的圆点大一些）、计划起飞刻度；
  点击 / 拖动回放到任意时刻（整屏同步），播放 = 60 倍速往前走，追上现在自动回到实时。
-->
<template>
  <div class="tline">
    <div class="ctrl">
      <span
        class="play"
        @click="live ? null : playing ? $emit('pause') : $emit('play')"
        >{{ playing ? "❚❚" : "▶" }}</span
      >
      <span class="mini"
        >{{ live ? "回放今日" : "回放中" }}<br /><span class="num">{{
          hms(cursor, false)
        }}</span></span
      >
    </div>
    <svg
      ref="svg"
      class="axis"
      :viewBox="`0 0 ${W} ${H}`"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
    >
      <rect
        :x="X(0)"
        :y="base - 6"
        :width="X(nowH) - X(0)"
        height="6"
        rx="2"
        class="past"
      />
      <rect
        :x="X(nowH)"
        :y="base - 6"
        :width="X(24) - X(nowH)"
        height="6"
        rx="2"
        class="future"
      />
      <text
        v-for="hr in HOURS"
        :key="hr"
        :x="X(hr)"
        :y="H - 4"
        class="tick num"
        text-anchor="middle"
      >
        {{ pad(hr) }}:00
      </text>
      <line
        v-for="p in started"
        :key="p.id"
        :x1="X(h(p.startedAt))"
        :x2="X(h(p.startedAt))"
        :y1="base - 10"
        :y2="base - 6"
        class="trip"
      />
      <g v-for="e in events" :key="e.id">
        <line
          :x1="X(h(e.detectedAt))"
          :x2="X(h(e.detectedAt))"
          :y1="base - 26"
          :y2="base - 8"
          :class="['ev', e.level]"
        />
        <circle
          :cx="X(h(e.detectedAt))"
          :cy="base - 28"
          :r="e.level === 'major' ? 4 : 2.5"
          :class="['evd', e.level]"
        />
      </g>
      <line
        :x1="X(curH)"
        :x2="X(curH)"
        :y1="base - 34"
        :y2="base"
        class="cur"
      />
      <circle :cx="X(curH)" :cy="base - 3" r="6" class="curd" />
    </svg>
  </div>
</template>

<script setup>
  import { hms, pad } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    cursor: { type: Number, required: true },
    now: { type: Number, required: true },
    dayStart: { type: Number, required: true },
    live: { type: Boolean, default: true },
    playing: { type: Boolean, default: false }
  })
  const emit = defineEmits(["seek", "play", "pause"])

  const W = 1040
  const H = 60
  const X0 = 96
  const base = H - 20
  const HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]
  const X = (hr) => X0 + (hr / 24) * (W - X0 - 10)
  const h = (t) => (t - props.dayStart) / 3600e3
  const nowH = computed(() => h(props.now))
  const curH = computed(() => h(props.cursor))
  const events = computed(() => props.state.events)
  const started = computed(() => props.state.plan.filter((p) => p.startedAt))

  // 拖动回放：按设计稿坐标换算回时刻（只能拖到"现在"为止）
  const svg = ref(null)
  let dragging = false
  function toTime(ev) {
    const r = svg.value.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * W
    const hr = Math.max(
      0,
      Math.min(nowH.value, ((x - X0) / (W - X0 - 10)) * 24)
    )
    return props.dayStart + hr * 3600e3
  }
  function down(ev) {
    dragging = true
    svg.value.setPointerCapture(ev.pointerId)
    emit("seek", toTime(ev))
  }
  function move(ev) {
    if (dragging) emit("seek", toTime(ev))
  }
  function up() {
    dragging = false
  }
</script>

<style lang="scss" scoped>
  .tline {
    position: absolute;
    left: 440px;
    top: 1000px;
    width: 1040px;
    height: 60px;
    z-index: 4;
  }
  .ctrl {
    position: absolute;
    left: 0;
    top: 8px;
    display: flex;
    gap: 8px;
    align-items: center;
    z-index: 1;
  }
  .play {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--line);
    font-size: 12px;
    cursor: pointer;
  }
  .mini {
    font-size: 11px;
    color: var(--dim);
    line-height: 1.3;
    .num {
      color: var(--sub);
    }
  }
  .axis {
    position: absolute;
    left: 0;
    top: 0;
    width: 1040px;
    height: 60px;
    cursor: pointer;
  }
  .past {
    fill: var(--accent);
    opacity: 0.35;
  }
  .future {
    fill: var(--line);
  }
  .tick {
    fill: var(--dim);
    font-size: 10px;
  }
  .trip {
    stroke: var(--sub);
    opacity: 0.6;
  }
  .ev {
    stroke-width: 2;
    &.major {
      stroke: var(--major);
    }
    &.serious {
      stroke: var(--serious);
    }
    &.general {
      stroke: var(--general);
    }
  }
  .evd {
    &.major {
      fill: var(--major);
    }
    &.serious {
      fill: var(--serious);
    }
    &.general {
      fill: var(--general);
    }
  }
  .cur {
    stroke: var(--text);
    stroke-width: 2;
  }
  .curd {
    fill: var(--text);
  }
</style>
