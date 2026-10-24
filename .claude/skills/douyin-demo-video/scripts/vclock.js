// 逐帧录制用的虚拟时钟：rec.mjs 在页面任何脚本运行之前注入（Page.addScriptToEvaluateOnNewDocument）
// ----------------------------------------------------------
// 接管 performance.now / requestAnimationFrame / setTimeout / setInterval / Date：
//   - "real" 模式（默认）：全部转给浏览器原生实现，页面照常加载，录屏前的准备（setup）照常运行；
//   - "manual" 模式（开录前由 rec.mjs 切换）：时间冻结，只有 rec.mjs 调 __vt.step(毫秒) 时才前进，
//     到点的定时器 / 周期定时器按时间顺序执行，再跑这一帧排队的帧回调（三维场景在帧回调里渲染），然后 rec.mjs 截一张图。
// 这样无头 Chrome 每帧渲染再慢（GTAO、阴影下可能只有十来帧），成片也是均匀的 30 帧；
// 页面里按 Date.now() 走的仿真、"已用时 05:02"这类计时、gsap / 自写的镜头缓动也都按虚拟时间走，不会一跳好几秒。
// Date：rec.mjs 按分镜文件的 CONFIG.epoch 注入 window.__VT_EPOCH（毫秒）时，页面打开那一刻 = 这个时刻，
// 各段分镜分开打开页面录，时钟和仿真也在同一条时间轴上，剪到一起右上角的时钟能接上；没给就从真实的当前时刻起算。
// 复制自 docs/design/waiting/douyin/vclock.js（那一版又改自 hospital），把固定的起算时刻改成可配置。
;(() => {
  const nativeNow = performance.now.bind(performance)
  const nativeRaf = window.requestAnimationFrame.bind(window)
  const nativeCaf = window.cancelAnimationFrame.bind(window)
  const nativeSetTimeout = window.setTimeout.bind(window)
  const nativeClearTimeout = window.clearTimeout.bind(window)
  const nativeSetInterval = window.setInterval.bind(window)
  const nativeClearInterval = window.clearInterval.bind(window)
  const NativeDate = window.Date

  // 起算时刻：Date 的虚拟值 = EPOCH + performance.now()
  const EPOCH = typeof window.__VT_EPOCH === "number" ? window.__VT_EPOCH : NativeDate.now() - nativeNow()
  let manual = false
  let t = 0 // manual 模式下的虚拟时间（毫秒，接着切换那一刻的 performance.now 往下走）
  let nextId = 1
  const rafs = new Map() // 自己的 id → { cb, native }（native 为真实模式下的原生 id）
  const timers = new Map() // 自己的 id → { due, cb, args, every }（every > 0 为周期定时器）
  const natives = new Map() // 真实模式下建的周期定时器：自己的 id → { native, ms, cb, args }

  const vnow = () => EPOCH + (manual ? t : nativeNow())
  performance.now = () => (manual ? t : nativeNow())

  // Date：不带参数的 new Date() 和 Date.now() 取虚拟时间，其余用法不变
  class VDate extends NativeDate {
    constructor(...a) {
      if (a.length) super(...a)
      else super(vnow())
    }
    static now() {
      return vnow()
    }
  }
  window.Date = VDate

  window.requestAnimationFrame = (cb) => {
    const id = nextId++
    const item = { cb, native: null }
    if (!manual) {
      item.native = nativeRaf((ts) => {
        rafs.delete(id)
        cb(manual ? t : ts)
      })
    }
    rafs.set(id, item)
    return id
  }
  window.cancelAnimationFrame = (id) => {
    const item = rafs.get(id)
    if (item?.native != null) nativeCaf(item.native)
    rafs.delete(id)
  }

  window.setTimeout = (cb, ms = 0, ...args) => {
    if (!manual) return nativeSetTimeout(cb, ms, ...args)
    const id = nextId++
    timers.set(id, { due: t + Math.max(0, ms), cb, args, every: 0 })
    return id
  }
  window.clearTimeout = (id) => {
    if (timers.has(id)) timers.delete(id)
    else nativeClearTimeout(id)
  }

  // 周期定时器：真实模式下也登记一份，切到 manual 时把原生的停掉、换成虚拟的（页面每 0.5 秒推进一次仿真就是这么接过来的）
  window.setInterval = (cb, ms = 0, ...args) => {
    const id = nextId++
    const every = Math.max(1, ms)
    if (manual) timers.set(id, { due: t + every, cb, args, every })
    else natives.set(id, { native: nativeSetInterval(cb, ms, ...args), ms: every, cb, args })
    return id
  }
  window.clearInterval = (id) => {
    if (natives.has(id)) {
      nativeClearInterval(natives.get(id).native)
      natives.delete(id)
    } else if (timers.has(id)) timers.delete(id)
    else nativeClearInterval(id)
  }

  /** 让排队的微任务（Promise 回调、Vue 的 nextTick）跑完 */
  const settle = () => new Promise((r) => nativeSetTimeout(r, 0))

  window.__vt = {
    /** 切到逐帧模式：时间冻结在当前时刻，已有的周期定时器改由虚拟时钟驱动 */
    manual() {
      t = nativeNow()
      manual = true
      for (const [id, x] of natives) {
        nativeClearInterval(x.native)
        timers.set(id, { due: t + x.ms, cb: x.cb, args: x.args, every: x.ms })
      }
      natives.clear()
    },
    /** 推进 dt 毫秒：先按时间顺序跑到点的定时器，再跑这一帧的帧回调（回调里新排的留到下一帧）；返回编排是否已结束 */
    async step(dt) {
      t += dt
      for (;;) {
        let first = null
        for (const [id, x] of timers) if (x.due <= t && (!first || x.due < first[1].due)) first = [id, x]
        if (!first) break
        const [id, x] = first
        if (x.every) x.due += x.every
        else timers.delete(id)
        x.cb(...x.args)
        await settle()
      }
      const batch = [...rafs.entries()].filter(([, x]) => x.native == null)
      for (const [id] of batch) rafs.delete(id)
      for (const [, x] of batch) x.cb(t)
      await settle()
      await settle()
      return window.__playDone === true
    }
  }
})()
