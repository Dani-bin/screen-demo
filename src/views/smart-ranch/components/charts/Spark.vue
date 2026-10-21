<!--
  走势小图：values 等距铺满宽度，末端画一个点。
  w / h 是设计稿像素；模板里写的尺寸构建时不会转成 rem，所以在这里换算成 rem，跟页面一起缩放
-->
<template>
  <svg
    class="spark"
    :viewBox="`0 0 ${w} ${h}`"
    :style="{ width: `${w / 192}rem`, height: `${h / 192}rem` }"
  >
    <path v-if="fill && pts.length" :d="area" :fill="color" opacity="0.14" />
    <path
      v-if="pts.length"
      :d="line"
      fill="none"
      :stroke="color"
      stroke-width="1.6"
    />
    <circle
      v-if="pts.length"
      :cx="last[0]"
      :cy="last[1]"
      r="2.4"
      :fill="color"
    />
  </svg>
</template>

<script setup>
  const props = defineProps({
    values: { type: Array, default: () => [] },
    w: { type: Number, default: 64 },
    h: { type: Number, default: 22 },
    color: { type: String, default: "#2b7bd6" },
    fill: { type: Boolean, default: true }
  })
  const pts = computed(() => {
    const v = props.values
    if (!v.length) return []
    const lo = Math.min(...v)
    const span = Math.max(...v) - lo || 1
    return v.map((x, i) => [
      (i / Math.max(v.length - 1, 1)) * props.w,
      props.h - 2 - ((x - lo) / span) * (props.h - 4)
    ])
  })
  const line = computed(() =>
    pts.value
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join(" ")
  )
  const area = computed(
    () => `${line.value} L${props.w},${props.h} L0,${props.h} Z`
  )
  const last = computed(() => pts.value[pts.value.length - 1] || [0, 0])
</script>
