/*
 * @Author:
 * @Date: 2023-12-18 14:19:06
 * @Description:
 */
import { defineStore } from "pinia"
import request from "@/utils/request"
import { ref } from "vue"
import { getToken, removeToken, setToken } from "@/utils/auth"

export const useUserStore = defineStore("user", () => {
  const token = ref(getToken())
  const userInfo = ref({})
  const myVillage = ref({})
  const allVillage = ref([])
  const dateList = ref([])

  /**
   * 登录
   * @param userInfo
   * @returns
   */
  const login = async (data) => {
    setToken(data)
  }
  const setDateList = (data) => {
    dateList.value = data || []
  }

  // 获取用户信息
  const getInfo = async () => {
    return request({
      url: "/admin-api/system/auth/get-permission-info",
      method: "get"
    }).then((res) => {
      userInfo.value = res.data.user
    })
  }

  const changeVillage = (villageId) => {
    myVillage.value =
      allVillage.value.find((item) => item.id == villageId) || {}
    sessionStorage.setItem(
      "myVillageId",
      JSON.stringify(myVillage.value.id || "")
    )
  }

  // 获取当前用户的社区权限列表
  const getBiMyVillage = async (deptId) => {
    return request({
      url: "/admin-api/system/user/bi-my-village",
      method: "get"
    }).then((res) => {
      let myVillageId = sessionStorage.getItem("myVillageId") || ""
      let id = myVillageId || deptId
      allVillage.value = res.data || []
      myVillage.value = allVillage.value.find((item) => item.id == id) || {}
      sessionStorage.setItem(
        "myVillageId",
        JSON.stringify(myVillage.value.id || "")
      )
    })
  }

  // 注销
  const logout = async () => {
    token.value = ""
    userInfo.value = {}
    removeToken()
  }

  return {
    userInfo,
    myVillage,
    allVillage,
    dateList,
    login,
    getInfo,
    logout,
    getBiMyVillage,
    changeVillage,
    setDateList
  }
})

export default useUserStore
