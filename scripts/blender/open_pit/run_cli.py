"""青原露天矿 · 命令行入口（不开 Blender 界面、不动你正在用的窗口）
----------------------------------------------------------
    blender --background --factory-startup --python scripts/blender/open_pit/run_cli.py -- build
    blender --background --factory-startup --python scripts/blender/open_pit/run_cli.py -- bake [--samples 128] [--only pit_floor,ground]
    blender --background --factory-startup --python scripts/blender/open_pit/run_cli.py -- project [--only pit_terraces] [--scale 0.5]
    blender --background --factory-startup --python scripts/blender/open_pit/run_cli.py -- export
bake = 重建（发光压低）→ 烘焙成 models/open-pit/bake/*.png（--scale 0.25 可以小尺寸快速试烘）；
project = 重建 → 台阶 / 排土场投影设计稿，和 bake/<name>.png 混合后烘成 bake/<name>_proj.png（project.py）；
export = 重建 → 用 bake/*.png（有 _proj 的优先用 _proj）替换程序化材质 → 导出 public/open-pit/pit.glb（不动你窗口里的 open-pit.blend）。
结果打印成一行 JSON，前缀 "RESULT "。
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

import open_pit.build as build  # noqa: E402

out = {}
if cmd in ("build", "bake", "export", "project"):
    # bake：烘焙时的发光压低（bake_mode）；export：用烘焙贴图 + 正常发光强度
    out["build"] = build.run(view=False, use_baked=(cmd == "export"), bake_mode=(cmd == "bake"))
if cmd == "bake":
    import open_pit.bake as k

    only = opt("--only")
    out["bake"] = k.bake(names=only.split(",") if only else None, samples=int(opt("--samples", 128)), scale=float(opt("--scale", 1.0)))
elif cmd == "project":
    # 台阶 / 排土场投影设计稿：要先跑过 bake（用 bake/<name>.png 做背对 / 被挡部分），写 bake/<name>_proj.png
    import open_pit.project as pj

    only = opt("--only")
    out["project"] = pj.project(names=only.split(",") if only else None, scale=float(opt("--scale", 1.0)))
elif cmd == "export":
    import open_pit.export as e

    out["export"] = e.export()
print("RESULT " + json.dumps(out, ensure_ascii=False))
