<template>
  <Teleport to="body">

    <Transition name="fade">
      <div v-if="visible" class="ai-chat-overlay" @click.self="handleClose">
        <!-- 机器人浮窗（监听状态） -->
        <Transition name="slide-up">
          <div v-if="mode !== 'chat'" class="robot-bubble"
            :style="bubbleStyle"
            @mousedown="startDrag('bubble', $event)"
            :class="{ 'is-dragging': draggingTarget === 'bubble' }">
            <div class="drag-handle" title="拖拽移动">
              <el-icon><Rank /></el-icon>
            </div>
            <div class="close-btn" @click="handleClose">
              <el-icon><Close /></el-icon>
            </div>
            <div class="bubble-content">
              <img class="robot-avatar" src="@/assets/images/yjzh/robot1.gif" alt="AI" />
              <div class="bubble-text">我正在听，请对我说出您的需求。</div>
            </div>
            <div class="stop-voice-btn" @click="stopVoice">结束说话</div>
          </div>
        </Transition>

        <!-- 对话面板（聊天状态） -->
        <Transition name="slide-up">
          <div v-if="mode === 'chat'" class="chat-panel"
            :style="panelStyle"
            @mousedown="startDrag('panel', $event)"
            :class="{ 'is-dragging': draggingTarget === 'panel' }">
            <div class="panel-top-bar">
              <!-- <div class="drag-handle" title="拖拽移动">
                <el-icon><Rank /></el-icon>
              </div> -->
              <div class="close-btn" @click="handleClose">
                <el-icon><Close /></el-icon>
              </div>
              <span class="panel-title">小安</span>
              <div class="debug-toggle" @click="showDebug = !showDebug">
                <el-icon><Edit /></el-icon>
                <span>调试</span>
              </div>
            </div>

            <!-- 调试面板 -->
            <div v-if="showDebug" class="debug-panel">
              <div class="debug-header">
                <span>函数调用测试</span>
                <el-button size="small" type="primary" @click="runTest">执行</el-button>
              </div>
              <el-input
                v-model="testJson"
                type="textarea"
                :rows="4"
                placeholder='输入 JSON，例如：
            {
              "action": "navigate",
              "keys": ["videoCenter"],
              "extraData": {}
            }'
              />
              <div v-if="testResult" class="debug-result">
                <div class="result-label">执行结果：</div>
                <pre>{{ testResult }}</pre>
              </div>
            </div>

            <div class="chat-messages" ref="messagesRef">
              <div v-for="msg in messages" :key="msg.id" :class="['message', msg.role]" >
                <img v-if="msg.role === 'ai'" class="msg-avatar ai-avatar" src="@/assets/images/yjzh/robot2.png" alt="AI" />
                <img v-if="msg.role === 'user'" class="msg-avatar" src="@/assets/images/ai/user.png" alt="用户" />
                <div class="msg-body">
                  <div class="msg-bubble">{{ msg.content }}</div>
                  <div v-if="msg.actions && msg.actions.length" class="msg-actions">
                    <div class="msg-action-icon" @click="speakMessage(msg.content)" title="语音播报">
                      <el-icon :size="18"><Microphone /></el-icon>
                    </div>
                    <div
                      v-for="act in msg.actions"
                      :key="act.key"
                      class="msg-action-btn"
                      :class="{ 'is-disabled': getActionDisabled(act) }"
                      @click="handleAction(msg, act)"
                    >{{ getActionLabel(act) }}</div>
                  </div>
                </div>
              </div>

              <!-- 处理中指示 -->
              <div v-if="aiProcessStore.showIndicator" class="message ai">
                <img class="msg-avatar ai-avatar" src="@/assets/images/yjzh/robot2.png" alt="AI" />
                <div class="processing-tip">
                  {{ aiProcessStore.processStatusTip }}
                  <span v-if="aiProcessStore.showDots" class="dots"><i>.</i><i>.</i><i>.</i></span>
                  <el-icon v-if="aiProcessStore.showCheck" class="check-icon" :size="16"><Check /></el-icon>
                </div>
              </div>
            </div>

            <div class="panel-footer">
              <!-- 默认态：编辑按钮 + 点击说话 -->
              <div v-if="barMode === 'voice'" class="bar-voice">
                <div class="btn-edit-circle" @click="switchToInput" title="文字输入">
                  <el-icon :size="20"><Edit /></el-icon>
                </div>
                <div class="btn-voice-pill" @click="startVoiceInChat">
                  <img class="voice-icon" src="@/assets/images/ai/voice.svg" alt="语音" />
                  <span>点击说话</span>
                </div>
              </div>

              <!-- 录音态：编辑按钮 + 结束说话 -->
              <div v-if="barMode === 'recording'" class="bar-recording">
                <div class="btn-edit-circle" @click="switchToInput" title="文字输入">
                  <el-icon :size="18"><Edit /></el-icon>
                </div>
                <div class="btn-voice-pill is-recording" @click="stopVoiceInChat">
                  <img class="voice-icon" src="@/assets/images/ai/voice.svg" alt="语音" />
                  <span>结束说话</span>
                </div>
              </div>

              <!-- 输入态：语音按钮 + 输入框 + 发送 -->
              <div v-if="barMode === 'input'" class="bar-input">
                <div class="btn-voice-circle" @click="switchToVoiceMode" title="语音输入">
                  <img class="voice-icon" src="@/assets/images/ai/voice.svg" alt="语音" />
                </div>
                <input v-model="inputText" class="text-input" placeholder="输入您的问题..." @keyup.enter="sendText" />
                <div class="btn-send" @click="sendText">
                  <el-icon :size="20"><Position /></el-icon>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Close, Position, Edit, Check, Microphone, Rank } from '@element-plus/icons-vue'
