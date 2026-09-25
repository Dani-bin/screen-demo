/*
 * 视频播放相关接口（WVP / 视频融合平台）
 *
 * 流程：
 *   1) POST /api/v1/open/getToken  → 用账号/密码换 token（短期有效，401 时需重取）
 *   2) GET  /api/v1/open/start/{deviceId}/{channelId}/{token}
 *        deviceId  = videoDevices[i].wvpDeviceId
 *        channelId = videoDevices[i].deviceNumber
 *      返回结果中筛选一条可在浏览器播放的地址（优先 mp4 / fmp4 / hls / flv）
 *
 * token 在模块内存中缓存，多个通道复用同一 token；
 * 命中 401 时清空缓存并自动重取一次（避免无限循环）。
 */
import videoRequest from "@/utils/videoRequest"

// 视频网关账号密码（按接口文档固定）
const VIDEO_AUTH = {
  username: "admin",
  password: "adc08c455cf17c3d15284dde3e990642"
}

// token 内存缓存
let cachedToken = ""
// 并发取 token 时复用同一个 Promise，避免重复请求
let pendingTokenPromise = null

/**
 * 获取视频网关 token
 * @param {boolean} forceRefresh 强制重新拉取（如上一次返回 401）
 * @returns {Promise<string>}
 */
export async function getVideoToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken) return cachedToken
  if (pendingTokenPromise) return pendingTokenPromise

  pendingTokenPromise = videoRequest({
    url: "/api/v1/open/getToken",
    method: "post",
    data: VIDEO_AUTH
  })
    .then(res => {
      // 兼容多种返回包装：{ code, data: "tokenStr" } / { code, data: { token } } / 直接是字符串
      const data = res?.data ?? res
      const token =
        typeof data === "string"
          ? data
          : data?.token || data?.accessToken || data?.value || ""
      if (!token) throw new Error("视频网关 token 解析失败")
      cachedToken = token
      return token
    })
    .finally(() => {
      pendingTokenPromise = null
    })

  return pendingTokenPromise
}

/**
 * 从网关返回的 data 中筛选最适合浏览器播放的地址
 * 网关常见字段：fmp4 / flv / ws_flv / hls / rtmp / rtc / mp4
 * 浏览器优先级：mp4 > fmp4 > hls(.m3u8) > flv(.flv)
 * @param {*} data 网关接口 data 字段
 * @returns {{ url: string, type: "mp4"|"fmp4"|"hls"|"flv"|"" }}
 */
function pickPlayableUrl(data) {
  if (!data) return { url: "", type: "" }

  // 1) data 直接是字符串
  if (typeof data === "string" && /^https?:\/\//.test(data)) {
    return { url: data, type: detectType(data) }
  }

  // 2) data 是对象：按浏览器兼容性优先级取
  if (typeof data === "object" && !Array.isArray(data)) {
    const candidates = [
      ["mp4", data.mp4],
      ["fmp4", data.fmp4 || data.fMp4 || data.fmp4Url],
      ["hls", data.hls || data.hlsUrl || data.m3u8 || data.hls_fmp4],
      ["flv", data.flv || data.flvUrl || data.https_flv || data.ws_flv]
    ]
    for (const [type, url] of candidates) {
      if (typeof url === "string" && url) return { url, type }
    }
    // 兜底：遍历对象，找一个 http(s) 开头的字符串
    for (const v of Object.values(data)) {
      if (typeof v === "string" && /^https?:\/\//.test(v)) {
        return { url: v, type: detectType(v) }
      }
    }
  }

  // 3) data 是数组：取第一个可用项
  if (Array.isArray(data)) {
    for (const item of data) {
      const picked = pickPlayableUrl(item)
      if (picked.url) return picked
    }
  }

  return { url: "", type: "" }
}

/** 根据 URL 推断流类型 */
function detectType(url) {
  const lower = url.toLowerCase()
  if (lower.includes(".m3u8")) return "hls"
  if (lower.includes(".flv")) return "flv"
  if (lower.includes(".mp4")) return "mp4"
  return ""
}

/**
 * 获取指定设备/通道的播放地址
 * @param {object} opts
 * @param {string} opts.deviceId  → wvpDeviceId
 * @param {string} opts.channelId → deviceNumber
 * @returns {Promise<{ url: string, type: string, raw: any }>}
 */
export async function getVideoPlayUrl({ deviceId, channelId }) {
  if (!deviceId || !channelId) {
    throw new Error("缺少 deviceId 或 channelId")
  }
  const request = async token => {
    const url = `/api/v1/open/start/${encodeURIComponent(
      deviceId
    )}/${encodeURIComponent(channelId)}/${encodeURIComponent(token)}`
    return videoRequest({ url, method: "get" })
  }

  // 第一次：用缓存 token
  let token = await getVideoToken(false)
  let res
  try {
    res = await request(token)
  } catch (e) {
    // 接口层抛出的网络错误透传
    throw e
  }

  // 业务 code === 401 时，刷新 token 重试一次
  if (res && (res.code === 401 || res.code === "401")) {
    cachedToken = ""
    token = await getVideoToken(true)
    res = await request(token)
  }

  if (!res || (res.code !== 0 && res.code !== 200)) {
    throw new Error(res?.msg || "获取视频播放地址失败")
  }

  const picked = pickPlayableUrl(res.data)
  return { ...picked, raw: res.data }
}

/** 手动清除 token 缓存（如登出或测试用） */
export function clearVideoToken() {
  cachedToken = ""
}
