<!-- 草畜平衡指数仪表：−20%…+30%，≤ 10% 为绿色，当前值用弧上的圆点标出 -->
<template>
  <svg viewBox="0 0 220 128" class="gauge">
    <path
      :d="arc(Math.PI, ang(10))"
      :stroke="ok"
      stroke-width="12"
      fill="none"
      stroke-linecap="round"
    />
    <path
      :d="arc(ang(10), 0)"
      :stroke="bad"
      stroke-width="12"
      fill="none"
      stroke-linecap="round"
      opacity="0.85"
    />
    <circle
      :cx="dot[0]"
      :cy="dot[1]"
      r="10"
      fill="#fff"
      stroke="#1f3a2b"
      stroke-width="3"
    />
    <text :x="t10[0]" :y="t10[1]" class="g-tick" text-anchor="middle">10%</text>
  </svg>
</template>

<script setup>
  const props = defineProps({
    value: { type: Number, default: 0 },
    ok: { type: String, default: "#2f8f4e" },
    bad: { type: String, default: "#e5484d" }
  })
  const cx = 110
  const cy = 112
  const R = 92
  const lo = -20
  const hi = 30
  const ang = (v) => Math.PI * (1 - (v - lo) / (hi - lo))
  const pt = (a, r = R) => [cx + r * Math.cos(a), cy - r * Math.sin(a)]
  const arc = (a0, a1) => {
    const p0 = pt(a0)
    const p1 = pt(a1)
    return `M${p0[0]},${p0[1]} A${R},${R} 0 0 1 ${p1[0]},${p1[1]}`
  }
  const dot = computed(() => pt(ang(Math.max(lo, Math.min(hi, props.value)))))
  const t10 = pt(ang(10), R + 16)
</script>
