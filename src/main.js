/*
 * @Author:
 * @Date: 2024-06-11 11:04:25
 * @Description:
 */

import { createApp } from "vue"
import ElementPlus from "element-plus"
import "element-plus/dist/index.css"
import zhCn from 'element-plus/es/locale/lang/zh-cn'

import "@/assets/styles/tailwind.css"
import "amfe-flexible"
import "@/assets/styles/index.scss"
import App from "./App.vue"
import store from "./store"
import router from "@/router"
const app = createApp(App)
import "./permission"
import './assets/qweather-icons/font/qweather-icons.css'
import Viewer from 'v-viewer'
import 'viewerjs/dist/viewer.css'
app.use(Viewer)
Viewer.setDefaults({
  title: false,
  toolbar: false,
  navbar: false,
  button: false,
  zIndex: 9999
})

app.use(store)
app.use(router)
app.use(ElementPlus, {
  locale: zhCn,
})

// 挂载实例
app.mount("#app")
