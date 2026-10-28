"""
井上地面输送 · 103 机头建模 · 命令行入口（不开 Blender 界面、不依赖 MCP 插件）
----------------------------------------------------------
    blender --background --factory-startup --python scripts/blender/coal_prep/run_cli.py -- build [--render <png>] [--cycles]
    blender --background --python scripts/blender/coal_prep/run_cli.py -- render <png> [--cycles]   （打开已保存的 conveyor.blend 再渲染）
    blender --background --python scripts/blender/coal_prep/run_cli.py -- bake [--size 4096] [--samples 256]
    blender --background --python scripts/blender/coal_prep/run_cli.py -- export
    blender --background --python scripts/blender/coal_prep/run_cli.py -- bg     （打开已烘焙的 conveyor.blend：只重建远景 BG 集合、同步材质参数，保存后导出；不用重新烘焙）
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
engine = "cycles" if "--cycles" in argv else "eevee"
out = {}


def _open():
    import coal_prep.build as b

    blend = os.path.join(b.MODEL_DIR, "conveyor.blend")
    if not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=blend)


if cmd == "build":
    import coal_prep.build as b

    out = b.run(render_to=opt("--render"), engine=engine)
elif cmd == "render":
    import coal_prep.preview as p

    _open()
    p.setup(engine)
    out = {"png": p.render(argv[1])}
elif cmd == "bake":
    import coal_prep.bake as k

    _open()
    out = k.bake(size=int(opt("--size", 4096)), samples=int(opt("--samples", 256)))
elif cmd == "bg":
    import coal_prep.export as e
    import coal_prep.layout as layout
    import coal_prep.palette as palette

    import coal_prep.lib as lib

    _open()
    lib.KEEP_IMAGES = True
    M = palette.build()  # 同名材质已存在：只同步颜色 / 金属度 / 粗糙度
    bg = bpy.data.collections["BG"]
    for ob in list(bg.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    layout.build_background(bg, M)
    bpy.ops.wm.save_mainfile()
    out = e.export()
elif cmd == "export":
    import coal_prep.export as e

    _open()
    out = e.export()
print("RESULT " + json.dumps(out, ensure_ascii=False, default=str))
