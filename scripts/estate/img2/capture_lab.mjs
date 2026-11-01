#!/usr/bin/env node
/*
 * /estate 还原评审截图：无头 Chrome 打开 estate-lab.html，等 window.__lab.ready 后截 PNG
 * ----------------------------------------------------------
 * 用法（先启动开发服务器，需在沙盒外运行）：
 *   node scripts/estate/img2/capture_lab.mjs <输出.png> [--url http://localhost:8893] [--q "mat=flat&cam=ref"]
 *        [--w 1536] [--h 864] [--settle 1.5] [--eval "<js>"] [--page "skip=1&tour=0"]
 * --page：不打开实验页，改打开真正的 /estate 页面（hash 路由，后面接的是它的查询串），等页面的 __dashboard.ready，
 *         stats 打印 window.__estateScene.stats()（含帧率），用来测页面里的帧率和截整屏图。
 * Chrome 路径可用 CHROME_PATH 覆盖。需要 Node 22+（用内置 WebSocket 直连调试协议）。
 * --eval 在截图前执行一段脚本（例如切光照、切镜头），其返回值会打印出来。
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
import { dirname, resolve } from "node:path"

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const out = resolve(args.find((a) => a.endsWith(".png")) || "lab.png")
const base = opt("url", "http://localhost:8893").replace(/\/$/, "")
const query = opt("q", "")
const W = Number(opt("w", 1536))
const H = Number(opt("h", 864))
const settle = Number(opt("settle", 1.5))
const evalJs = opt("eval", "")
const pageQuery = opt("page", "")

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
]
  .filter(Boolean)
  .find((p) => existsSync(p))
if (!CHROME) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(`${tmpdir()}/estate-lab-`)
const proc = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    "--hide-scrollbars",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    // 截图用：不要因为页面在后台就降帧或延迟渲染
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "about:blank"
  ],
  { stdio: "ignore" }
)

async function connect() {
  let page = null
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === "page") || null
    } catch {
      /* Chrome 还没起来 */
    }
    if (!page) await sleep(200)
  }
  if (!page) throw new Error("连接 Chrome 调试端口超时")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : res(msg.result)
    } else if (msg.method === "Runtime.exceptionThrown") {
      console.warn(
        "[页面异常]",
        (msg.params.exceptionDetails.exception?.description || "").split(
          "\n"
        )[0]
      )
    } else if (
      msg.method === "Runtime.consoleAPICalled" &&
      msg.params.type === "error"
    ) {
      console.warn(
        "[console.error]",
        msg.params.args
          .map((a) => a.value ?? a.description)
          .join(" ")
          .slice(0, 200)
      )
    }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, { resolve: res, reject: rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => ws.close() }
}

try {
  const { send, close } = await connect()
  await send("Runtime.enable")
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false
  })
  const url = pageQuery
    ? `${base}/#/estate?${pageQuery}`
    : `${base}/estate-lab.html?w=${W}&h=${H}${query ? "&" + query : ""}`
  const nav = await send("Page.navigate", { url })
  if (nav.errorText) throw new Error(`打不开 ${url}（${nav.errorText}）`)
  const t0 = Date.now()
  let ready = false
  while (!ready && Date.now() - t0 < 120000) {
    await sleep(400)
    const { result } = await send("Runtime.evaluate", {
      expression: pageQuery
        ? "!!(window.__dashboard && window.__dashboard.ready)"
        : "!!(window.__lab && window.__lab.ready)",
      returnByValue: true
    })
    ready = result.value === true
  }
  console.log(
    ready
      ? `就绪（${((Date.now() - t0) / 1000).toFixed(1)}s）`
      : "120s 内未就绪，仍截图"
  )
  if (evalJs) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: evalJs,
      awaitPromise: true,
      returnByValue: true
    })
    console.log(
      "eval →",
      exceptionDetails
        ? exceptionDetails.exception?.description
        : JSON.stringify(result.value)
    )
  }
  await sleep(settle * 1000)
  const stats = await send("Runtime.evaluate", {
    expression: pageQuery
      ? "JSON.stringify(window.__estateScene && window.__estateScene.stats ? window.__estateScene.stats() : {})"
      : "JSON.stringify(window.__labStats || {})",
    returnByValue: true
  })
  console.log("stats", stats.result.value)
  const { data } = await send("Page.captureScreenshot", { format: "png" })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(data, "base64"))
  console.log("已保存", out)
  close()
} finally {
  proc.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* 系统会清理 */
  }
}
