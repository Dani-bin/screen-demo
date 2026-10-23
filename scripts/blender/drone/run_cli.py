"""
无人机巡检 · 化工园区建模 · 命令行入口（不开 Blender 界面、不依赖 MCP 插件时用）
----------------------------------------------------------
    blender --background --factory-startup --python scripts/blender/drone/run_cli.py -- build [--render <png>]
    blender --background --python scripts/blender/drone/run_cli.py -- export
    blender --background --python scripts/blender/drone/run_cli.py -- render <png>   （打开已保存的 park.blend 再渲染）
结果（统计信息）打印成一行 JSON，前缀 "RESULT "。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
cmd = argv[0] if argv else "build"
out = {}
if cmd == "build":
    import drone.build as b

    render = argv[argv.index("--render") + 1] if "--render" in argv else None
    out = b.run(render_to=render)
elif cmd == "export":
    import drone.build as b
    import drone.export as e

    blend = os.path.join(b.MODEL_DIR, "park.blend")
    if os.path.exists(blend) and not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=blend)
    out = e.export()
elif cmd == "render":
    import drone.build as b
    import drone.preview as p

    bpy.ops.wm.open_mainfile(filepath=os.path.join(b.MODEL_DIR, "park.blend"))
    out = {"png": p.render(argv[1])}
print("RESULT " + json.dumps(out, ensure_ascii=False, default=str))
