/*
 * @Author:
 * @Date: 2025-09-09 16:04:14
 * @Description: 视频播放URL缓存管理
 */

import { getVedioPlayUrl } from '@/api/commandCentre.js'

// 缓存管理
let hasRequest = {} // 记录是否已请求过
let channelsData = [] // 原始数据
let urlCache = {} // URL缓存
let failedChannels = new Set() // 记录请求失败的channelId

/**
 * 设置预览图片URL
 * @param {Object} item - 包含channelId和fmp4的数据项
 */
function setPreviewImg(item) {
  if (item.fmp4) {
    let data = channelsData.find(val => val.channelId === item.channelId)
    if (data) {
      if (item.fmp4){
        item.fmp4 = item.fmp4.replace(':80/',':8082/')
      }
      data.fmp4 = item.fmp4
    }
  }
}

/**
 * 获取视频播放URL
 * @param {Object} item - 包含channelId和deviceId的数据项
 * @returns {Promise} 返回Promise对象
 */
async function getVideoPlayUrl(item) {
  const { channelId, deviceId } = item

  // 检查必要参数
  if (!channelId || !deviceId) {
    console.warn(`参数不完整 - channelId: ${channelId}, deviceId: ${deviceId}`)
    item.isLoading = false
    return Promise.reject(new Error('参数不完整'))
  }

  // 检查是否已经请求失败过，如果是则不再请求
  if (failedChannels.has(channelId)) {
    console.log(`Channel ${channelId} 之前请求失败，跳过本次请求`)
    item.isLoading = false
    return Promise.resolve()
  }

  // 检查缓存
  // if (urlCache[channelId]) {
  //   console.log(`使用缓存数据 - channelId: ${channelId}`)
  //   setPreviewImg({
  //     ...item,
  //     ...urlCache[channelId]
  //   })
  //   item.isLoading = false
  //   return Promise.resolve()
  // }

  // 检查是否正在请求中
  if (hasRequest[channelId]) {
    console.log(`Channel ${channelId} 正在请求中，等待结果...`)
    return new Promise((resolve) => {
      // 等待当前请求完成
      const checkRequest = () => {
        if (!hasRequest[channelId]) {
          // 请求完成，检查缓存
          if (urlCache[channelId]) {
            setPreviewImg({
              ...item,
              ...urlCache[channelId]
            })
          }
          item.isLoading = false
          resolve()
        } else {
          // 继续等待
          setTimeout(checkRequest, 100)
        }
      }
      checkRequest()
    })
  }

  // 标记为正在请求
  hasRequest[channelId] = true
  console.log(`开始请求视频URL - channelId: ${channelId}, deviceId: ${deviceId}`)

  return new Promise((resolve, reject) => {
    getVedioPlayUrl({
      channelId: channelId,
      deviceId: deviceId
    }).then(res => {
      // 清除请求标记
      hasRequest[channelId] = false

      if (res.data.code !== 0) {
        console.warn(`请求失败 - channelId: ${channelId}, code: ${res.data.code}`)
        // 请求失败，记录到失败列表
        failedChannels.add(channelId)
        item.isLoading = false
        resolve()
        return
      }

      // 请求成功，缓存数据
      const responseData = res.data.data
      urlCache[channelId] = responseData

      console.log(`请求成功并缓存 - channelId: ${channelId}`)
      setPreviewImg({
        ...item,
        ...responseData
      })

      item.isLoading = false
      resolve()
    }).catch((error) => {
      // 清除请求标记
      hasRequest[channelId] = false

      console.error(`请求异常 - channelId: ${channelId}`, error)
      // 请求异常，记录到失败列表
      failedChannels.add(channelId)
      item.isLoading = false
      reject(error)
    })
  })
}

/**
 * 批量处理数组并请求视频URL
 * @param {Array} array - 包含设备信息的数组
 */
export function pollArrayAndRequest(array) {
  channelsData = array
  console.log(`开始批量处理 ${array.length} 个设备`)

  for (let item of array) {
    try {
      // 设置加载状态
      item.isLoading = true
      getVideoPlayUrl(item)
    } catch (error) {
      console.error(`处理设备失败 - channelId: ${item.channelId}`, error)
    }
  }
}

/**
 * 清除指定channelId的缓存
 * @param {string} channelId - 频道ID
 */
export function clearChannelCache(channelId) {
  if (urlCache[channelId]) {
    delete urlCache[channelId]
    console.log(`已清除缓存 - channelId: ${channelId}`)
  }

  if (failedChannels.has(channelId)) {
    failedChannels.delete(channelId)
    console.log(`已清除失败记录 - channelId: ${channelId}`)
  }

  if (hasRequest[channelId]) {
    hasRequest[channelId] = false
    console.log(`已清除请求标记 - channelId: ${channelId}`)
  }
}

/**
 * 清除所有缓存
 */
export function clearAllCache() {
  urlCache = {}
  failedChannels.clear()
  hasRequest = {}
  console.log('已清除所有缓存')
}

/**
 * 获取缓存状态
 * @returns {Object} 缓存状态信息
 */
export function getCacheStatus() {
  return {
    cacheCount: Object.keys(urlCache).length,
    failedCount: failedChannels.size,
    requestingCount: Object.keys(hasRequest).filter(key => hasRequest[key]).length,
    cachedChannels: Object.keys(urlCache),
    failedChannels: Array.from(failedChannels)
  }
}
