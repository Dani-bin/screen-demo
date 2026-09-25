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
                <!-- 显示/隐藏调度路线：点击在地图上绘制（或清除）起点、终点和箭头 -->
                <button type="button" class="route-btn" :class="{ active: shownIds.includes(item.id) }" v-if="item.endName"
                  @click="toggleRoute(item)">
                  <el-icon class="route-btn-icon">
                    <Position />
                  </el-icon>
                  {{ shownIds.includes(item.id) ? "隐藏路线" : "显示路线" }}
                </button>
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
import { ref, watch, onUnmounted } from "vue"
import { Close, DArrowLeft, Right, Clock, Position } from "@element-plus/icons-vue"
import { ElMessage } from "element-plus"
import { getResponseTaskList, completeResponseTask } from "@/api/commandDispatch"
import {
  drawDispatchRoute,
  clearDispatchRoute,
  recomputeRouteArrow
} from "@/utils/dispatchRouteDraw"

const props = defineProps({
  // 预案 ID：指挥调度 281 / 专项指挥 280
  planId: {
    type: [Number, String],
    default: null
  },
  // 地图实例（BMapGL.Map）：由父页面传入，用于按需绘制调度路线
  map: {
    type: Object,
    default: null
  }
})

/**
 * 路线显隐变化事件：
 *  - route-shown   首次有路线在地图上展示（用于父级隐藏其它图层避免干扰）
 *  - route-hidden  所有路线都被清掉（用于父级恢复之前激活的分类图层）
 * 用 watch shownIds 长度从 0/非 0 切换来触发，单条切换不会重复 emit
 */
const emit = defineEmits(["route-shown", "route-hidden"])

/** 是否处于展开态 */
const expanded = ref(false)
const loading = ref(false)
const list = ref([])
/** 正在标记完成的任务 ID，用于按钮 loading / 防重复点击 */
const completingId = ref(null)

/* ===== 调度路线按需绘制 ===== */
/** 当前已在地图上展示路线的任务 ID 列表（驱动按钮"显示/隐藏"文案） */
const shownIds = ref([])
/**
 * 已绘制路线的 overlay 句柄表：taskId → drawDispatchRoute 返回的句柄对象
 * 非响应式（存放 BMapGL 原生对象），随组件生命周期保留，切换 / 卸载时清理
 */
const routeOverlays = new Map()

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

/* ===== 调度路线：显示 / 隐藏切换 ===== */

/**
 * 点击列表项按钮：在地图上切换该条调度路线（起点、终点、箭头）的显隐
 * 已展示 → 清除；未展示 → 绘制
 */
const toggleRoute = item => {
  if (shownIds.value.includes(item.id)) {
    hideRoute(item.id)
  } else {
    // 切换到另一条调度任务时，先清空其它已显示的路线，保证同一时刻只展示一条
    clearAllRoutes()
    showRoute(item)
  }
}

/** 绘制单条调度路线（起点 marker + 终点 marker + 箭头折线 + 任务标签） */
const showRoute = item => {
  const map = props.map
  if (!map) {
    ElMessage.warning("地图未就绪，无法展示路线")
    return
  }
  const handle = drawDispatchRoute(map, {
    startLng: item.startLng,
    startLat: item.startLat,
    endLng: item.endLng,
    endLat: item.endLat,
    startName: item.startName,
    type: item.type,
    // 单条展示场景：绘制后自动 setViewport 框到本条路线
    fitView: true
  })
  if (!handle) {
    ElMessage.warning("该应急响应缺少有效的起止坐标")
    return
  }
  routeOverlays.set(item.id, handle)
  shownIds.value.push(item.id)
}

/** 清除单条调度路线的所有 overlay */
const hideRoute = id => {
  const map = props.map
  const overlay = routeOverlays.get(id)
  if (overlay) clearDispatchRoute(map, overlay)
  routeOverlays.delete(id)
  shownIds.value = shownIds.value.filter(sid => sid !== id)
}

/** 清除所有已绘制路线 */
const clearAllRoutes = () => {
  shownIds.value.slice().forEach(id => hideRoute(id))
}

/**
 * 地图缩放后按当前像素重算各条已展示箭头的几何，
 * 避免高缩放级别下箭头端点偏离图标
 */
const recomputeArrows = () => {
  const map = props.map
  if (!map) return
  routeOverlays.forEach(handle => recomputeRouteArrow(map, handle))
}

// 地图实例就绪后绑定 zoomend，用于路线箭头的几何重算
watch(
  () => props.map,
  (newMap, oldMap) => {
    if (oldMap) oldMap.removeEventListener("zoomend", recomputeArrows)
    if (newMap) newMap.addEventListener("zoomend", recomputeArrows)
  },
  { immediate: true }
)

/**
 * 监听"是否有路线在展示"切换：
 *   false → true   通知父级隐藏其它图层（独占视觉，避免点位与路线相互干扰）
 *   true  → false  通知父级恢复之前激活的分类图层
 * 用 length>0 的布尔派生避免单条切换里 push/filter 触发多次 emit
 */
watch(
  () => shownIds.value.length > 0,
  shown => emit(shown ? "route-shown" : "route-hidden")
)

onUnmounted(() => {
  if (props.map) props.map.removeEventListener("zoomend", recomputeArrows)
  clearAllRoutes()
})

/**
 * 收起面板
 * 同时清空地图上已绘制的所有调度路线：触发 watch → emit route-hidden →
 * 父级恢复路线展示前的分类点位，避免"关闭弹窗后路线仍残留 + 点位不回来"的不一致状态
 */
const close = () => {
  expanded.value = false
  clearAllRoutes()
}

/**
 * 收起面板并清空地图上已绘制的所有调度路线
 * 与 close 行为一致；保留独立命名供父页面在进入队伍/物资调度模式时调用，语义更清晰
 */
const hideAndClearRoutes = () => {
  expanded.value = false
  clearAllRoutes()
}

defineExpose({ open, close, clearRoutes: clearAllRoutes, hideAndClearRoutes })
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

/* 显示/隐藏路线按钮 */
.route-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 12px;
  border: 1px solid rgba(0, 206, 234, 0.5);
  border-radius: 4px;
  background: rgba(0, 206, 234, 0.12);
  color: $accent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  .route-btn-icon {
    font-size: 13px;
  }

  &:hover {
    background: rgba(0, 206, 234, 0.25);
    color: #ffffff;
  }

  /* 已显示态：高亮填充，提示再次点击可隐藏 */
  &.active {
    background: $accent;
    color: #06283d;
    box-shadow: 0 0 10px rgba(0, 206, 234, 0.45);
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
