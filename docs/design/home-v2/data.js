// 首页改版效果图用的演示数据（前 5 个取自 src/views/home/data/demos.js，后 3 个为「规划中」占位，演示容量）
const P = "file:///Users/zhangjiabin/Desktop/Company/bi-demo/public/home/"
window.DEMOS = [
  { key: "school", name: "智慧校园三维导览", en: "SMART CAMPUS 3D", sub: "成都市实验小学西区分校", cat: "智慧教育", accent: "#a8432e",
    desc: "程序化建模还原红砖学院风校园，镜头沿南校门、中轴广场、钟楼、议事厅、运动场自动巡览。",
    tags: ["程序化建模", "自动巡览"], stats: [["6", "站", "导览地标"], ["30", "亩", "校园还原"], ["148×130", "m", "场景尺度"]], img: P + "school.webp" },
  { key: "city", name: "城市三维总览", en: "CITY 3D OVERVIEW", sub: "锦绣天府 · 安逸四川", cat: "智慧城市", accent: "#2f8f96",
    desc: "基于 OpenStreetMap 真实数据还原成都市中心街区，12 处地标精细建模、到站人流漫步。",
    tags: ["OSM 真实街区", "人流动画"], stats: [["12", "站", "城市地标"], ["18,750", "栋", "真实建筑"], ["8.8×7.5", "km", "街区范围"]], img: P + "city.webp" },
  { key: "charging", name: "智慧充电站", en: "SMART CHARGING STATION", sub: "光储充一体化超充站 · 数字孪生", cat: "新能源", accent: "#1f7fd6",
    desc: "Blender 建模还原大型光储充超充站，仿真驱动车辆进出、充放电与告警，四角能量节点实时联动。",
    tags: ["Blender 建模", "运行仿真"], stats: [["34", "根", "充电桩"], ["600", "kWp", "光伏装机"], ["2", "MWh", "储能容量"]], img: P + "charging.webp" },
  { key: "building", name: "高新区数字楼宇", en: "DIGITAL BUILDING", sub: "成都高新区 · 金融城双子塔", cat: "智慧城市", accent: "#c8902e",
    desc: "立体行政区地图联动金融城双子塔，按城市、园区、楼宇、楼层、房间五级钻取。",
    tags: ["五级钻取", "OSM 真实边界"], stats: [["5", "个", "南区街道"], ["86.1", "km²", "辖区面积"], ["218", "m", "双子塔高度"]], img: P + "building.webp" },
  { key: "hometown", name: "营山 · 五通村", en: "HOMETOWN MEMORY", sub: "老家记忆 · 四季沙盘之夏", cat: "乡村文旅", accent: "#b8392b",
    desc: "按卫星图与老照片还原的盛夏沙盘：沿田埂走一遍回家的路，推门回到老屋前，傍晚与夜晚可切换。",
    tags: ["卫星图配准", "昼夜切换"], stats: [["5.1", "公顷", "还原范围"], ["43", "栋", "农家房屋"], ["170", "m", "回家的路"]], img: P + "hometown.webp" },
  { key: "p1", name: "规划中的演示", sub: "智慧园区 · 安防巡检", cat: "规划中", placeholder: true },
  { key: "p2", name: "规划中的演示", sub: "水利 · 流域监测", cat: "规划中", placeholder: true },
  { key: "p3", name: "规划中的演示", sub: "工厂 · 产线孪生", cat: "规划中", placeholder: true }
]
window.FONTS = `
@font-face { font-family: "ShuHei"; src: url("file:///Users/zhangjiabin/Desktop/Company/bi-demo/src/assets/fonts/AlimamaShuHeiTi-Bold.ttf"); }
@font-face { font-family: "HanSans"; src: url("file:///Users/zhangjiabin/Desktop/Company/bi-demo/src/assets/fonts/SourceHanSansCN-Regular.otf"); }
@font-face { font-family: "DIN"; src: url("file:///Users/zhangjiabin/Desktop/Company/bi-demo/src/assets/fonts/DIN-Bold.otf"); }`
// 字体与图片加载完再置就绪信号（截图脚本等它）
window.markReady = () =>
  Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {}))]).then(() => (window.__ready = true))
