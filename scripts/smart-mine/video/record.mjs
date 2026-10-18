/*
 * 智能矿山解说视频：逐帧录制三维镜头
 * ----------------------------------------------------------
 * 无头 Chrome 打开 /smart-mine 页面，停掉场景自己的渲染循环，改为按虚拟时间逐帧推进：
 * 每帧设置镜头、外观（透视 / 剖切程度）、页面缩放与虚拟时钟，渲染一次再截图，
 * 所以不管截图多慢，成片都是均匀的 30 帧 / 秒。
 *
 * 镜头时间取自 shots.json + timeline.json（先跑 timeline.py），这里定义每个三维镜头的运镜与界面状态。
 * 输出到 git 忽略的 models/smart-mine/video/frames/<镜头>/：00000.jpg … 与 meta.json（起始时间、帧数、标注点屏幕坐标）。
 *
 * 用法（先启动开发服务器）：
 *   node scripts/smart-mine/video/record.mjs [服务器地址] [镜头 id …]
 *   node scripts/smart-mine/video/record.mjs http://localhost:8893 strata xray
 * 单帧高清截图（做封面底图）：--still <镜头 id> <镜头内进度 0–1> <输出 png> [--dpr 2] [--cam '{"az":…}']
 *   --cam 覆盖该镜头的镜头参数（整段用同一个姿态）；--size 1440x1080 按封面比例的视口渲染（默认 1920x1080）
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
const VIDEO = join(ROOT, "models", "smart-mine", "video")
const FPS = 30

const args = process.argv.slice(2)
const base = (
  args.find((a) => /^https?:/.test(a)) || "http://localhost:8893"
).replace(/\/$/, "")
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const stillAt = args.indexOf("--still")
const still =
  stillAt >= 0
    ? {
        id: args[stillAt + 1],
        u: Number(args[stillAt + 2]),
        out: args[stillAt + 3]
      }
    : null
const dpr = Number(opt("--dpr", 1))
const [VW, VH] = opt("--size", "1920x1080").split("x").map(Number)
const camOverride = opt("--cam", null)
// 选项及其参数不算镜头 id
const skip = new Set()
args.forEach((a, i) => {
  if (a === "--still") [1, 2, 3].forEach((k) => skip.add(i + k))
  if (["--dpr", "--cam", "--size"].includes(a)) skip.add(i + 1)
})
const only = still
  ? [still.id]
  : args.filter(
      (a, i) => !/^https?:/.test(a) && !a.startsWith("--") && !skip.has(i)
    )

const timeline = JSON.parse(readFileSync(join(VIDEO, "timeline.json"), "utf8"))
const { shots, fade } = JSON.parse(
  readFileSync(join(HERE, "shots.json"), "utf8")
)
const segStart = Object.fromEntries(
  timeline.segments.map((s) => [s.key, s.start])
)
const at = ([key, off]) =>
  key === "END" ? timeline.duration : segStart[key] + off

// 虚拟时钟（矿区当地时间）：录视频时那边是凌晨一点多；延时镜头里快进到上午 10:40
const CLOCK0 = Date.UTC(2026, 9, 18, 7, 12, 0) // 01:12 MDT
const CLOCK1 = Date.UTC(2026, 9, 18, 16, 40, 0) // 10:40 MDT

/*
 * 三维镜头定义
 *   view：底部专题（点对应标签切换），ui：界面显示（dash 全部 / clean 只留三维 / plant 顶栏 + 标注）
 *   cam：镜头关键帧（u 为镜头内进度 0–1），可用 preset 引用页面里的专题镜头（overview / underground / … / section）
 *        再覆盖 az / pitch / dist / shiftY；也可直接给 tx、ty（局部米坐标）+ lift（相对地表）或 elev（海拔）
 *   look：外观关键帧（ghost 透视、under 井下物体、section 剖切、overlay 采区投影、flow 风流加强）
 *   clicks：镜头进行到 u 时点工具条按钮（同步页面上的按钮高亮、标签与图例）
 *   zoom：页面整体放大关键帧（k 倍，cx / cy 为放大中心的页面坐标）
 *   points：每帧输出屏幕坐标的标注点（合成时画说明文字）
 *   scan / scanDir：地表扫描揭示关键帧（pos 为扫描线位置，局部米坐标沿 scanDir 方向；扫过处为实景）
 *   tags：场景标注的不透明度关键帧（k 0 → 1）
 *   panels：界面入场关键帧（k 0 → 1：顶栏先出，两侧面板随后滑入，最后是指北针、工具条、图例和标注）
 *   refresh：每隔几帧刷新一次面板数据
 */
