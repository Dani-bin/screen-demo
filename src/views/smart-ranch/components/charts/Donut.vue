<!-- 环图：parts = [{ v, c }]，中间放插槽内容；r / w 是设计稿像素，外框换算成 rem 随页面缩放 -->
<template>
  <div
    class="donut-wrap"
    :style="{ width: `${S / 192}rem`, height: `${S / 192}rem` }"
  >
    <svg :viewBox="`0 0 ${S} ${S}`" class="donut">
      <circle
        :cx="r + w"
        :cy="r + w"
        :r="r"
        stroke="rgba(31,58,43,0.08)"
        :stroke-width="w"
        fill="none"
      />
      <path
        v-for="(s, i) in segs"
        :key="i"
        :d="s.d"
        :stroke="s.c"
        :stroke-width="w"
        fill="none"
      />
    </svg>
    <div class="donut-c"><slot /></div>
  </div>
</template>

<script setup>
  const props = defineProps({
    parts: { type: Array, default: () => [] },
    r: { type: Number, default: 34 },
    w: { type: Number, default: 12 }
  })
  const S = computed(() => (props.r + props.w) * 2)
  const segs = computed(() => {
    const { r, w } = props
    const tot = props.parts.reduce((s, p) => s + p.v, 0) || 1
    let a = -Math.PI / 2
    return props.parts
      .filter((p) => p.v > 0)
      .map((p) => {
        const a1 = a + (p.v / tot) * Math.PI * 2
        const large = a1 - a > Math.PI ? 1 : 0
        const c = r + w
        const d = `M${c + r * Math.cos(a)},${c + r * Math.sin(a)} A${r},${r} 0 ${large} 1 ${c + r * Math.cos(a1 - 0.0001)},${c + r * Math.sin(a1 - 0.0001)}`
        a = a1
        return { d, c: p.c }
      })
  })
</script>

<style scoped>
  .donut-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .donut {
    width: 100%;
    height: 100%;
  }
  .donut-c {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
</style>
