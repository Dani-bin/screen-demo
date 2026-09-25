<!--
 * @Description: 调度待提交任务列表（指挥调度 / 专项指挥页面共用）
 *   两种来源汇入同一份列表：
 *     1) 进入队伍 / 物资调度模式后，每完成一次地图取点追加（无后端 ID，需先点"下发"调 createTask）
 *     2) 点击"前置调度"按钮通过 generateTask 拉的预生成任务（自带后端 ID，无需再下发）
 *
 *   每条任务的"下发"按钮单独发起 createTask，回填 task.serverId；
 *   底部"完成调度"按钮（在父页面）把所有 serverId 用逗号拼接调 issueTasks 批量下发。
 *
 *   卡片字段映射：
 *     物资/队伍信息 ← task.name（起点仓库 / 队伍名）
 *     物资/队伍清单 ← task.content
 *     目的地       ← task.targetName（支持行内修改，直接改写任务对象）
-->
<template>
  <Transition name="pending-slide">
    <div v-if="visible" class="dispatch-pending-list">
      <div class="list-body">
        <div v-for="task in tasks" :key="task.id" class="task-card">
          <div class="card-header">
            <span class="card-title">调度任务</span>
            <div class="card-actions">
              <!-- 下发按钮：把临时任务持久化到后端 (createTask)，已下发(持有 serverIds)时禁用
                   serverIds 为数组：一次 createTask 可能生成多条记录（批量起点 → 多条任务），所以存数组 -->
              <button type="button" class="card-issue-btn"
                :class="{ 'is-issued': isTaskIssued(task) }"
                :disabled="isTaskIssued(task) || task.issuing"
                :title="isTaskIssued(task) ? '该任务已下发' : '下发该任务'"
                @click="$emit('issue', task)">
                {{
                  isTaskIssued(task)
                    ? "已下发"
                    : task.issuing
                      ? "下发中..."
                      : "下发"
                }}
              </button>
              <button type="button" class="card-delete" title="删除任务" @click="$emit('delete', task)">
                <el-icon>
                  <Delete />
                </el-icon>
              </button>
            </div>
          </div>

          <!-- 物资信息 + 物资清单 -->
          <div class="card-row">
            <span class="field">
              <span class="field-label">{{ typeLabel(task) }}信息：</span>
              <span class="field-value" :title="task.name">{{ task.name || "-" }}</span>
            </span>
            <span class="field grow">
              <el-icon class="field-prefix-icon">
                <Menu />
              </el-icon>
              <span class="field-label">{{ typeLabel(task) }}清单：</span>
              <span class="field-value ellipsis" :title="task.content">{{
                task.content || "-"
                }}</span>
            </span>
          </div>

          <!-- 目的地（支持修改） -->
          <div class="card-row">
            <span class="field">
              <span class="field-label">目的地：</span>
              <!-- 编辑态：输入框；展示态：文本 + 编辑按钮 -->
              <input v-if="editingId === task.id" v-focus class="dest-input" v-model="task.targetName"
                @blur="editingId = null" @keyup.enter="editingId = null" />
              <span v-else class="field-value" :title="task.targetName">{{
                task.targetName || "-"
                }}</span>
              <el-icon class="field-suffix-icon">
                <Location />
              </el-icon>
              <el-icon class="field-edit-icon" title="修改目的地" @click="startEditTarget(task)">
                <Edit />
              </el-icon>
            </span>
          </div>
        </div>

        <div v-if="!tasks.length" class="empty-tip">
          暂无调度任务，请在地图上选择调度终点
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref } from "vue"
import { Delete, Menu, Location, Edit } from "@element-plus/icons-vue"

defineProps({
  // 是否显示（由父页面按调度模式控制）
  visible: {
    type: Boolean,
    default: false
  },
  // 待提交的调度任务列表
  tasks: {
    type: Array,
    default: () => []
  }
})

defineEmits(["delete", "issue"])

/** 字段前缀文案：物资调度显示"物资"，队伍调度显示"队伍" */
const typeLabel = task => task.type || "物资"

/** 任务是否已下发（持有后端 serverIds 数组且非空） */
const isTaskIssued = task =>
  Array.isArray(task?.serverIds) && task.serverIds.length > 0

/* ===== 目的地行内编辑 ===== */
/** 当前处于编辑态的任务 ID */
const editingId = ref(null)

/** 进入目的地编辑态 */
const startEditTarget = task => {
  editingId.value = task.id
}

/** 自定义指令：输入框出现后自动聚焦 */
const vFocus = {
  mounted: el => el.focus()
}
</script>

<style lang="scss" scoped>
$accent: #00ceea;
$accent-soft: #7ec8ff;
$text-primary: #d8e8f5;
$text-muted: #7a9bb8;
$panel-bg: rgba(16, 28, 48, 0.94);
$panel-border: rgba(0, 206, 234, 0.32);

.dispatch-pending-list {
  position: absolute;
  top: 170px;
  right: 24px;
  z-index: 108;
  width: 600px;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 200px);
  padding: 12px 14px 14px;
  background: $panel-bg;
  border: 1px solid $panel-border;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5),
    inset 0 0 18px rgba(0, 206, 234, 0.08);
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}

.list-body {
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

.task-card {
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
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 206, 234, 0.2);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

/* card-header 右侧的按钮组（下发 + 删除） */
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 下发按钮：未下发 = 蓝青渐变；已下发 = 灰色禁用态 */
.card-issue-btn {
  min-width: 64px;
  height: 24px;
  padding: 0 12px;
  border: 1px solid rgba(0, 206, 234, 0.55);
  border-radius: 4px;
  background: linear-gradient(90deg,
      rgba(0, 134, 251, 0.85) 0%,
      rgba(0, 206, 234, 0.7) 100%);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    box-shadow: 0 0 10px rgba(0, 206, 234, 0.5);
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  /* 已下发态：置灰，禁止再次点击 */
  &.is-issued {
    background: rgba(63, 200, 130, 0.18);
    border-color: rgba(63, 200, 130, 0.5);
    color: #3fc882;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.75;
    box-shadow: none;
    transform: none;
  }
}

.card-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: $text-muted;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    background: rgba(255, 77, 109, 0.15);
    color: #ff4d6d;
  }

  .el-icon {
    font-size: 14px;
  }
}

.card-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
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

  &.ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
    display: inline-block;
    vertical-align: bottom;
  }
}

.field-prefix-icon,
.field-suffix-icon {
  color: $accent-soft;
  font-size: 14px;
  flex-shrink: 0;
}

.field-suffix-icon {
  margin-left: 2px;
}

/* 目的地编辑触发图标 */
.field-edit-icon {
  margin-left: 4px;
  color: $accent-soft;
  font-size: 14px;
  flex-shrink: 0;
  cursor: pointer;
  transition: color 0.2s ease;

  &:hover {
    color: #ffffff;
  }
}

/* 目的地编辑输入框 */
.dest-input {
  width: 400px;
  height: 24px;
  padding: 0 8px;
  background: rgba(0, 40, 80, 0.6);
  border: 1px solid rgba(0, 206, 234, 0.5);
  border-radius: 4px;
  color: $text-primary;
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: $accent;
    box-shadow: 0 0 8px rgba(0, 206, 234, 0.35);
  }
}

.empty-tip {
  padding: 36px 0;
  text-align: center;
  color: $text-muted;
  font-size: 13px;
  line-height: 1.6;
}

/* 从右滑入 */
.pending-slide-enter-active,
.pending-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.pending-slide-enter-from,
.pending-slide-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
