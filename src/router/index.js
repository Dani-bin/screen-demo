/*
 * @Author:
 * @Date: 2024-04-27 10:15:16
 * @Description:
 */
import { createRouter, createWebHashHistory } from "vue-router"

const routes = [
  {
    // 根路径进入演示中心首页（各演示的统一入口）
    path: "",
    redirect: "/home"
  },
  {
    // 演示中心首页：展示各演示的介绍与预览图，点击进入
    path: "/home",
    name: "Home",
    component: () => import("@/views/home/index.vue")
  },
  {
    // 小学三维可视化介绍：独立页面，自带外壳
    path: "/school",
    name: "School",
    component: () => import("@/views/school/index.vue")
  },
  {
    // 城市三维总览：独立页面，自带外壳
    path: "/city",
    name: "City",
    component: () => import("@/views/city/index.vue")
  },
  {
    // 智慧充电站：光储充一体化超充站数字孪生，Blender 建模 + three.js 展示
    path: "/charging",
    name: "Charging",
    component: () => import("@/views/charging/index.vue")
  },
  {
    // 综合能源补给站：油 / 气 / 电 / 换电一体化补给站数字孪生，Blender 建模 + three.js 展示
    path: "/energy",
    name: "Energy",
    component: () => import("@/views/energy/index.vue")
  },
  {
    // 老家沙盘：营山五通村，按卫星图与老照片还原，Blender 建模 + three.js 展示
    path: "/hometown",
    name: "Hometown",
    component: () => import("@/views/hometown/index.vue")
  },
  {
    // 医院院内导航：虚构三层门诊楼，选起终点 → 跨楼层路线（楼梯 / 电梯 / 扶梯）→ 人员模拟
    path: "/hospital",
    name: "Hospital",
    component: () => import("@/views/hospital/index.vue")
  },
  {
    // 无人机巡检监控平台：虚构化工园区，4 机场 × 4 无人机自动巡检 + AI 事件处置，Blender 建模 + three.js 展示
    path: "/drone",
    name: "Drone",
    component: () => import("@/views/drone/index.vue")
  },
  {
    // 候诊大厅：同一家医院 2F 内科候诊区，三维展示各诊室待诊 / 复诊 / 过诊 + 叫号高亮
    path: "/waiting",
    name: "Waiting",
    component: () => import("@/views/waiting/index.vue")
  },
  {
    // 智能矿山：West Elk 煤矿（美国科罗拉多州），真实高程 + 航拍影像沙盘，井下巷道 / 工作面透视与剖切
    path: "/smart-mine",
    name: "SmartMine",
    component: () => import("@/views/smart-mine/index.vue")
  },
  {
    // 智慧牧场：呼伦贝尔莫日格勒河中游真实地形 + Sentinel-2 影像 / NDVI 沙盘，划区轮牧与畜群监管（牧场为虚构）
    path: "/smart-ranch",
    name: "SmartRanch",
    component: () => import("@/views/smart-ranch/index.vue")
  },
  {
    // 带式输送机安全预警与集控孪生：虚构井工煤矿主煤流（6 条皮带、3 个煤仓），剖面沙盘 + 人机料环预警 + 集控
    path: "/smart-conveyor",
    name: "SmartConveyor",
    component: () => import("@/views/smart-conveyor/index.vue")
  },
  {
    // 井上地面输送系统：103 原煤上仓带式输送机机头特写（Blender 建模 + Cycles 光照图），输送机安全预警与智能运维
    path: "/coal-prep",
    name: "CoalPrep",
    component: () => import("@/views/coal-prep/index.vue")
  },
  {
    // 数字楼宇：城市（成都高新区）→ 园区 → 楼宇 → 楼层 → 房间 五级钻取
    path: "/building",
    name: "Building",
    component: () => import("@/views/building/index.vue")
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})
export default router
