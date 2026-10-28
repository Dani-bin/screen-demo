/**
 * 开发模式测试钩子（照 build-3d-visual-dashboard 模板）：给 skill 的 scripts/capture.mjs 固定画面用，生产构建不挂载。
 * 契约：ready, views, states, setView(name), setState(name), freeze(on), hidePanels(on), renderIdMask(), stats()
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
    views: ["home"],
    states: Object.keys(states),
    setView: (name) => {
      if (name !== "home") throw new Error(`未定义的视角 ${name}`)
      scene.goHome()
    },
    async setState(name) {
      if (!states[name]) throw new Error(`未定义的数据状态 ${name}`)
      await states[name]()
    },
    freeze(on = true) {
      scene.setFrozen(on)
      onFreeze?.(on)
    },
    hidePanels(on = true) {
      for (const el of panels()) el.style.visibility = on ? "hidden" : ""
    },
    // 本页没有做设备 ID 图（比对时不带 --id-mask）
    renderIdMask: () => null,
    stats: () => scene.stats()
  }
  return {
    markReady: () => (window.__dashboard.ready = true),
    uninstall: () => delete window.__dashboard
  }
}
