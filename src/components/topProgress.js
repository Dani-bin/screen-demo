/*
 * 顶部加载进度条（全局唯一）
 * ----------------------------------------------------------
 * 进度条覆盖切换页面的两段等待：
 *   1. 路由懒加载：页面代码分块下载；
 *   2. 三维场景加载：页面挂载后用 three.js 加载器下载模型 / 贴图。
 * 两段各算一个"加载来源"，来源全部结束（并稍等片刻确认没有下一波）才走满收起。
 * three.js 的 GLTFLoader / TextureLoader 等不传 manager 时都挂在 DefaultLoadingManager 上，
 * 所以只要给它挂上回调，就能拿到各页面的模型加载进度，不用改页面代码。
 */
import { reactive } from "vue"

/** 进度条状态：TopProgress.vue 直接读它 */
export const progress = reactive({
  visible: false,
  value: 0, // 0–1
  instant: false // true 时这一帧关掉宽度过渡（复位用，避免看到进度条往回缩）
})

/** 正在进行的加载来源："route" / "scene" */
const sources = new Set()
let trickleTimer = 0
let finishTimer = 0
let hideTimer = 0

/** 开始一个加载来源；进度条没显示时从头出现 */
function begin(key) {
  sources.add(key)
  clearTimeout(finishTimer)
  if (progress.visible && !hideTimer) return
  clearTimeout(hideTimer)
  hideTimer = 0
  progress.instant = true
  progress.value = 0.08
  progress.visible = true
  // 下一帧再恢复过渡，复位那一下不做动画
  requestAnimationFrame(() => (progress.instant = false))
  clearInterval(trickleTimer)
  // 拿不到真实进度时慢慢往 90 % 爬，越接近越慢，让人知道还在加载
  trickleTimer = setInterval(() => {
    progress.value += (0.9 - progress.value) * 0.06
  }, 200)
}

/** 结束一个加载来源；全部结束后再等 delay 毫秒，期间没有新的加载就走满收起 */
function end(key, delay = 250) {
  sources.delete(key)
  if (sources.size || !progress.visible) return
  clearTimeout(finishTimer)
  finishTimer = setTimeout(finish, delay)
}

/** 走满 → 淡出 → 复位 */
function finish() {
  clearInterval(trickleTimer)
  progress.value = 1
  hideTimer = setTimeout(() => {
    progress.visible = false
    hideTimer = setTimeout(() => {
      hideTimer = 0
      progress.instant = true
      progress.value = 0
    }, 400)
  }, 250)
}

/** 有真实进度（已加载 / 总数）时往前推，只进不退，留 5 % 给收尾 */
function advance(ratio) {
  const v = 0.15 + 0.8 * ratio
  if (v > progress.value) progress.value = Math.min(v, 0.95)
}

let threeHooked = false

/**
 * 给 three.js 的默认加载管理器挂回调。
 * 只在三维页面的代码分块加载完之后调用：那时 three 已经下载过，这里拿到的是同一个模块实例，不会多下载。
 */
async function hookThree() {
  if (threeHooked) return
  threeHooked = true
  const { DefaultLoadingManager: m } = await import("three")
  m.onStart = () => begin("scene")
  m.onProgress = (url, loaded, total) => advance(loaded / total)
  // 加载出错时 three 同样会计入"已完成"，最后照常触发 onLoad，进度条不会卡住
  m.onLoad = () => end("scene")
}

/** 挂到路由上：切换页面时显示进度条 */
export function installTopProgress(router) {
  router.beforeEach((to, from) => {
    // 只改查询参数（如首页 ?view=）不算切换页面；首次进入时 from 没有匹配的路由
    if (to.path !== from.path || !from.matched.length) begin("route")
  })
  router.beforeResolve(async (to) => {
    // 首页等不用 three 的页面在路由 meta 里标 three: false，免得为了进度条多下载 three
    if (to.meta.three !== false) await hookThree()
  })
  router.afterEach((to, from, failure) => {
    if (failure) return end("route", 0)
    // 页面挂载后才开始加载模型，留 400 ms 等场景的第一个加载请求接上
    end("route", 400)
  })
  router.onError(() => end("route", 0))
}
