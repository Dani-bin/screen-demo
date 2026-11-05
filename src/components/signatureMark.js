/*
 * 署名水印（全局，所有页面共用）
 * ----------------------------------------------------------
 * 演示地址发给别人后，有人会直接拿去做汇报；页面上常驻作者署名，让台下的人看得出出处。
 * 两个元素，都画在挂在 <body> 上的一个全屏透明层里：
 *   1. 弹跳角标：一小块半透明角标在整屏里匀速游走，撞到屏幕边缘就反弹，
 *      每次反弹方向略有随机偏转；它走遍整个画面，没法靠裁掉一角去掉。
 *   2. 中央浮现：打开后 20 秒第一次、之后每 20 秒一次，在画面中央浮出大号署名和声明，每次 4 秒（含淡入淡出）。
 *
 * 显示规则（见 signatureMarkRules.js）：
 *   - 开发服务器（yarn dev）默认不显示，不影响自己调试、截图和录视频；地址加 ?mark=on 可强制显示
 *   - 线上 / 生产构建默认显示；地址带 ?mark=<口令> 打开一次，这个浏览器会记住并隐藏
 *   - 口令只在本机 .mark-key.local，源码里只有它的哈希，见 scripts/mark-key.mjs
 *
 * 不容易被去掉（做不到绝对：会改前端代码的人仍然能去掉）：
 *   - 内容在 closed shadow root 里，页面自己的样式选不中它，脚本也伸不进去
 *   - 宿主元素的样式全是行内 !important；被删除、被改样式、被加 hidden / class，一秒内（多数是立刻）自动恢复
 *   - 角标或浮层被删、<style> 被改，同样整块重建
 */
import { decideMark } from "./signatureMarkRules.js"
import { KEY_HASH } from "./signatureMarkKey.js"

/** 文案与节奏：改这里即可 */
const CONFIG = {
  platform: "抖音",
  name: "程序员玥洛",
  tag: "演示版 · 数据均为虚构",
  contact: "如需用于汇报，请联系 抖音 程序员玥洛",
  /** 弹跳速度：每秒走过画面宽度的比例（1920 宽时约 96px/s，约 20 秒横穿一次） */
  speed: 0.05,
  /** 打开页面后第一次中央浮现的等待时间（毫秒） */
  firstFlashMs: 20000,
  /** 之后每隔多久浮现一次（毫秒）：每 20 秒一次，每次停留 flashDwellMs */
  flashEveryMs: 20000,
  /** 每次浮现的总时长，含淡入淡出（毫秒） */
  flashDwellMs: 4000
}

/** 这个浏览器里记住口令的 localStorage 键 */
const STORE_KEY = "sig:mark-off"

/** 宿主元素的行内样式：全是 !important，页面自己的样式压不过它 */
const HOST_STYLE = [
  "position:fixed",
  "inset:0",
  "z-index:2147483647",
  "pointer-events:none",
  "display:block",
  "visibility:visible",
  "opacity:1",
  "transform:none",
  "overflow:hidden",
  "margin:0",
  "padding:0",
  "border:0",
  "clip-path:none",
  "filter:none",
  "mix-blend-mode:normal",
  "background:none"
]
  .map((d) => d + "!important")
  .join(";")

/** 全屏层里的样式；字号随视口宽度等比缩放（1920 宽时角标约 18px、浮层标题约 33px） */
const CSS = `
  .badge {
    position: absolute; left: 0; top: 0; will-change: transform;
    padding: .3em .85em; border-radius: 999px;
    background: rgba(8, 16, 28, .74); border: 1px solid rgba(255, 255, 255, .22);
    color: rgba(255, 255, 255, .9); font-size: max(11px, .95vw); line-height: 1.3;
    font-family: "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    letter-spacing: .04em; white-space: nowrap;
  }
  .badge b { color: #5fd4ff; font-weight: 600; }
  .flash {
    position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%);
    max-width: 90vw; padding: .5em 1.5em; border-radius: 8px; text-align: center;
    background: rgba(6, 12, 22, .66); border: 1px solid rgba(95, 212, 255, .5);
    color: #fff; font-size: max(15px, 1.7vw); line-height: 1.3; letter-spacing: .12em;
    font-family: "Source Han Sans CN", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    opacity: 0;
  }
  .flash small {
    display: block; margin-top: .3em; font-size: .55em; letter-spacing: .08em;
    color: rgba(255, 255, 255, .72);
  }
  .flash.on { animation: sig-flash ${CONFIG.flashDwellMs}ms ease-in-out 1 both; }
  @keyframes sig-flash { 0% { opacity: 0 } 22%, 78% { opacity: 1 } 100% { opacity: 0 } }
`

