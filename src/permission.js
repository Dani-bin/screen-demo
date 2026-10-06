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
import { BMPGL } from "./bmpgl"
import useDictStore from "@/store/modules/dict"

let hasInitScript = false

NProgress.configure({ showSpinner: false })

/**
 * 无需登录态的独立展示页。
 * 这类页面不调用业务接口、也不使用百度地图，若走下面的通用流程，
 * 会因为没有 token 被重定向到后端登录页，或空等字典接口与地图脚本。
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

  // BMPGL('dMhcSw600divYNOLFin9KlfSk7oertPX').then(async () => {
  //   hasInitScript = true
  //   next()
  // })
  // return

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
    if (!hasInitScript) {
      request({
        url: "/admin-api/system/dict-data/list-all-simple",
        method: "get"
      }).then((res) => {
        let data = res.data.find((val) => val.dictType === "BaiduMapKey")
        useDictStore().setDateList(res.data)
        if (data) {
          BMPGL(data.value).then(async () => {
            hasInitScript = true
            next()
          })
        }
      })
    } else {
      next()
    }
  }
})

router.afterEach((to) => {
  NProgress.done()
})
