/**
 * AI 面板状态 Store
 * 跟踪页面是否首次进入（决定是否追加默认内容）以及各业务按钮的全局状态
 */
import { defineStore } from "pinia"
import { ref } from "vue"

export const useAiChatStore = defineStore("aiChat", () => {
  /** 已完成"首次进入追加内容"的页面路由名集合 */
  const initializedPages = ref(new Set())

  /**
   * 业务按钮状态映射
   * key: 按钮唯一标识（如 situation-analysis-issue / command-dispatch-openVideo / special-command-dispatchTeams）
   * value: { state: 'idle' | 'success', label: '当前显示的按钮文字' }
   */
  const buttonStates = ref({})

  /**
   * 判断页面是否已完成首次进入的初始化
   * @param {string} routeName 路由名
   * @returns {boolean}
   */
  const isPageInitialized = (routeName) => initializedPages.value.has(routeName)

  /**
   * 标记页面已完成首次进入的初始化
   * @param {string} routeName 路由名
   */
  const markPageInitialized = (routeName) => {
    initializedPages.value.add(routeName)
  }

  /**
   * 获取按钮状态
   * @param {string} key 按钮标识
   * @returns {{ state: string, label: string } | undefined}
   */
  const getButtonState = (key) => buttonStates.value[key]

  /**
   * 设置按钮状态
   * @param {string} key 按钮标识
   * @param {string} state 'idle' | 'success'
   * @param {string} label 当前显示文字
   */
  const setButtonState = (key, state, label) => {
    buttonStates.value = {
      ...buttonStates.value,
      [key]: { state, label }
    }
  }

  /**
   * 重置所有状态（仅在调试/开发时使用）
   */
  const reset = () => {
    initializedPages.value = new Set()
    buttonStates.value = {}
  }

  return {
    initializedPages,
    buttonStates,
    isPageInitialized,
    markPageInitialized,
    getButtonState,
    setButtonState,
    reset
  }
})
