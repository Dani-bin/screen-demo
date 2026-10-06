/*
 * @Author:
 * @Date: 2024-04-27 10:58:58
 * @Description:
 */
import router from "./router"
import NProgress from "nprogress"
import "nprogress/nprogress.css"
import { getToken, setToken, setRefreshToken } from "@/utils/auth"
import useUserStore from "@/store/modules/user"
import request from "@/utils/request"
import useDictStore from "@/store/modules/dict"

/** 字典数据是否已拉取：整个会话只拉一次 */
let dictLoaded = false

NProgress.configure({ showSpinner: false })

/**
 * 无需登录态的独立展示页。
 * 这类页面不调用业务接口，若走下面的通用流程，
 * 会因为没有 token 被重定向到后端登录页，或空等字典接口。
 */
const PUBLIC_PATHS = ["/home", "/school", "/city"]

router.beforeEach((to, from, next) => {
  NProgress.start()

  if (PUBLIC_PATHS.includes(to.path)) {
    next()
    return
  }

  // let obj = {
  //   token: "fbee774f3cfb42cc881837eeebc60950",
  //   refreshToken: "47894483e5cc4ffb876c554c27b691c2"
  // }
  // sessionStorage.setItem("thyj-bi-token", JSON.stringify(obj))

  console.log(to.query)
  to.query.token &&
    sessionStorage.setItem(
      "thyj-bi-token",
      JSON.stringify({
        token: to.query.token,
        refreshToken: to.query.refreshToken
      })
    )

  let tokenData = sessionStorage.getItem("thyj-bi-token")
  if (tokenData) {
    tokenData = JSON.parse(tokenData)
    setToken(tokenData.token)
    setRefreshToken(tokenData.refreshToken)
  } else {
    window.location.href = import.meta.env.VITE_APP_BASE_API + "/rx-admin/login"
  }

  if (getToken()) {
    if (!dictLoaded) {
      // 首次进入业务页时拉一次全量字典，存入 dict store 供各组件取用
      request({
        url: "/admin-api/system/dict-data/list-all-simple",
        method: "get"
      }).then((res) => {
        useDictStore().setDateList(res.data)
        dictLoaded = true
        next()
      })
    } else {
      next()
    }
  }
})

router.afterEach((to) => {
  NProgress.done()
})
