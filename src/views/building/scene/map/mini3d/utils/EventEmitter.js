export class EventEmitter {
  constructor() {
    // 事件名 → 回调集合
    this.events = new Map()
  }

  on(event, callback) {
    let callbacks = this.events.get(event)
    if (!callbacks) {
      callbacks = new Set()
      this.events.set(event, callbacks)
    }
    callbacks.add(callback)
  }

  off(event, callback) {
    const callbacks = this.events.get(event)
    if (callbacks) {
      if (callback) {
        callbacks.delete(callback)
      } else {
        this.events.delete(event)
      }
    }
  }

  emit(event, ...args) {
    const callbacks = this.events.get(event)
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(...args)
      })
    }
  }

  once(event, callback) {
    const onceWrapper = (...args) => {
      callback(...args)
      this.off(event, onceWrapper)
    }
    this.on(event, onceWrapper)
  }
}
