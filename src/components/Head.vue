<template>
  <div class="command-nav-header">
    <img class="nav-bg-img" src="@/assets/images/yjzh/typhoon/nav_bg.png" alt="" />
    <div class="nav-content">
      <div class="nav-left">
        <div class="nav-title">射阳智慧应急指挥平台</div>
        <div class="nav-sub-title"> - 台风I级响应指挥平台</div>
      </div>
      <div class="nav-center">
        <template v-for="tab in tabList">
          <div v-if="tab.route !== 'TyphoonSpecialCommand' || showSpecialCommandTab" class="nav-tab-item"
            :class="{ active: isActive(tab.route) }" :key="tab.name" @click="handleTabClick(tab.route)">
            <div class="tab-btn-bg"></div>
            <span class="tab-text">{{ tab.name }}</span>
          </div>
        </template>
      </div>
      <div class="nav-right">
        <div class="nav-action-btn ai-btn" @click="handleAI" v-if="0">
          <img src="@/assets/images/yjzh/typhoon/7d109b9e76287e9828b365530bd02af3.gif" alt="" />
          <span>使用AI</span>
        </div>
        <!-- "启动专项预案"按钮始终显示，专项指挥页进入后也保留 -->
        <div class="nav-action-btn start-btn" @click="handleStart">
          <img src="@/assets/images/yjzh/typhoon/play.svg" alt="" />
          <span>启动专项预案</span>
        </div>
      </div>
    </div>
    <AiChatBox ref="aiChatBoxRef" />

    <!-- 启动专项预案：选择预案弹框（暂仅 1 项，后续可扩展接口拉取）
         选择并确定后，路由进入"专项指挥"页面（路由仍保留，仅从顶部菜单中移除入口） -->
    <Transition name="plan-dialog-fade">
      <div v-if="planDialogVisible" class="plan-dialog-mask" @click.self="planDialogVisible = false">
        <div class="plan-dialog">
          <div class="plan-dialog-header">
            <h3 class="plan-dialog-title">启动专项预案</h3>
            <button type="button" class="plan-dialog-close" title="关闭" @click="planDialogVisible = false">×</button>
          </div>
          <div class="plan-dialog-body">
            <label class="plan-field-label">选择预案</label>
            <el-select v-model="selectedPlan" placeholder="请选择预案" class="plan-field-select">
              <el-option v-for="opt in planOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </div>
          <div class="plan-dialog-footer">
            <button type="button" class="btn-cancel" @click="planDialogVisible = false">取消</button>
            <button type="button" class="btn-confirm" :disabled="!selectedPlan" @click="handleConfirmPlan">
              确定
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import AiChatBox from './AiChatBox.vue'
import EventBus from '@/utils/event-bus'
import { useAiChatStore } from '@/store/modules/aiChat'

const router = useRouter()
const route = useRoute()

const emit = defineEmits(["ai", "start"])

const aiChatBoxRef = ref(null)
const startPlan = ref(false)
const aiChatStore = useAiChatStore()

/**
 * 是否展示"专项指挥"标签
 * 初始为 false：默认不显示；点击"启动专项预案"后置为 true，进入专项指挥页并保持显示
 */
const showSpecialCommandTab = ref(false)

/**
 * 顶部菜单 tab：原"专项指挥"从导航中移除，改由右侧"启动专项预案"按钮经预案选择弹框进入 
 */
var tabList = [
  { name: "天气地图", route: "TyphoonWeatherMap" },
  { name: "态势分析", route: "TyphoonSituationAnalysis" },
  { name: "指挥调度", route: "TyphoonCommandDispatch" },
  { name: "视频中心", route: "TyphoonVideoCenter" },
  { name: "专项指挥", route: "TyphoonSpecialCommand" }
]

/* ====== 启动专项预案：选择预案弹框状态 ====== */
/** 弹框可见性 */
const planDialogVisible = ref(false)

/**
 * 可选预案列表（产品当前仅 1 项；保留 value 字段以便后续按预案分流不同路由 / 传后端）
 */
const planOptions = [
  { value: "fire", label: "射阳县火灾事故应急救援预案" }
]

/** 选中的预案 value（默认选中首项，避免用户多一次点击） */
const selectedPlan = ref(planOptions[0]?.value || "")

/** 是否在"专项指挥"页：用于在该页隐藏"启动专项预案"入口按钮 */
const isSpecialCommandPage = computed(
  () => route.name === "TyphoonSpecialCommand"
)

const isActive = (tabRoute) => {
  if (!tabRoute) return false
  return route.name === tabRoute
}

const handleTabClick = (tabRoute) => {
  if (tabRoute) {
    router.push({ name: tabRoute })
  }
}

const handleAI = () => {
  aiChatBoxRef.value?.open()
}

/**
 * 点击"启动专项预案"：打开预案选择弹框（每次打开默认选中首项）
 * emit start 保留对外通知，便于父级在需要时联动（当前各页面未监听，无副作用）
 */
