"""
综合能源补给站三维模型（Blender 构建脚本包）
----------------------------------------------------------
在 Blender（5.1+）里通过 Blender Lab MCP 执行：

    import sys
    sys.path.insert(0, "<repo>/scripts/blender")
    import energy.build as b; b.run()        # 重建场景并保存 models/energy/station.blend
    import energy.export as e; e.export()    # 导出 public/energy/station.glb

布局数据 site.json 由 scripts/energy/draw_plan.py 生成（规划草图同源），不要手改。

模块：
- lib.py      几何与材质工具（复制自 charging/lib.py）
- palette.py  材质与程序化贴图
- assets.py   设备预制件（加油机、罩棚、换电站、LNG 储罐、超充桩……）
- layout.py   读取 site.json，换算坐标并摆放全部要素
- preview.py  预览渲染（正交等轴相机、辉光）
- export.py   导出 GLB
"""
