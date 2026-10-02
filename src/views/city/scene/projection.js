/*
 * 经纬度 ↔ 米制局部坐标
 * ----------------------------------------------------------
 * 与 scripts/fetch-osm-city.py 使用同一套等距圆柱投影，
 * 保证景点经纬度与预处理几何数据落在同一坐标系里。
 * X 向东、Z 向南（three.js 右手系，Y 向上）。
 * 公式仅在远离两极时有效（lat0 不接近 ±90°，否则 cos 趋近 0）。
 */
const METERS_PER_DEG_LAT = 110540
const METERS_PER_DEG_LON_EQUATOR = 111320

/**
 * @param {[number, number]} origin 原点 [lon, lat]
 */
export function createProjection(origin) {
  const [lon0, lat0] = origin
  const kx = METERS_PER_DEG_LON_EQUATOR * Math.cos((lat0 * Math.PI) / 180)
  const kz = METERS_PER_DEG_LAT
  return {
    /** 经纬度 → [x, z] */
    toLocal(lon, lat) {
      return [(lon - lon0) * kx, -(lat - lat0) * kz]
    },
    /** [x, z] → [lon, lat] */
    toLonLat(x, z) {
      return [lon0 + x / kx, lat0 - z / kz]
    }
  }
}
