/*
 * /energy 页面截图（与设计稿对比用）
 * ----------------------------------------------------------
 * 无头 Chrome 打开 /energy，等开场动画结束后把镜头固定在主视角（停掉空闲摆动），截 1920 × 1080 整屏 PNG。
 * --clean 时隐藏面板、标签等页面 UI，只留三维画面（看建筑位置与体量）；
 * --keep-camera 时不动镜头（配合较短的 --settle 截开场动画中途的画面）；
 * --dpr 2 时截 3840 × 2160 高清图；
 * --design-frame 时取消页面上的构图平移（THEME.viewShift），画面与设计稿 01 逐像素对齐，供 compare.py 叠图。
 * 截图再交给 scripts/energy/compare.py 与设计稿对齐出对比图。
 *
 * 用法（先启动开发服务器）：
 *   node scripts/energy/capture.mjs [服务器地址] [输出 png] [--clean] [--keep-camera] [--settle 秒] [--eval 表达式]
 *   node scripts/energy/capture.mjs https://localhost:8892 /tmp/energy.png --clean
 * Chrome 路径可用 CHROME_PATH 覆盖；需要 Node 22+（内置 WebSocket）。
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const flag = (k) => args.includes(k)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const pos = args.filter(
  (a, i) => !a.startsWith("--") && !["--settle", "--eval", "--dpr"].includes(args[i - 1])
)
const base = (
  pos.find((a) => /^https?:/.test(a)) || "https://localhost:8892"
).replace(/\/$/, "")
const out = pos.find((a) => !/^https?:/.test(a)) || join(tmpdir(), "energy.png")
// 开场动画 8.6 s + 面板滑入 0.8 s，之后再让车流跑一会儿
const settle = Number(opt("--settle", 16))
// 设备像素比：2 时截 3840 × 2160（封面等需要高清底图时用）
const dpr = Number(opt("--dpr", 1))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

const port = 9300 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), "energy-capture-"))
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
  await send("Page.navigate", { url: `${base}/#/energy` })
  for (let i = 0; i < 200; i++) {
    await sleep(300)
    if (await evaluate(send, "!!window.__energyScene?.station")) break
  }
  await sleep(settle * 1000)
  // 镜头回到主视角并停住摆动：lastInteract 设到很久以后，_autoCamera 就不再干预
  await evaluate(
    send,
    `(() => {
      const s = window.__energyScene
      ${flag("--design-frame") ? "s.designFrame = true; s._fitFrustum()" : ""}
      ${
        flag("--keep-camera")
          ? ""
          : `s.lastInteract = performance.now() + 1e9
      s.controls.target.copy(s.center)
      s.camera.zoom = 1
      s.camera.updateProjectionMatrix()
      s._placeCamera(s.homeSpherical)`
      }
      ${
        flag("--clean")
          ? `document.querySelectorAll(".col,.bottom-row,.bottom-tip,.model-credits,.tags,.legend,header.head").forEach(e => e.style.visibility = "hidden")`
          : ""
      }
    })()`
  )
  if (!flag("--keep-camera")) await sleep(800)
  // --eval <表达式>：截图前在页面里求值并打印（排查场景状态用）
  if (flag("--eval"))
    console.log(JSON.stringify(await evaluate(send, opt("--eval")), null, 1))
  const { data } = await send("Page.captureScreenshot", { format: "png" })
  writeFileSync(out, Buffer.from(data, "base64"))
  console.log("saved", out)
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
