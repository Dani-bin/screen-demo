"""
老家沙盘（/hometown，营山 · 五通村）三维模型（Blender 构建脚本包）
----------------------------------------------------------
在 Blender（5.1+）里通过 MCP 执行：

    import sys, importlib
    sys.path.insert(0, "<repo>/scripts/blender")
    import hometown.build as b; importlib.reload(b); b.run()

场地数据 site.json / site_grid.npz 由 python3 scripts/hometown/build_site.py 生成，不要手改；
地物源数据在 scripts/hometown/draw_plan.py（按卫星图描绘）与 houses.json（用户手描房屋轮廓）。
模块：lib 几何与材质工具 / palette 材质与程序化贴图 / terrain 地面与沙盘 / houses 房屋 /
trees 树木 / preview 预览相机与渲染
"""
