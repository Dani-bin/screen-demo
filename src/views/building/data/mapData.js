/*
 * 数字楼宇 城市级地图数据
 * 由 scripts/build-building-geo.mjs 生成，请勿手改。
 * 数据来源：OpenStreetMap（© OpenStreetMap contributors，ODbL）、DataV GeoAtlas。
 */

/** 地图投影参数（墨卡托：中心经纬度 / 缩放；投影后的宽高，世界单位） */
export const MAP_CONFIG = {
  geoProjectionCenter: [104.066943, 30.566747],
  geoProjectionScale: 5600,
  projectedWidth: 11.454,
  projectedHeight: 16.799,
  bbox: [104.00835, 30.492751, 104.125537, 30.640744]
}

/** 高新区街道：名称、拼音、片区、锚点（面内离边界最远的点） */
export const STREETS = [
  {
    name: "桂溪街道",
    enName: "GUIXI",
    zone: "南区",
    area: 25.2,
    center: [104.065786, 30.561413],
    centroid: [104.065786, 30.561413]
  },
  {
    name: "中和街道",
    enName: "ZHONGHE",
    zone: "南区",
    area: 34.7,
    center: [104.091852, 30.522341],
    centroid: [104.091852, 30.522341]
  },
  {
    name: "石羊街道",
    enName: "SHIYANG",
    zone: "南区",
    area: 16.3,
    center: [104.042534, 30.588142],
    centroid: [104.042534, 30.588142]
  },
  {
    name: "肖家河街道",
    enName: "XIAOJIAHE",
    zone: "南区",
    area: 4.7,
    center: [104.029893, 30.614368],
    centroid: [104.029893, 30.614368]
  },
  {
    name: "芳草街街道",
    enName: "FANGCAOJIE",
    zone: "南区",
    area: 5.2,
    center: [104.046755, 30.617568],
    centroid: [104.046755, 30.617568]
  }
]

/** 周边区县标签（blur: 远处模糊显示） */
export const NEIGHBORS = [
  {
    name: "锦江区",
    center: [104.1151, 30.60117]
  },
  {
    name: "青羊区",
    center: [103.981259, 30.679625],
    blur: true
  },
  {
    name: "成华区",
    center: [104.143973, 30.688388],
    blur: true
  },
  {
    name: "双流区",
    center: [104.035634, 30.447974]
  }
]

/** 园区：成都金融城双子塔（南北两塔，高度 / 层数取自 OSM） */
export const PARK = {
  name: "成都金融城双子塔",
  enName: "CHENGDU IFC TWIN TOWERS",
  street: "桂溪街道",
  center: [104.062265, 30.585043],
  towers: [
    {
      name: "成都金融城双子塔（南塔）",
      height: 218,
      levels: 58,
      center: [104.062257, 30.58477]
    },
    {
      name: "成都金融城双子塔（北塔）",
      height: 218,
      levels: 58,
      center: [104.062273, 30.585316]
    }
  ]
}

/** 高新区内 100 m 以上的高层楼宇（OSM 有 name + height 的建筑，覆盖不全） */
export const TOWERS = [
  {
    name: "东方希望天祥广场",
    height: 219,
    levels: null,
    center: [104.065164, 30.554401],
    street: "桂溪街道"
  },
  {
    name: "中国太平金融大厦",
    height: 205,
    levels: 43,
    center: [104.066884, 30.575313],
    street: "桂溪街道"
  },
  {
    name: "NIC国创中心",
    height: 205,
    levels: 43,
    center: [104.067752, 30.575089],
    street: "桂溪街道"
  },
  {
    name: "棕榈泉国际金融中心",
    height: 200,
    levels: 41,
    center: [104.067301, 30.557494],
    street: "桂溪街道"
  },
  {
    name: "环球金融中心 1",
    height: 200,
    levels: 46,
    center: [104.061088, 30.553223],
    street: "桂溪街道"
  },
  {
    name: "成都棕榈泉费尔蒙酒店",
    height: 179,
    levels: null,
    center: [104.067294, 30.555468],
    street: "桂溪街道"
  },
  {
    name: "成都世纪城假日酒店-西楼",
    height: 153,
    levels: 20,
    center: [104.070884, 30.560295],
    street: "桂溪街道"
  },
  {
    name: "环球时代中心",
    height: 123,
    levels: null,
    center: [104.063678, 30.557781],
    street: "桂溪街道"
  },
  {
    name: "成都保利辉盛坊国际公寓",
    height: 120,
    levels: 33,
    center: [104.058789, 30.558735],
    street: "桂溪街道"
  }
]
