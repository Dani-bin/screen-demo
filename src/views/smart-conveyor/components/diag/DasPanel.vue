<!--
  D5 光纤听诊（DAS）：沿线每 6 m 一个分区的异响评分热力条，识别出的异响位置和类型，
  一段异响波形；"播放异响"用 WebAudio 合成（轴承缺陷的周期冲击 + 宽带噪声，默认不出声，点了才播 3 秒）
-->
<template>
  <Panel no="D5" title="光纤听诊" en="DAS · ACOUSTIC">
    <div class="ds-h">
      <span
        ><Ic name="ear" />{{ beltName }} · {{ das.score.length }} 个分区（6
        m）</span
      >
      <a class="ds-play" :class="{ on: playing }" @click="play"
        ><Ic :name="playing ? 'live' : 'play'" />{{
          playing ? "播放中" : "播放异响"
        }}</a
      >
    </div>
    <div class="ds-strip">
      <i
        v-for="(c, i) in cells"
        :key="i"
        :style="{
          opacity: (0.12 + 0.88 * c).toFixed(2),
          background: c > 0.3 ? 'var(--predict)' : 'var(--data)'
        }"
      ></i>
    </div>
    <div class="ds-ax">
      <span>0</span><span>{{ fmt(len) }} m</span>
    </div>
    <svg
      class="ds-wave"
      :style="{ width: rem(W), height: rem(34) }"
      :viewBox="`0 0 ${W} 34`"
    >
      <path :d="wave" stroke="var(--predict)" stroke-width="1" fill="none" />
    </svg>
    <ul class="ds-l">
      <li v-for="x in das.found" :key="x.zone">
        <b>{{ x.where }}</b
        ><span>{{ x.type }}</span
        ><em>评分 {{ fmt(x.score, 2) }}</em>
      </li>
      <li v-if="!das.found.length" class="none">未识别到异响</li>
    </ul>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { beltShort, fmt, rem } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    tr: { type: Object, default: null }
  })
  const sim = inject("sim")
  const W = 396
  const N = 120

  // 听哪条皮带：选中的托辊劣化所在皮带，默认主运输大巷
  const belt = computed(() =>
    props.tr && props.tr.kind === "idlerBearing" ? props.tr.belt : "BC03"
  )
  const beltName = computed(() => beltShort(layout, belt.value))
  const len = computed(() => layout.belts.find((b) => b.id === belt.value).L)
  // 听诊结果每 10 秒刷新
  const key = computed(() => Math.floor(props.f.ms / 10000))
  const das = computed(() => {
    void key.value
    return sim.das(belt.value, props.f.ms)
  })
  const cells = computed(() => {
    const sc = das.value.score
    return Array.from({ length: N }, (_, i) => {
      let m = 0
      for (
        let k = Math.floor((i * sc.length) / N);
        k < Math.floor(((i + 1) * sc.length) / N);
        k++
      )
        m = Math.max(m, sc[k])
      return Math.min(1, m)
    })
  })
  /** 示意波形：有异响时叠加周期冲击 */
  const wave = computed(() => {
    const top = das.value.found[0]?.score || 0
    let d = ""
    let seed = 7
    const rnd = () =>
      ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 2
    for (let i = 0; i <= 200; i++) {
      const x = (i / 200) * W
      const knock = top > 0.3 && i % 23 < 2 ? (1 - (i % 23) / 2) * top * 14 : 0
      const y = 17 + rnd() * 3 + (i % 23 === 0 ? -knock : knock * 0.6)
      d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`
    }
    return d
  })

  /* WebAudio 合成异响：滚动体冲击（约 58 Hz 的周期脉冲）+ 带通噪声 */
  const playing = ref(false)
  let ctx = null
  function play() {
    if (playing.value) return
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    const sr = ctx.sampleRate
    const dur = 3
    const buf = ctx.createBuffer(1, sr * dur, sr)
    const ch = buf.getChannelData(0)
    const sev = das.value.found[0]?.score || 0.1
    const period = Math.round(sr / 58)
    for (let i = 0; i < ch.length; i++) {
      const p = i % period
      const knock = p < 200 ? Math.exp(-p / 40) * Math.sin(p * 0.9) * sev : 0
      ch[i] = (Math.random() - 0.5) * 0.08 + knock * 0.9
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = 1800
    bp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.value = 0.6
    src.connect(bp).connect(g).connect(ctx.destination)
    src.onended = () => (playing.value = false)
    src.start()
    playing.value = true
  }
  onBeforeUnmount(() => ctx?.close())
</script>
