"""
命令行入口（无界面 Blender）：
    F:/blander/blender.exe -b --factory-startup -P scripts/blender/shiyan_energy/run.py -- [选项]

选项：
    --render <png>      出图路径（不给则只建模型）
    --samples <n>       Cycles 采样数（默认 192）
    --res <宽>x<高>      分辨率（默认 2560x1440）
    --view <名字>        相机机位，见 build.VIEWS（默认 main）
    --save <blend>      另存 .blend（默认 models/shiyan-energy/station.blend，models/ 不入库）
    --test-mats         只建材质（检查节点 API）
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # scripts/blender

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


import shiyan_energy.build as build  # noqa: E402
import shiyan_energy.lib as lib  # noqa: E402
import shiyan_energy.mats as mats  # noqa: E402

if "--test-mats" in argv:
    lib.clear_scene()
    print("MATS_OK", len(mats.build()))
else:
    w, h = (int(x) for x in arg("--res", "2560x1440").split("x"))
    build.run(render_to=arg("--render"), samples=int(arg("--samples", "192")), res=(w, h),
              view=arg("--view", "main"), save=arg("--save", ""))
