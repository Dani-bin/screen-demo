/*
 * /smart-ranch 页面与设计稿截图
 * ----------------------------------------------------------
 * 无头 Chrome 打开页面，等就绪后截 1920 × 1080 PNG（和 scripts/smart-mine/capture.mjs 同一套做法，只改了就绪条件）。
 *   - 设计稿（docs/design/smart-ranch/drafts-source.html）：等 window.__ready = true
 *   - 页面（--page）：等场景对象挂上、加载遮罩消失，再等 --settle 秒（默认 6，等开场镜头飞完）
 *
 * 用法（先启动开发服务器，如 DEV_HTTP=1 PORT=8893 yarn dev）：
 *   node scripts/smart-ranch/capture.mjs "http://localhost:8893/#/smart-ranch?at=2026-07-25T13:58&tour=0" /tmp/ranch.png --page
 *   node scripts/smart-ranch/capture.mjs "http://localhost:8893/docs/design/smart-ranch/drafts-source.html?dir=a" /tmp/draft.png
 * ?at= 把仿真固定在定稿那一刻，?tour=0 不巡游，截出来的画面才能和定稿 design/final.png 逐区比对。
 * Chrome 路径可用 CHROME_PATH 覆盖；需要 Node 22+（内置 WebSocket）；在 Claude 沙箱里要放到沙箱外运行。
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const pos = args.filter(
  (a, i) =>
    !a.startsWith("--") &&
    !["--dpr", "--timeout", "--settle"].includes(args[i - 1])
)
const [url, out = join(tmpdir(), "ranch.png")] = pos
if (!url) throw new Error("缺少页面地址")
const dpr = Number(opt("--dpr", 1))
const timeout = Number(opt("--timeout", 180))
const page = args.includes("--page")
const settle = Number(opt("--settle", page ? 6 : 0))
// 就绪 / 报错条件：设计稿看 window.__ready / __error，页面看场景对象与遮罩
const readyExpr = page
  ? `document.querySelector(".scene-error")?.textContent ||
     (!!window.__ranchScene && !document.querySelector(".scene-loading"))`
  : "window.__error || (window.__ready === true)"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), "ranch-capture-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1920,1080",
    "--hide-scrollbars",
    "--ignore-certificate-errors",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    // 额外参数（排查 GPU 问题用），如 CHROME_FLAGS="--use-angle=swiftshader"
    ...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean),
    "about:blank"
  ],
  { stdio: "ignore" }
)

/** 连接页面标签的调试协议 */
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

const evaluate = async (send, expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true })).result
    .value

try {
  const send = await connect()
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: dpr,
    mobile: false
  })
  const t0 = Date.now()
  await send("Page.navigate", { url })
  let ok = false
  while (Date.now() - t0 < timeout * 1000) {
    await sleep(500)
    const s = await evaluate(send, readyExpr)
    if (typeof s === "string") throw new Error("页面报错：" + s)
    if (s) {
      ok = true
      break
    }
  }
  if (!ok) {
    // 超时时把页面状态打出来，方便排查
    const st = await evaluate(
      send,
      `JSON.stringify({ href: location.href, scene: !!window.__ranchScene, ready: window.__ready, loading: document.querySelector(".scene-loading")?.textContent, error: document.querySelector(".scene-error")?.textContent || window.__error, body: document.body.innerText.slice(0, 200) })`
    )
    throw new Error("等待渲染超时：" + st)
  }
  await sleep(settle * 1000)
  const info = await evaluate(send, "window.__info")
  if (info) console.log(JSON.stringify(info))
  // 偶尔截图请求拿不到合成帧会一直挂着：限时 20 s，超时就重试一次
  const shot = () =>
    Promise.race([
      send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      }),
      sleep(20000).then(() => null)
    ])
  let res = await shot()
  if (!res) {
    console.log("截图超时，重试")
    await evaluate(
      send,
      "document.body.style.outline = '0px solid transparent'"
    )
    res = await shot()
  }
  if (!res) throw new Error("截图失败")
  const { data } = res
  writeFileSync(out, Buffer.from(data, "base64"))
  console.log("saved", out, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
