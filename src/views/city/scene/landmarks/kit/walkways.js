/*
 * 步行路径（walkways，人群系统用，格式见 crowd.js）的共用几何小工具
 */

/**
 * 圆角矩形环路：矩形 [x0, x1] × [z0, z1]（任意平面坐标系，两轴记作 x、z），
 * 四角各用 4 段圆弧（每段转 22.5°）代替直角——人群在折线拐角处有少许横向跳动，
 * 拐角不超过 22.5° 时看不出来。
 * @param {{ x0: number, x1: number, z0: number, z1: number, r: number }} rect r 为圆角半径
 * @returns {Array<[number, number]>} 闭合折线顶点 [x, z]（首尾不重复，按 closed 环路使用）
 */
export function roundedLoop({ x0, x1, z0, z1, r }) {
  const pts = []
  // 四个圆角的圆心与起始角（角度从 +x 向 +z 量），依次绕行一周
  const corners = [
    [x1 - r, z0 + r, -90],
    [x1 - r, z1 - r, 0],
    [x0 + r, z1 - r, 90],
    [x0 + r, z0 + r, 180]
  ]
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + k * 22.5) * Math.PI) / 180
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
    }
  }
  return pts
}
