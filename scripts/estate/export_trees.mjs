#!/usr/bin/env node
/**
 * 用 ez-tree 造树并导出 GLB（给 Blender 的 Cycles 渲染用）
 * ----------------------------------------------------------
 * 无头 Chrome 打开开发服务里的 scripts/estate/tree_lab/index.html，调 window.treeLab.exportAll()，写出：
 *   models/estate/render/trees_ez/<name>.glb      每个变体一个 GLB（带树皮和叶片贴图）
 *   models/estate/render/trees_ez/manifest.json   每个变体的类型、高度、冠径、三角面数
 * 用法：node scripts/estate/export_trees.mjs [开发服务地址，默认 http://localhost:8893]
 * 注意：需在 Claude 的沙盘外运行；开发服务要先起好。Chrome 启动和 CDP 做法同 export_for_blender.mjs。
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
const OUT = join(ROOT, "models", "estate", "render", "trees_ez")
const base = process.argv[2] ?? "http://localhost:8893"
const url = `${base}/scripts/estate/tree_lab/index.html`
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
const profile = mkdtempSync(join(tmpdir(), "estate-trees-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,720",
    "--hide-scrollbars",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--ignore-certificate-errors",
    "--no-first-run",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
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
  await send("Runtime.enable")
  await send("Page.navigate", { url })
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && !ready) {
    const r = await send("Runtime.evaluate", {
      expression: "window.__treeLabReady === true",
      returnByValue: true
    }).catch(() => null)
    ready = r?.result?.value === true
    if (!ready) await sleep(400)
  }
  if (!ready) throw new Error("造树页 90 秒内没有就绪")
  const r = await send("Runtime.evaluate", {
    expression: "window.treeLab.exportAll()",
    returnByValue: true,
    awaitPromise: true
  })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? "导出出错")
  mkdirSync(OUT, { recursive: true })
  const manifest = []
  for (const v of r.result.value) {
    writeFileSync(join(OUT, `${v.name}.glb`), Buffer.from(v.glb, "base64"))
    const { glb, ...meta } = v
    manifest.push(meta)
    console.log(
      `${v.name.padEnd(9)} ${v.preset.padEnd(13)} 高 ${v.stats.height.toFixed(1)}  冠径 ${v.stats.crownRadius.toFixed(1)}  ${Math.round(v.stats.tris)} 面  GLB ${((glb.length * 0.75) / 1e6).toFixed(1)} MB`
    )
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1))
} catch (e) {
  console.error(e.message)
  code = 1
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
process.exit(code)
