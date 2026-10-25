/*
 * 无人机巡检监控平台解说视频：逐帧录制
 * ----------------------------------------------------------
 * 无头 Chrome 打开 /drone 页面，停掉场景自己的渲染循环，改为按虚拟时间逐帧推进：
 * 每帧设置虚拟时钟（替换页面的 Date.now）、镜头、界面显隐与页面放大，渲染一次再截图，
 * 所以不管截图多慢，成片都是均匀的 30 帧 / 秒。做法同智能矿山（scripts/smart-mine/video/record.mjs）。
 *
 * 虚拟时钟：录制时园区时间从 2026-10-19 14:02:25 开始（可燃气体泄漏 14:01:44 刚被发现，告警进行中），
 * 随视频时间往前走；"派单处置"镜头里真的点一下按钮，后面的镜头事件状态随之变化，
 * "回放"镜头把时间轴从早上拖到现在再回到实时。
 *
 * 镜头时间取自 shots.json + timeline.json（先跑 timeline.py）。
 * 输出到 git 忽略的 models/drone/video/frames/<镜头>/：00000.jpg … 与 meta.json。
 *
 * 用法（先启动开发服务器）：
 *   node scripts/drone/video/record.mjs [服务器地址] [镜头 id …]
 *   node scripts/drone/video/record.mjs http://localhost:8893 hook intro
 * 只录部分镜头时，"派单处置"之后的镜头看不到已派单的状态（点击发生在 dispatch 镜头里），成片请整套重录。
 * 需要 Node 22+；CHROME_PATH 可覆盖 Chrome 路径。
 */
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..")
const VIDEO = join(ROOT, "models", "drone", "video")
const FPS = 30
const VW = 1920
const VH = 1080

const args = process.argv.slice(2)
/** 取出形如 --key v1 v2 … 的参数（n 个值），并从 args 里删掉 */
function flag(key, n = 1) {
  const i = args.indexOf(key)
  return i >= 0 ? args.splice(i, n + 1).slice(1) : null
}
// --still <镜头 id> <u> <png>：不录视频，只把该镜头进度 u 处的一帧存成 PNG（抖音封面底图用）
// --dpr 2 出 3840 × 2160（视口放大，见 SCALE）；--cam '{"tx":…}' 临时覆盖镜头（试机位用）
const STILL = flag("--still", 3)
const DPR = Number(flag("--dpr")?.[0] || 1)
const CAM = flag("--cam")?.[0]
// 高分辨率单帧不用 deviceScaleFactor（无头 Chrome 2 倍像素比时截图会卡死），改为把视口放大 DPR 倍：
// 页面按视口宽度设 rem（amfe-flexible），版面等比放大，效果同 2 倍图
const SCALE = STILL ? DPR : 1
const base = (
  args.find((a) => /^https?:/.test(a)) || "http://localhost:8893"
).replace(/\/$/, "")
const only = args.filter((a) => !/^https?:/.test(a) && !a.startsWith("--"))

const timeline = JSON.parse(readFileSync(join(VIDEO, "timeline.json"), "utf8"))
const { shots, fade } = JSON.parse(
  readFileSync(join(HERE, "shots.json"), "utf8")
)
const segStart = Object.fromEntries(
  timeline.segments.map((s) => [s.key, s.start])
)
const at = ([key, off]) =>
  key === "END" ? timeline.duration : segStart[key] + off

// 虚拟时钟起点（北京时间 2026-10-19 14:02:25）：泄漏 14:01:44 被发现，确认倒计时还剩约 80 s
const CLOCK0 = Date.parse("2026-10-19T14:02:25+08:00")
// 回放镜头把时间轴从这一刻拖起
const REPLAY_FROM = Date.parse("2026-10-19T06:30:00+08:00")

