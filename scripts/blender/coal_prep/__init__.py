"""
井上地面输送系统 · 103 原煤上仓带式输送机机头三维模型（Blender 构建脚本包）
----------------------------------------------------------
命令行执行（不需要 MCP，见 run_cli.py）：

    "/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup \
        --python scripts/blender/coal_prep/run_cli.py -- build --render <png>   # 重建 + 同机位预览
    ... -- bake      # Cycles 烘焙静态件光照 → public/coal-prep/lightmap.webp
    ... -- export    # 导出 public/coal-prep/conveyor.glb

模块：
- lib.py      几何与材质工具（复制自 drone/lib.py）
- palette.py  材质与程序化贴图
- layout.py   按尺寸建模（栈桥、巡检通道、托辊、输送带、煤、双滚筒驱动、漏斗、吊轨机器人、远景）
- lights.py   黄昏光照（预览和烘焙共用，不导出）
- preview.py  定稿标定相机的同机位预览
- bake.py     静态件光照烘焙（第二套 UV，一张光照图集）
- export.py   导出 GLB
"""