import AudioRecorder from '@/utils/audioRecorder'
import voiceService from '@/utils/senseVoiceService'
import { useAiProcessStore } from '@/store/modules/aiProcess'
import { useAiChatStore } from '@/store/modules/aiChat'
import {
  generateDispatchTask,
  issueDispatchTasks
} from "@/api/commandDispatch"
import { ElMessage } from "element-plus"

const router = useRouter()
const aiProcessStore = useAiProcessStore()
const aiChatStore = useAiChatStore()
import actionHandler from '@/utils/actionHandler'

// ==================== 常量 ====================
/** action 类型中文映射 */
const ACTION_LABEL = {
  openVideos: '打开视频',
  navigate: '打开页面',
  startMaterialTask: '执行物资调度任务',
  startTeamsTask: '执行队伍调度任务',
  startTask: '执行普通任务',
  startPlan: '执行预案',
  dispatchTeams: '执行队伍调度',
  dispatchMaterials: '执行物资调度',
  unknown: '未知命令'
}

// ==================== 状态 ====================
const visible = ref(false)
// const visible = ref(true)
const mode = ref('chat')          // listening | chat
// const mode = ref('chat')          // listening | chat
const barMode = ref('voice')           // voice | recording | input（聊天面板底部栏状态）
const inputText = ref('')
const messages = ref([])
const messagesRef = ref(null)

// ==================== 拖拽功能 ====================
/** 拖拽状态 */
const draggingTarget = ref(null) // 'bubble' | 'panel' | null
const dragOffset = ref({ x: 0, y: 0 })
const bubblePosition = ref({ x: null, y: 90 }) // null 表示使用默认值
const panelPosition = ref({ x: null, y: 90 })

/** 计算属性：bubble 面板样式 */
const bubbleStyle = computed(() => {
  if (bubblePosition.value.x !== null || bubblePosition.value.y !== null) {
    return {
      right: bubblePosition.value.x !== null ? undefined : '20px',
      left: bubblePosition.value.x !== null ? `${bubblePosition.value.x}px` : undefined,
      top: bubblePosition.value.y !== null ? `${bubblePosition.value.y}px` : '90px'
    }
  }
  return {}
})

/** 计算属性：panel 面板样式 */
const panelStyle = computed(() => {
  if (panelPosition.value.x !== null || panelPosition.value.y !== null) {
    return {
      right: panelPosition.value.x !== null ? undefined : '20px',
      left: panelPosition.value.x !== null ? `${panelPosition.value.x}px` : undefined,
      top: panelPosition.value.y !== null ? `${panelPosition.value.y}px` : '90px'
    }
  }
  return {}
})

