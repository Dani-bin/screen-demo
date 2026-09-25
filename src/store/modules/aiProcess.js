/**
 * AI 处理状态 Store
 * 管理 AI 对话流程中的状态提示文本，供全局组件修改和监听
 */
import { defineStore } from "pinia"
import { ref, computed } from "vue"
import voiceService from "@/utils/senseVoiceService"

export const useAiProcessStore = defineStore("aiProcess", () => {
  const status = ref("idle") // idle | processing | executing | completed

  /** 状态文本映射 */
  const STATUS_MAP = {
    idle: "",
    processing: "处理中",
    executing: "执行中",
    completed: "执行完成"
  }

  /** 当前需要播报的状态文本 */
  const processStatusTip = computed(() => STATUS_MAP[status.value] || "")

  /** 是否显示动画点（idle/completed 不显示） */
  const showDots = computed(() => status.value === "processing" || status.value === "executing")

  /** 是否显示对钩（completed 显示） */
  const showCheck = computed(() => status.value === "completed")

  /** 是否显示处理指示器（idle 不显示） */
  const showIndicator = computed(() => status.value !== "idle")

  /**
   * 设置状态并播报
   * @param {"idle"|"processing"|"executing"|"completed"} newStatus
   */
  const setStatus = (newStatus) => {
    if (status.value === newStatus) return
    status.value = newStatus

    const tip = processStatusTip.value
    if (tip) {
      voiceService.speakText(tip)
    }
  }

  /** 重置为 idle 状态（静默，不播报） */
  const reset = () => {
    status.value = "idle"
  }

  return {
    status,
    processStatusTip,
    showDots,
    showCheck,
    showIndicator,
    setStatus,
    reset
  }
})
