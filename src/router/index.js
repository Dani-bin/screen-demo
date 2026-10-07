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
