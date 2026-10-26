<!--
  一路 AI 视频的示意画面（canvas 程序化绘制，不是真实视频）：
  巷道透视、输送带（梯形）、托辊横线、随带速流动的煤块、巷道灯；叠加 AI 识别层：
  跑偏检测线（带边绿线，跑偏时变黄）、识别到异物 / 大块 / 人员时的红框和标签、置信度、OSD 时间水印、扫描噪点。
-->
<template>
  <div
    class="cv"
    :class="{ alarm: !!hit, dirty: cam.state === 'dirty' }"
    @click="emit('zoom')"
  >
    <canvas ref="cvs"></canvas>
    <span class="cv-id code">{{ cam.id }}</span>
    <em class="cv-use">{{ use }}</em>
    <b v-if="hit" class="cv-hit">{{ hit }}</b>
    <i class="cv-conf">AI {{ fmt(cam.conf, 0) }}%</i>
  </div>
</template>

<script setup>
  import { fmt, hms } from "../ui.js"

  const props = defineProps({
    cam: { type: Object, required: true }, // cameraReading + { id }
    use: { type: String, default: "" },
    v: { type: Number, default: 0 }, // 带速 m/s
    load: { type: Number, default: 0.6 }, // 装载率 0…1
    hit: { type: String, default: "" }, // 识别到的目标（异物 / 大块 / 人员越界…）
    deviation: { type: Number, default: 0 }, // 跑偏量 mm
    now: { type: Number, default: 0 },
    seed: { type: Number, default: 1 }
  })
  const emit = defineEmits(["zoom"])
  const cvs = ref(null)
  let raf = 0
  let travel = 0
  let last = 0

  // 固定种子的煤块（相对带面的位置）
  function lumps(seed) {
    let x = seed * 9301 + 49297
    const r = () => (x = (x * 9301 + 49297) % 233280) / 233280
    return Array.from({ length: 70 }, () => ({ u: r(), w: r(), s: 0.5 + r() }))
  }
  const LUMPS = lumps(props.seed)

  function draw(ts) {
    raf = requestAnimationFrame(draw)
    // 15 fps 够了
    if (ts - last < 66) return
    const dt = last ? (ts - last) / 1000 : 0
    last = ts
    const c = cvs.value
    if (!c) return
    const W = c.clientWidth
    const H = c.clientHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
    }
    const g = c.getContext("2d")
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    travel += props.v * dt * 0.08
    // 巷道：暗背景 + 拱顶
    const vx = W * 0.5
    const vy = H * 0.34
    g.fillStyle = "#07090c"
    g.fillRect(0, 0, W, H)
    const grd = g.createRadialGradient(vx, vy, 2, vx, vy, W * 0.7)
    grd.addColorStop(0, "rgba(60,70,80,0.55)")
    grd.addColorStop(1, "rgba(10,12,16,0)")
    g.fillStyle = grd
    g.fillRect(0, 0, W, H)
    // 巷道灯（沿顶部透视排列）
    for (let k = 0; k < 6; k++) {
      const z = ((k + 0.5) / 6) ** 1.6
      const x = vx + W * 0.36 * z
      const y = vy - H * 0.3 * z
      g.fillStyle = `rgba(255,214,150,${0.25 + 0.6 * z})`
      g.beginPath()
      g.arc(x, y, 1 + 2.5 * z, 0, Math.PI * 2)
      g.fill()
    }
    // 输送带：梯形（近宽远窄）
    const nearL = W * 0.12
    const nearR = W * 0.88
    const farL = vx - W * 0.05
    const farR = vx + W * 0.05
    g.fillStyle = "#15181d"
    g.beginPath()
    g.moveTo(farL, vy)
    g.lineTo(farR, vy)
    g.lineTo(nearR, H)
    g.lineTo(nearL, H)
    g.closePath()
    g.fill()
    // 托辊：横线，随带速不动（托辊固定），间距按透视
    g.strokeStyle = "rgba(140,150,160,0.25)"
    g.lineWidth = 1
    for (let k = 1; k < 14; k++) {
      const z = (k / 14) ** 2
      const y = vy + (H - vy) * z
      const l = farL + (nearL - farL) * z
      const r = farR + (nearR - farR) * z
      g.beginPath()
      g.moveTo(l, y)
      g.lineTo(r, y)
      g.stroke()
    }
    // 煤块：沿带面朝镜头流动，装载率决定密度
    const n = Math.round(LUMPS.length * Math.min(1, props.load))
    for (let k = 0; k < n; k++) {
      const p = LUMPS[k]
      const z = ((p.u + travel) % 1) ** 2
      const y = vy + (H - vy) * z
      const l = farL + (nearL - farL) * z
      const r = farR + (nearR - farR) * z
      const x = l + (r - l) * (0.18 + 0.64 * p.w)
      const s = (1 + 7 * z) * p.s
      g.fillStyle = `rgba(${40 + 30 * p.s},${36 + 22 * p.s},${32 + 14 * p.s},1)`
      g.fillRect(x - s / 2, y - s / 2, s, s * 0.7)
    }
    // 跑偏检测线（AI 识别的带边）
    const dev = Math.min(1, props.deviation / 60)
    g.strokeStyle = dev > 0.6 ? "rgba(250,204,21,0.9)" : "rgba(52,211,153,0.75)"
    g.lineWidth = 1.2
    g.setLineDash([4, 3])
    for (const [a, b] of [
      [farL, nearL],
      [farR, nearR]
    ]) {
      g.beginPath()
      g.moveTo(a + dev * 3, vy)
      g.lineTo(b + dev * 14, H)
      g.stroke()
    }
    g.setLineDash([])
    // 识别框
    if (props.hit) {
      const bx = W * 0.44 + Math.sin(ts / 700) * W * 0.02
      const by = H * 0.6
      g.strokeStyle = "#f43f5e"
      g.lineWidth = 1.5
      g.strokeRect(bx, by, W * 0.16, H * 0.18)
      g.fillStyle = "rgba(244,63,94,0.18)"
      g.fillRect(bx, by, W * 0.16, H * 0.18)
    }
    // 噪点 + 扫描线
    g.fillStyle = "rgba(255,255,255,0.035)"
    for (let k = 0; k < 120; k++)
      g.fillRect(Math.random() * W, Math.random() * H, 1, 1)
    g.fillStyle = "rgba(0,0,0,0.18)"
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1)
    // OSD 时间水印
    g.font = `${Math.max(8, H * 0.09)}px DIN, monospace`
    g.fillStyle = "rgba(230,240,250,0.7)"
    g.fillText(hms(props.now), W - H * 0.62, H - 5)
  }
  onMounted(() => (raf = requestAnimationFrame(draw)))
  onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
