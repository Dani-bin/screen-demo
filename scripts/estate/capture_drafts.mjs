#!/usr/bin/env node
/*
 * 截取 /estate 设计稿：docs/design/estate/design/src/drafts.html → design/<名字>.png
 * ----------------------------------------------------------
 * 合成页用 file:// 直接打开（数据从 design-moment.js 引入，不需要开发服务器），
 * 无头 Chrome 按 1920 × 1080 截图，等字体加载完（virtual-time-budget）。
 * 用法：node scripts/estate/capture_drafts.mjs [输出名，默认 v1]
 * Chrome 路径可用 CHROME_PATH 覆盖；截完后 Chrome 进程会自行退出（需在沙盒外运行）。
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DIR = join(ROOT, "docs", "design", "estate", "design")
const name = process.argv[2] || "v1"

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p))
if (!chrome) throw new Error("找不到 Chrome，请用 CHROME_PATH 指定")

// 每次用全新的临时配置目录，避免和用户自己开着的 Chrome 冲突
const profile = mkdtempSync(join(tmpdir(), "estate-chrome-"))
const out = join(DIR, `${name}.png`)
const url = pathToFileURL(join(DIR, "src", "drafts.html")).href
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
