/*
 * 应用入口
 * ----------------------------------------------------------
 * 各演示页都是自带外壳的独立页面，入口只负责全局样式、根字号适配与路由。
 */
import { createApp } from "vue"

// Tailwind 基础样式（preflight）：各页面依赖它统一的元素默认样式，删掉会改变页面外观
import "@/assets/styles/tailwind.css"
// 按视口宽度设置根字号，配合 postcss-pxtorem 让整屏按 1920 设计稿等比缩放
import "amfe-flexible"
// 字体注册与全局基础样式
import "@/assets/styles/index.scss"
import App from "./App.vue"
import router from "@/router"

const app = createApp(App)
app.use(router)

// 挂载实例
app.mount("#app")