/** 开始拖拽 */
const startDrag = (target, event) => {
  // 忽略点击关闭按钮和其他按钮
  if (event.target.closest('.close-btn') || event.target.closest('button')) return

  draggingTarget.value = target
  const targetEl = event.currentTarget
  const rect = targetEl.getBoundingClientRect()
  dragOffset.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

/** 拖拽中 */
const onDrag = (event) => {
  if (!draggingTarget.value) return

  const newX = event.clientX - dragOffset.value.x
  const newY = event.clientY - dragOffset.value.y

  // 限制在视口内
  const minX = 0
  const minY = 0
  const maxX = window.innerWidth - (draggingTarget.value === 'bubble' ? 400 : 450)
  const maxY = window.innerHeight - (draggingTarget.value === 'bubble' ? 180 : 200)

  const constrainedX = Math.max(minX, Math.min(maxX, newX))
  const constrainedY = Math.max(minY, Math.min(maxY, newY))

  if (draggingTarget.value === 'bubble') {
    bubblePosition.value = { x: constrainedX, y: constrainedY }
  } else {
    panelPosition.value = { x: constrainedX, y: constrainedY }
  }
}

/** 停止拖拽 */
const stopDrag = () => {
  draggingTarget.value = null
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

// ==================== 调试测试 ====================
const showDebug = ref(false)           // 是否显示调试面板
const testJson = ref('{\n  "action": "navigate",\n  "keys": ["videoCenter"],\n  "extraData": {}\n}')
const testResult = ref('')

/** 执行测试 */
const runTest = async () => {
  try {
    const data = JSON.parse(testJson.value)
    const result = await actionHandler.executeAction(data)
    testResult.value = JSON.stringify(result, null, 2)
  } catch (e) {
    testResult.value = `错误: ${e.message}`
  }
}

const audioRecorder = new AudioRecorder()
let convId = ''                         // 对话上下文ID
let chatAbortController = null          // 用于取消流式请求

const chatApiUrl = import.meta.env.VITE_CHAT_API_URL || '/chat-api/v1/chat-messages'
const chatApiKey = import.meta.env.VITE_CHAT_API_KEY || ''
const userId = 'user-' + Date.now()

// ==================== 对外暴露 ====================
/** 打开浮窗，启动录音 */
const open = () => {
  aiProcessStore.reset()
  voiceService.speakText('你好，我是小安，有什么可以帮你的？')
  messages.value.push({ role: 'ai', content: '你好，我是小安，有什么可以帮你的？' })
  visible.value = true
  mode.value = 'chat'
  // return;
  // startListening()
}

/** 以聊天模式打开面板（不进入录音），用于页面切换追加内容 */
const openInChat = () => {
  cancelChatRequest()
  stopRecording().catch(() => {})
  aiProcessStore.reset()
  visible.value = true
  mode.value = 'chat'
  barMode.value = 'voice'
  nextTick(() => scrollToBottom())
}

/** 向面板追加一条或多条消息（自动打开面板） */
const appendMessage = (newMessages = []) => {
  if (!Array.isArray(newMessages)) newMessages = [newMessages]
  const list = newMessages.filter(Boolean).map((m) => ({
    id: m.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: m.role || 'ai',
    content: m.content || '',
    actions: m.actions || []
  }))
  if (!list.length) return
  openInChat()
  messages.value = [...messages.value, ...list]
}

/** 关闭浮窗，清理所有资源 */
const handleClose = async () => {
  await stopRecording()
  voiceService.stopSpeaking()
  cancelChatRequest()
  aiProcessStore.reset()
  visible.value = false
}

defineExpose({ open, handleClose, appendMessage, openInChat })

// ==================== UI 事件处理 ====================
/** 结束说话（浮窗）：停止录音 → 语音转文字 → 进入对话面板 */
const stopVoice = async () => {
  const audioBlob = await stopRecordingAndGetBlob()
  mode.value = 'chat'
  if (!audioBlob) {
    barMode.value = 'input'
    messages.value.push({ role: 'ai', content: '没有检测到麦克风，请手动输入您的问题。' })
    return
  }
  barMode.value = 'voice'
  await transcribeAndSend(audioBlob)
}

/** 切换到文字输入模式，清理录音/播报/请求 */
const switchToInput = () => {
  cleanupAll()
  barMode.value = 'input'
}

/** 从输入模式切回语音模式，清理录音/播报/请求 */
const switchToVoiceMode = () => {
  cleanupAll()
  barMode.value = 'voice'
}

/** 发送文字消息，保持在输入模式 */
const sendText = () => {
  if (!inputText.value.trim()) return
  const text = inputText.value.trim()
  inputText.value = ''
  sendToChat(text)
}

/** 聊天面板中：启动录音 */
const startVoiceInChat = async () => {
  barMode.value = 'recording'
  await voiceService.stopSpeaking()
  await startListening()
  if (!audioRecorder.isRecording) {
    barMode.value = 'voice'
  }
}

/** 聊天面板中：结束录音 → 语音转文字 → 发送对话 */
const stopVoiceInChat = async () => {
  const audioBlob = await stopRecordingAndGetBlob()
  if (!audioBlob) {
    handleClose()
    return
  }
  barMode.value = 'voice'
  await transcribeAndSend(audioBlob)
}

// ==================== 录音控制 ====================
/** 启动浏览器录音 */
const startListening = async () => {
  try {
    await audioRecorder.startRecording((err) => {
      console.error('录音出错:', err)
      voiceService.speakText('录音出错，请重试')
    })
  } catch (err) {
    console.error('启动录音失败:', err)
    voiceService.speakText('启动录音失败，请检查麦克风权限')
  }
}

/** 停止录音并返回 Blob（失败时返回 null） */
const stopRecordingAndGetBlob = async () => {
  try {
    return await audioRecorder.stopRecording()
  } catch (e) {
    console.error('停止录音失败:', e)
    voiceService.speakText('录音失败，可能是因为麦克风权限问题，请手动输入您的问题。')
    return null
  }
}

/** 停止录音（静默，不返回 Blob） */
const stopRecording = async () => {
  try {
    if (audioRecorder.isRecording) await audioRecorder.stopRecording()
  } catch (e) { /* ignore */ }
}

/** 语音转文字 → 发送对话，含错误处理 */
const transcribeAndSend = async (audioBlob) => {
  if (!audioBlob || audioBlob.size === 0) return

  try {
    const text = await voiceService.transcribe(audioBlob)
    if (text) sendToChat(text)
  } catch (e) {
    console.error('语音识别失败:', e)
    messages.value.push({ role: 'ai', content: '语音识别失败，请手动输入您的问题。' })
    voiceService.speakText('语音识别失败，请手动输入您的问题')
  }
}

/** 清理录音 + 语音播报 + 请求（模式切换用） */
const cleanupAll = () => {
  stopRecording()
  voiceService.stopSpeaking()
  cancelChatRequest()
}

/** 取消进行中的对话请求 */
const cancelChatRequest = () => {
  if (chatAbortController) {
    chatAbortController.abort()
    chatAbortController = null
  }
}

// ==================== 内部核心流程 ====================
/** 发送消息到对话：添加用户气泡 → 播报提示语 → 调接口 */
const sendToChat = async (text) => {
  messages.value.push({ role: 'user', content: text })
  aiProcessStore.setStatus('processing')
  scrollToBottom()
  await callChatApi(text)
}

/** 调用对话接口，处理 SSE 流式响应 */
const callChatApi = async (query) => {
  chatAbortController = new AbortController()

  try {
    const response = await fetch(chatApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${chatApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: 'streaming',
        conversation_id: convId,
        user: userId,
        files: []
      }),
      signal: chatAbortController.signal
    })
    console.log(response)
    if (!response.ok) throw new Error(`请求失败: ${response.status}`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice(5).trim()
        if (jsonStr === '[DONE]') continue

        try {
          const data = JSON.parse(jsonStr)

          if (data.conversation_id) convId = data.conversation_id

          if (data.event === 'workflow_finished') {
            handleWorkflowResult(data.data?.outputs)
          }
        } catch (e) { /* 非 JSON 行，跳过 */ }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('对话请求失败:', e)
    aiProcessStore.reset()
    messages.value.push({ role: 'ai', content: '网络异常，请稍后重试。' })
  } finally {
    chatAbortController = null
  }
}

// ==================== 结果处理 ====================
/** 处理 workflow_finished 返回结果 */
const handleWorkflowResult = (outputs) => {
  if (!outputs?.answer) {
    aiProcessStore.reset()
    return
  }

  // 解析 answer JSON，容错非 JSON 格式
  let action = '', keys = '', to = '', actions = []
  try {
    const obj = JSON.parse(outputs.answer)
    
    // 支持单个 action 或多个 action 数组
    if (Array.isArray(obj)) {
      actions = obj
      // 从第一个 action 获取显示信息
      const firstAction = obj[0]
      action = firstAction?.action || ''
      keys = firstAction?.keys || ''
      to = firstAction?.to || ''
    } else {
      action = obj.action || ''
      keys = obj.keys || ''
      to = obj.to || ''
    }
  } catch {
    // 非 JSON，当作普通文本展示
    aiProcessStore.reset()
    messages.value.push({ role: 'ai', content: outputs.answer })
    scrollToBottom()
    return
  }

  // 1. 显示回复文本（基于所有 actions）
  let displayText = ''
  if (actions.length > 1) {
    // 多个 action，显示摘要
    const labels = actions.map(a => ACTION_LABEL[a.action] || a.action).filter(Boolean)
    displayText = labels.join('，') + '，正在执行...'
  } else if (actions.length === 1) {
    // 单个 action，显示详情
    const label = ACTION_LABEL[action] || action
    displayText = keys ? `${label}，关键词：${keys}` : label
  } else {
    displayText = action ? (ACTION_LABEL[action] || action) : outputs.answer
  }
  
  messages.value.push({ role: 'ai', content: displayText })
  scrollToBottom()

  // 2. 执行 actions（支持多个 action）
  if (actions.length > 0) {
    aiProcessStore.setStatus('executing')
    console.log('[handleWorkflowResult] actions:', actions)
    executeActions(actions)
  } else if (action && action !== 'unknown') {
    aiProcessStore.setStatus('executing')
    console.log('[handleWorkflowResult] action:', action, 'keys:', keys, 'to:', to)
    executeAction(JSON.parse(outputs.answer))
  } else {
    aiProcessStore.reset()
  }
}

/** 根据 action 类型执行对应操作（占位） */
// const executeAction = (action, keys, to) => {
//   console.log('[executeAction] action:', action, 'keys:', keys, 'to:', to)
//   switch (action) {
//     case 'openVideos':
//       // TODO: 打开视频
//       break
//     case 'navigate': {

//       // 测试跳转到态势分析
//       const target = to || '/typhoon/situationAnalysis'
//       if (router.currentRoute.value.path !== target) {
//         router.push(target)
//       }
//       break
//     }
//     case 'startMaterialTask':
//       // TODO: 执行物资调度任务
//       break
//     case 'startTeamsTask':
//       // TODO: 执行队伍调度任务
//       break
//     case 'startTask':
//       // TODO: 执行普通任务
//       break
//     case 'startPlan':
//       // TODO: 执行预案
//       break
//     case 'dispatchTeams':
//       // TODO: 执行队伍调度
//       break
//     case 'dispatchMaterials':
//       // TODO: 执行物资调度
//       break
//     default:
//       // unknown，不做额外操作
//       break
//   }
// }

// const handleWorkflowResult = (outputs) => {
//   if (!outputs?.answer) {
//     isProcessing.value = false
//     return
//   }

//   // 解析 answer JSON，容错非 JSON 格式
//   let action = '', keys = ''
//   try {
//     const obj = JSON.parse(outputs.answer)
//     action = obj.action || ''
//     keys = obj.keys || ''
//   } catch {
//     // 非 JSON，当作普通文本展示
//     isProcessing.value = false
//     messages.value.push({ role: 'ai', content: outputs.answer })
//     scrollToBottom()
//     return
//   }

//   // 1. 显示回复文本
//   isProcessing.value = false
//   const label = ACTION_LABEL[action] || action
//   const text = keys ? `${label}，关键词：${keys}` : label
//   messages.value.push({ role: 'ai', content: text })
//   scrollToBottom()

//   // 2. 如果 action 存在，执行对应操作
//   if (action) {
//     executeAction(JSON.parse(outputs.answer))
//   }
// }

/** 根据 action 类型执行对应操作 */
const executeAction = async (resData = {}) => {
  console.log('[AiChatBox] executeAction:', { resData })

  // 使用 actionHandler 统一处理
  const result = await actionHandler.executeAction(resData)

  if (result.success) {
    // 操作成功，语音播报
    voiceService.speakText(result.message)
  } else {
    // 操作失败，提示用户
    console.warn('[AiChatBox] 操作执行失败:', result.message)
    voiceService.speakText(result.message)
  }

  return result
}

/** 执行多个 actions */
const executeActions = async (actions = []) => {
  console.log('[AiChatBox] executeActions:', { actions })

  // 使用 actionHandler 统一处理多个 actions
  const result = await actionHandler.executeActions(actions)

  if (result.success) {
    // 操作成功，语音播报
    voiceService.speakText(result.message)
  } else {
    // 操作失败，提示用户
    console.warn('[AiChatBox] 操作执行失败:', result.message)
    voiceService.speakText(result.message)
  }

  return result
}

// ==================== 初始化消息操作 ====================
/** 语音播报消息内容 */
const speakMessage = (text) => {
  if (!text) return
  voiceService.stopSpeaking()
  voiceService.speakText(text)
}

/** 获取按钮当前显示文字 */
const getActionLabel = (act) => {
  const state = aiChatStore.getButtonState(act.key)
  if (state?.state === 'success') return state.label || act.successLabel || act.label
  return act.label
}

/** 判断按钮是否处于禁用态 */
const getActionDisabled = (act) => {
  const state = aiChatStore.getButtonState(act.key)
  if (state?.state !== 'success') return false
  return !act.canReclick
}

/** 通用操作分发 */
const handleAction = async (msg, act) => {
  if (getActionDisabled(act)) return
  switch (act.type) {
    case 'issue':
      await runIssueAction(msg, act)
      break
    case 'openVideo':
      await runOpenVideoAction(msg, act)
      break
    case 'dispatchTeams':
      await runDispatchTeamsAction(msg, act)
      break
    default:
      break
  }
}

/** 下发指令 */
const runIssueAction = async (msg, act) => {
  //下发指令时，调用issueDispatchTasks接口进行任务的批量下发，任务ID列表[131、132、133、134、135、136、137、138、139] 
  const allServerIds = [131, 132, 133, 134, 135, 136, 137, 138, 139];
  await issueDispatchTasks({ ids: allServerIds.join(",") })
  ElMessage.success("防台措施预案指令已下发！")
  voiceService.speakText('防台措施预案指令已下发！')
  aiChatStore.setButtonState(act.key, 'success', act.successLabel || '已下发指令')
  // 切换页面到指挥调度---
  await actionHandler.executeAction({
    action: 'navigate',
    to: '应急响应弹窗'
  })
  //  router.push({ name: 'TyphoonCommandDispatch' })
}

/** 打开视频 */
const runOpenVideoAction = async (msg, act) => {
  const result = await actionHandler.executeAction({
    action: 'openVideos',
    to: '物资库'
  })
  aiChatStore.setButtonState(act.key, 'success', act.successLabel || '已打开视频')
}

/** 调度队伍 */
const runDispatchTeamsAction = async (msg, act) => {
  //确认当前页面是专项指挥页面
  if (router.currentRoute.value.name !== 'TyphoonCommandDispatch') {
    //执行队伍调度
    await actionHandler.executeAction({
      action: 'navigate',
      to: '队伍调度'
    })
    return
  }else{
    await actionHandler.executeAction({
      action: 'navigate',
      to: '队伍调度',
      targetPage: 'TyphoonCommandDispatch'
    })
  }
  aiChatStore.setButtonState(act.key, 'success', act.successLabel || '已调度队伍')
}

// ==================== 工具 ====================
/** 滚动消息列表到底部 */
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

watch(() => messages.value.length, scrollToBottom)
</script>

<style lang="scss" scoped>
/* 遮罩层 */
.ai-chat-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
}

