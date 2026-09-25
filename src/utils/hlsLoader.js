/*
 * hls.js 动态加载器
 *   - 项目未安装 hls.js 依赖，仅当通道返回 m3u8 流时按需从 CDN 加载
 *   - 加载过程做单例缓存，避免多次注入
 *   - 优先使用浏览器原生 HLS（Safari）；其它浏览器再 fallback 到 hls.js
 *
 * 用法：
 *   const Hls = await loadHlsJs()
 *   if (Hls?.isSupported()) {
 *     const hls = new Hls()
 *     hls.loadSource(url)
 *     hls.attachMedia(videoEl)
 *   }
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"

let hlsLoadingPromise = null

/** 是否原生支持 HLS（Safari / iOS） */
export function canPlayHlsNative(videoEl) {
  if (!videoEl) videoEl = document.createElement("video")
  return !!videoEl.canPlayType("application/vnd.apple.mpegurl")
}

/**
 * 加载 hls.js，返回构造函数（window.Hls）
 * 若浏览器禁用外网 / CDN 失败，将抛出错误，由调用方降级处理
 */
export function loadHlsJs() {
  if (typeof window === "undefined") return Promise.resolve(null)
  if (window.Hls) return Promise.resolve(window.Hls)
  if (hlsLoadingPromise) return hlsLoadingPromise

  hlsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = HLS_CDN
    script.async = true
    script.onload = () => {
      if (window.Hls) resolve(window.Hls)
      else reject(new Error("hls.js 加载完成但未挂载到 window"))
    }
    script.onerror = () => reject(new Error("hls.js CDN 加载失败"))
    document.head.appendChild(script)
  }).catch(err => {
    // 失败后清空 Promise，允许下次重试
    hlsLoadingPromise = null
    throw err
  })

  return hlsLoadingPromise
}
