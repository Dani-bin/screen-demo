/*
 * @Author:
 * @Date: 2025-09-09 16:04:14
 * @Description: 视频播放URL缓存管理
 */

import { getVideoPlayUrl as apiGetVideoPlayUrl } from '@/api/videoPlay'

// 缓存管理
let hasRequest = {} // 记录是否已请求过
let channelsData = [] // 原始数据
let urlCache = {} // URL缓存
let failedChannels = new Set() // 记录请求失败的channelId

/**
 * 设置预览图片URL
 * @param {Object} item - 包含channelId和url的数据项
 */
function setPreviewImg(item) {
  if (item.url) {
    // 直接设置到传入的item上，确保正确更新
    item.fmp4 = item.url
    item.url = item.url
    
    // 同时更新channelsData中对应的对象（如果存在相同引用）
    const channelId = item.channelId || item.deviceNumber
    let data = channelsData.find(val => 
      val.channelId === channelId || val.deviceNumber === channelId
    )
    if (data) {
      data.fmp4 = item.url
      data.url = item.url
    }
  }
}

/**
 * 获取视频播放URL
 * @param {Object} item - 包含channelId和deviceId的数据项
 * @returns {Promise} 返回Promise对象
 */
async function getVideoPlayUrl(item) {
  const { deviceNumber, wvpDeviceId } = item
  const channelId = deviceNumber
  const deviceId = wvpDeviceId
  // 检查必要参数
  if (!channelId || !deviceId) {
    console.warn(`参数不完整 - channelId: ${channelId}, deviceId: ${deviceId}`)
    item.isLoading = false
    item.videoError = "缺少必要参数"
    return Promise.reject(new Error('参数不完整'))
  }

  // 检查是否已经请求失败过，如果是则不再请求
  if (failedChannels.has(channelId)) {
    console.log(`Channel ${channelId} 之前请求失败，跳过本次请求`)
    item.isLoading = false
    return Promise.resolve()
  }

  // 检查缓存
  if (urlCache[channelId]) {
    console.log(`使用缓存数据 - channelId: ${channelId}`)
    setPreviewImg({
      ...item,
      ...urlCache[channelId]
    })
    item.isLoading = false
    return Promise.resolve()
  }

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

  try {
    // 使用统一的API接口
    const { url, type } = await apiGetVideoPlayUrl({ deviceId, channelId })
    const videoUrl = ref('')
    if(!url.startsWith("https")){
      videoUrl.value = url.replace("http://36.137.74.48:32080/rtp", "https://36.213.184.229:8889/vedio/play/rtp")
    }else{
      videoUrl.value = url
    }
    // 清除请求标记
    hasRequest[channelId] = false

    if (!videoUrl.value) {
      console.warn(`请求失败 - channelId: ${channelId}, 未返回可播放地址`)
      failedChannels.add(channelId)
      item.isLoading = false
      item.videoError = "未返回可播放地址"
      return Promise.resolve()
    }

    // 请求成功，缓存数据
    urlCache[channelId] = { url: videoUrl.value, type }

    console.log(`请求成功并缓存 - channelId: ${channelId}`)
    setPreviewImg({
      ...item,
      url: videoUrl.value,
      type
    })

    item.isLoading = false
    item.videoError = ""
    return Promise.resolve({ url: videoUrl.value, type })
  } catch (error) {
    // 清除请求标记
    hasRequest[channelId] = false

    console.error(`请求异常 - channelId: ${channelId}`, error)
    // 请求异常，记录到失败列表
    failedChannels.add(channelId)
    item.isLoading = false
    item.videoError = error?.message || "视频取流失败"
    return Promise.reject(error)
  }
}

/**
 * 批量处理数组并请求视频URL
 * @param {Array} array - 包含设备信息的数组
 */
export async function pollArrayAndRequest(array) {
  channelsData = array
  console.log(`开始批量处理 ${array.length} 个设备`)

  for (let item of array) {
    try {
      // 设置加载状态
      item.isLoading = true
      const result = await getVideoPlayUrl(item)
      // 请求成功后，直接在item上设置fmp4
      if (result && result.url) {
        item.fmp4 = result.url
        item.url = result.url
      }
    } catch (error) {
      console.error(`处理设备失败 - channelId: ${item.channelId || item.deviceNumber}`, error)
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
