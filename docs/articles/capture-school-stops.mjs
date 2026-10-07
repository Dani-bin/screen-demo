/*
 * 临时脚本：为掘金文章截取校园页六个导览站的画面
 * 思路沿用 scripts/capture-home-previews.mjs：无头 Chrome + 调试协议，
 * 逐个点击底部导览栏按钮，等镜头飞到位后截 1920×1080 整屏。
 * 另外再截一张隐藏全部面板的纯三维全景，用作文章头图。
 *
 * 用法：node capture-school-stops.mjs <服务器地址> <输出目录>
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const [, , base, outDir] = process.argv
const WIDTH = 1920
const HEIGHT = 1080
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 各站的文件名，顺序与 schoolData.js 的 LANDMARKS 一致 */
const STOPS = [
  "01-gate",
  "02-plaza",
  "03-clock-tower",
  "04-rotunda",
  "05-sports-field",
  "06-overview"
]

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if (!existsSync(chromePath)) throw new Error("找不到 Chrome")

const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), "school-shot-"))
const proc = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--hide-scrollbars",
    "--ignore-certificate-errors",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "about:blank"
  ],
  { stdio: "ignore" }
)

async function connect() {
  let page = null
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === "page") || null
    } catch {
      // Chrome 尚未就绪
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
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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

const evaluate = async (send, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result
    .value

async function shot(send, name) {
  const { data } = await send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 88
  })
  const file = join(outDir, `${name}.jpg`)
  writeFileSync(file, Buffer.from(data, "base64"))
  console.log("  已保存", file)
}

try {
  mkdirSync(outDir, { recursive: true })
  const { send, close } = await connect()
  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false
  })

  await send("Page.navigate", { url: `${base}/#/school` })

  // 等场景构建完成（加载遮罩消失）
  const started = Date.now()
  let ready = false
  while (!ready && Date.now() - started < 90000) {
    await sleep(400)
    ready = await evaluate(
      send,
      `document.readyState === "complete" &&
       !!document.querySelector(".stop-btn") &&
       !document.querySelector(".scene-loading")`
    )
  }
  console.log(`场景就绪：${((Date.now() - started) / 1000).toFixed(1)}s`)

  for (let i = 0; i < STOPS.length; i++) {
    // 点导览栏按钮：人工触发会暂停自动巡览，镜头飞到位后保持不动
    await evaluate(send, `document.querySelectorAll(".stop-btn")[${i}].click()`)
    await sleep(4200) // 飞行 2.6s + 余量
    console.log(`→ 第 ${i + 1} 站`)
    await shot(send, STOPS[i])
  }

  // 头图：隐藏所有面板，只留三维画面（仍停在全景站）
  await evaluate(
    send,
    `(() => {
      const s = document.createElement("style")
      s.textContent = ".school-page > *:not(canvas){display:none !important}"
      document.head.appendChild(s)
    })()`
  )
  await sleep(800)
  console.log("→ 头图（纯三维全景）")
  await shot(send, "00-cover")

  close()
} finally {
  proc.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // 忽略
  }
}
