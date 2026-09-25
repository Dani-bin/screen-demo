/*
 * @Author:
 * @Date: 2024-06-11 11:33:13
 * @Description:
 */

/**
 * 参数处理
 * @param {*} params  参数
 */
let scale;
const getScale = () => {
  let width = document.documentElement.clientWidth;
  scale = width / 3840;
};
window.onresize = () => {
  getScale();
};

export function tansParams(params) {
  let result = "";
  for (const propName of Object.keys(params)) {
    const value = params[propName];
    var part = encodeURIComponent(propName) + "=";
    if (value !== null && value !== "" && typeof value !== "undefined") {
      if (typeof value === "object") {
        for (const key of Object.keys(value)) {
          if (
            value[key] !== null &&
            value[key] !== "" &&
            typeof value[key] !== "undefined"
          ) {
            let params = propName + "[" + key + "]";
            var subPart = encodeURIComponent(params) + "=";
            result += subPart + encodeURIComponent(value[key]) + "&";
          }
        }
      } else {
        result += part + encodeURIComponent(value) + "&";
      }
    }
  }
  return result;
}

/**
 * 设计稿尺寸1920*1080  根据屏幕大小缩放比例
 * @param {*}
 */
export function getScaleNum(num) {
  !scale && getScale();
  return scale * num;
}
