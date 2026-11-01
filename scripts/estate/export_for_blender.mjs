#!/usr/bin/env node
/**
 * 把页面里的数据导给 Blender 离线渲染
 * ----------------------------------------------------------
 * 无头 Chrome 打开页面，调 window.__estateScene.exportForBlender()，写出：
 *   models/estate/render/ground_albedo.png     地面底图（不含树脚阴影和地面 AO）
 *   models/estate/render/scene_instances.json  树冠 / 树干 / 灌木 / 路灯 / 车 / 周边楼的实例矩阵和颜色
 * 页面里这些东西是随机撒出来的，导出后 Blender 里的位置和页面一一对应。
 * 用法：node scripts/estate/export_for_blender.mjs [页面地址，默认 http://localhost:8893]
 * 注意：需在 Claude 的沙盒外运行；开发服务要先起好；跑完确认 Chrome 进程退出。
 * Chrome 启动和 CDP 做法沿用 ~/src/build-3d-visual-dashboard/scripts/capture.mjs。
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "models", "estate", "render")
const base = process.argv[2] ?? "http://localhost:8893"
const url = `${base}/#/estate?skip=1&tour=0`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].find((p) => p && existsSync(p))
if (!chrome) {
  console.error("错误：找不到 Chrome，请用环境变量 CHROME_PATH 指定")
  process.exit(1)
}
const port = 9300 + Math.floor(Math.random() * 600)
const profile = mkdtempSync(join(tmpdir(), "estate-export-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1920,1080",
    "--ignore-certificate-errors",
    "--no-first-run",
    "--hide-scrollbars",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "about:blank"
  ],
  { stdio: "ignore" }
)

async function connect() {
  for (let i = 0; i < 60; i++) {
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
    await sleep(250)
  }
  throw new Error("连接 Chrome 调试端口超时（是否在沙盒里运行？）")
}

let code = 0
try {
  const send = await connect()
  await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  })
  await send("Page.navigate", { url })
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && !ready) {
    const r = await send("Runtime.evaluate", {
      expression: "window.__dashboard?.ready === true",
      returnByValue: true
    }).catch(() => null)
    ready = r?.result?.value === true
    if (!ready) await sleep(400)
  }
  if (!ready) throw new Error("页面 90 秒内没有就绪")
  await sleep(1500) // 汽车矩阵等跑一帧
  const r = await send("Runtime.evaluate", {
    expression: "window.__estateScene.exportForBlender()",
    returnByValue: true
  })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? "导出出错")
  const { albedo, instances } = r.result.value
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, "ground_albedo.png"),
    Buffer.from(albedo.split(",")[1], "base64")
  )
  writeFileSync(
    join(OUT, "scene_instances.json"),
    JSON.stringify({ instances })
  )
  console.log(
    "已导出：",
    Object.entries(instances)
      .map(([k, v]) => `${k}×${v.count}`)
      .join("  ")
  )
} catch (e) {
  console.error(e.message)
  code = 1
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
process.exit(code)