/* 机器人浮窗 */
.robot-bubble {
  position: absolute;
  top: 90px;
  right: 20px;
  width: 400px;
  background: linear-gradient(135deg, rgba(26, 26, 46, 0.75) 0%, rgba(22, 33, 62, 0.75) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 206, 234, 0.25);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  cursor: move;
  user-select: none;

  &.is-dragging {
    cursor: grabbing;
    opacity: 0.9;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
  }

  .drag-handle {
    position: absolute;
    top: 12px;
    left: 12px;
    color: rgba(255, 255, 255, 0.4);
    cursor: move;
    transition: color 0.2s;
    font-size: 16px;
    &:hover {
      color: rgba(0, 206, 234, 0.8);
    }
  }

  .close-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: color 0.2s;
    font-size: 18px;
    &:hover {
      color: #fff;
    }
  }
  .bubble-content {
    display: flex;
    align-items: center;
    gap: 16px;
    .robot-avatar {
      width: 83px;
      height: 90px;
      flex-shrink: 0;
      object-fit: contain;
    }
    .bubble-text {
      color: #fff;
      font-size: 14px;
      line-height: 1.6;
    }
  }
  .stop-voice-btn {
    width: 200px;
    margin-top: 0px;
    margin: 0 auto;
    padding: 8px 24px;
    background: linear-gradient(135deg, rgba(0, 206, 234, 0.32), rgba(0, 160, 220, 0.25));
    border: 1px solid rgba(0, 206, 234, 0.55);
    border-radius: 20px;
    color: #00ceea;
    font-size: 13px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    animation: voice-breathe 2s ease-in-out infinite;
    &:hover {
      background: linear-gradient(135deg, rgba(0, 206, 234, 0.4), rgba(0, 160, 220, 0.32));
      border-color: rgba(0, 206, 234, 0.7);
    }
  }
}