/** 全屏层里的内容：样式 + 角标 + 中央浮层 */
const TEMPLATE = `<style>${CSS}</style>
<div class="badge">◆ ${CONFIG.platform} <b>${CONFIG.name}</b> · ${CONFIG.tag}</div>
<div class="flash">${CONFIG.platform} · ${CONFIG.name}<small>${CONFIG.tag} · ${CONFIG.contact}</small></div>`

/** 读地址里的 mark 参数：同时看 ?search 和 hash 路由里的查询串（#/page?mark=…） */
function readMarkParam() {
  const hashAt = location.hash.indexOf("?")
  const parts = [
    location.search,
    hashAt >= 0 ? location.hash.slice(hashAt) : ""
  ]
  for (const s of parts) {
    const v = new URLSearchParams(s).get("mark")
    if (v) return v
  }
  return null
}

/** 口令校验通过后把 mark 参数从地址栏去掉，免得投屏时把口令露出来、或把带口令的地址转发出去 */
function stripMarkParam() {
  try {
    const url = new URL(location.href)
    url.searchParams.delete("mark")
    const q = url.hash.indexOf("?")
    if (q >= 0) {
      const p = new URLSearchParams(url.hash.slice(q + 1))
      p.delete("mark")
      const rest = p.toString()
      url.hash = url.hash.slice(0, q) + (rest ? "?" + rest : "")
    }
    // 保留 history.state，vue-router 靠它记录前进 / 后退位置
    history.replaceState(history.state, "", url)
  } catch {
    // 地址改不动就算了，口令已经记住，不影响隐藏
  }
}

let installed = false

/**
 * 安装署名水印：在入口 main.js 里挂载应用之后调用一次。
 * @param {import("vue-router").Router} [router] 传入后，抹口令的动作等路由初始导航完成再做：
 *   vue-router 的初始导航会把它读到的完整地址（含 hash 里的 mark=…）重新写回地址栏，抢先抹会被盖回去
 */
