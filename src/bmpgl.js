/*
 * @Author:
 * @Date: 2025-07-21 16:50:30
 * @Description:
 */
// bmpgl.js
export function BMPGL(ak) {
  return new Promise(function(resolve, reject) {
    window.init = function() {
      let script2 = document.createElement('script');
      script2.type = 'text/javascript'
      script2.src = `https://mapopen.cdn.bcebos.com/github/BMapGLLib/DrawingManager/src/DrawingManager.min.js`;
      document.head.appendChild(script2);
      resolve(BMapGL)
    }
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${ak}&callback=init`
    script.onerror = reject
    document.head.appendChild(script)
  })
}
