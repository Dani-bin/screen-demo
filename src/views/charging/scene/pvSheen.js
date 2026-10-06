/*
 * 光伏阵列反光着色
 * ----------------------------------------------------------
 * 场景用正交相机：所有视线平行，一整片平的光伏板对环境的反射处处相同，实时光照算不出明暗变化，
 * 整片就成了同一种蓝。这里在光伏材质（Blender 里的 M_pv）上叠一层「天光反射」：
 *   - 三道沿对角线方向的反光带（两窄一宽），按世界坐标计算，跨越整片阵列连续，并随时间缓慢漂移；
 *   - 一层大尺度明暗起伏，避免反光带过于规整；
 *   - 每块板的深浅取自顶点色（Blender 里 _panel_shade 写入的 COLOR_0），同一道反光带落在不同板上亮度不同，
 *     形成设计稿上深浅交错的拼块感。
 * 叠加量写进自发光（totalEmissiveRadiance），不受场景灯光强弱影响，辉光阈值以下，不会泛白。
 */

/**
 * 给光伏材质挂上反光着色；返回 uniforms，渲染循环里更新 uTime（秒）
 * @param {THREE.MeshStandardMaterial} material
 */
export function applyPvSheen(material) {
  const uniforms = { uTime: { value: 0 } }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPvWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvPvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vPvWorld;\nuniform float uTime;"
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // 每块板的深浅（顶点色），没有顶点色时按 1 处理
          float shade = 1.0;
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            shade = vColor.r;
          #endif
          // 沿对角线的坐标：反光带垂直于这个方向
          float d = dot(vPvWorld.xz, vec2(0.78, 0.62));
          float t = uTime * 0.12;
          // 两道窄而亮的反光带（频率、速度不同，画面里同时能看到好几道）+ 一道宽而柔的天光
          float narrow = pow(0.5 + 0.5 * sin(d * 0.21 - t * 1.6), 12.0);
          float narrow2 = pow(0.5 + 0.5 * sin(d * 0.33 + 2.1 - t * 1.1), 16.0);
          float wide = pow(0.5 + 0.5 * sin(d * 0.075 + 1.7 - t), 3.0);
          // 大尺度明暗起伏（与反光带方向不同），打破规整
          float drift = 0.5 + 0.5 * sin(vPvWorld.x * 0.045 - vPvWorld.z * 0.11 + 0.8);
          float sheen = (1.1 * narrow + 0.8 * narrow2 + 0.5 * wide) * (0.5 + 0.5 * drift);
          // 反光颜色：偏青的天光；落在深色板上弱、浅色板上强（拉开板与板的反差）
          vec3 sky = vec3(0.22, 0.5, 1.0);
          totalEmissiveRadiance += sky * sheen * (0.15 + 0.85 * shade * shade) * 0.5;
          // 底层自亮：贴图本身（含细亮边框与电池片纹理）微微透出，夜景里不发黑
          totalEmissiveRadiance += diffuseColor.rgb * 0.16;
        }`
      )
  }
  // 与普通标准材质区分着色器缓存
  material.customProgramCacheKey = () => "pv-sheen"
  material.needsUpdate = true
  return uniforms
}
