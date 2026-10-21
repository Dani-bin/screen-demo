// 抖音视频逐帧录屏：无头 Chrome 打开演示页面，按分镜文件编排，每推进 1/fps 秒截一张图，ffmpeg 合成分镜片段
// ----------------------------------------------------------
// 通用版，提炼自 docs/design/hospital|waiting/douyin/rec.mjs：页面相关的东西全部放进分镜文件（shots.mjs），这里不碰。
// 流程（每段分镜单独开一个 Chrome、单独打开页面）：
//   注入 vclock.js（虚拟时钟）→ 打开 base + shot.url → 等 CONFIG.ready 成立 → 等 CONFIG.settle 毫秒
//   → 关掉 CSS 动画 / 过渡（它们按真实时间播放，逐帧录制时会一闪而过；需要的动效在 helpers 里逐帧重做）
//   → 注入 rec-helpers.js 和分镜文件 CONFIG.helpers 里的页面工具 → 真实时间里跑 shot.setup
//   → 切到逐帧模式 → 反复调 shot.preroll 快进（不截图）直到它说可以开录 → 跑 shot.play，每帧截图，play 结束即这段结束
// 需在沙箱外运行（Claude 的沙箱里 Chrome 起不来）：终端面板里跑，或 Bash 关沙箱跑
//
// 用法：node rec.mjs <分镜文件> <devServerUrl> [分镜名… | all]
//         [--still <png>]   不录视频，只把这段分镜 play 结束时的画面存成 PNG（封面底图用）
//         [--dpr <n>]       --still 时的像素倍数（2 = 3840×2160）
// 环境变量：CHROME_PATH（Chrome 可执行文件）、CHROME_FLAGS（附加参数，默认 --use-angle=metal；
//           俯角大时 GPU 截图卡住就换成 --use-angle=swiftshader）、FFMPEG（ffmpeg 路径）
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = "用法：node rec.mjs <分镜文件> <devServerUrl> [分镜名… | all] [--still <png> --dpr 2]"

// ---- 命令行：先取出带值的开关，剩下的是位置参数
const argv = process.argv.slice(2)
const flag = (k) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv.splice(i, 2)[1] : null
}
const STILL = flag("--still")
const DPR = Number(flag("--dpr") || 1)
const [shotsArg, baseArg, ...names] = argv
if (!shotsArg || !baseArg) {
  console.error(USAGE)
  process.exit(1)
}
const SHOTS_PATH = resolve(shotsArg)
const SHOTS_DIR = dirname(SHOTS_PATH)
const BASE = baseArg.replace(/\/$/, "")
const mod = await import(pathToFileURL(SHOTS_PATH).href)
const SHOTS = mod.SHOTS
if (!Array.isArray(SHOTS) || !SHOTS.length) throw new Error(`${shotsArg} 没有导出 SHOTS 数组`)

