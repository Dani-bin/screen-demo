/** 视角键和导览顺序：旧场景（PitScene）和 Blender 模型场景（GlbScene）共用，页面（board.js）从 PitScene.js 导入 */
export const VIEWS = ["overview", "fleet", "swap", "shovel", "slope", "yard"]

/** 导览顺序（秒）：每一站停留多久；控制台按这个显示「下一站」和倒计时 */
export const TOUR = [
  { view: "overview", dwell: 10 },
  // 总览之后先去换电站：设计稿控制台画的是「下一站 换电站」
  { view: "swap", dwell: 8 },
  { view: "fleet", dwell: 8 },
  { view: "shovel", dwell: 8 },
  { view: "slope", dwell: 8 },
  { view: "yard", dwell: 8 }
]
