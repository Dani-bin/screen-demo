/*
 * @Author:
 * @Date: 2024-04-27 10:15:16
 * @Description:
 */
import {
  createRouter,
  createWebHashHistory,
  createWebHistory
} from "vue-router"

const routes = [
  {
    // 注意：原默认重定向指向 /typhoon，但当前工作区中 typhoon 系列页面
    // 处于「已删除未提交」状态、对应路由也已移除，直接进根路径会白屏。
    // 因此暂时改指学校页；若恢复 typhoon 页面，把这里改回 "/typhoon" 即可。
    path: "",
    redirect: "/school"
  },
  {
    // 小学三维可视化介绍：独立页面，自带外壳，不加载百度地图
    path: "/school",
    name: "School",
    component: () => import("@/views/school/index.vue")
  },
  {
    // 城市三维总览：独立页面，自带外壳，不加载百度地图
    path: "/city",
    name: "City",
    component: () => import("@/views/city/index.vue")
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
