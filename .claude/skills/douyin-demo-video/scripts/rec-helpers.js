// 录屏用的通用页面工具（rec.mjs 在 setup 之前注入，挂在 window.REC 上）
// ----------------------------------------------------------
// 提炼自 docs/design/hospital|waiting/douyin/helpers.js 里和页面无关的部分：缓动、假光标点击、高亮框、弹一下、闪光、整屏覆盖层、打字。
// 演示页面专用的（镜头、仿真、面板）写在各自 douyin 目录的 helpers.js 里，用 Object.assign(window.REC, {...}) 往上加。
// 所有动画都用 requestAnimationFrame 驱动：vclock.js 接管后按虚拟时间走，逐帧录制也是平滑的；
// rec.mjs 关掉了页面的 CSS 动画 / 过渡（它们按真实时间播放，会一闪而过），所以这里不要用 CSS transition。
window.REC = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  /** 缓入缓出（三次） */
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const lerp = (a, b, k) => a + (b - a) * k
  const $ = (el) => (typeof el === "string" ? document.querySelector(el) : el)

  /** ms 毫秒内每帧调用 fn(缓动后进度, 线性进度)，结束时 resolve */
  function tween(ms, fn) {
    const t0 = performance.now()
    return new Promise((res) => {
      const f = () => {
        const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1
        fn(ease(k), k)
        if (k < 1) requestAnimationFrame(f)
        else res()
      }
      requestAnimationFrame(f)
    })
  }

  /** ms 毫秒内每帧调一次 fn（例如每帧推进页面的仿真，事件正好落在设定的那一帧） */
  function everyFrame(ms, fn) {
    return tween(ms, () => fn())
  }

  /** 按选择器 + 包含的文字找元素 */
  function find(sel, text) {
    const els = [...document.querySelectorAll(sel)]
    return text ? els.find((e) => e.textContent.trim().includes(text)) : els[0]
  }

  // ---- 假鼠标光标：白色箭头 + 点击时一圈扩散的波纹（第一次用到时才创建，初始在画面右侧外面）
  let cur = null
  let cx = 0
  let cy = 0
  function cursor() {
    if (cur) return cur
    cur = document.createElement("div")
    cur.innerHTML =
      '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M3 2l15 11-6.5 1.2L15 21l-3 1.4-3.4-6.8L3 20z" fill="#fff" stroke="#13201c" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    cx = window.innerWidth + 60
    cy = window.innerHeight * 0.55
    Object.assign(cur.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: 99999,
      pointerEvents: "none",
      transform: `translate(${cx}px, ${cy}px)`,
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,.45))"
    })
    document.body.appendChild(cur)
    return cur
  }

  /** 光标移到 (x, y)（屏幕像素），ms 毫秒缓动 */
  async function move(x, y, ms = 700) {
    const c = cursor()
    const x0 = cx
    const y0 = cy
    await tween(ms, (e) => {
      cx = lerp(x0, x, e)
      cy = lerp(y0, y, e)
      c.style.transform = `translate(${cx - 4}px, ${cy - 2}px)`
    })
  }

  /** 在光标处放一圈波纹 */
  function ripple(color = api.accent) {
    const r = document.createElement("div")
    Object.assign(r.style, {
      position: "fixed",
      left: cx - 22 + "px",
      top: cy - 22 + "px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      border: `3px solid ${color}`,
      zIndex: 99998,
      pointerEvents: "none",
      transform: "scale(0.3)"
    })
    document.body.appendChild(r)
    tween(500, (e) => {
      r.style.transform = `scale(${0.3 + 1.3 * e})`
      r.style.opacity = String(1 - e)
    }).then(() => r.remove())
  }

  /** 光标移到元素中心，停一下，波纹 + 真实 click */
  async function clickEl(el, { ms = 800, hold = 250 } = {}) {
    el = $(el)
    if (!el) throw new Error("clickEl：元素不存在")
    const b = el.getBoundingClientRect()
    await move(b.x + b.width / 2, b.y + b.height / 2, ms)
    await sleep(hold)
    ripple()
    el.click()
  }

  /** 光标移到 (x, y) 点一下：在那个位置派发 pointer / mouse 事件（点三维画布里的物体用） */
  async function clickAt(x, y, { ms = 800, hold = 250 } = {}) {
    await move(x, y, ms)
    await sleep(hold)
    ripple()
    const target = document.elementFromPoint(x, y)
    const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      target?.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, opt) : new MouseEvent(type, opt))
  }

  /** 光标移到元素中心（不点） */
  async function hoverEl(el, ms = 800) {
    const b = $(el).getBoundingClientRect()
    await move(b.x + b.width / 2, b.y + b.height / 2, ms)
  }

  /** 往输入框里逐字打字（每个字派发 input 事件，Vue 的 v-model 能跟上） */
  async function typeInto(el, text, ms = 900) {
    el = $(el)
    el.focus?.()
    const chars = [...text]
    for (let i = 1; i <= chars.length; i++) {
      el.value = chars.slice(0, i).join("")
      el.dispatchEvent(new Event("input", { bubbles: true }))
      await sleep(ms / chars.length)
    }
  }

  /** 给元素（或屏幕矩形 {x,y,width,height}）套一个圆角高亮框：放大淡入、停 hold 毫秒、淡出 */
  function highlight(el, { hold = 1500, pad = 8, color = api.accent, radius = 16, width = 4 } = {}) {
    const b = el && el.getBoundingClientRect ? el.getBoundingClientRect() : $(el)?.getBoundingClientRect?.() || el
    if (!b) return Promise.resolve()
    const box = document.createElement("div")
    Object.assign(box.style, {
      position: "fixed",
      left: b.x - pad + "px",
      top: b.y - pad + "px",
      width: b.width + pad * 2 + "px",
      height: b.height + pad * 2 + "px",
      border: `${width}px solid ${color}`,
      borderRadius: radius + "px",
      boxShadow: `0 0 0 6px ${color}2e`,
      pointerEvents: "none",
      zIndex: 99990,
      opacity: "0"
    })
    document.body.appendChild(box)
    return tween(300, (e) => {
      box.style.opacity = String(e)
      box.style.transform = `scale(${1.06 - 0.06 * e})`
    })
      .then(() => sleep(hold))
      .then(() => tween(250, (e) => (box.style.opacity = String(1 - e))))
      .then(() => box.remove())
  }

  /** 元素弹一下（图例逐项点名、数字跳变时用） */
  function pulse(el, { ms = 600, scale = 0.3, origin = "center" } = {}) {
    el = $(el)
    if (!el) return Promise.resolve()
    el.style.transformOrigin = origin
    return tween(ms, (e, k) => {
      el.style.transform = `scale(${1 + scale * Math.sin(Math.PI * k)})`
    }).then(() => (el.style.transform = ""))
  }

  /** 元素上闪 times 下白光（页面原本用 CSS 动画的闪烁，录屏时关掉了，用它逐帧重做） */
  function flash(el, { times = 2, ms = 900, color = "#fff", alpha = 0.5, radius = 16 } = {}) {
    const b = $(el).getBoundingClientRect()
    const f = document.createElement("div")
    Object.assign(f.style, {
      position: "fixed",
      left: b.x + "px",
      top: b.y + "px",
      width: b.width + "px",
      height: b.height + "px",
      borderRadius: radius + "px",
      background: color,
      opacity: "0",
      pointerEvents: "none",
      zIndex: 99991
    })
    document.body.appendChild(f)
    return tween(ms, (e, k) => {
      const ph = (k * times) % 1
      f.style.opacity = String(k < 1 ? alpha * (1 - ph) : 0)
    }).then(() => f.remove())
  }

  /**
   * 整屏覆盖层（痛点镜头的"普通做法"示意、对比卡片、说明卡等 2D 画面用）：html 放进一个铺满全屏的层，
   * fade 毫秒淡入；返回元素，用完调 REC.fadeOut(el)
   */
  function overlay(html, { fade = 0, background = "transparent", z = 99000 } = {}) {
    const el = document.createElement("div")
    Object.assign(el.style, { position: "fixed", inset: "0", zIndex: z, background, opacity: fade ? "0" : "1" })
    el.innerHTML = html
    document.body.appendChild(el)
    if (fade) tween(fade, (e) => (el.style.opacity = String(e)))
    return el
  }

  /** 淡出并移除元素 */
  function fadeOut(el, ms = 300) {
    el = $(el)
    return tween(ms, (e) => (el.style.opacity = String(1 - e))).then(() => el.remove())
  }

  /** 藏起一组选择器对应的元素（visibility，不影响布局）；全屏三维、封面底图用 */
  function hide(...sels) {
    for (const s of sels.flat()) document.querySelectorAll(s).forEach((e) => (e.style.visibility = "hidden"))
  }

  /** 恢复 hide 藏起来的元素 */
  function show(...sels) {
    for (const s of sels.flat()) document.querySelectorAll(s).forEach((e) => (e.style.visibility = ""))
  }

  const api = {
    accent: "#FF7A00", // 光标波纹、高亮框的颜色；分镜 setup 里按页面配色改，例如 REC.accent = "#F26B1D"
    sleep,
    ease,
    lerp,
    tween,
    everyFrame,
    find,
    cursor,
    move,
    ripple,
    clickEl,
    clickAt,
    hoverEl,
    typeInto,
    highlight,
    pulse,
    flash,
    overlay,
    fadeOut,
    hide,
    show
  }
  return api
})()
"ok"