/*
 * 镜头定义
 *   ui：dash 整屏 / tags 只留三维 + 场景标注 / clean 只留三维（后两种去掉暗角，画布铺满）
 *   cam：镜头关键帧（u 为镜头内进度 0–1）。"home" = 标定主机位；否则 tx / ty / tz 为看向的场地坐标（米，
 *        x 东 y 北 z 上），az 为相机方位（度，0 = 在目标正南往北看，正值往东偏），pitch 俯角，dist 距离
 *   zoom：页面放大关键帧（k 倍，cx / cy 为放大后对准画面中心的页面坐标，超出页面边缘会被夹回）
 *   clicks：镜头进行到 u 时点击含该文字的按钮
 *   replay：[u0, u1, u2]，u0–u1 把时间轴从 REPLAY_FROM 拖到"现在"，u2 回到实时
 */
const HOME = "home"
const SPECS = {
  // 钩子：整屏开场，镜头从主机位推向泄漏点的红色光柱，告警横幅在顶上
  hook: {
    ui: "dash",
    cam: [
      { u: 0, ...HOME_POSE() },
      { u: 1, tx: 288.6, ty: -314.2, tz: 35, az: 6, pitch: 19, dist: 620 }
    ]
  },
  // 三维还原：去掉面板，罐区 → 装置区 → 江边码头和化学品船
  intro: {
    ui: "clean",
    cam: [
      { u: 0, tx: -30, ty: -160, tz: 8, az: -38, pitch: 30, dist: 520 },
      { u: 0.5, tx: 230, ty: -255, tz: 25, az: -6, pitch: 27, dist: 560 },
      { u: 1, tx: 110, ty: -650, tz: 4, az: 22, pitch: 21, dist: 470 }
    ]
  },
  // 机队：整屏，放大左侧机队状态面板
  fleet: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1, cx: 960, cy: 540 },
      { u: 0.22, k: 1.55, cx: 300, cy: 330 },
      { u: 1, k: 1.55, cx: 300, cy: 420 }
    ]
  },
  // 空中：侧面看 UAV-02 停在泄漏点南边两百多米处悬停监视（视野锥连到泄漏点）
  irAir: {
    ui: "tags",
    cam: [
      { u: 0, tx: 287, ty: -440, tz: 60, az: 72, pitch: 13, dist: 560 },
      { u: 1, tx: 287, ty: -430, tz: 60, az: 52, pitch: 15, dist: 500 }
    ]
  },
  // 机载红外画面：整屏，放大右下机载窗口（深紫色气羽）
  irPov: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1, cx: 960, cy: 540 },
      { u: 0.25, k: 2.1, cx: 1262, cy: 811 },
      { u: 1, k: 2.2, cx: 1262, cy: 811 }
    ]
  },
  // 派单：放大右侧事件流，跟着"一键派单"的口播点下"派单处置"
  dispatch: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1.3, cx: 1262, cy: 700 },
      { u: 0.15, k: 1.75, cx: 1660, cy: 300 },
      { u: 1, k: 1.75, cx: 1660, cy: 330 }
    ],
    clicks: [{ at: ["dispatch", 1.9], text: "派单处置" }]
  },
  // 大风停飞：放大机队面板的 1# 机场（阵风超限、不可起飞），再移到离线的 3# 机场
  wind: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1.2, cx: 1100, cy: 400 },
      { u: 0.18, k: 1.9, cx: 260, cy: 215 },
      { u: 0.5, k: 1.9, cx: 260, cy: 215 },
      { u: 0.75, k: 1.9, cx: 260, cy: 465 },
      { u: 1, k: 1.9, cx: 260, cy: 470 }
    ]
  },
  // 回放：放大底部时间轴，从早上拖到现在（三维里的无人机跟着时间跑），再回到实时
  replay: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1.2, cx: 900, cy: 700 },
      { u: 0.15, k: 1.35, cx: 960, cy: 760 },
      { u: 1, k: 1.35, cx: 960, cy: 760 }
    ],
    replay: [0.12, 0.85, 0.92]
  },
  // 技术：去掉面板，绕装置区转半圈，灯光、管廊、塔器的近景
  tech: {
    ui: "clean",
    cam: [
      { u: 0, tx: 225, ty: -250, tz: 28, az: -48, pitch: 31, dist: 440 },
      { u: 1, tx: 235, ty: -255, tz: 28, az: 36, pitch: 25, dist: 400 }
    ]
  },
  // 结尾：回到整屏主机位，轻微推近，留给评论引导
  outro: {
    ui: "dash",
    cam: [{ u: 0, ...HOME_POSE() }],
    zoom: [
      { u: 0, k: 1, cx: 960, cy: 540 },
      { u: 1, k: 1.04, cx: 960, cy: 540 }
    ]
  },
  // 封面底图（不进成片，只给 --still 用）：去掉面板留标注，泄漏光柱、红圈和悬停的 UAV-02 同框
  cover: {
    ui: "tags",
    t: 30, // 对应的视频时间（秒），决定虚拟时钟
    cam: [{ u: 0, tx: 270, ty: -380, tz: 40, az: 28, pitch: 22, dist: 760 }]
  }
}

