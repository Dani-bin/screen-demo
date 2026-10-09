"""
楼宇级（成都金融城双子塔 南塔 / 北塔）室内楼层模型：Blender 程序化建模 + Cycles 烘焙室内灯光
----------------------------------------------------------
在 Blender 里通过 MCP 执行：
  import sys; sys.path.insert(0, "<repo>/scripts/blender")
  import tower.build as b; b.run()      # 建模，保存 models/tower/tower.blend
  import tower.bake as k; k.bake()      # 逐个楼层模型烘焙（几十分钟，MCP 调用会超时但 Blender 会继续跑完）
  import tower.export as e; e.export()  # 写 public/building/tower_S.glb / tower_N.glb
详见 build.py 文件头。
"""
