/*
 * 老家沙盘 环境音（WebAudio 实时合成，不需要音频文件、没有版权问题）
 * ----------------------------------------------------------
 * 傍晚：蝉鸣（带通噪声 + 快速振幅调制，忽强忽弱）+ 偶尔几声鸟叫
 * 夜晚：蟋蟀（高频正弦断续颤音）+ 稻田蛙鸣（低频带通噪声"咕咕"）
 * 全天：很轻的风声底噪
 * 浏览器要求用户点击后才能出声，所以默认静音，点右上角按钮时才创建 AudioContext。
 */

export class Ambience {
  constructor() {
    this.ctx = null
    this.night = 0
    this.muted = true
    this.timers = []
  }

  /** 首次开声：创建音频图（必须在用户手势里调用） */
  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)
    this.dusk = ctx.createGain()
    this.nightBus = ctx.createGain()
    this.dusk.connect(this.master)
    this.nightBus.connect(this.master)
    this._noise = this._noiseBuffer()
    this._wind()
    this._cicadas()
    this._birds()
    this._crickets()
    this._frogs()
    this.setNight(this.night)
  }

  _noiseBuffer() {
    const ctx = this.ctx
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource()
    s.buffer = this._noise
    s.loop = true
    s.start()
    return s
  }

  _wind() {
    const ctx = this.ctx
    const lp = ctx.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.value = 380
    const g = ctx.createGain()
    g.gain.value = 0.05
    this._noiseSrc().connect(lp).connect(g).connect(this.master)
  }

  /** 蝉：5 kHz 附近的窄带噪声，被 38 Hz 振荡快速调幅，整体每隔几秒涨落一次 */
  _cicadas() {
    const ctx = this.ctx
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = 5200
    bp.Q.value = 6
    const am = ctx.createGain()
    am.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 38
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.5
    lfo.connect(lfoG).connect(am.gain)
    lfo.start()
    const swell = ctx.createGain()
    swell.gain.value = 0.3
    this._noiseSrc().connect(bp).connect(am).connect(swell).connect(this.dusk)
    const tick = () => {
      const t = ctx.currentTime
      swell.gain.cancelScheduledValues(t)
      swell.gain.setTargetAtTime(0.15 + Math.random() * 0.35, t, 1.2)
    }
    this.timers.push(setInterval(tick, 4000))
  }

  /** 鸟：两三声上扬的短鸣 */
  _birds() {
    const ctx = this.ctx
    const chirp = () => {
      const n = 2 + Math.floor(Math.random() * 3)
      const f0 = 2400 + Math.random() * 900
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + i * 0.16
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(f0, t)
        o.frequency.exponentialRampToValueAtTime(f0 * 1.45, t + 0.09)
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.06, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
        o.connect(g).connect(this.dusk)
        o.start(t)
        o.stop(t + 0.14)
      }
    }
    this.timers.push(setInterval(() => Math.random() < 0.5 && chirp(), 2600))
  }

  /** 蟋蟀：4.3 kHz 正弦，被 30 Hz 方波斩成颤音，再按 0.4 s 一段断续 */
  _crickets() {
    const ctx = this.ctx
    for (const [f, delay] of [
      [4300, 0],
      [4720, 0.27]
    ]) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      const trill = ctx.createGain()
      trill.gain.value = 0
      const lfo = ctx.createOscillator()
      lfo.type = "square"
      lfo.frequency.value = 30
      const lfoG = ctx.createGain()
      lfoG.gain.value = 0.5
      lfo.connect(lfoG).connect(trill.gain)
      const gate = ctx.createGain()
      gate.gain.value = 0
      o.connect(trill).connect(gate).connect(this.nightBus)
      o.start()
      lfo.start()
      const level = 0.035
      const pulse = () => {
        const t = ctx.currentTime + delay
        gate.gain.setValueAtTime(level, t)
        gate.gain.setValueAtTime(0, t + 0.38)
      }
      this.timers.push(setInterval(pulse, 900 + f / 40))
    }
  }

  /** 蛙：600 Hz 带通噪声，25 Hz 调幅的短促"咕咕"，一次 2–4 声 */
  _frogs() {
    const ctx = this.ctx
    const croak = () => {
      const n = 2 + Math.floor(Math.random() * 3)
      const f = 420 + Math.random() * 300
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + i * 0.42
        const src = ctx.createBufferSource()
        src.buffer = this._noise
        const bp = ctx.createBiquadFilter()
        bp.type = "bandpass"
        bp.frequency.value = f
        bp.Q.value = 5
        const am = ctx.createGain()
        const lfo = ctx.createOscillator()
        lfo.frequency.value = 24
        const lfoG = ctx.createGain()
        lfoG.gain.value = 0.5
        am.gain.value = 0.5
        lfo.connect(lfoG).connect(am.gain)
        const env = ctx.createGain()
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(0.5, t + 0.04)
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
        src.connect(bp).connect(am).connect(env).connect(this.nightBus)
        src.start(t, Math.random())
        src.stop(t + 0.32)
        lfo.start(t)
        lfo.stop(t + 0.32)
      }
    }
    this.timers.push(setInterval(() => Math.random() < 0.6 && croak(), 1700))
  }

  /** 静音 / 开声。第一次开声时才创建音频（浏览器自动播放策略） */
  setMuted(muted) {
    this.muted = muted
    if (!muted && !this.ctx) this._build()
    if (!this.ctx) return
    if (!muted) this.ctx.resume()
    const t = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(t)
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, t, 0.4)
  }

  /** 昼夜混音：k = 0 傍晚、1 夜晚 */
  setNight(k) {
    this.night = k
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.dusk.gain.setTargetAtTime(1 - k, t, 0.3)
    this.nightBus.gain.setTargetAtTime(k, t, 0.3)
  }

  dispose() {
    for (const id of this.timers) clearInterval(id)
    this.timers = []
    this.ctx?.close()
    this.ctx = null
  }
}
