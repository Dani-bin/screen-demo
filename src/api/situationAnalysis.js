/*
 * @Author: 
 * @Date: 2026-06-02 19:40:47
 * @Description: 
 */
import request from "@/utils/request"

/**
 * 获取分组清单
 * 返回字段：pointName(名称) / lng(经度，字符串) / lat(纬度，字符串) /
 *           typeName(类型中文名) / id(点位ID)
 */
export function getPlanGroups(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups",
    method: "get",
    params
  })
}

export function getPlanGroupsOrgs(params) {
  return request({
    url: "/admin-api/business/yjyl/plan/groups/orgs",
    method: "get",
    params
  })
}

export function getDioUserInfos(params) {
  return request({
    url: "/admin-api/business/dioUserInfo/page",
    method: "get",
    params
  })
}