#!/usr/bin/env node
/*
 * 截取 /open-pit 设计稿：docs/design/open-pit/design/src/drafts.html → design/<name>.png
 * ----------------------------------------------------------
 * 合成页用 file:// 直接打开（数据从 data.js 引入，不需要开发服务器），
 * 无头 Chrome 按 1920 × 1080 截图，等字体加载完（virtual-time-budget）。
 * 用法：node scripts/open-pit/capture_drafts.mjs [输出名，默认 v1] [--ui]
 *   --ui：只截 HTML 面板（drafts.html?ui=1，隐藏场景图和场景标签），输出 <名>-ui.png，
 *         和页面隐藏画布后的截图比对面板排版。
 * Chrome 路径可用 CHROME_PATH 覆盖；需要在沙盒外运行；截完后 Chrome 进程会自行退出。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DIR = join(ROOT, "docs", "design", "open-pit", "design")
const args = process.argv.slice(2)
const ui = args.includes("--ui")
const name = args.find((a) => !a.startsWith("--")) || "v1"

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

// 每次用一个全新的临时配置目录，避免和用户自己开着的 Chrome 冲突
const profile = mkdtempSync(join(tmpdir(), "open-pit-chrome-"))
const out = join(DIR, `${name}${ui ? "-ui" : ""}.png`)
const url = `${pathToFileURL(join(DIR, "src", "drafts.html")).href}${ui ? "?ui=1" : ""}`
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