/** 标定主机位的占位（在页面里换成 s.home 的位置 / 目标） */
function HOME_POSE() {
  return { preset: HOME }
}

// ---------------- 页面里的录制辅助（注入后挂在 window.__vid） ----------------

const INSTALL = `(() => {
  const s = window.__droneScene
  const clock = window.__droneClock
  // 停掉场景自己的渲染循环，之后每帧由 __vid.frame 推进
  s.renderer.setAnimationLoop(null)
  const page = document.querySelector(".drone-page")
  const V3 = s.camera.position.constructor
  const homeT = s.home.target.clone()
  const homeP = s.home.position.clone()
  const off = homeP.clone().sub(homeT)
  const homeOrbit = {
    tx: homeT.x, ty: -homeT.z, tz: homeT.y,
    az: Math.atan2(off.x, off.z) * 180 / Math.PI,
    pitch: Math.asin(off.y / off.length()) * 180 / Math.PI,
    dist: off.length()
  }
  const ease = (x) => x * x * (3 - 2 * x)
  const key = (k) => (k.preset === "home" ? homeOrbit : k)
  /** 关键帧插值：返回 [前一帧, 后一帧, 权重] */
  const pick = (keys, u) => {
    let i = 0
    while (i < keys.length - 1 && u > keys[i + 1].u) i++
    const a = keys[i]
    const b = keys[Math.min(i + 1, keys.length - 1)]
    const w = b === a || b.u === a.u ? 0 : ease(Math.min(1, Math.max(0, (u - a.u) / (b.u - a.u))))
    return [a, b, w]
  }
  const lerp = (a, b, w) => a + (b - a) * w
  // 只留三维的镜头不画机载窗口（它画在主画布上，面板藏了它还在；页面每秒刷新状态时会重设目标，所以直接跳过渲染）
  const povRender = s.pov.render.bind(s.pov)
  let povOn = true
  s.pov.render = (t) => povOn && povRender(t)
  // 灯光晕（lights.js 的 Points）按透视放大，镜头推近时成片的大光点叠加后被辉光糊成白团；
  // 录制时按相机到目标的距离压低放大系数（主机位约 1414 m 时不变），光点保持小而密
  const glow = s.lights?.group.children.find((o) => o.isPoints)
  if (glow) {
    const ob = glow.onBeforeRender
    glow.onBeforeRender = (r, sc, cam) => {
      ob(r, sc, cam)
      const d = cam.position.distanceTo(s.controls.target)
      glow.material.uniforms.uScale.value *= Math.min(1, Math.pow(d / 1414, 0.8))
    }
  }
  window.__vid = {
    /** 界面状态：dash 整屏 / tags 只留三维 + 标注 / clean 只留三维 */
    ui(mode) {
      document.documentElement.classList.remove("vid-dash", "vid-tags", "vid-clean")
      document.documentElement.classList.add("vid", "vid-" + mode)
      povOn = mode === "dash"
    },
    /** 点含指定文字的按钮 */
    click(text) {
      const el = [...document.querySelectorAll(".drone-page span, .drone-page button")].find(
        (x) => x.textContent.trim() === text
      )
      if (el) el.click()
      return !!el
    },
    /** 推进一帧 */
    async frame(o) {
      // 镜头
      const [a, b, w] = pick(o.cam, o.u)
      const A = key(a)
      const B = key(b)
      const tx = lerp(A.tx, B.tx, w), ty = lerp(A.ty, B.ty, w), tz = lerp(A.tz, B.tz, w)
      const az = (lerp(A.az, B.az, w) * Math.PI) / 180
      const p = (lerp(A.pitch, B.pitch, w) * Math.PI) / 180
      const d = lerp(A.dist, B.dist, w)
      const target = new V3(tx, tz, -ty)
      s._tween = null
      s.mode = "home" // home 模式下场景不再自己动镜头
      s.camera.position.set(
        target.x + d * Math.sin(az) * Math.cos(p),
        target.y + d * Math.sin(p),
        target.z + d * Math.cos(az) * Math.cos(p)
      )
      s.controls.target.copy(target)
      s.camera.lookAt(target)
      // 页面放大：先去掉变换再渲染（机载窗口按取景框的屏幕位置画进画布，变换会让它错位），渲染完再加回
      let tf = ""
      if (o.zoom) {
        const [za, zb, zw] = pick(o.zoom, o.u)
        const k = lerp(za.k, zb.k, zw)
        const cx = lerp(za.cx, zb.cx, zw)
        const cy = lerp(za.cy, zb.cy, zw)
        const W = innerWidth, H = innerHeight
        const ox = Math.min(0, Math.max(W - W * k, W / 2 - cx * k * (W / 1920)))
        const oy = Math.min(0, Math.max(H - H * k, H / 2 - cy * k * (H / 1080)))
        tf = "translate(" + ox + "px," + oy + "px) scale(" + k + ")"
      }
      page.style.transformOrigin = "0 0"
      page.style.transform = ""
      s._frame()
      page.style.transform = tf
      // 等两帧：场景标注（SceneTags 自己的 rAF）按新镜头重排、画面合成
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return true
    },
    live() { clock.goLive() },
    seek(t) { clock.seek(t) }
  }
  return true
})()`

