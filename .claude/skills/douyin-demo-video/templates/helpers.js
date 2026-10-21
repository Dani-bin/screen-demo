// <demo 中文名> 录屏用的页面工具（rec.mjs 在通用的 rec-helpers.js 之后注入，往 window.REC 上加方法）
// 只用页面里的全局：window.__<demo>Scene（三维场景）、window.__<demo>Page（开发模式的录屏接口，没有就不用）、document
// 动画一律用 REC.tween（requestAnimationFrame 驱动，按虚拟时间走），不要用 CSS 过渡
;(() => {
  const S = () => window.__demoScene // 换成这个页面实际挂的名字

  /** 镜头 ms 毫秒缓动到 view（{ target, dist, yaw, pitch } 之类，按场景实际的镜头接口改） */
  async function view(to, ms = 1500) {
    const s = S()
    const from = { ...s.view }
    await REC.tween(ms, (e) => {
      for (const k of Object.keys(to)) s.view[k] = REC.lerp(from[k], to[k], e)
      s.applyView?.()
    })
  }

  /** 镜头立刻到位（第 0 帧不要有过渡） */
  function snap(to) {
    Object.assign(S().view, to)
    S().applyView?.()
  }

  Object.assign(window.REC, { view, snap })
})()
"ok"
