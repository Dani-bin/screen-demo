"""
澜岸云境沙盘 · Blender 命令行入口（不开 Blender 界面、不依赖 MCP 插件）
----------------------------------------------------------
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- build [--render <png>]
    blender --background --python scripts/blender/estate/run_cli.py -- render <png> [--cam x,y,z,tx,ty,tz,fov] [--size 1920x1080]
    blender --background --python scripts/blender/estate/run_cli.py -- bake [--samples 64] [--size 4096]
    blender --background --python scripts/blender/estate/run_cli.py -- export
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
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731
out = {}


def _open():
    import estate.lib as lib

    if not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=os.path.join(lib.MODEL_DIR, "estate.blend"))


if cmd == "build":
    import estate.build as b

    out = b.run(render_to=opt("--render"))
elif cmd == "render":
    import estate.preview as p

    _open()
    cam = None
    c = opt("--cam")
    if c:
        v = [float(x) for x in c.split(",")]
        cam = ((v[0], v[1], v[2]), (v[3], v[4], v[5]), v[6])
    w, h = (int(x) for x in opt("--size", "1920x1080").split("x"))
    out = {"png": p.render(argv[1], w, h, cam)}
elif cmd == "bake":
    import estate.bake as k

    _open()
    out = k.bake(samples=int(opt("--samples", 64)), size=int(opt("--size", 4096)))
elif cmd == "export":
    import estate.export as e

    _open()
    out = e.export()
print("RESULT " + json.dumps(out, ensure_ascii=False, default=str))
