#!/usr/bin/env node
/*
 * 在 ez-tree 造树页（scripts/estate/tree_lab/index.html，开发服务里）里求一段 JS，打印返回值
 * ----------------------------------------------------------
 * 用法（沙盒外；开发服务先起好）：
 *   node scripts/estate/img2/tree_lab_eval.mjs "<表达式，可 await>" [--url http://localhost:8893] [--out <文件.json>]
 * 例：node scripts/estate/img2/tree_lab_eval.mjs "treeLab.probeAll()"
 * 返回值是 JSON；--out 给了就把它整个写进文件，并只在终端打印摘要（大数据不刷屏）。
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const expr = args.find((a) => !a.startsWith("--"))
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : d
}
const base = opt("url", "http://localhost:8893").replace(/\/$/, "")
const outFile = opt("out", "")
if (!expr) {
  console.error("缺少表达式")
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")
const port = 9300 + Math.floor(Math.random() * 600)
const profile = mkdtempSync(join(tmpdir(), "tree-lab-"))
const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1280,720",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--enable-unsafe-swiftshader",
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
  throw new Error("连接 Chrome 调试端口超时")
}

let code = 0
try {
  const send = await connect()
  await send("Page.enable")
  await send("Runtime.enable")
  await send("Page.navigate", {
    url: `${base}/scripts/estate/tree_lab/index.html`
  })
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
    expression: `(async () => JSON.stringify(await (${expr})))()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? "求值出错")
  const text = r.result.value
  if (outFile) {
    writeFileSync(outFile, text)
    console.log(`已写 ${outFile}（${(text.length / 1e3).toFixed(0)} KB）`)
  } else console.log(JSON.stringify(JSON.parse(text), null, 1))
} catch (e) {
  console.error(e.message)
  code = 1
} finally {
  proc.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
process.exit(code)