const SPECS = {
  // 开场钩子：全息扫描。一开始整块地表是半透明全息（等高线），地下巷道风流、工作面、钻孔在发光；
  // 一道青色光带由南向北扫过，扫过处变成真实航拍地表；最后镜头拉高，场景标注依次弹出
  hero: {
    view: "综合态势",
    ui: "hero",
    cam: [
      {
        u: 0,
        tx: 2300,
        ty: -2500,
        lift: -380,
        az: 128,
        pitch: 26,
        dist: 8600,
        shiftY: 0
      },
      {
        u: 1,
        tx: 1100,
        ty: -1000,
        lift: 0,
        az: 60,
        pitch: 35,
        dist: 19500,
        shiftY: 0
      }
    ],
    look: [{ u: 0, ghost: 0, under: 1, section: 0, overlay: 0, flow: 0.7 }],
    scan: [
      { u: 0.24, pos: -6400 },
      { u: 0.76, pos: 6400 }
    ],
    scanDir: [0, 1],
    tags: [
      { u: 0.74, k: 0 },
      { u: 0.9, k: 1 }
    ]
  },
  // 封面底图（只用于 --still，不在 shots.json 里）：从南往北看，扫描线南北向把沙盘切成两半，
  // 西半边（画面左）已是真实地表，东半边（画面右）还是全息，B 煤各工作面与在采面都在这一侧发光
  cover: {
    view: "综合态势",
    ui: "clean",
    cam: [
      {
        u: 0,
        tx: 450,
        ty: -1900,
        lift: -150,
        az: 166,
        pitch: 37,
        dist: 13600,
        shiftY: 0.06
      }
    ],
    look: [{ u: 0, ghost: 0, under: 1, section: 0, overlay: 0, flow: 0.7 }],
    scan: [{ u: 0, pos: 450 }],
    scanDir: [1, 0]
  },
  // 大屏出场：镜头拉回主视角，顶栏 → 两侧面板 → 指北针 / 工具条 / 图例依次滑入；标注一直保留
  reveal: {
    view: "综合态势",
    ui: "dash",
    cam: [
      {
        u: 0,
        tx: 1100,
        ty: -1000,
        lift: 0,
        az: 60,
        pitch: 35,
        dist: 19500,
        shiftY: 0
      },
      { u: 0.55, preset: "overview", az: 46 },
      { u: 1, preset: "overview", az: 50 }
    ],
    look: [
      { u: 0, ghost: 0, under: 1, section: 0, overlay: 0, flow: 0.7 },
      { u: 0.3, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 }
    ],
    panels: [
      { u: 0.12, k: 0 },
      { u: 0.55, k: 1 }
    ],
    tags: [{ u: 0, k: 1 }],
    refresh: 20
  },
  terrain: {
    view: "综合态势",
    ui: "clean",
    cam: [
      { u: 0, preset: "overview", az: 50 },
      {
        u: 1,
        tx: 1300,
        ty: -1700,
        lift: 0,
        az: 122,
        pitch: 25,
        dist: 13800,
        shiftY: 0
      }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 0, flow: 0 }]
  },
  strata: {
    view: "综合态势",
    ui: "clean",
    cam: [
      // 斜着看东侧壁：地层向南（画面左侧）抬升，煤层倾斜看得出来
      { u: 0, tx: 6000, ty: -1300, elev: 2150, az: 118, pitch: 14, dist: 5200 },
      { u: 1, tx: 6000, ty: -1800, elev: 2100, az: 104, pitch: 10, dist: 3900 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 0, flow: 0 }],
    points: [
      { key: "F", x: 6000, y: -1900, seam: "F" },
      { key: "E", x: 6000, y: -1900, seam: "E" },
      { key: "B", x: 6000, y: -1900, seam: "B" },
      { key: "top", x: 6000, y: -1900, surface: true }
    ]
  },
  slope: {
    view: "综合态势",
    ui: "clean",
    cam: [
      { u: 0, tx: 2700, ty: -2450, lift: 0, az: 22, pitch: 56, dist: 16500 },
      { u: 1, tx: 2700, ty: -2650, lift: 0, az: 30, pitch: 47, dist: 7600 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 0, flow: 0 }],
    points: "wells"
  },
  xray: {
    view: "综合态势",
    ui: "dash",
    clicks: [
      { u: 0.07, button: "透视" },
      { u: 0.55, button: "剖切" }
    ],
    cam: [
      { u: 0, preset: "overview" },
      { u: 0.07, preset: "overview" },
      { u: 0.32, preset: "underground" },
      { u: 0.55, preset: "underground", az: 42 },
      { u: 0.8, preset: "section" },
      { u: 1, preset: "section", az: 14 }
    ],
    look: [
      { u: 0, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 },
      { u: 0.07, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 },
      { u: 0.18, ghost: 1, under: 1, section: 0, overlay: 0, flow: 0 },
      { u: 0.55, ghost: 1, under: 1, section: 0, overlay: 0, flow: 0 },
      { u: 0.72, ghost: 1, under: 1, section: 1, overlay: 0, flow: 0 }
    ],
    refresh: 20
  },
  night: {
    view: "生产运营",
    ui: "dash",
    cam: [
      { u: 0, preset: "production", az: 24 },
      { u: 1, preset: "production", az: 30 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 }],
    zoom: [
      { u: 0, k: 1 },
      { u: 0.3, k: 1 },
      { u: 0.62, k: 2, cx: 1696, cy: 535 },
      { u: 1, k: 2.06, cx: 1696, cy: 535 }
    ],
    refresh: 10
  },
  timelapse: {
    view: "通风瓦斯",
    ui: "dash",
    timelapse: 0.85,
    cam: [
      { u: 0, preset: "ventilation", az: 54 },
      { u: 1, preset: "ventilation", az: 62 }
    ],
    look: [{ u: 0, ghost: 1, under: 1, section: 0, overlay: 0, flow: 1 }],
    zoom: [
      { u: 0, k: 1 },
      { u: 0.12, k: 1 },
      { u: 0.36, k: 1.6, cx: 1696, cy: 372 },
      { u: 1, k: 1.62, cx: 1696, cy: 372 }
    ],
    refresh: 4
  },
  recap: {
    view: "综合态势",
    ui: "clean",
    cam: [
      { u: 0, preset: "overview", az: 60, dist: 25500 },
      { u: 1, preset: "overview", az: 70, dist: 24000 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 }]
  },
  plant: {
    view: "工业广场",
    ui: "plant",
    // 俯角不超过 38°：无头 Chrome 走 GPU 截更陡的近景会卡住
    cam: [
      { u: 0, tx: 620, ty: 2150, lift: 0, az: 4, pitch: 36, dist: 3900 },
      { u: 1, tx: 640, ty: 2200, lift: 0, az: 16, pitch: 38, dist: 3300 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 0, flow: 0 }],
    refresh: 15
  },
  outro: {
    view: "综合态势",
    ui: "dash",
    cam: [
      { u: 0, preset: "overview", az: 40, dist: 23000 },
      { u: 1, preset: "overview", az: 54, dist: 28500 }
    ],
    look: [{ u: 0, ghost: 0, under: 0, section: 0, overlay: 1, flow: 0 }],
    refresh: 20
  }
}

