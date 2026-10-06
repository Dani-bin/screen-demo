<!-- 环形图：多段占比（按顺序首尾相接）+ 中心主数值 / 副标题 -->
<template>
  <svg
    class="ring"
    :viewBox="`0 0 ${size} ${size}`"
    :style="{ width: rem(size), height: rem(size) }"
  >
    <circle
      :cx="c"
      :cy="c"
      :r="r"
      fill="none"
      stroke="rgba(255,255,255,.07)"
      :stroke-width="width"
    />
    <circle
      v-for="(s, i) in arcs"
      :key="i"
      :cx="c"
      :cy="c"
      :r="r"
      fill="none"
      :stroke="s.color"
      :stroke-width="width"
      :stroke-dasharray="`${s.len} ${L}`"
      :stroke-dashoffset="-s.offset"
      :transform="`rotate(-90 ${c} ${c})`"
      :style="{ filter: `drop-shadow(0 0 4px ${s.color})` }"
    />
    <text
      :x="c"
      :y="c + 3"
      text-anchor="middle"
      class="main"
      :font-size="size > 120 ? 22 : 24"
    >
      {{ value }}
      <tspan font-size="12" dx="2">{{ unit }}</tspan>
    </text>
    <text :x="c" :y="c + 22" text-anchor="middle" class="sub" font-size="12">
      {{ label }}
    </text>
  </svg>
</template>

<script setup>
  import { rem } from "../utils"

  const props = defineProps({
    size: { type: Number, default: 130 },
    width: { type: Number, default: 12 },
    /** [{ v: 0..1, color }] */
    segs: { type: Array, required: true },
    value: { type: [String, Number], required: true },
    unit: { type: String, default: "" },
    label: { type: String, default: "" }
  })

  const c = computed(() => props.size / 2)
  const r = computed(() => c.value - props.width / 2 - 2)
  const L = computed(() => 2 * Math.PI * r.value)
  /** 每段的弧长与起点；段间留 3 单位缝隙 */
  const arcs = computed(() => {
    let acc = 0
    return props.segs.map((s) => {
      const out = {
        color: s.color,
        len: Math.max(0, s.v * L.value - (props.segs.length > 1 ? 3 : 0)),
        offset: acc * L.value
      }
      acc += s.v
      return out
    })
  })
</script>

<style lang="scss" scoped>
  .ring {
    flex: none;
  }

  .main {
    fill: #fff;
    font-family: "DIN", sans-serif;
  }

  .sub {
    fill: var(--muted);
  }

  circle {
    transition: stroke-dasharray 0.8s ease;
  }
</style>
