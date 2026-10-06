<!--
 * @Description: 应急响应侧边面板（指挥调度 / 专项指挥页面共用）
 *   - 收起态：贴在页面右侧边缘的竖向"应急响应"按钮
 *   - 展开态：从右侧滑入的弹窗，按 planId 调 listAll 接口，
 *             以卡片形式展示所有应急响应（队伍调度 + 物资调度，按生成时间排序）
 *   通过 planId 区分页面：指挥调度传 280，专项指挥传 281
-->
<template>
  <div class="emergency-response-wrap">
    <!-- 收起态：右侧竖向触发按钮 -->
    <Transition name="tab-fade">
      <button v-if="!expanded" type="button" class="response-tab" title="展开应急响应" @click="open">
        <el-icon class="tab-arrow">
          <DArrowLeft />
        </el-icon>
        <span class="tab-text">应急响应</span>
        <el-icon class="tab-arrow">
          <DArrowLeft />
        </el-icon>
      </button>
    </Transition>

    <!-- 展开态：右侧应急响应弹窗 -->
    <Transition name="popup-slide">
      <div v-if="expanded" class="response-popup" v-loading="loading" element-loading-text="正在加载应急响应..."
        element-loading-background="rgba(8, 20, 40, 0.55)">
        <div class="popup-header">
          <h3 class="popup-title">应急响应</h3>
          <button type="button" class="close-btn" title="关闭" @click="close">
            <el-icon>
              <Close />
            </el-icon>
          </button>
        </div>

        <div class="card-list">
          <div v-for="item in list" :key="item.id" class="response-card">
            <!-- 卡片头部：类型标签 + 状态标签 -->
            <div class="card-header">
              <span class="type-tag" :class="item.type === '物资' ? 'is-material' : 'is-team'">
                {{ item.type || "调度" }}
              </span>
              <span class="status-tag" :class="statusClass(item.status)">
                {{ statusText(item.status) }}
              </span>
            </div>

            <!-- 起点 → 终点 -->
            <div class="route-row">
              <span class="route-point" :title="item.startName">{{
                item.startName || "-"
              }}</span>
              <el-icon class="route-arrow">
                <Right />
              </el-icon>
              <span class="route-point end" :title="item.endName">{{
                item.endName || "-"
              }}</span>
            </div>

            <!-- 责任单位 / 责任人 -->
            <div class="card-row">
              <span class="field">
                <span class="field-label">责任单位：</span>
                <span class="field-value">{{ item.responsibleUnit || "-" }}</span>
              </span>
              <span class="field">
                <span class="field-label">责任人：</span>
                <span class="field-value">
                  {{ item.responsiblePerson || "-" }}
                  <template v-if="item.responsiblePhone">（{{ item.responsiblePhone }}）</template>
                </span>
              </span>
            </div>

            <!-- 调度备注 -->
            <div class="card-row">
              <span class="field grow">
                <span class="field-label">调度详情：</span>
                <span class="field-value memo" :title="item.memo">{{
                  item.memo || "-"
                }}</span>
              </span>
            </div>

            <!-- 时间 + 操作 -->
            <div class="card-footer">
              <span class="footer-time">
                <el-icon class="time-icon">
                  <Clock />
                </el-icon>
                {{ item.createTime || "-" }}
              </span>
              <div class="footer-actions">
                <!-- 未完成时展示"标记完成"按钮，点击后调接口把状态置为已完成 -->
                <button v-if="Number(item.status) !== 2" type="button" class="complete-btn"
                  :disabled="completingId === item.id" @click="handleComplete(item)">
                  {{ completingId === item.id ? "处理中..." : "标记完成" }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="!loading && !list.length" class="empty-tip">暂无应急响应</div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref } from "vue"
import { Close, DArrowLeft, Right, Clock } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"
import { getResponseTaskList, completeResponseTask } from "@/api/commandDispatch"

const props = defineProps({
  // 预案 ID：指挥调度 281 / 专项指挥 280
  planId: {
    type: [Number, String],
    default: null
  }
})

/** 是否处于展开态 */
const expanded = ref(false)
const loading = ref(false)
const list = ref([])
/** 正在标记完成的任务 ID，用于按钮 loading / 防重复点击 */
const completingId = ref(null)

/** 任务状态 → 文案 */
const statusText = status => {
  const map = { 0: "草稿", 1: "进行中", 2: "已完成" }
  return map[status] ?? "草稿"
}

/** 任务状态 → 样式类（不同状态不同配色） */
const statusClass = status => {
  const map = { 0: "is-draft", 1: "is-doing", 2: "is-done" }
  return map[status] || "is-draft"
}

/** 展开面板并拉取应急响应数据 */
const open = async () => {
  expanded.value = true
  loading.value = true
  list.value = []
  try {
    const res = await getResponseTaskList({ planId: props.planId })
    list.value = Array.isArray(res?.data) ? res.data : []
    //排除status为0的数据，并按照createTime进行排序
    list.value = list.value.filter(item => Number(item.status) !== 0).sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
  } catch (e) {
    ElMessage.error("获取应急响应失败")
    list.value = []
  } finally {
    loading.value = false
  }
}

