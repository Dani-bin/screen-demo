/*
 * @Author:
 * @Date: 2024-04-27 10:32:14
 * @Description:
 */
import Cookies from "js-cookie"

const TokenKey = "HYL-Token"
const RefreshTokenKey = "HYL-Refresh-Token"

export function getToken() {
  return Cookies.get(TokenKey)
}
export function getRefreshToken() {
  return Cookies.get(RefreshTokenKey)
}

export function setToken(token) {
  return Cookies.set(TokenKey, token)
}

export function setRefreshToken(token) {
  return Cookies.set(RefreshTokenKey, token)
}

export function removeToken() {
  return Cookies.remove(TokenKey)
}
