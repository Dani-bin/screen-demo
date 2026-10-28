/*
 * /mine-fire 页面截图（从 scripts/smart-conveyor/capture.mjs 改来，只换了就绪条件）
 * ----------------------------------------------------------
 * 无头 Chrome 打开页面，等三维场景就绪、没有加载 / 报错遮罩后，再等 --settle 秒，截 1920 × 1080 PNG。
 *
 * 用法（先启动开发服务器；需在沙盒外运行）：
 *   node scripts/mine-fire/capture.mjs "<开发服务器>/#/mine-fire?at=14:06:18&tour=0" <输出 png> [--settle 秒] [--dpr 2]
 * 不带 --page 时按设计稿页面的 window.__ready 判断（docs/design/mine-fire/design/src/v1.html）。
 * --css "<样式>"：截图前往页面注入一段样式；--eval "<表达式>"：截图前在页面里求值并打印结果（JSON）。
 * Chrome 路径可用 CHROME_PATH 覆盖；需要 Node 22+（内置 WebSocket）。
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
    !["--dpr", "--timeout", "--settle", "--css", "--eval"].includes(args[i - 1])
)
const [url, out = join(tmpdir(), "mine-fire.png")] = pos
if (!url) throw new Error("缺少页面地址")
const dpr = Number(opt("--dpr", 1))
const timeout = Number(opt("--timeout", 180))
const page = args.includes("--page")
const settle = Number(opt("--settle", page ? 4 : 0))
const css = opt("--css", "")
const evalExpr = opt("--eval", "")
// 就绪 / 报错条件：设计稿看 window.__ready / __error，页面看场景对象与遮罩
const readyExpr = page
  ? `document.querySelector(".scene-error")?.textContent ||
     (!!window.__dashboard?.ready && !document.querySelector(".scene-loading"))`
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
const profile = mkdtempSync(join(tmpdir(), "mine-fire-capture-"))
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
  (
    await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
  ).result.value

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
  if (!ok) throw new Error("等待渲染超时")
  await sleep(settle * 1000)
  if (css) {
    await evaluate(
      send,
      `document.head.insertAdjacentHTML("beforeend", ${JSON.stringify(`<style>${css}</style>`)})`
    )
    await sleep(400)
  }
  if (evalExpr) console.log(JSON.stringify(await evaluate(send, evalExpr)))
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
