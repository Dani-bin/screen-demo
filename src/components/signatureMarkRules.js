/*
 * 署名水印的显示规则
 * ----------------------------------------------------------
 * 纯函数，不碰 DOM 和 import.meta，Node 里也能直接 import 来验证。
 */
import { sha256 } from "./sha256.js"

/**
 * 判断这次要不要显示水印。
 * @param {object} o
 * @param {string|null} o.param 地址里的 mark 参数（没有为 null）
 * @param {string|null} o.saved 这个浏览器里记住的口令（没有为 null）
 * @param {boolean} o.isDev 是否开发服务器（yarn dev）
 * @param {string} o.keyHash 口令的 SHA-256；为空表示还没设口令，谁都关不掉
 * @returns {{ show: boolean, remember: string|null }}
 *   remember 非空表示要把这个口令存进 localStorage，下次打开不用再带参数
 */
export function decideMark({ param, saved, isDev, keyHash }) {
  // ?mark=on：强制显示，在开发服务器里自己验证水印时用
  if (param === "on") return { show: true, remember: null }
  // 开发服务器默认不显示：免得影响自己调试、截图和录视频
  if (isDev) return { show: false, remember: null }
  // 地址里带了正确口令：隐藏，并让这个浏览器记住
  if (param && keyHash && sha256(param) === keyHash) {
    return { show: false, remember: param }
  }
  // 这个浏览器之前记住过正确口令
  if (saved && keyHash && sha256(saved) === keyHash) {
    return { show: false, remember: null }
  }
  return { show: true, remember: null }
}
