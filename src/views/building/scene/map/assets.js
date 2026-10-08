import { FileLoader } from "three"
import { Resource } from "./mini3d"

import pathLine2 from "./texture/pathLine2.png"
import side from "./texture/side.png"
import rotationBorder1 from "./texture/rotationBorder1.png"
import rotationBorder2 from "./texture/rotationBorder2.png"
import guangquan1 from "./texture/guangquan01.png"
import guangquan2 from "./texture/guangquan02.png"
import huiguang from "./texture/huiguang.png"
import mapFlyline from "./texture/flyline6.png"
import focusArrowsTexture from "./texture/focus/focus_arrows.png"
import focusBarTexture from "./texture/focus/focus_bar.png"
import focusBgTexture from "./texture/focus/focus_bg.png"
import focusMidQuanTexture from "./texture/focus/focus_mid_quan.png"
import focusMoveBgTexture from "./texture/focus/focus_move_bg.png"

/**
 * 城市级地图的资源清单：贴图 + GeoJSON
 * GeoJSON 由 scripts/build-building-geo.mjs 生成到 public/building/map/
 */
export class Assets {
  constructor() {
    this.instance = new Resource()
    this.instance.addLoader(FileLoader, "FileLoader")

    const json = (name) =>
      `${import.meta.env.BASE_URL}building/map/${name}.json`
    this.instance.loadAll([
      // 背景：成都区县面；焦点：高新区街道面 / 高新区外轮廓
      { type: "File", name: "background", path: json("chengdu") },
      { type: "File", name: "mapJson", path: json("gaoxin") },
      { type: "File", name: "mapStroke", path: json("gaoxin-stroke") },

      { type: "Texture", name: "pathLine2", path: pathLine2 },
      { type: "Texture", name: "side", path: side },
      { type: "Texture", name: "huiguang", path: huiguang },
      { type: "Texture", name: "rotationBorder1", path: rotationBorder1 },
      { type: "Texture", name: "rotationBorder2", path: rotationBorder2 },
      { type: "Texture", name: "guangquan1", path: guangquan1 },
      { type: "Texture", name: "guangquan2", path: guangquan2 },
      { type: "Texture", name: "mapFlyline", path: mapFlyline },

      { type: "Texture", name: "focusArrows", path: focusArrowsTexture },
      { type: "Texture", name: "focusBar", path: focusBarTexture },
      { type: "Texture", name: "focusBg", path: focusBgTexture },
      { type: "Texture", name: "focusMidQuan", path: focusMidQuanTexture },
      { type: "Texture", name: "focusMoveBg", path: focusMoveBgTexture }
    ])
  }
}
