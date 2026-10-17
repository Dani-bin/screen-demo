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
    // 候诊大厅：同一家医院 2F 内科候诊区，三维展示各诊室待诊 / 复诊 / 过诊 + 叫号高亮
    path: "/waiting",
    name: "Waiting",
    component: () => import("@/views/waiting/index.vue")
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
