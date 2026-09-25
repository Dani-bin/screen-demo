/*
 * 运动场建模
 * ----------------------------------------------------------
 * 200 米环形跑道（百科明载）+ 人工草皮足球场 + 北端硬地球场。
 *
 * 两个要点：
 *  1. 跑道环 = 外轮廓挖去内轮廓；内场的草皮与球场则用 innerFieldShape
 *     按跑道内圈裁剪，弧段处自动收窄，不会像矩形那样戳到跑道上。
 *  2. 草皮、球场、划线分别铺在依次升高的 Y 上。若把两块地面放在同一
 *     高度且区域重叠，会因深度值相同而产生 Z-fighting 闪烁条纹。
 */
import { Group, Path } from "three"
import { FIELD } from "./layout"
import {
  circlePoints,
  groundFromShape,
  innerFieldShape,
  lineLoop,
  rectPoints,
  stadiumPoints,
  stadiumShape
} from "./geometry"

/* 各层高度：依次抬升，彼此不共面 */
const Y_TRACK = 0.05
const Y_TURF = 0.07
const Y_COURT = 0.09
const Y_LINE = 0.13

export function createPlayground(materials) {
  const group = new Group()
  const {
    x,
    z,
    trackOuterHalfW,
    trackOuterHalfL,
    trackInnerHalfW,
    trackInnerHalfL,
    court,
    courtLines,
    pitch
  } = FIELD

  // 跑道环
  const outer = stadiumShape(trackOuterHalfW, trackOuterHalfL)
  const innerShape = stadiumShape(trackInnerHalfW, trackInnerHalfL)
  outer.holes.push(new Path(innerShape.getPoints(90)))
  group.add(groundFromShape(outer, materials.track, Y_TRACK))

  // 内场草皮：铺满整个跑道内圈，作为底层
  group.add(
    groundFromShape(
      innerFieldShape(
        trackInnerHalfW,
        trackInnerHalfL,
        -trackInnerHalfL,
        trackInnerHalfL
      ),
      materials.turf,
      Y_TURF
    )
  )

  // 北端硬地球场：压在草皮之上，边界同样贴合跑道内圈
  group.add(
    groundFromShape(
      innerFieldShape(trackInnerHalfW, trackInnerHalfL, court.zMin, court.zMax),
      materials.court,
      Y_COURT
    )
  )

  // 四条白色分道线
  const laneOffsets = [14.6, 16.2, 17.8, 19.4]
  laneOffsets.forEach((halfW) => {
    group.add(lineLoop(stadiumPoints(halfW, halfW + 24, 0.09), materials.line))
  })

  // 足球场划线：边线、中线、中圈、两侧禁区
  const { z: pz, width: pw, depth: pd } = pitch
  group.add(lineLoop(rectPoints(0, pz, pw, pd, Y_LINE), materials.line))
  group.add(lineLoop(rectPoints(0, pz, pw, 0.02, Y_LINE), materials.line))
  group.add(lineLoop(circlePoints(0, pz, 5, Y_LINE), materials.line))
  ;[pz - 15, pz + 15].forEach((boxZ) => {
    group.add(lineLoop(rectPoints(0, boxZ, 12, 5, Y_LINE), materials.line))
  })

  // 北端两片篮球场划线
  courtLines.centers.forEach((cz) => {
    group.add(
      lineLoop(
        rectPoints(0, cz, courtLines.width, courtLines.depth, Y_LINE),
        materials.line
      )
    )
    group.add(lineLoop(circlePoints(0, cz, 2.4, Y_LINE, 32), materials.line))
  })

  group.position.set(x, 0, z)
  group.userData.stop = 4
  return group
}
