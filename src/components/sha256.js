/*
 * 纯 JS 的 SHA-256（返回小写十六进制）
 * ----------------------------------------------------------
 * 线上演示地址是 http（不是安全上下文），浏览器里没有 crypto.subtle，
 * 所以署名水印校验口令时自己实现一份；结果与 Node 的 crypto 一致。
 */

/** 前 64 个素数：SHA-256 的常量表和初始值都由它们的立方根 / 平方根小数部分得出 */
const PRIMES = []
for (let n = 2; PRIMES.length < 64; n++) {
  if (PRIMES.every((p) => n % p)) PRIMES.push(n)
}
/** 取小数部分的前 32 位 */
const frac32 = (x) => Math.floor((x - Math.floor(x)) * 2 ** 32)
/** 64 个轮常量：前 64 个素数立方根的小数部分 */
const K = PRIMES.map((p) => frac32(Math.cbrt(p)))
/** 8 个初始哈希值：前 8 个素数平方根的小数部分 */
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)))

/** 32 位循环右移 */
const rotr = (x, n) => (x >>> n) | (x << (32 - n))

/**
 * @param {string} text 要哈希的文本（按 UTF-8 编码）
 * @returns {string} 64 位小写十六进制
 */
export function sha256(text) {
  const bytes = new TextEncoder().encode(text)
  // 补位：末尾加 0x80，补零到长度 ≡ 56 (mod 64)，再写入 64 位的原始比特长度
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLen = bytes.length * 8
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  let h = H0.slice()
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    // 消息调度：前 16 个字取自数据块，其余由前面的字扩展出来
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    // 64 轮压缩
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h = [a, b, c, d, e, f, g, hh].map((v, i) => (h[i] + v) | 0)
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("")
}
