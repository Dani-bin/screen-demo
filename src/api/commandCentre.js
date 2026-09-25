/*
 * @Author: 
 * @Date: 2024-10-31 14:53:12
 * @Description: 
 */
import request from "@/utils/request"


export function createWvpGroupTemp(data) {
  return request({
    url: "/admin-api/business/WvpGroupTemp/create",
    method: "post",
    data
  })
}

export function updateWvpGroupTemp(data) {
  return request({
    url: "/admin-api/business/WvpGroupTemp/update/" + data.id,
    method: "put",
    data
  })
}

export function getWvpGroupTempList(params) {
  return request({
    url: "/admin-api/business/WvpGroupTemp/page",
    method: "get",
    params
  })
}


export function getGongGeFenLei(params) {
  return request({
    url: "/admin-api/system/dict-data/type/gonggefenlei",
    method: "get",
    params
  })
}

export function delWvpGroupTemp(id) {
  return request({
    url: "/admin-api/business/WvpGroupTemp/delete/" + id,
    method: "delete",
  })
}

export function getVedioPlayUrl(params) {
  return request({
    url: `/admin-api/business/WvpTrees/playStart/${params.deviceId}/${params.channelId}`,
    method: "get",
    notError: true
  })
} 