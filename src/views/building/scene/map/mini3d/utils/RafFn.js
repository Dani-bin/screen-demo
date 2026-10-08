/**
 * requestAnimationFrame 动画控制
 * @param {Function} callback 每帧回调
 * @returns {{start: Function, pause: Function, resume: Function, isActive: Function}}
 */
export function RafFn(callback) {
  let rafId = null
  let isActive = false
  let paused = false

  function animate() {
    if (!isActive || paused) return
    callback()
    rafId = requestAnimationFrame(animate)
  }

  function start() {
    if (!isActive) {
      isActive = true
      animate()
    }
  }

  function pause() {
    if (isActive) {
      isActive = false
      paused = true
      cancelAnimationFrame(rafId)
    }
  }

  function resume() {
    if (!isActive && paused) {
      isActive = true
      paused = false
      animate()
    }
  }

  return {
    start,
    pause,
    resume,
    isActive: () => isActive
  }
}
