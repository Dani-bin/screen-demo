/*
 * 署名水印口令管理
 * ----------------------------------------------------------
 * 线上页面默认常驻「抖音 程序员玥洛」署名水印；只有知道口令的人才能关掉它：
 * 打开 http://<地址>/#/home?mark=<口令>，这个浏览器就会记住并隐藏（口令存 localStorage）。
 * 口令本身只放在本机 .mark-key.local（已被 .gitignore 的 *.local 忽略），
 * 源码 src/components/signatureMarkKey.js 里只有它的 SHA-256。
 *
 * 用法：
 *   node scripts/mark-key.mjs       显示当前口令（没有就先生成一个）
 *   node scripts/mark-key.mjs new   换一个新口令；旧口令立刻失效，各浏览器里记住的旧口令也会失效，
 *                                   换完要提交并重新部署，水印才会按新口令校验
 * 录屏 / 截图脚本会从环境变量 MARK_KEY 或 .mark-key.local 读口令（见 scripts/lib/mark-key.mjs）。
 */
import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const KEY_FILE = join(ROOT, ".mark-key.local")
const HASH_FILE = join(ROOT, "src/components/signatureMarkKey.js")

/** 生成 24 位十六进制口令（96 位随机，哈希泄露出去也无法反推） */
function generate() {
  const key = randomBytes(12).toString("hex")
  const hash = createHash("sha256").update(key).digest("hex")
  writeFileSync(KEY_FILE, key + "\n")
  writeFileSync(
    HASH_FILE,
    `/*
 * 署名水印口令的 SHA-256（由 scripts/mark-key.mjs 生成，不要手改）。
 * 源码里只放哈希，口令本身只在本机的 .mark-key.local 里（git 忽略）。
 */
export const KEY_HASH = "${hash}"
`
  )
  return key
}

const wantNew = process.argv[2] === "new"
let key
if (wantNew || !existsSync(KEY_FILE)) {
  key = generate()
  console.log(wantNew ? "已换成新口令：" : "已生成口令：")
  console.log(`  ${key}`)
  console.log(
    `哈希已写入 ${HASH_FILE.replace(ROOT + "/", "")}，需要提交并重新部署才对线上生效。`
  )
} else {
  key = readFileSync(KEY_FILE, "utf8").trim()
  console.log("当前口令：")
  console.log(`  ${key}`)
}
console.log(`关闭水印的地址：http://<地址>/#/home?mark=${key}`)