const CSS = `
  .vid .tour { display: none !important; }
  .vid-tags .panel, .vid-tags .head, .vid-tags .kpis, .vid-tags .banner, .vid-tags .pov-wrap, .vid-tags .tline,
  .vid-tags .vignette-wrap, .vid-tags .zone,
  .vid-clean .panel, .vid-clean .head, .vid-clean .kpis, .vid-clean .banner, .vid-clean .pov-wrap, .vid-clean .tline,
  .vid-clean .vignette-wrap, .vid-clean .tags { visibility: hidden !important; }
`

// ---------------- Chrome ----------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), "drone-video-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VW * SCALE},${VH * SCALE}`,
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
    "about:blank"
  ],
  { stdio: "ignore" }
)

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = list.find((t) => t.type === "page")
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
        let seq = 0
        const pending = new Map()
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m)
            pending.delete(m.id)
          }
        }
        return (method, params = {}) =>
          new Promise((resolve, reject) => {
            const id = ++seq
            pending.set(id, (m) =>
              m.error ? reject(new Error(m.error.message)) : resolve(m.result)
            )
            ws.send(JSON.stringify({ id, method, params }))
          })
      }
    } catch {
      // Chrome 还没起来
    }
    await sleep(200)
  }
  throw new Error("连接 Chrome 调试端口超时")
}

