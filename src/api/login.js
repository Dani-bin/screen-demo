/*
 * @Author:
 * @Date: 2024-06-26 09:55:53
 * @Description:
 */
import request from "@/utils/request"
import { getRefreshToken } from "@/utils/auth"
// 刷新访问令牌
export function refreshToken() {
  return request({
    url: "/admin-api/system/auth/refresh-token?refreshToken=" + getRefreshToken(),
    method: "post"
  })
}
