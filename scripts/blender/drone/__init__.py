"""
无人机巡检监控平台 · 化工园区三维模型（Blender 构建脚本包）
----------------------------------------------------------
在 Blender（5.1+）里通过 Blender MCP 执行：

    import sys
    sys.path.insert(0, "<repo>/scripts/blender")
    import drone.build as b; b.run(render_to="<png>")   # 重建并保存 models/drone/park.blend，同机位预览
    import drone.export as e; e.export()                 # 导出 public/drone/park.glb、fleet.glb

布局数据 site.json 由 scripts/drone/plan_site.py 从定稿反投影生成，不要手改。

模块：
- lib.py      几何与材质工具（复制自 energy/lib.py）
- palette.py  材质与程序化贴图（黄昏沙盘的配色）
- assets.py   预制件（浮顶罐、拱顶罐、球罐、塔器、钢结构、管廊、冷却塔、冷箱、污水池、火炬、建筑、槽车、槽船、树、路灯、机场、无人机）
- layout.py   读取 site.json，按设备编号摆放全部要素
- preview.py  定稿标定相机 + 黄昏光的同机位预览
- export.py   导出 GLB
"""
