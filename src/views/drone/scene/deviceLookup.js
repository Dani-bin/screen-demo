/**
 * 设备查找与 ID 图规则（不依赖 three，便于单测）。
 */

/**
 * 按设备节点名找模型里的根节点。
 * GLTFLoader 会清洗节点名（去掉 . : / [ ]，空白换成 _，重名加后缀），清洗前的原名保存在 userData.name；
 * 所以先按 userData.name 精确匹配，再退回按 name 匹配。找不到返回 null。
 */
export function findDeviceNode(root, name) {
  let byOriginal = null
  let byName = null
  root.traverse((o) => {
    if (!byOriginal && o.userData?.name === name) byOriginal = o
    if (!byName && o.name === name) byName = o
  })
  return byOriginal || byName
}

/** 材质是否透明（半透明或透射玻璃） */
function isSeeThrough(m) {
  return (m.transparent && (m.opacity ?? 1) < 1) || (m.transmission ?? 0) > 0
}

/**
 * ID 图里一个网格的画法：
 *   "device"  属于某台设备，画该设备的颜色
 *   "hide"    不属于设备、且所有材质都是透明的（玻璃幕墙、罩子），隐藏，免得把里面的设备涂黑
 *   "black"   其余不属于设备的网格，画黑色（会遮挡后面的设备，和真实画面一致）
 */
export function idMaskRole(mesh, isDevice) {
  if (isDevice) return "device"
  const mats = [].concat(mesh.material || [])
  return mats.length && mats.every(isSeeThrough) ? "hide" : "black"
}
