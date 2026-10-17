/*
 * 院内导航 三维场景的配色与尺寸
 * ----------------------------------------------------------
 * 以设计稿 docs/design/hospital/01-draft-light.png 为准（浅色"医院导视"版）：
 * 白墙、浅灰楼面、按分区的淡彩房间、唯一的橙色路线、绿色起点 / 红色终点。
 * 场景只定风格；房间布局、扶梯朝向、路线都按 CAD（data/plan.json）来。
 */
export const THEME = {
  // 画布底色 = 设计稿中央场景的底色，和页面底色接上
  bg: "#E2E8E6",

  // 爆炸图：每层楼板之间的间距（米，真实层高 4.5）。要大于楼板进深在画面上的投影（43.2 × tan 俯角），
  // 上层才不会挡住下层，和设计稿一样层与层之间留出空隙
  level: 24,
  slab: 0.6, // 楼板厚
  wallH: 1.5, // 墙剖切高度
  railH: 1.1, // 中庭栏杆高
  furnH: 0.72, // 家具高
  chairH: 0.45, // 椅子高
  escRise: 4.5, // 扶梯真实提升高度（再往上到爆炸后的上层用一段竖线表示）

  colors: {
    floor: "#DDDEDA", // 走廊 / 大厅地面（设计稿是浅暖灰，比白墙深一档，墙才立得起来）
    slabSide: "#C8CCCA", // 楼板侧面中灰，勾出每层的轮廓
    wall: "#FBFBFA",
    furn: "#D7DDE2",
    seat: "#7C8A98", // 候诊座椅
    chair: "#A9B6C3",
    stair: "#F1F2F0",
    glass: "#CBE7EE",
    glassEdge: "#FFFFFF",
    escTruss: "#4A525B",
    escStep: "#2F363D",
    apron: "#D9DFDD", // 入口外的铺地
    person: "#22303D",
    personHead: "#E7C9A9",
    route: "#F26B1D",
    routeDone: "#F6B68E",
    start: "#1F9D57",
    end: "#D7372C",
    dest: "#FBD2B8", // 终点房间的地面高亮
    hover: "#C7E4EE",
    // 房间分区色（与 CAD 图例同一套分区，色值按设计稿的淡彩调）
    zones: {
      clinic: "#CCDCF0",
      exam: "#DAD0EE",
      emergency: "#F1C9C0",
      service: "#C8E4D3",
      public: "#DDDEDA",
      traffic: "#ECE0C0",
      wc: "#C6E1E6",
      aux: "#D6D9D8"
    }
  },

  // 相机：正交，从前右方（东南）斜上方看，与设计稿一致
  camera: { azimuth: 20, elevation: 24, padding: 1.03 },

  // 人员模拟（演示时间，不是真实时间：真实用时在面板上按路网代价换算）
  sim: {
    walk: 4.2, // 步行速度 m/s
    escalator: 4.5, // 扶梯斜段用时 s
    lift: 1.1, // 爆炸图里层与层之间的竖向段用时 s
    elevatorWait: 2.2, // 候梯 s
    flight: 2.6, // 一个楼梯梯段 s
    arriveHold: 6 // 到达后停留 s，再从头演示
  }
}
