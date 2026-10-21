<!--
  场景标注：按三维位置摆在画面上（锚点由场景每帧回调，单位是设计稿像素 → rem）。
  畜群徽标、饮水点液位环、营地、场部、基站、摄像头、告警标注（卡片固定在沙盘上方，折线引到事发处）、
  指北针、比例尺、测距结果
-->
<template>
  <div class="labels">
    <template v-if="a">
      <div
        v-for="w in waterLabels"
        :key="w.id"
        class="lb wp"
        :class="{ bad: w.bad }"
        :style="pos(w)"
        @click="$emit('water', w.id)"
      >
        <i :style="{ '--lv': `${w.level}%` }"></i
        ><span v-if="w.bad || near">{{ w.id }}</span>
      </div>
      <div
        v-for="h in a.homes"
        v-show="!h.hide"
        :key="h.id"
        class="lb hh"
        :style="pos(h)"
      >
        <i></i><span v-if="near">{{ h.id }}</span>
      </div>
      <div v-if="devices" class="dev-layer">
        <div
          v-for="b in a.stations"
          v-show="!b.hide"
          :key="b.id"
          class="lb bs"
          :style="pos(b)"
        >
          <i></i><span>{{ b.id }}</span>
        </div>
        <div
          v-for="c in a.cams"
          v-show="!c.hide"
          :key="c.id"
          class="lb cam"
          :style="pos(c)"
        >
          <i></i>
        </div>
      </div>
      <div
        v-show="!a.hq.hide"
        class="lb hq"
        :style="pos(a.hq)"
        @click="$emit('hq')"
      >
        <span>场部 HQ-01</span>
      </div>
      <div
        v-for="h in herdLabels"
        v-show="!h.hide"
        :key="h.id"
        class="lb herd"
        :class="{ warn: h.warn, sel: h.id === selected }"
        :style="pos(h)"
        @click="$emit('herd', h.id)"
      >
        <div class="pill">
          <i class="hk" :class="h.kind"></i><b>{{ h.id }}</b
          ><span>{{ h.head }}</span>
        </div>
        <em></em>
      </div>
      <template v-if="alarm && callout">
        <!-- 引线坐标是设计像素，viewBox 取画布的设计像素尺寸，窗口不是 16:9 也对得上 -->
        <svg
          class="leader"
          :viewBox="`0 0 ${a.vw || 1920} ${a.vh || 1080}`"
          preserveAspectRatio="none"
        >
          <polyline
            :points="`${callout.x},${CALLOUT_TOP + 96} ${callout.x},${CALLOUT_TOP + 116} ${callout.px},${callout.py - 14}`"
          />
          <circle :cx="callout.px" :cy="callout.py" r="4" />
        </svg>
        <div
          class="lb alarm"
          :style="{ left: rem(callout.x), top: rem(CALLOUT_TOP) }"
          @click="$emit('alarm')"
        >
          <div class="callout">
            <b>{{ alarm.title }}</b
            ><span>{{ text.what }}</span>
            <small
              >{{ hm(alarm.start) }} · {{ STAGE[alarm.stage] }} ·
              {{ alarm.herder }}</small
            >
          </div>
        </div>
      </template>
      <div v-if="measure" class="lb measure" :style="pos(measure)">
        <span>{{ measure.km }} km</span>
      </div>
      <div
        v-if="north !== null"
        class="north"
        :style="{ '--deg': `${north}deg` }"
      >
        <i></i><span>北</span>
      </div>
      <div
        v-if="scale"
        class="scale"
        :style="{
          left: rem(scale.x),
          top: rem(scale.y + 28),
          width: rem(scale.w)
        }"
      >
        <i></i><span>2 km</span>
      </div>
    </template>
  </div>
</template>

<script setup>
  import { alarmText, fmt, hm, STAGE } from "../utils.js"

  const props = defineProps({
    a: { type: Object, default: null },
    state: { type: Object, required: true },
    layout: { type: Object, required: true },
    alarm: { type: Object, default: null },
    selected: { type: String, default: "" },
    devices: { type: Boolean, default: false },
    measure: { type: Object, default: null },
    /**
     * 告警标注的横向范围（设计稿像素）：左边界离左栏 600，右边界离画布右缘 690（右栏 + 间距），
     * 窗口比 16:9 宽时画布超过 1920 设计像素，右边界跟着右移
     */
    clampX: { type: Array, default: () => [600, 690] }
  })
  defineEmits(["herd", "water", "hq", "alarm"])

  const CALLOUT_TOP = 160
  const rem = (px) => `${px / 192}rem`
  const pos = (p) => ({ left: rem(p.x), top: rem(p.y) })
  /** 拉近后（相机距离 < 6 km）显示营地、饮水点编号 */
  const near = computed(() => (props.a?.camDist || 1e9) < 6000)

  const herdLabels = computed(() =>
    props.a.herds.map((p) => {
      const h = props.state.herds.find((x) => x.id === p.id)
      return {
        ...p,
        kind: h.kind,
        head: fmt(h.head),
        warn: props.alarm?.herd === h.id
      }
    })
  )
  const waterLabels = computed(() =>
    props.a.water
      .filter((p) => !p.hide)
      .map((p) => {
        const w = props.state.water.find((x) => x.id === p.id)
        return { ...p, level: w.level, bad: w.pump === "fault" || w.level < 20 }
      })
  )
  const text = computed(() => alarmText(props.alarm, props.layout))
  const callout = computed(() => {
    const p = props.a.alarm
    if (!p || p.hide) return null
    return {
      x: Math.min(
        Math.max(p.x, props.clampX[0]),
        (props.a.vw || 1920) - props.clampX[1]
      ),
      px: p.x,
      py: p.y
    }
  })
  const north = computed(() => {
    const { n0, n1 } = props.a
    return (Math.atan2(n1.x - n0.x, -(n1.y - n0.y)) * 180) / Math.PI
  })
  const scale = computed(() => {
    const { s0, s1 } = props.a
    if (s0.hide || s1.hide) return null
    return { x: s0.x, y: s0.y, w: s1.x - s0.x }
  })
</script>
