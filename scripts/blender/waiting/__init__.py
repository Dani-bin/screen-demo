"""
候诊大厅人物（Blender 构建脚本包）
----------------------------------------------------------
按 docs/design/waiting/draft/characters-concept.png（盲盒潮玩风）程序化建模医生、护士、患者，
全部是坐姿（屁股坐在 z = 0.45 的座面上），导出 GLB 给 /waiting 页面摆到诊室和候诊座椅上。

在 Blender（5.1+）里通过 MCP 执行：

    import sys, importlib
    sys.path.insert(0, "<repo>/scripts/blender")
    import waiting.build as b; importlib.reload(b); b.run(render_to="<png>")   # 建模 + 出预览
    b.export()                                                                  # 写 public/waiting/people.glb

模块：
- toy.py     几何工具：元球（软胶质感的身体 / 头发）、球、圆柱、圆角方块、圆环、管子，统一刷顶点色
- people.py  人物定义：身体模板、坐姿手位、发型、五官、服装配件
- build.py   构建、预览渲染（人物阵列）、导出
"""