// ---------------- 页面里安装的录制助手 ----------------

/** 在页面里求值：接管渲染循环，提供 __vid.frame(spec) */
const INSTALL = `(async () => {
  const s = window.__smartMineScene
  // 页面里用的同一份 gsap（vite 预构建依赖，URL 带版本号），用来停掉页面自带的补间
  const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/deps/gsap.js"))
  const gsap = (await import(url)).default
  cancelAnimationFrame(s.frameId)
  s._loop = () => {}
  const page = document.querySelector(".mine-page")
  const inst = page.__vueParentComponent
  const L = s.L
  const V3 = s.camera.position.constructor
  const W = (x, y, e) => new V3(x, (e - L.blockBase) * 1.35, -y)
  const sp = L.seamPlane
  const seamB = (x, y) => {
    const t = Math.tan((sp.dipDeg * Math.PI) / 180)
    const az = (sp.dipAz * Math.PI) / 180
    return sp.z0 - t * ((x - sp.refX) * Math.sin(az) + (y - sp.refY) * Math.cos(az))
  }
  const seamC = (k) => { const q = L.seams.find((x) => x.key === k); return q.base + q.thick / 2 }
  const ease = (x) => x * x * (3 - 2 * x)
  /** 关键帧 → 镜头姿态 */
  const keyPose = (k) => {
    let p
    if (k.preset === "section") p = s._sectionCam()
    else if (k.preset) p = s._viewCam(k.preset)
    else {
      const g = s.blocks[s.current].grid
      p = { target: W(k.tx, k.ty, k.elev ?? g.z(k.tx, k.ty) + (k.lift || 0)), az: 0, pitch: 30, dist: 10000, shiftY: 0 }
    }
    for (const f of ["az", "pitch", "dist", "shiftY"]) if (k[f] !== undefined) p[f] = k[f]
    return p
  }
  const pick = (keys, u) => {
    let i = 0
    while (i < keys.length - 1 && u > keys[i + 1].u) i++
    const a = keys[i]
    const b = keys[Math.min(i + 1, keys.length - 1)]
    const w = b === a || b.u === a.u ? 0 : ease(Math.min(1, Math.max(0, (u - a.u) / (b.u - a.u))))
    return [a, b, w]
  }
  const camAt = (keys, u) => {
    const [a, b, w] = pick(keys, u)
    const pa = keyPose(a)
    const pb = keyPose(b)
    let az = pb.az
    while (az - pa.az > 180) az -= 360
    while (az - pa.az < -180) az += 360
    return {
      target: pa.target.clone().lerp(pb.target, w),
      az: pa.az + (az - pa.az) * w,
      pitch: pa.pitch + (pb.pitch - pa.pitch) * w,
      dist: Math.exp(Math.log(pa.dist) + (Math.log(pb.dist) - Math.log(pa.dist)) * w),
      shiftY: pa.shiftY + (pb.shiftY - pa.shiftY) * w
    }
  }
  const numAt = (keys, u, fields) => {
    const [a, b, w] = pick(keys, u)
    const o = {}
    for (const f of fields) {
      const va = a[f] ?? 0
      const vb = b[f] ?? va
      o[f] = va + (vb - va) * w
    }
    return o
  }
  const killTweens = () => {
    gsap.killTweensOf(s.look)
    gsap.killTweensOf(s.canvas)
    s.fly?.kill()
    s.fly = null
    s.canvas.style.opacity = 1
  }
  const project = (v) => {
    const p = v.clone().project(s.camera)
    return [((p.x + 1) / 2) * 1920, ((1 - p.y) / 2) * 1080, p.z < 1 ? 1 : 0]
  }
  window.__vid = {
    killTweens,
    /** 点底部专题标签（隐藏了也能点） */
    tab(name) {
      const b = [...document.querySelectorAll(".tabs button")].find((x) => x.textContent.trim() === name)
      if (b && !b.classList.contains("on")) b.click()
    },
    /** 点左下工具条按钮，并立刻停掉页面自带的补间（外观由录制脚本逐帧给） */
    tool(name) {
      const b = [...document.querySelectorAll(".toolbar button")].find((x) => x.textContent.trim() === name)
      b?.click()
      killTweens()
    },
    ui(mode) {
      document.body.classList.add("vid")
      document.body.classList.toggle("vid-clean", mode === "clean")
      document.body.classList.toggle("vid-plant", mode === "plant")
      document.body.classList.toggle("vid-hero", mode === "hero")
    },
    /** 清掉入场动画留下的内联样式 */
    resetPanels() {
      for (const el of page.querySelectorAll(".head, .col, .compass, .toolbar, .legend, .tags")) {
        el.style.opacity = ""
        el.style.transform = ""
      }
    },
    state: () => ({ current: s.current, view: s.view, mode: s.mode, closeup: !!s.blocks.closeup }),
    frame(o) {
      const u = o.u
      s._apply(camAt(o.cam, u))
      Object.assign(s.look, numAt(o.look, u, ["ghost", "under", "section", "overlay", "flow"]))
      const scanU = s.blocks[s.current].terrain.material.uniforms
      scanU.uScanOn.value = o.scan ? 1 : 0
      if (o.scan) {
        scanU.uScanPos.value = numAt(o.scan, u, ["pos"]).pos
        scanU.uScanDir.value.set(o.scanDir[0], o.scanDir[1])
        scanU.uScanW.value = 180
      }
      s._applyLook()
      const b = s.blocks[s.current]
      const tu = b.terrain.material.uniforms
      tu.uHazeNear.value = s.camera.position.distanceTo(s.controls.target) * 0.9
      tu.uHazeK.value = s.current === "closeup" ? 0.00005 : 0.00004
      if (s.current === "overview") {
        s.under.update(o.dt, o.t, s.sim.face())
        if (s.section.visible) s.section.material.uniforms.uTime.value = o.t
      }
      s.composer.render()
      // 标注锚点（与场景渲染循环里的算法相同）
      const out = {}
      for (const [k, p] of Object.entries(b.anchors)) {
        const [x, y, front] = project(p)
        out[k] = { x, y, visible: front && x > -40 && x < 1960 && y > -40 && y < 1120 }
      }
      s.onAnchors(out)
      // 页面整体放大（Ken Burns），以左上角为原点：放大中心移到画面中心
      if (o.zoom) {
        const z = numAt(o.zoom, u, ["k", "cx", "cy"])
        const k = z.k
        const cx = z.cx || 960
        const cy = z.cy || 540
        // 放大中心从画面中心渐变到目标，且不露出页面外的空白
        const w = Math.min(1, (k - 1) / Math.max(0.001, (o.zoom.at(-1).k || 1) - 1))
        let fx = 960 + (cx - 960) * w
        let fy = 540 + (cy - 540) * w
        fx = Math.min(1920 - 960 / k, Math.max(960 / k, fx))
        fy = Math.min(1080 - 540 / k, Math.max(540 / k, fy))
        page.style.transformOrigin = "0 0"
        page.style.transform = "translate(" + (960 - fx * k) + "px," + (540 - fy * k) + "px) scale(" + k + ")"
      } else page.style.transform = ""
      if (o.panels) {
        // 按虚拟时间逐帧设置入场进度（不用 CSS 过渡：截图比实时慢，过渡会被压缩）
        const k = numAt(o.panels, u, ["k"]).k
        const c = (v) => ease(Math.min(1, Math.max(0, v)))
        const kh = c(k / 0.6)
        const kc = c((k - 0.25) / 0.75)
        const km = c((k - 0.55) / 0.45)
        const set = (el, a, tr) => {
          if (!el) return
          el.style.opacity = a
          el.style.transform = tr
        }
        set(page.querySelector(".head"), kh, "translateY(" + -40 * (1 - kh) + "px)")
        set(page.querySelector(".col.left"), kc, "translateX(" + -90 * (1 - kc) + "px)")
        set(page.querySelector(".col.right"), kc, "translateX(" + 90 * (1 - kc) + "px)")
        for (const el of page.querySelectorAll(".compass, .toolbar, .legend, .tags")) el.style.opacity = km
      }
      if (o.tags) {
        const tk = numAt(o.tags, u, ["k"]).k
        const tg = page.querySelector(".tags")
        if (tg) tg.style.opacity = tk
      }
      if (o.refresh) inst.setupState.snap = s.sim.snapshot()
      // 合成用的标注点
      if (o.points === "wells") return L.wells.map((w) => project(W(w.x, w.y, w.z + 6)))
      if (o.points) {
        const g = s.blocks[s.current].grid
        return o.points.map((q) => project(W(q.x, q.y, q.surface ? g.z(q.x, q.y) : seamB(q.x, q.y) + seamC(q.seam))))
      }
      return null
    }
  }
  return true
})()`

