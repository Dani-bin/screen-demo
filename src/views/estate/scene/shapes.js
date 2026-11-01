/**
 * 沙盘里的曲线形状：景观湖岸线、锦澜河中心线
 * ----------------------------------------------------------
 * 地面贴图、水面网格、树的避让遮罩都从这里取同一份形状，保证岸线对得上。
 * 平面坐标：x 向东、y 向北（米）。
 */

/** 景观湖岸线：以 (cx, cy) 为心的椭圆，叠加两个低频起伏让岸线不那么规整。scale 用来外扩出石岸、步道 */
export function lakeOutline(lake, scale = 1, extra = 0, n = 96) {
  const a = lake.w / 2
  const b = lake.d / 2
  const pts = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    const k = 1 + 0.018 * Math.sin(3 * t + 0.6) + 0.012 * Math.sin(5 * t + 2.1)
    const ra = a * k * scale + extra
    const rb = b * k * scale + extra
    pts.push([lake.cx + Math.cos(t) * ra, lake.cy + Math.sin(t) * rb])
  }
  return pts
}

/** 湖岸线在角度 t 处的相对半径系数（水面网格用） */
export function lakeRadiusK(t) {
  return 1 + 0.018 * Math.sin(3 * t + 0.6) + 0.012 * Math.sin(5 * t + 2.1)
}

/** 河的中心线：沿 x 缓缓起伏 */
export function riverY(river, x) {
  return river.cy + 9 * Math.sin(x / 70 + 0.4) + 4 * Math.sin(x / 31 + 1.3)
}

/** 河的两岸线（沿 x 从 x0 到 x1），返回 { top, bottom }，y 向北 */
export function riverBanks(river, x0, x1, step = 6, extra = 0) {
  const top = []
  const bottom = []
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    const y = riverY(river, x)
    // 河宽也轻微变化
    const half = river.d / 2 + 2.2 * Math.sin(x / 55 + 2) + extra
    top.push([x, y + half])
    bottom.push([x, y - half])
  }
  return { top, bottom }
}
