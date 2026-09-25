import axios from 'axios'
import store from '@/store'
import {
  getToken,
  getRefreshToken,
  setRefreshToken,
  setToken
} from "@/utils/auth"
import errorCode from '@/utils/errorCode'

// 需要忽略的提示。忽略后，自动 Promise.reject('error')
const ignoreMsgs = [
  "无效的刷新令牌", // 刷新令牌被删除时，不用提示
  "刷新令牌已过期" // 使用刷新令牌，刷新获取新的访问令牌时，结果因为过期失败，此时需要忽略。否则，会导致继续 401，无法跳转到登出界面
]

// 是否显示重新登录
export let isRelogin = { show: false };
// Axios 无感知刷新令牌，参考 https://www.dashingdog.cn/article/11 与 https://segmentfault.com/a/1190000020210980 实现
// 请求队列
let requestList = []
// 是否正在刷新中
let isRefreshToken = false

axios.defaults.headers['Content-Type'] = 'application/json;charset=utf-8'
// 创建axios实例
const service = axios.create({
  // axios中请求配置有baseURL选项，表示请求URL公共部分
  baseURL: "http://36.139.139.19:8501",
  // 超时
  timeout: 2400000,
  // 禁用 Cookie 等信息
  withCredentials: false,
})
let parseAdvanceParam = function (_data) {
  let result = {
    groupRelation: "AND",
    params: {},
    querys: [],
    sorter: [],
  };
  for (let dataKey in _data) {
    if (dataKey.indexOf('OP') == -1 && dataKey != 'parse' && _data[dataKey]) {
      result.querys.push({
        group: "main",
        operation: _data[dataKey + 'OP'] ? _data[dataKey + 'OP'] : '=',
        property: dataKey,
        relation: "AND",
        value: _data[dataKey],
      });
    }
  }

  return result;
}

// request拦截器
service.interceptors.request.use(config => {
  // 是否需要设置 token
  const isToken = (config.headers || {}).isToken === false
  if (config.data && config.data.parse) {
    config.data = parseAdvanceParam(config.data);
  }
  if (getToken() && !isToken) {
    config.headers['Authorization'] = 'Bearer ' + getToken() // 让每个请求携带自定义token 请根据实际情况自行修改
    // config.headers['authorization-userId'] = store.getters.user.id // 当前登录用户的ID
  }
  // if (getToken() && !isToken) {
  // }
  // get请求映射params参数
  if (config.data && config.method == 'get') {
    config.params = config.data;
  }
  return config
}, error => {
  Promise.reject(error)
})

// 响应拦截器
service.interceptors.response.use(async res => {
  // 未设置状态码则默认成功状态
  const code = res.data.code || 200;
  // 获取错误信息
  const msg = res.data.msg || errorCode[code] || errorCode['default']
  if (code != 200) {
    return Promise.reject(new Error(msg))
  } else {
    return res.data
  }
}, error => {
  console.log('err' + error)
  return Promise.reject(error)
})

export function getBaseHeader() {
  return {
    'Authorization': "Bearer " + getToken(),
  }
}

export default service