const handleStart = () => {
  selectedPlan.value = planOptions[0]?.value || ""
  planDialogVisible.value = true
  emit("start")
}
const handleFirePlanStart = () => {
  selectedPlan.value = planOptions[0]?.value || ""
  planDialogVisible.value = true
  emit("start")
  //延时2秒执行确认预案操作
  setTimeout(() => {
    handleConfirmPlan()
  }, 2000);

}

/**
 * 确认所选预案：关闭弹框后再跳转，避免新页面挂载时旧弹框还在层上
 * 同时把"专项指挥"标签置为可见
 */
const handleConfirmPlan = () => {
  if (!selectedPlan.value) return
  planDialogVisible.value = false
  showSpecialCommandTab.value = true
  router.push({ name: "TyphoonSpecialCommand" })
}

/* ====== 首次进入页面追加 AI 面板内容 ====== */
/**
 * 各页面首次进入时需要追加到 AI 面板的初始化内容
 * key 为路由名，value 为需要追加的消息数组
 */
const PAGE_INIT_MESSAGES = {
  TyphoonSituationAnalysis: [
    {
      id: 'init-situation-analysis',
      role: 'ai',
      content: `防台措施
县应急管理局：发紧急通知，督导企业停产、加固危化仓库、封堵防水门槛；调配前置抢险队伍、排涝泵车、沙袋、防化物资
水利局：巡查海堤、闸站、排涝泵站，24小时值守。
公安局：交通管制、道路清障、保障转移通道畅通。
住建局：发布提醒函至每个工地，工作组到工地指导工作，要求加固设施、停工、转移工棚居住人员，调拨排涝泵前置在易涝小区，要求小区物业在地下车库进出口铺设挡水板、防汛沙袋。
农业农村局：通过北斗系统发布渔业船舶预警信息
城管局：修剪加固行道树、拆除加固广告牌、围挡、疏通排水管阀。
生态环境局：部署危化企业环境监管、备足监测、防化、堵漏物资。
供电、电信：特巡线路、加固杆塔、备足应急发电/通信设备。
各镇区：拉网式排查、敲门行动、组织群众转移、安置、巡查值守。`,
      actions: [
        { key: 'situation-analysis-issue', type: 'issue', label: '下发指令', successLabel: '已下发指令', canReclick: false }
      ]
    }
  ],
  TyphoonSpecialCommand: [
    {
      id: 'init-special-command-1',
      role: 'ai',
      content: '射阳县应急管理局、射阳县消防救援大队负责人会同专家组到达现场后立即成立县级指挥部，启动县级应急预案，并制定现场处置预案。',
      actions: []
    },
    {
      id: 'init-special-command-2',
      role: 'ai',
      content: '快速启动现场指挥工作小组：灭火救援组、综合协调组、交通管制组、医疗卫生组、环境监测组、处置保障组、新闻发布组、专家组善后处置组',
      actions: []
    },
    {
      id: 'init-special-command-3',
      role: 'ai',
      content: '监测到当前为台风暴雨天气，是否协调调度防汛抗旱相关队伍到现场进行排涝工作？',
      actions: [
        { key: 'special-command-dispatchTeams', type: 'dispatchTeams', label: '调度队伍', successLabel: '已调度队伍', canReclick: false }
      ]
    }
  ]
}

/** 首次进入指定页面时追加 AI 面板初始化内容 */
const appendPageInitMessages = (routeName) => {
  if (!routeName) return
  if (aiChatStore.isPageInitialized(routeName)) return
  const messages = PAGE_INIT_MESSAGES[routeName]
  if (!messages || !messages.length) return
  aiChatStore.markPageInitialized(routeName)
  // 等待 AiChatBox 组件挂载后再追加
  nextTick(() => {
    aiChatBoxRef.value?.appendMessage(messages)
  })
}

/** 监听路由变化：首次进入指定页面时自动打开 AI 面板并追加内容 */
watch(
  () => route.name,
  (newName) => {
    appendPageInitMessages(newName)
  },
  { immediate: true }
)
onMounted(() => {
  EventBus.on('startZXyuan', () => {
    if (startPlan.value) {
      showSpecialCommandTab.value = true
      router.push({ name: "TyphoonSpecialCommand" })
    } else {
      handleStart()
    }
  })
  //启动启动火灾应急预案I级响应
  EventBus.on('startFirePlan', () => {
    if (startPlan.value) {
      showSpecialCommandTab.value = true
      router.push({ name: "TyphoonSpecialCommand" })
    } else {
      handleFirePlanStart()
    }
  })
  // 监听追加AI消息事件
  EventBus.on('aiChatAppendMessage', (messages) => {
    nextTick(() => {
      aiChatBoxRef.value?.appendMessage(messages)
    })
  })
  // 监听打开AI面板事件
  EventBus.on('openAiChatBox', () => {
    aiChatBoxRef.value?.open()
  })
})
onUnmounted(() => {
  EventBus.off('startZXyuan')
  EventBus.off('startFirePlan')
  EventBus.off('aiChatAppendMessage')
  EventBus.off('openAiChatBox')
})
</script>