try {
  const send = await connect()
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text
      )
    return r.result.value
  }
  await send("Page.enable")
  await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: VW * SCALE,
    height: VH * SCALE,
    deviceScaleFactor: 1,
    mobile: false
  })
  // 虚拟时钟：仿真和时钟只用 Date.now()，录制时由脚本逐帧给定
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `{ const real = Date.now.bind(Date); window.__vidNow = ${CLOCK0}; Date.now = () => window.__vidNow ?? real(); }`
  })
  await send("Page.navigate", { url: `${base}/#/drone?tour=0` })
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    if (await evaluate(`window.__dashboard?.ready === true`)) break
  }
  await evaluate(
    `(() => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(CSS)}; document.head.append(st) })()`
  )
  // 等事件缩略图截完（页面每 120 ms 截一张）
  await sleep(4000)
  await evaluate(INSTALL)

  // 单帧模式：时钟走到该镜头 u 处对应的时刻，摆好镜头 / 界面，渲染一帧存 PNG
  if (STILL) {
    const [id, us, png] = STILL
    const spec = SPECS[id]
    const shot = shots.find((s) => s.id === id)
    const u = Number(us)
    const t =
      spec.t ?? at(shot.from) + (at(shot.to) - at(shot.from)) * u - fade / 2
    const cam = CAM ? [{ u: 0, ...JSON.parse(CAM) }] : spec.cam
    await evaluate(`__vid.ui(${JSON.stringify(spec.ui)})`)
    console.log("渲染…")
    await evaluate(
      `window.__vidNow = ${Math.round(CLOCK0 + t * 1000)}; __vid.live(); __vid.frame(${JSON.stringify({ u, cam, zoom: spec.zoom || null })})`
    )
    console.log("截图…")
    const r = await Promise.race([
      send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 95,
        optimizeForSpeed: true
      }),
      sleep(120000).then(() => {
        throw new Error("截图超时")
      })
    ])
    writeFileSync(png, Buffer.from(r.data, "base64"))
    console.log(`saved ${png}（${id} u=${u}，视频时间 ${t.toFixed(2)} s）`)
  }

  const clicked = new Set()
  for (const shot of STILL ? [] : shots) {
    if (only.length && !only.includes(shot.id)) continue
    const spec = SPECS[shot.id]
    const from = at(shot.from)
    const to = at(shot.to)
    const t0 = from - fade / 2
    const t1 = to + fade / 2
    const n = Math.round((t1 - t0) * FPS)
    const dir = join(VIDEO, "frames", shot.id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    await evaluate(`__vid.ui(${JSON.stringify(spec.ui)})`)
    const started = Date.now()
    let lastSec = -1
    for (let k = 0; k < n; k++) {
      const t = Math.max(0, t0 + k / FPS)
      const u = (t0 + k / FPS - t0) / (t1 - t0)
      const now = CLOCK0 + t * 1000
      let js = `window.__vidNow = ${Math.round(now)};`
      // 时钟：实时镜头每过一秒刷新一次状态；回放镜头按进度拖时间轴
      const rp = spec.replay
      if (rp && u >= rp[0] && u < rp[2]) {
        if (k % 2 === 0) {
          const w = Math.min(1, (u - rp[0]) / (rp[1] - rp[0]))
          const e = w * w * (3 - 2 * w)
          js += `__vid.seek(${Math.round(REPLAY_FROM + (now - 60000 - REPLAY_FROM) * e)});`
        }
      } else if (Math.floor(t) !== lastSec) {
        lastSec = Math.floor(t)
        js += `__vid.live();`
      }
      for (const c of spec.clicks || [])
        if (t >= at(c.at) && !clicked.has(c.text)) {
          clicked.add(c.text)
          js += `__vid.live(); __vid.click(${JSON.stringify(c.text)});`
        }
      js += `__vid.frame(${JSON.stringify({ u, cam: spec.cam, zoom: spec.zoom || null })})`
      await evaluate(js)
      const shotRes = await Promise.race([
        send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 92,
          optimizeForSpeed: true
        }),
        sleep(20000).then(() => null)
      ])
      if (!shotRes) throw new Error(`${shot.id} 第 ${k} 帧截图超时`)
      writeFileSync(
        join(dir, `${String(k).padStart(5, "0")}.jpg`),
        Buffer.from(shotRes.data, "base64")
      )
    }
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ id: shot.id, start: t0, fps: FPS, frames: n })
    )
    console.log(
      `${shot.id}: ${n} 帧（${t0.toFixed(2)}–${t1.toFixed(2)} s），用时 ${((Date.now() - started) / 1000).toFixed(0)} s`
    )
  }
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
