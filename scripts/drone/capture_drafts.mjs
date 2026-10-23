#!/usr/bin/env node
/*
 * 截取 /drone 设计稿：docs/design/drone/design/src/drafts.html?v=a|b|c → design/v1-*.png
 * ----------------------------------------------------------
 * 合成页用 file:// 直接打开（数据从 mock/design-moment.js 引入，不需要开发服务器），
 * 无头 Chrome 按 1920 × 1080 截图，等字体加载完（virtual-time-budget）。
 * 用法：node scripts/drone/capture_drafts.mjs [a b c] [--prefix v1] [--ui]
 *   --ui：只截 HTML 面板（drafts.html?ui=1，隐藏场景图、机载画面和缩略图），输出 <prefix>-<v>-ui.png，
 *         和页面隐藏画布后的截图比对面板排版（半透明面板背后透出的场景不算进面板差异）
 * Chrome 路径可用 CHROME_PATH 覆盖；截完后 Chrome 进程会自行退出。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DIR = join(ROOT, "docs", "design", "drone", "design")
const args = process.argv.slice(2)
const pi = args.indexOf("--prefix")
const prefix = pi >= 0 ? args[pi + 1] : "v1"
const variants = args.filter(
  (a, i) => !a.startsWith("--") && !(pi >= 0 && i === pi + 1)
)
const list = variants.length ? variants : ["a", "b", "c"]
const ui = args.includes("--ui")

const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

for (const v of list) {
  // 每次用一个全新的临时配置目录，避免和用户自己开着的 Chrome 冲突
  const profile = mkdtempSync(join(tmpdir(), "drone-chrome-"))
  const out = join(DIR, `${prefix}-${v}${ui ? "-ui" : ""}.png`)
  const url = `${pathToFileURL(join(DIR, "src", "drafts.html")).href}?v=${v}${ui ? "&ui=1" : ""}`
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1920,1080",
      "--virtual-time-budget=6000",
      "--allow-file-access-from-files",
      `--user-data-dir=${profile}`,
      `--screenshot=${out}`,
      url
    ],
    { stdio: "ignore" }
  )
  rmSync(profile, { recursive: true, force: true })
  console.log(`✓ ${out}`)
}