<style lang="scss" scoped>
.command-nav-header {
  width: 100%;
  height: 76px;
  position: absolute;
  left: 0;
  top: 0;
  z-index: 10;

  .nav-bg-img {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
  }

  .nav-content {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    position: relative;
    z-index: 1;

    .nav-left {
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: linear-gradient(180deg, #FFF 47.71%, #B9E8FF 80.43%);
      font-family: "Alimama ShuHeiTi";
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;

      .nav-title {
        font-family: "Alimama ShuHeiTi";
        font-size: 30px;
        color: #d2f3ff;
        letter-spacing: 4px;
        white-space: nowrap;
      }

      .nav-sub-title {
        font-size: 18px;
        font-weight: 700;
        color: #d2f3ff;
        white-space: nowrap;
      }
    }
  }



  .nav-center {
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: 30px;

    .nav-tab-item {
      position: relative;
      width: 110px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;

      &:hover,
      &.active {
        .tab-btn-bg {
          opacity: 1;
        }

        .tab-text {
          color: #ffffff;
        }
      }

      .tab-btn-bg {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background: url("@/assets/images/yjzh/typhoon/btn_bg.svg") no-repeat center center;
        background-size: 100% 100%;
        opacity: 0;
      }

      .tab-text {
        position: relative;
        z-index: 1;
        font-family: "Alimama ShuHeiTi";
        font-size: 16px;
        color: #d2f3ff;
        white-space: nowrap;
      }
    }
  }



  .nav-right {
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;

    .nav-action-btn {
      display: flex;
      align-items: center;
      cursor: pointer;
      padding: 6px 12px;
      font-family: Source Han Sans CN;
    }

    .ai-btn {
      border-radius: 999px;
      border: 1px solid #4366DB;
      background: #4366db66;
      transition: all 0.25s ease;

      img {
        width: 24px;
        height: 24px;
      }

      span {
        margin-left: 6px;
        color: #ffffff;
        font-family: "MiSans";
        font-size: 13px;
        font-style: normal;
        font-weight: 500;
      }

      &:hover {
        background: rgba(67, 102, 219, 0.2);
        border-color: #5b8def;
        box-shadow: 0 0 12px rgba(67, 102, 219, 0.35);
      }
    }

    .start-btn {
      border-radius: 6px;
      border: 2px solid #578098;
      background: #2A5E7C;

      img {
        width: 14px;
        height: 14px;
      }

      span {
        margin-left: 6px;
        color: #ffffff;
        font-family: "Alimama ShuHeiTi";
        font-size: 16px;
        font-style: normal;
        font-weight: 500;
      }
    }
  }
}

/* ===== 启动专项预案：选择预案弹框（深色大屏风格） ===== */
.plan-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}

.plan-dialog {
  width: 460px;
  padding: 20px 24px 18px;
  border-radius: 8px;
  border: 1px solid rgba(0, 206, 234, 0.45);
  background: linear-gradient(180deg,
      rgba(16, 28, 48, 0.96) 0%,
      rgba(8, 20, 40, 0.96) 100%);
  box-shadow: 0 8px 36px rgba(0, 0, 0, 0.65),
    inset 0 0 18px rgba(0, 206, 234, 0.1);
  color: #d8e8f5;
}

.plan-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(0, 206, 234, 0.25);
}

.plan-dialog-title {
  margin: 0;
  font-family: "Alimama ShuHeiTi";
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 1.5px;
}

.plan-dialog-close {
  width: 24px;
  height: 24px;
  line-height: 22px;
  text-align: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #a4c2db;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(0, 206, 234, 0.18);
    color: #ffffff;
  }
}

.plan-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 22px;
}

.plan-field-label {
  font-size: 13px;
  color: #a4c2db;
  letter-spacing: 0.5px;
}

.plan-field-select {
  width: 100%;

  :deep(.el-select__wrapper) {
    height: 38px;
    background: rgba(8, 24, 48, 0.7);
    border: 1px solid rgba(0, 206, 234, 0.35);
    box-shadow: inset 0 0 8px rgba(0, 206, 234, 0.08);
    border-radius: 4px;
  }

  :deep(.el-select__placeholder),
  :deep(.el-select__selected-item) {
    color: #d8e8f5;
    font-size: 13px;
  }

  :deep(.el-select__caret) {
    color: #7ec8ff;
  }
}

.plan-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel,
.btn-confirm {
  min-width: 80px;
  height: 32px;
  padding: 0 16px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  color: #d8e8f5;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.55);
    color: #ffffff;
  }
}

.btn-confirm {
  border: 1px solid rgba(0, 206, 234, 0.6);
  background: linear-gradient(90deg,
      rgba(0, 134, 251, 0.9) 0%,
      rgba(0, 206, 234, 0.85) 100%);
  color: #ffffff;

  &:hover:not(:disabled) {
    box-shadow: 0 0 10px rgba(0, 206, 234, 0.55);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

/* 弹框淡入淡出 + 内层轻微上浮的过渡 */
.plan-dialog-fade-enter-active,
.plan-dialog-fade-leave-active {
  transition: opacity 0.2s ease;

  .plan-dialog {
    transition: transform 0.2s ease;
  }
}

.plan-dialog-fade-enter-from,
.plan-dialog-fade-leave-to {
  opacity: 0;

  .plan-dialog {
    transform: translateY(-8px);
  }
}
</style>