/* 对话面板 */
.chat-panel {
  position: absolute;
  top: 90px;
  right: 20px;
  width: 450px;
  height: calc(100vh - 120px);
  max-height: 600px;
  background: linear-gradient(180deg, rgba(26, 26, 46, 0.8) 0%, rgba(22, 33, 62, 0.8) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 206, 234, 0.25);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  cursor: move;
  user-select: none;

  &.is-dragging {
    cursor: grabbing;
    opacity: 0.9;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
  }

  .panel-top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 0;

    .drag-handle {
      color: rgba(255, 255, 255, 0.4);
      cursor: move;
      transition: color 0.2s;
      font-size: 16px;
      &:hover {
        color: rgba(0, 206, 234, 0.8);
      }
    }

    .panel-title {
      color: #fff;
      font-size: 14px;
      font-weight: 500;
    }

    .debug-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 12px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
      &:hover {
        color: #00ceea;
        background: rgba(0, 206, 234, 0.1);
      }
    }

    .close-btn {
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      transition: color 0.2s;
      font-size: 18px;
      &:hover {
        color: #fff;
      }
    }
  }

  /* 调试面板 */
  .debug-panel {
    padding: 12px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(0, 206, 234, 0.2);

    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      color: #00ceea;
      font-size: 12px;
    }

    .debug-result {
      margin-top: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 4px;
      font-size: 12px;

      .result-label {
        color: #7ec8ff;
        margin-bottom: 4px;
      }

      pre {
        color: #90ee90;
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }
    }
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 10px 16px 16px;
    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
    }
    .message {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 16px;
      &.ai {
        .msg-bubble {
          background: rgba(60, 60, 100, 0.6);
          border-radius: 2px 12px 12px 12px;
        }
      }
      &.user {
        flex-direction: row-reverse;
        .msg-bubble {
          background: rgba(100, 100, 140, 0.5);
          border-radius: 12px 2px 12px 12px;
        }
      }
      .msg-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        flex-shrink: 0;
        &.ai-avatar {
          background-color: #999;
          object-fit: contain;
          padding: 5px;
          box-sizing: border-box;
        }
      }
      .msg-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        max-width: 340px;
      }
      .msg-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        align-self: flex-end;
        padding-right: 4px;
      }
      .msg-action-icon {
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(0, 206, 234, 0.35);
        border-radius: 50%;
        color: rgba(0, 206, 234, 0.85);
        cursor: pointer;
        transition: all 0.2s;
        &:hover {
          background: rgba(0, 206, 234, 0.2);
          color: #00ceea;
          border-color: rgba(0, 206, 234, 0.6);
        }
      }
      .msg-action-btn {
        padding: 6px 16px;
        background: linear-gradient(135deg, rgba(0, 206, 234, 0.32), rgba(0, 160, 220, 0.25));
        border: 1px solid rgba(0, 206, 234, 0.55);
        border-radius: 16px;
        color: #00ceea;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        user-select: none;
        &:hover {
          background: linear-gradient(135deg, rgba(0, 206, 234, 0.4), rgba(0, 160, 220, 0.32));
          border-color: rgba(0, 206, 234, 0.7);
        }
        &.is-disabled {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.45);
          cursor: not-allowed;
          &:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(255, 255, 255, 0.2);
          }
        }
      }
      .msg-bubble {
        padding: 10px 14px;
        border-radius: 12px;
        color: #fff;
        font-size: 14px;
        line-height: 1.5;
        max-width: 340px;
        word-break: break-word;
        white-space: pre-wrap;
      }
      .processing-tip {
        color: #666;
        font-size: 13px;
        padding: 6px 0;
        display: flex;
        align-items: center;
        gap: 4px;
        .dots {
          i {
            font-style: normal;
            animation: dot-blink 1.4s infinite both;
            &:nth-child(2) { animation-delay: 0.2s; }
            &:nth-child(3) { animation-delay: 0.4s; }
          }
        }
        .check-icon {
          color: #67c23a;
        }
      }
    }
  }

  .panel-footer {
    padding: 14px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
     /* 三态底部栏通用 */
    .bar-voice, .bar-recording, .bar-input {
      display: flex;
      align-items: center;
      gap: 10px;
    }
  }

  /* 圆形编辑按钮 */
  .btn-edit-circle {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: all 0.2s;
    &:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.35);
    }
  }

  /* 圆形语音按钮（输入模式） */
  .btn-voice-circle {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 206, 234, 0.2);
    border: 1px solid rgba(0, 206, 234, 0.35);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;

    .voice-icon {
      width: 20px;
      height: 20px;
      display: block;
    }

    &:hover {
      background: rgba(0, 206, 234, 0.35);
      border-color: rgba(0, 206, 234, 0.55);
    }
  }

  /* 长圆形语音按钮 */
  .btn-voice-pill {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    background: linear-gradient(135deg, rgba(0, 206, 234, 0.08), rgba(0, 150, 200, 0.05));
    border: 1px solid rgba(0, 206, 234, 0.2);
    border-radius: 24px;
    color: rgba(0, 206, 234, 0.65);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    .voice-icon {
      width: 20px;
      height: 20px;
      display: block;
      opacity: 0.7;
    }
    &:hover {
      background: linear-gradient(135deg, rgba(0, 206, 234, 0.15), rgba(0, 150, 200, 0.1));
      border-color: rgba(0, 206, 234, 0.35);
      color: #00ceea;
      .voice-icon {
        opacity: 1;
      }
    }

    /* 录音态：亮蓝 + 呼吸动画 */
    &.is-recording {
      background: linear-gradient(135deg, rgba(0, 206, 234, 0.32), rgba(0, 160, 220, 0.25));
      border-color: rgba(0, 206, 234, 0.55);
      color: #00ceea;
      animation: voice-breathe 2s ease-in-out infinite;

      .voice-icon {
        opacity: 1;
      }

      &:hover {
        background: linear-gradient(135deg, rgba(0, 206, 234, 0.4), rgba(0, 160, 220, 0.32));
        border-color: rgba(0, 206, 234, 0.7);
      }
    }
  }

  /* 输入框 */
  .text-input {
    flex: 1;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 22px;
    outline: none;
    color: #fff;
    font-size: 14px;
    padding: 10px 16px;
    &::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }
    &:focus {
      border-color: rgba(0, 206, 234, 0.4);
      background: rgba(255, 255, 255, 0.12);
    }
  }

  /* 发送按钮 */
  .btn-send {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(0, 206, 234, 0.35), rgba(0, 150, 200, 0.3));
    border-radius: 50%;
    color: #00ceea;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: linear-gradient(135deg, rgba(0, 206, 234, 0.5), rgba(0, 150, 200, 0.45));
      transform: scale(1.05);
    }
  }
}

@keyframes dot-blink {
  0%, 20%  { opacity: 0; }
  50%      { opacity: 1; }
  100%     { opacity: 0; }
}

@keyframes voice-breathe {
  0%, 100% { box-shadow: 0 0 2px 0 rgba(0, 206, 234, 0.12); }
  50%      { box-shadow: 0 0 10px 3px rgba(0, 206, 234, 0.28); }
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

</style>
