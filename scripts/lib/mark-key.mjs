/*
 * 录屏 / 截图脚本用：给要打开的页面地址带上署名水印的口令，让水印在画面里隐藏。
 * ----------------------------------------------------------
 * 口令取自环境变量 MARK_KEY，没有就读仓库根目录的 .mark-key.local（node scripts/mark-key.mjs 生成）。
 * 开发服务器（yarn dev）本来就不显示水印，只有对着线上地址或生产构建（yarn preview）录屏时才需要它；
 * 读不到口令时原样返回地址，什么都不改。
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const KEY_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.mark-key.local"
)

/** 读取口令；没有返回空字符串 */
export function readMarkKey() {
  if (process.env.MARK_KEY) return process.env.MARK_KEY.trim()
  return existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : ""
}

/**
 * 在地址上追加 mark=<口令>。
 * hash 路由的参数写在 # 之后（如 http://x/#/open-pit?at=…&mark=…），没有 # 时写在 ? 之后。
 */
export function withMarkKey(url) {
  const key = readMarkKey()
  if (!key || /[?&]mark=/.test(url)) return url
  const hashAt = url.indexOf("#")
  const hasQuery = (hashAt >= 0 ? url.slice(hashAt) : url).includes("?")
  return `${url}${hasQuery ? "&" : "?"}mark=${key}`
}