/** 标记某条应急响应为已完成 */
const handleComplete = async item => {
  if (completingId.value) return
  completingId.value = item.id
  try {
    await completeResponseTask({ id: item.id })
    // 接口成功后本地把状态置为"已完成"，无需整体刷新列表
    item.status = 2
    ElMessage.success("已标记完成")
  } catch (e) {
    ElMessage.error("标记完成失败")
  } finally {
    completingId.value = null
  }
}

/** 收起面板 */
const close = () => {
  expanded.value = false
}

defineExpose({ open, close })
</script>

<style lang="scss" scoped>
$accent: #00ceea;
$accent-soft: #7ec8ff;
$text-primary: #d8e8f5;
$text-muted: #7a9bb8;
$panel-bg: rgba(16, 28, 48, 0.94);
$panel-border: rgba(0, 206, 234, 0.32);

/* ===== 收起态：右侧竖向触发按钮 ===== */
.response-tab {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 104;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 40px;
  padding: 16px 0;
  border: 1px solid $panel-border;
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: $panel-bg;
  color: $accent-soft;
  cursor: pointer;
  box-shadow: -4px 0 18px rgba(0, 0, 0, 0.45),
    inset 0 0 14px rgba(0, 206, 234, 0.12);
  pointer-events: auto;
  transition: all 0.2s ease;

  &:hover {
    color: #ffffff;
    border-color: $accent;
    box-shadow: -4px 0 22px rgba(0, 206, 234, 0.45),
      inset 0 0 16px rgba(0, 206, 234, 0.25);
  }

  .tab-text {
    writing-mode: vertical-rl;
    letter-spacing: 4px;
    font-size: 16px;
    font-weight: 600;
  }

  .tab-arrow {
    font-size: 14px;

    /* 上方箭头朝上、下方箭头朝下，做对称装饰 */
    &:first-child {
      transform: rotate(90deg);
    }

    &:last-child {
      transform: rotate(-90deg);
    }
  }
}

/* ===== 展开态：右侧弹窗 ===== */
.response-popup {
  position: absolute;
  top: 170px;
  right: 0;
  bottom: 24px;
  z-index: 105;
  width: 560px;
  max-width: calc(100vw - 80px);
  padding: 14px 16px 16px;
  background: $panel-bg;
  border: 1px solid $panel-border;
  border-radius: 8px 0 0 8px;
  box-shadow: -8px 0 28px rgba(0, 0, 0, 0.5),
    inset 0 0 18px rgba(0, 206, 234, 0.08);
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.popup-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
  letter-spacing: 0.5px;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: $text-primary;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    background: rgba(0, 206, 234, 0.15);
    color: #ffffff;
  }

  .el-icon {
    font-size: 18px;
  }
}

.card-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 206, 234, 0.35);
    border-radius: 2px;
  }
}

.response-card {
  background: rgba(8, 20, 44, 0.55);
  border: 1px solid rgba(0, 206, 234, 0.22);
  border-radius: 6px;
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-tag {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;

  &.is-team {
    background: rgba(0, 134, 251, 0.22);
    border: 1px solid rgba(0, 134, 251, 0.6);
    color: #66b3ff;
  }

  &.is-material {
    background: rgba(0, 206, 234, 0.18);
    border: 1px solid rgba(0, 206, 234, 0.6);
    color: $accent;
  }
}

.status-tag {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;

  &.is-draft {
    background: rgba(122, 155, 184, 0.18);
    border: 1px solid rgba(122, 155, 184, 0.5);
    color: $text-muted;
  }

  &.is-doing {
    background: rgba(0, 206, 234, 0.18);
    border: 1px solid rgba(0, 206, 234, 0.5);
    color: $accent;
  }

  &.is-done {
    background: rgba(63, 200, 130, 0.18);
    border: 1px solid rgba(63, 200, 130, 0.55);
    color: #3fc882;
  }
}

.route-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #ffffff;

  .route-point {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 210px;

    &.end {
      color: $accent-soft;
    }
  }

  .route-arrow {
    color: $accent;
    font-size: 15px;
    flex-shrink: 0;
  }
}

.card-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  font-size: 13px;
  line-height: 1.6;
  color: $text-primary;
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;

  &.grow {
    flex: 1;
    min-width: 0;
  }
}

.field-label {
  color: $text-muted;
  white-space: nowrap;
}

.field-value {
  color: $text-primary;

  &.memo {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 420px;
    display: inline-block;
    vertical-align: bottom;
  }
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: $text-muted;

  .footer-time {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .time-icon {
    font-size: 13px;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

/* 标记完成按钮 */
.complete-btn {
  flex-shrink: 0;
  padding: 4px 14px;
  border: 1px solid rgba(63, 200, 130, 0.55);
  border-radius: 4px;
  background: rgba(63, 200, 130, 0.15);
  color: #3fc882;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: #3fc882;
    color: #ffffff;
    box-shadow: 0 0 10px rgba(63, 200, 130, 0.45);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.empty-tip {
  padding: 48px 0;
  text-align: center;
  color: $text-muted;
  font-size: 13px;
}

/* loading 文字色 */
:deep(.el-loading-spinner .el-loading-text) {
  color: $accent-soft;
  margin-top: 8px;
  font-size: 13px;
}

/* 触发按钮淡入淡出 */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.tab-fade-enter-from,
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(12px);
}

/* 弹窗从右滑入 */
.popup-slide-enter-active,
.popup-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.popup-slide-enter-from,
.popup-slide-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
