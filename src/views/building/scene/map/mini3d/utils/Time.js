import { Clock } from "three"
import { EventEmitter } from "./EventEmitter"
import { RafFn } from "./RafFn"

export class Time extends EventEmitter {
  constructor() {
    super()
    this.start = Date.now()
    this.current = this.start
    this.elapsed = 0
    this.delta = 16
    this.clock = new Clock()
    this.raf = RafFn(() => this.tick())
    this.raf.start()
  }
  tick() {
    const currentTime = Date.now()
    this.delta = currentTime - this.current
    this.current = currentTime
    this.elapsed = this.current - this.start
    const delta = this.clock.getDelta()
    const elapsedTime = this.clock.getElapsedTime()
    this.emit("tick", delta, elapsedTime)
  }
  destroy() {
    this.pause()
    this.off("tick")
  }
  pause() {
    this.raf.pause()
  }
  resume() {
    this.raf.resume()
  }
  isActive() {
    return this.raf.isActive()
  }
}