export function installSignatureMark(router) {
  if (installed || typeof document === "undefined") return

  // 先看这次要不要显示
  let saved = null
  try {
    saved = localStorage.getItem(STORE_KEY)
  } catch {
    // 隐私模式等读不了 localStorage：当作没记住
  }
  const { show, remember } = decideMark({
    param: readMarkParam(),
    saved,
    isDev: import.meta.env.DEV,
    keyHash: KEY_HASH
  })
  if (remember) {
    try {
      localStorage.setItem(STORE_KEY, remember)
    } catch {
      // 存不了就只对这一次生效
    }
    if (router) router.isReady().then(stripMarkParam)
    else stripMarkParam()
  }
  if (!show) return
  installed = true

  const host = document.createElement("div")
  host.setAttribute("style", HOST_STYLE)
  const root = host.attachShadow({ mode: "closed" })

  /** 弹跳与浮现要用到的状态；角标 / 浮层元素在重建内容时会换，所以放在这里统一取 */
  const st = {
    badge: null,
    flash: null,
    x: 0,
    y: 0,
    vx: 1,
    vy: 1,
    W: 0,
    H: 0,
    bw: 0,
    bh: 0,
    frames: 0
  }

  /** 重新量视口和角标尺寸；每隔几十帧量一次，避免每帧强制布局 */
  function measure() {
    st.W = window.innerWidth
    st.H = window.innerHeight
    st.bw = st.badge.offsetWidth
    st.bh = st.badge.offsetHeight
  }

  /** 写入 / 重写全屏层里的内容，并重新挂上"内容被改就重建"的监听 */
  function mountContent() {
    contentObserver.disconnect()
    root.innerHTML = TEMPLATE
    st.badge = root.querySelector(".badge")
    st.flash = root.querySelector(".flash")
    measure()
    contentObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    })
  }
  // 内容被删、被改文字时整块重建；只看结构和文字，角标每帧写 style 不会触发它
  const contentObserver = new MutationObserver(mountContent)

  /** 宿主被删、被改样式、被加 hidden / class 等属性时恢复 */
  function ensure() {
    if (!host.isConnected) {
      ;(document.body || document.documentElement).appendChild(host)
    }
    if (host.getAttribute("style") !== HOST_STYLE) {
      host.setAttribute("style", HOST_STYLE)
    }
    for (const a of Array.from(host.attributes)) {
      if (a.name !== "style") host.removeAttribute(a.name)
    }
  }

  /** 角标反弹后把方向向量转个随机小角度，限制在 15°–75°，避免贴着边缘来回滑 */
  function turn() {
    const rad = (deg) => (deg * Math.PI) / 180
    const base = Math.atan2(Math.abs(st.vy), Math.abs(st.vx))
    const a = Math.min(
      rad(75),
      Math.max(rad(15), base + (Math.random() * 2 - 1) * rad(8))
    )
    st.vx = Math.cos(a) * Math.sign(st.vx)
    st.vy = Math.sin(a) * Math.sign(st.vy)
  }

  /** 角标前进 dt 秒；撞到画面边缘就反弹 */
  function step(dt) {
    if (st.frames++ % 30 === 0) measure()
    const maxX = Math.max(0, st.W - st.bw)
    const maxY = Math.max(0, st.H - st.bh)
    const d = CONFIG.speed * st.W * dt
    st.x += st.vx * d
    st.y += st.vy * d
    let hit = false
    if (st.x < 0) {
      st.x = 0
      st.vx = Math.abs(st.vx)
      hit = true
    } else if (st.x > maxX) {
      st.x = maxX
      st.vx = -Math.abs(st.vx)
      hit = true
    }
    if (st.y < 0) {
      st.y = 0
      st.vy = Math.abs(st.vy)
      hit = true
    } else if (st.y > maxY) {
      st.y = maxY
      st.vy = -Math.abs(st.vy)
      hit = true
    }
    if (hit) turn()
    // 整段覆盖 style：有人往角标上塞 display:none 之类，下一帧就被抹掉
    st.badge.style.cssText = `transform:translate(${st.x}px,${st.y}px)`
  }

  /** 中央浮现一次：去掉再加上 on 类并强制重排，让动画重新播放 */
  function flash() {
    const el = st.flash
    if (!el) return
    el.classList.remove("on")
    void el.offsetWidth
    el.classList.add("on")
  }

  // 挂到页面上
  mountContent()
  ;(document.body || document.documentElement).appendChild(host)
  measure()
  // 起点和方向随机：角度 25°–65°，四个象限随机
  const a0 = ((25 + Math.random() * 40) * Math.PI) / 180
  st.x = Math.random() * Math.max(0, st.W - st.bw)
  st.y = Math.random() * Math.max(0, st.H - st.bh)
  st.vx = Math.cos(a0) * (Math.random() < 0.5 ? 1 : -1)
  st.vy = Math.sin(a0) * (Math.random() < 0.5 ? 1 : -1)

  // 弹跳循环：dt 封顶 50 ms，切回标签页时不会一步跳很远
  let last = performance.now()
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(dt)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // 中央浮现：第一次等 firstFlashMs，之后每 flashEveryMs 一次
  setTimeout(() => {
    flash()
    setInterval(flash, CONFIG.flashEveryMs)
  }, CONFIG.firstFlashMs)

  // 防删除：宿主被移出 <body>、被改属性时立刻恢复；每秒再兜底检查一次（含 <style> 被改、内容缺失）
  new MutationObserver(ensure).observe(
    document.body || document.documentElement,
    {
      childList: true
    }
  )
  new MutationObserver(ensure).observe(host, { attributes: true })
  setInterval(() => {
    ensure()
    const style = root.querySelector("style")
    if (
      !st.badge.isConnected ||
      !st.flash.isConnected ||
      !style ||
      style.textContent !== CSS
    ) {
      mountContent()
    }
  }, 1000)

  // 开发服务器里留个钩子，方便手动推进帧、触发浮现来验证（线上构建不带）
  if (import.meta.env.DEV) {
    window.__sigMark = { st, step, flash, host, measure }
  }
}
