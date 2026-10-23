/**
 * 开发模式测试钩子：给截图 / 比对脚本固定画面用（skill 的 scripts/capture.mjs 只依赖这些）。生产构建不挂载。
 * 契约：ready, views, states, setView(name), setState(name), freeze(on), hidePanels(on), renderIdMask(), stats()
 */

/**
 * @param {object} o
 * @param {import("../scene/DroneScene.js").DroneScene} o.scene
 * @param {() => HTMLElement[]} o.panels 返回所有 HTML 面板元素（--clean 时隐藏）
 * @param {Record<string, () => void | Promise<void>>} o.states 数据状态名 → 切换函数（design = 设计稿那一刻）
 * @param {(on: boolean) => void} [o.onFreeze] 冻结时页面也要停掉自动巡游等
 */
export function installDashboardHooks({
  scene,
  panels,
  states = {},
  onFreeze
}) {
  if (!import.meta.env.DEV) return { markReady() {}, uninstall() {} }
  window.__dashboard = {
    ready: false,
    views: Object.keys(scene.views),
    states: Object.keys(states),
    setView: (name) => scene.setView(name),
    async setState(name) {
      if (!states[name]) throw new Error(`未定义的数据状态 ${name}`)
      await states[name]()
    },
    freeze(on = true) {
      scene.setFrozen(on)
      onFreeze?.(on)
    },
    hidePanels(on = true) {
      for (const el of panels())
        if (el) el.style.visibility = on ? "hidden" : ""
    },
    renderIdMask: () => scene.renderIdMask(),
    stats: () => scene.stats()
  }
  window.__droneScene = scene
  return {
    markReady: () => (window.__dashboard.ready = true),
    uninstall: () => {
      delete window.__dashboard
      delete window.__droneScene
    }
  }
}
