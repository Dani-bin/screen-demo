/*
 * 首页预览图截图脚本
 * ----------------------------------------------------------
 * 用本机 Chrome 无头模式依次打开 src/views/home/data/demos.js 里的每个演示，
 * 等场景构建完、镜头到达首站后截 1920 × 1080 整屏，存为 public/<demo.preview>（webp）。
 * 新增演示或演示画面改版后重跑即可。
 *
 * 用法（先启动开发服务器）：
 *   node scripts/capture-home-previews.mjs [服务器地址] [演示 key…]
 *   - 服务器地址默认 https://localhost:8892（yarn dev 的地址）
 *   - 给出 key 时只重拍这几个，如：node scripts/capture-home-previews.mjs city
 * Chrome 路径默认取 macOS / Windows / Linux 的常见安装位置，可用 CHROME_PATH 环境变量覆盖。
 * 需要 Node 22+：用内置 WebSocket 直连 Chrome 调试协议，不额外安装依赖。
 */
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEMOS } from "../src/views/home/data/demos.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WIDTH = 1920
const HEIGHT = 1080
/** webp 质量：首页大预览最大约 1080 宽，82 已足够清晰 */
const QUALITY = 82
/** 等场景加载完成的最长时间（秒），超时仍会截图并给出提示 */
const READY_TIMEOUT = 60

/**
 * 场景就绪后再等多少秒截图。
 * 演示加载完会自动巡览，镜头先飞到首站、停留一段时间后去下一站；
 * 截图要落在首站停留期间的中段，太早镜头还在飞，太晚已经离站：
 *   - 校园：飞行 2.6 s + 停留 6.4 s（school/scene/cameraTour.js），取 5 s
 *   - 城市：飞行 2 s + 停留 8 s（city/scene/theme.js 的 tour），取 6 s，此时到站人流也已走起来
 * 新演示未配置时取 DEFAULT_SETTLE。
 */
const DEFAULT_SETTLE = 5
const SETTLE = { school: 5, city: 6 }

/**
 * 页面就绪条件（在页面里求值）：整页加载完、路由组件已渲染、
 * 且没有「场景构建中」遮罩（两个演示的加载遮罩都用 .scene-loading，没有遮罩的页面直接视为就绪）
 */
const readyExpr = (path) => `
  document.readyState === "complete" &&
  location.hash.startsWith(${JSON.stringify(`#${path}`)}) &&
  !!document.querySelector(".app-content > *") &&
  !document.querySelector(".scene-loading")
`

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome"
].filter(Boolean)

const isUrl = (s) => /^https?:\/\//.test(s)
const args = process.argv.slice(2)
const base = (args.find(isUrl) || "https://localhost:8892").replace(/\/$/, "")
const keys = args.filter((a) => !isUrl(a))
const targets = keys.length ? DEMOS.filter((d) => keys.includes(d.key)) : DEMOS

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 启动无头 Chrome，返回进程、调试端口与临时用户目录 */
function launchChrome() {
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chromePath)
    throw new Error("找不到 Chrome，请用 CHROME_PATH 环境变量指定")
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(tmpdir(), "home-preview-"))
  const proc = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--hide-scrollbars",
      // yarn dev 是自签名 https
      "--ignore-certificate-errors",
      // 无头模式没有 GPU，靠 SwiftShader 软件渲染 WebGL
      "--enable-unsafe-swiftshader",
      "--no-first-run",
      "about:blank"
    ],
    { stdio: "ignore" }
  )
  return { proc, port, profile }
}

/** 连接第一个页面标签的调试协议，返回 send(method, params) 与 close() */
async function connect(port) {
  let page = null
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === "page") || null
    } catch {
      // Chrome 还没起来，稍后重试
    }
    if (!page) await sleep(200)
  }
  if (!page) throw new Error("连接 Chrome 调试端口超时")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === "Runtime.exceptionThrown") {
      // 页面脚本异常只提示、不中断：截图仍可能可用，由人判断
      const desc = msg.params.exceptionDetails.exception?.description || ""
      console.warn("  [页面异常]", desc.split("\n")[0])
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { send, close: () => ws.close() }
}

async function main() {
  if (typeof WebSocket === "undefined") {
    throw new Error("需要 Node 22 及以上版本（使用内置 WebSocket）")
  }
  if (!targets.length) {
    throw new Error(`没有匹配的演示 key：${keys.join(", ")}`)
  }

  const { proc, port, profile } = launchChrome()
  try {
    const { send, close } = await connect(port)
    await send("Runtime.enable")
    await send("Page.enable")
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    })

    for (const demo of targets) {
      const url = `${base}/#${demo.path}`
      const settle = SETTLE[demo.key] ?? DEFAULT_SETTLE
      console.log(`→ ${demo.name}  ${url}`)
      // 先回空白页，保证每个演示都整页重新加载，而不是在同一页面里切路由
      await send("Page.navigate", { url: "about:blank" })
      const nav = await send("Page.navigate", { url })
      if (nav.errorText) {
        throw new Error(
          `打不开 ${url}（${nav.errorText}），请确认开发服务器已启动`
        )
      }

      // 轮询到场景加载完成；巡览从这一刻起计时，固定等待会受机器快慢影响
      const startedAt = Date.now()
      let ready = false
      while (!ready && Date.now() - startedAt < READY_TIMEOUT * 1000) {
        await sleep(300)
        const { result } = await send("Runtime.evaluate", {
          expression: readyExpr(demo.path),
          returnByValue: true
        })
        ready = result.value === true
      }
      const loadSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)
      if (ready) console.log(`  场景就绪（${loadSeconds}s），再等 ${settle}s`)
      else
        console.warn(
          `  ${READY_TIMEOUT}s 内未就绪，仍按当前画面截图，请人工检查`
        )

      await sleep(settle * 1000)
      const { data } = await send("Page.captureScreenshot", {
        format: "webp",
        quality: QUALITY
      })
      const out = join(ROOT, "public", demo.preview)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, Buffer.from(data, "base64"))
      console.log(`  已保存 public/${demo.preview}`)
    }
    close()
  } finally {
    proc.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      // Chrome 退出时可能还在写临时目录，删不掉无妨，系统会清理
    }
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
