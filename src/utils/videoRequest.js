/*
 * 视频网关专用 axios 实例（WVP / 视频融合平台）
 *
 * baseURL 来源（按优先级）：
 *   1) 环境变量 VITE_APP_VIDEO_API
 *      - 开发环境  = '/video-api'，由 vite.config.js 的 server.proxy 反代到真实网关，解决跨域
 *      - 生产环境  = 'http://36.137.74.48:8090' 或部署侧 nginx 透出的 '/video-api'
 *   2) 未配置时回退到 '/video-api'，避免硬编码 IP 直连导致跨域失败
 *
 * 视频网关与主业务后端是两套独立鉴权体系，不能共用项目 token，
 * 因此这里不挂主业务的 Authorization、不走 refreshToken 流程。
 * 业务层如需附带视频网关 token，请在 url 路径上自行拼接
 * （接口规约：/api/v1/open/start/{deviceId}/{channelId}/{nowToken}）。
 */
import axios from "axios"

const VIDEO_BASE_URL = import.meta.env.VITE_APP_VIDEO_API || "/video-api"

const videoService = axios.create({
  baseURL: VIDEO_BASE_URL,
  timeout: 15 * 1000
})

// 响应拦截：扁平化数据 + 透传 401（用于业务层触发重新取 token 并重试）
videoService.interceptors.response.use(
  res => {
    // 视频网关返回的 HTTP 状态码 200 但业务上仍可能携带 code=401
    return res.data
  },
  error => {
    return Promise.reject(error)
  }
)

export default videoService
