import axios from "axios"
import { ElNotification, ElMessageBox, ElMessage } from "element-plus"
import {
  getToken,
  getRefreshToken,
  setRefreshToken,
  setToken
} from "@/utils/auth"
import errorCode from "@/utils/errorCode"
import { tansParams } from "@/utils/ruoyi"
import { refreshToken } from "@/api/login"
import useUserStore from "@/store/modules/user"

// 是否显示重新登录
export let isRelogin = { show: false }
// 是否正在刷新中
let isRefreshToken = false
// 请求队列
let requestList = []

axios.defaults.headers["Content-Type"] = "application/json;charset=utf-8"
// 创建axios实例
const service = axios.create({
  // axios中请求配置有baseURL选项，表示请求URL公共部分
  baseURL: import.meta.env.VITE_APP_BASE_API,
  // 超时
  timeout: 1000 * 60 * 3
})

// request拦截器
service.interceptors.request.use(
  (config) => {
    // 是否需要设置 token
    const isToken = (config.headers || {}).isToken === false
    // 是否需要防止数据重复提交
    const isRepeatSubmit = (config.headers || {}).repeatSubmit === false
    if (getToken() && !isToken) {
      config.headers["Authorization"] = "Bearer " + getToken() // 让每个请求携带自定义token 请根据实际情况自行修改
    }

    // get请求映射params参数
    if (config.method === "get" && config.params) {
      let url = config.url + "?" + tansParams(config.params)
      url = url.slice(0, -1)
      config.params = {}
      config.url = url
    }
    if (!isRepeatSubmit && (config.method === "post" || config.method === "put")) {
      const requestObj = {
        url: config.url,
        data: typeof config.data === "object" ? JSON.stringify(config.data) : config.data,
        time: new Date().getTime()
      }
      if (config.responseType) {
        requestObj.responseType = config.responseType
      }
    }
    return config
  },
  (error) => {
    console.log(error)
    Promise.reject(error)
  }
)

// 响应拦截器
service.interceptors.response.use(
  async (res) => {
    // 未设置状态码则默认成功状态
    const code = res.data.code || 200
    // 获取错误信息
    const msg = errorCode[code] || res.data.msg || errorCode["default"]
    // 二进制数据则直接返回
    if (
      res.request.responseType === "blob" ||
      res.request.responseType === "arraybuffer"
    ) {
      return res.data
    }
    if (code === 4012 || code === 4014 || code === 4015 || code === 4013 || code === 4011 || code === 4016 || code === 401) {
      // 如果未认证，并且未进行刷新令牌，说明可能是访问令牌过期了
      if (!isRefreshToken) {
        isRefreshToken = true
        // 1. 如果获取不到刷新令牌，则只能执行登出操作
        if (!getRefreshToken()) {
          window.location.href = import.meta.env.VITE_APP_BASE_API + "/login"
          // return Promise.reject("无效的会话，或者会话已过期，请重新登录。")
        }
        // 2. 进行刷新访问令牌
        try {
          const refreshTokenRes = await refreshToken()
          // 2.1 刷新成功，则回放队列的请求 + 当前请求
          setToken(refreshTokenRes.data.accessToken)
          setRefreshToken(refreshTokenRes.data.refreshToken)
          requestList.forEach((cb) => cb())
          return service(res.config)
        } catch (e) {
          // 为什么需要 catch 异常呢？刷新失败时，请求因为 Promise.reject 触发异常。
          // 2.2 刷新失败，只回放队列的请求
          requestList.forEach((cb) => cb())
          // 提示是否要登出。即不回放当前请求！不然会形成递归
          return Promise.reject("无效的会话，或者会话已过期，请重新登录。")
        } finally {
          requestList = []
          isRefreshToken = false
        }
      } else {
        if (res.config.url.includes('refresh-token')) {
          window.location.href = import.meta.env.VITE_APP_BASE_API + "/login"
          return Promise.reject("无效的会话，或者会话已过期，请重新登录。")
        }
        // 添加到队列，等待刷新获取到新的令牌
        return new Promise((resolve) => {
          requestList.push(() => {
            res.config.headers["Authorization"] = "Bearer " + getToken() // 让每个请求携带自定义token 请根据实际情况自行修改
            resolve(service(res.config))
          })
        })
      }
    } else if (code === 500) {
      if (res.config.notError) {
        return Promise.reject("error")
      }
      ElMessage({ message: msg, type: "error" })
      return Promise.reject(new Error(msg))
    } else if (code === 601) {
      if (res.config.notError) {
        return Promise.reject("error")
      }
      ElMessage({ message: msg, type: "warning" })
      return Promise.reject(new Error(msg))
    } else if (code !== 200) {
      if (res.config.notError) {
        return Promise.reject("error")
      }
      ElNotification.error({ title: msg })
      return Promise.reject("error")
    } else {
      return Promise.resolve(res.data)
    }
  },
  (error) => {
    if (error.config.notError) {
      return Promise.reject("error")
    }
    let { message } = error
    if (message == "Network Error") {
      message = "后端接口连接异常"
    } else if (message.includes("timeout")) {
      message = "系统接口请求超时"
    } else if (message.includes("Request failed with status code")) {
      message = "系统接口" + message.substr(message.length - 3) + "异常"
    }
    ElMessage({ message: message, type: "error", duration: 5 * 1000 })
    return Promise.reject(error)
  }
)

export default service