/** 录制时界面的显隐：始终隐藏底部标签、署名与近景说明（给剪映字幕留位置）；clean 只留三维 */
const CSS = `
  .vid .tabs, .vid .credit, .vid .caption { display: none !important; }
  .vid-clean .head, .vid-clean .cols, .vid-clean .compass, .vid-clean .toolbar,
  .vid-clean .legend, .vid-clean .tags { visibility: hidden !important; }
  .vid-plant .compass, .vid-plant .toolbar { visibility: hidden !important; }
  .vid-hero .head, .vid-hero .cols, .vid-hero .compass, .vid-hero .toolbar, .vid-hero .legend { visibility: hidden !important; }
  .vid .mine-page::after { display: none; }
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
const profile = mkdtempSync(join(tmpdir(), "mine-video-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VW},${VH}`,
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    // 额外参数，如 CHROME_FLAGS="--use-angle=swiftshader"（GPU 截 4K 单帧会卡住时用软件渲染）
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
    width: VW,
    height: VH,
    deviceScaleFactor: dpr,
    mobile: false
  })
  // 虚拟时钟：仿真器只用 Date.now()，录制时由脚本逐帧给定
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `{ const real = Date.now.bind(Date); window.__vidNow = null; Date.now = () => window.__vidNow ?? real(); }`
  })
  await evaluate(`window.__vidNow = ${CLOCK0}`)
  await send("Page.navigate", { url: `${base}/#/smart-mine` })
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    if (
      await evaluate(
        `!!window.__smartMineScene?.current && !document.querySelector(".scene-loading")`
      )
    )
      break
  }
  await evaluate(
    `window.__vidNow = ${CLOCK0}; (() => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(CSS)}; document.head.append(st) })()`
  )
  await evaluate(INSTALL)
  // 预先加载工业广场近景，再回到综合态势
  await evaluate(`__vid.tab("工业广场")`)
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    const st = await evaluate(`__vid.state()`)
    if (st.closeup && st.current === "closeup") break
  }
  await sleep(1500)
  await evaluate(`__vid.tab("综合态势")`)
  await sleep(2000)

  const tlEnd = at(["honest", 0])
  // 单帧模式可以截不在镜头表里的镜头（如封面），借用开场的时间段
  const list =
    still && !shots.some((x) => x.id === still.id)
      ? [{ id: still.id, kind: "3d", from: ["ask", 0], to: ["mine", 0] }]
      : shots
  for (const shot of list) {
    if (shot.kind !== "3d" || (only.length && !only.includes(shot.id))) continue
    const spec = { ...SPECS[shot.id] }
    if (camOverride) {
      const c = JSON.parse(camOverride)
      spec.cam = [
        { u: 0, ...spec.cam[0], ...c },
        { u: 1, ...spec.cam[0], ...c }
      ]
    }
    const from = at(shot.from)
    const to = at(shot.to)
    const t0 = from - fade / 2
    const t1 = to + fade / 2
    const n = Math.round((t1 - t0) * FPS)
    const dir = join(VIDEO, "frames", shot.id)
    if (!still) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    }

    // 预备：切专题、界面显隐，等页面自带的过渡走完再接管
    await evaluate(
      `__vid.ui(${JSON.stringify(spec.ui)}); __vid.tab(${JSON.stringify(spec.view)})`
    )
    await sleep(2200)
    // 工具条回到该专题默认的显示方式（上一个镜头可能切过透视 / 剖切）
    const wantMode = spec.view === "通风瓦斯" ? "透视" : "地表"
    await evaluate(`__vid.tool(${JSON.stringify(wantMode)})`)
    await sleep(400)
    await evaluate(`__vid.killTweens()`)

    const meta = { id: shot.id, start: t0, fps: FPS, frames: n, points: [] }
    const clicked = new Set()
    const started = Date.now()
    // 单帧模式只渲染 still.u 这一帧
    const ks = still
      ? [Math.round(still.u * (n - 1))]
      : Array.from({ length: n }, (_, k) => k)
    for (const k of ks) {
      const t = t0 + k / FPS
      const u = (t - t0) / (t1 - t0)
      // 虚拟时钟：延时镜头里从 01:1x 快进到 10:40，之后从 10:40 接着走
      let clock = CLOCK0 + t * 1000
      if (spec.timelapse) {
        const w = Math.min(1, u / spec.timelapse)
        const e = w * w * (3 - 2 * w)
        clock = CLOCK0 + t0 * 1000 + (CLOCK1 - CLOCK0 - t0 * 1000) * e
      } else if (t > tlEnd) clock = CLOCK1 + (t - tlEnd) * 1000
      for (const c of spec.clicks || [])
        if (u >= c.u && !clicked.has(c.button)) {
          clicked.add(c.button)
          await evaluate(`__vid.tool(${JSON.stringify(c.button)})`)
        }
      const refresh = spec.refresh ? k % spec.refresh === 0 : k === 0
      const pts = await evaluate(
        `window.__vidNow = ${Math.round(clock)}; __vid.frame(${JSON.stringify({
          u,
          t,
          dt: 1 / FPS,
          cam: spec.cam,
          look: spec.look,
          zoom: spec.zoom || null,
          panels: spec.panels || null,
          scan: spec.scan || null,
          scanDir: spec.scanDir || null,
          tags: spec.tags || null,
          points: spec.points || null,
          refresh
        })})${
          // 单帧模式：渲染完立刻在同一任务里读画布存到 window.__still（4K 下 Page.captureScreenshot 会卡住；封面底图不需要 HTML 标注）
          still
            ? `, (window.__still = document.querySelector(".scene-canvas").toDataURL("image/png")).length`
            : ""
        }`
      )
      if (still) {
        // 约 20 MB 的 data URL 一次回传会卡住调试协议，分块取回
        let data = ""
        for (let off = 0; off < pts; off += 1 << 20)
          data += await evaluate(
            `window.__still.slice(${off}, ${off + (1 << 20)})`
          )
        writeFileSync(still.out, Buffer.from(data.split(",")[1], "base64"))
        console.log("saved", still.out)
        break
      }
      meta.points.push(pts)
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
    // 单帧模式到此结束，不写镜头的 meta.json
    if (still) break
    await evaluate(
      `document.querySelector(".mine-page").style.transform = ""; __vid.resetPanels()`
    )
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta))
    console.log(
      `${shot.id}: ${n} 帧（${t0.toFixed(2)}–${t1.toFixed(2)} s），用时 ${((Date.now() - started) / 1000).toFixed(0)} s`
    )
  }
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