// ---- 分镜文件的 CONFIG（都可省略）
const C = {
  ready: 'document.readyState === "complete"', // 页面就绪条件（页面里求值的表达式），如 "!!window.__waitingScene && !document.querySelector('.scene-loading')"
  readyTimeout: 60, // 等就绪最多多少秒
  settle: 2000, // 就绪后再等多少毫秒（让镜头、标签、首帧动画稳定）
  epoch: null, // 虚拟时钟起算时刻（ISO 字符串，如 "2026-07-25T13:58:00+08:00"）；null = 真实当前时刻
  width: 1920,
  height: 1080,
  fps: 30,
  clips: "clips", // 片段输出目录（相对分镜文件）
  helpers: [], // 额外注入的页面工具（相对分镜文件），在 rec-helpers.js 之后注入，可以往 window.REC 上加方法
  cssMotion: false, // true = 保留页面的 CSS 动画 / 过渡（一般不要）
  maxSeconds: 60, // 单段最长秒数，防止编排函数卡住时无限录下去
  maxPreroll: 600, // 快进最多多少秒虚拟时间
  ...(mod.CONFIG || {})
}
const FPS = C.fps
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const CHROME_FLAGS = (process.env.CHROME_FLAGS ?? "--use-angle=metal").split(/\s+/).filter(Boolean)
const FFMPEG = process.env.FFMPEG || (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg")
const NO_CSS_MOTION = "*, *::before, *::after { animation: none !important; transition: none !important }"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 分镜里的 setup / preroll / play 可以写成函数（取源码注入页面）或源码字符串（要拼进 Node 这边的常量时用模板字符串）
const src = (f) => (typeof f === "function" ? f.toString() : String(f))

const VCLOCK = readFileSync(join(HERE, "vclock.js"), "utf8")
const HELPERS = [join(HERE, "rec-helpers.js"), ...C.helpers.map((h) => resolve(SHOTS_DIR, h))].map((f) => readFileSync(f, "utf8"))
const EPOCH_JS = C.epoch ? `window.__VT_EPOCH = ${new Date(C.epoch).getTime()};\n` : ""

async function record(shot, idx) {
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(tmpdir(), "rec-profile-"))
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${C.width},${C.height}`,
      "--hide-scrollbars",
      "--ignore-certificate-errors", // yarn dev 是自签名证书
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      ...CHROME_FLAGS,
      "about:blank"
    ],
    { stdio: "ignore" }
  )
  let page
  for (let i = 0; i < 50 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")
    } catch {}
    if (!page) await sleep(200)
  }
  if (!page) {
    proc.kill()
    rmSync(profile, { recursive: true, force: true })
    throw new Error("Chrome 没起来（在沙箱里跑的话会这样，换到终端面板里跑）")
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let seq = 0
  const pend = new Map()
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++seq
      pend.set(id, r)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) console.warn("  页面脚本出错", JSON.stringify(r.result.exceptionDetails).slice(0, 600))
    return r.result?.result?.value
  }
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    } else if (m.method === "Runtime.exceptionThrown")
      console.warn("  EXC", m.params.exceptionDetails.exception?.description?.split("\n")[0])
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      console.warn("  ERR", JSON.stringify(m.params.args.map((a) => a.value || a.description)).slice(0, 300))
  }
  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: C.width, height: C.height, deviceScaleFactor: STILL ? DPR : 1, mobile: false })
  await send("Page.addScriptToEvaluateOnNewDocument", { source: EPOCH_JS + VCLOCK })
  await send("Page.navigate", { url: BASE + shot.url })

  // ---- 等页面就绪
  let ok = false
  for (let i = 0; i < C.readyTimeout * 4 && !ok; i++) {
    await sleep(250)
    ok = (await evaluate(`(() => { try { return !!(${C.ready}) } catch { return false } })()`)) === true
  }
  if (!ok) console.warn(`  ${C.readyTimeout} 秒内没等到就绪条件：${C.ready}`)
  await sleep(shot.settle ?? C.settle)
  if (!C.cssMotion) await evaluate(`document.head.insertAdjacentHTML("beforeend", ${JSON.stringify(`<style>${NO_CSS_MOTION}</style>`)})`)
  for (const h of HELPERS) await evaluate(h)
  if (shot.setup) {
    await evaluate(`(${src(shot.setup)})(${JSON.stringify(shot.setupArg ?? null)})`)
    await sleep(shot.setupWait ?? 1500)
  }

  // ---- 切到逐帧模式；有 preroll 的先快进（不截图）：返回 null = 再快进 0.1 秒，返回数字 = 再快进这么多毫秒就开录
  await evaluate("window.__vt.manual()")
  if (shot.preroll) {
    let n = 0
    for (; n < C.maxPreroll * 10; n++) {
      const left = await evaluate(`(${src(shot.preroll)})()`)
      if (left == null) {
        await evaluate("window.__vt.step(100)")
        continue
      }
      // 剩下的一段按 1/fps 一步走完，镜头和动画不会因为一步跨太大而跳
      for (let k = left; k > 0; k -= 1000 / FPS) await evaluate(`window.__vt.step(${Math.min(k, 1000 / FPS)})`)
      break
    }
    if (n >= C.maxPreroll * 10) console.warn(`  快进 ${C.maxPreroll} 秒仍没等到开录条件，照常开录`)
    else console.log(`  快进 ${(n / 10).toFixed(1)} 秒`)
  }

  // ---- 开录：play 结束（__playDone）即这段结束
  await evaluate(`window.__playDone = false; window.__playErr = null;
      (${src(shot.play)})().then(() => (window.__playDone = true), (e) => { window.__playErr = String(e && e.stack || e); window.__playDone = true }); "started"`)
  const dir = mkdtempSync(join(tmpdir(), "rec-frames-"))
  const t0 = Date.now()
  let frames = 0
  for (let i = 0; i < C.maxSeconds * FPS; i++) {
    const done = (await evaluate(`window.__vt.step(${1000 / FPS})`)) === true
    if (STILL) {
      if (done) {
        const png = await send("Page.captureScreenshot", { format: "png" })
        mkdirSync(dirname(resolve(STILL)), { recursive: true })
        writeFileSync(resolve(STILL), Buffer.from(png.result.data, "base64"))
        console.log(`${STILL}  ${C.width * DPR}×${C.height * DPR}（play 第 ${i + 1} 帧结束）`)
        break
      }
      continue
    }
    const img = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 })
    writeFileSync(join(dir, `${String(frames).padStart(6, "0")}.jpg`), Buffer.from(img.result.data, "base64"))
    frames++
    if (frames % (FPS * 5) === 0) console.log(`  已录 ${frames / FPS} 秒`)
    if (done) break
  }
  const err = await evaluate("window.__playErr")
  if (err) console.warn("  play 出错：", err)
  ws.close()
  proc.kill()
  rmSync(profile, { recursive: true, force: true })
  if (STILL) return rmSync(dir, { recursive: true, force: true })

  const outDir = resolve(SHOTS_DIR, C.clips)
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, `${String(idx + 1).padStart(2, "0")}-${shot.name}.mp4`)
  const ff = spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "%06d.jpg"), "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", out])
  if (ff.status) console.warn(ff.stderr.toString())
  rmSync(dir, { recursive: true, force: true })
  console.log(`${out}  ${frames} 帧 = ${(frames / FPS).toFixed(2)} 秒（录制耗时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
}

const list = !names.length || names.includes("all") ? SHOTS : names.map((n) => SHOTS.find((s) => s.name === n) || n)
const missing = list.filter((s) => typeof s === "string")
if (missing.length) throw new Error(`分镜文件里没有：${missing.join("、")}（有：${SHOTS.map((s) => s.name).join("、")}）`)
if (STILL && list.length !== 1) throw new Error("--still 一次只能渲染一段分镜")
for (const s of list) {
  console.log(`▶ ${s.name}`)
  await record(s, SHOTS.indexOf(s))
}
