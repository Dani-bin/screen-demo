"""
数字楼宇 · 园区级三维模型（Blender 构建脚本包）：成都金融城双子塔 · 天府国际金融中心
----------------------------------------------------------
在 Blender（5.1+）里通过 MCP 执行：

    import sys, importlib
    sys.path.insert(0, "<repo>/scripts/blender")
    import park.build as b; importlib.reload(b); b.run()

布局数据 layout.json 由 node scripts/build-park-layout.mjs 从 OSM 生成，不要手改。
模块：lib 几何与材质工具 / palette 材质与程序化贴图 / buildings 楼体 / site 沙盘地面绿化路灯 /
preview 预览相机与渲染 / bake 地面光照烘焙 / export 导出 GLB
"""
