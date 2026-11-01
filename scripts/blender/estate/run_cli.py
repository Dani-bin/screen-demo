"""
澜岸云境沙盘 · Blender 命令行入口（不开 Blender 界面、不依赖 MCP 插件）
----------------------------------------------------------
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- build [--render <png>]
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- restored [--samples 48] [--render <png>]
        （还原页的住宅楼栋 B01–B16：按 footprints.json 建模 + 顶点 AO + 导出 public/estate/img2/buildings_bl.glb）
    blender --background --python scripts/blender/estate/run_cli.py -- render <png> [--cam x,y,z,tx,ty,tz,fov] [--size 1920x1080]
    blender --background --python scripts/blender/estate/run_cli.py -- bake [--samples 64] [--size 4096]
    blender --background --python scripts/blender/estate/run_cli.py -- export
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- photo [--only a,b] [--samples 128] [--orbit-samples 96] [--force]
        （照片模式整套：4 档光照主视图、8 个近景、12 帧环绕、楼栋遮罩，输出到 models/estate/render/photo/，已有的跳过）
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- cycles <png> [--lit 0.55] [--samples 64] [--w 960] [--h 540] [--fstop 0.012] [--exp 0]
        （Cycles 离线渲染主视图，需要先跑 scripts/estate/export_for_blender.mjs 导出页面数据）
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
elif cmd == "restored":
    import estate.restored as rs

    out = rs.run(render_to=opt("--render"), samples=int(opt("--samples", 48)))
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
elif cmd == "cycles":
    import estate.render as r

    out = r.build_and_render(
        argv[1],
        lit=float(opt("--lit", 0.55)),
        samples=int(opt("--samples", 64)),
        width=int(opt("--w", 960)),
        height=int(opt("--h", 540)),
        fstop=float(opt("--fstop", 0.012)),
        exposure=float(opt("--exp", 0.0)),
    )
elif cmd == "photo":
    import estate.photo as ph

    only = set(opt("--only").split(",")) if opt("--only") else None
    out = ph.render_all(
        samples=int(opt("--samples", 128)),
        orbit_samples=int(opt("--orbit-samples", 96)),
        only=only,
        force="--force" in argv,
    )
elif cmd == "export":
    import estate.export as e

    _open()
    out = e.export()
print("RESULT " + json.dumps(out, ensure_ascii=False, default=str))
