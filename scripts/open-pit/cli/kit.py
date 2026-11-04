"""cli-anything-blender 建模的公共部分：每台设备一个工程（models/open-pit/cli/<name>.blend-cli.json），
统一的 8 种材质（名字和 Blender 构建里的调色板一一对应：scripts/blender/open_pit/props.py 的 palette），
部件 / 梁 / 预览 / 导出 bpy 脚本的封装。所有操作都是这个工具的命令（subprocess 调用），工程文件可以用工具本身继续编辑。

坐标约定：+Y 朝前，+Z 向上，原点在设备底面中心，单位米，按真实尺寸建（场景里再整体放大）。
"""
import json
import math
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "models" / "open-pit" / "cli"

v3 = lambda t: ",".join(f"{x:g}" for x in t)  # noqa: E731

# 材质：(颜色, 金属度, 粗糙度, 自发光颜色, 自发光强度)；名字必须和 Blender 构建的调色板同名
MATERIALS = {
    "steel": ((0.2, 0.33, 0.46), 0.35, 0.45, None, 0),
    "dark": ((0.04, 0.06, 0.08), 0.3, 0.7, None, 0),
    "white": ((0.62, 0.7, 0.76), 0.1, 0.5, None, 0),
    "concrete": ((0.3, 0.38, 0.45), 0.0, 0.8, None, 0),
    "cyan": ((0.05, 0.4, 0.5), 0.0, 0.4, (0.1, 0.8, 1.0), 6.0),
    "amber": ((0.4, 0.2, 0.05), 0.0, 0.4, (1.0, 0.55, 0.12), 12.0),
    "red": ((0.5, 0.08, 0.08), 0.0, 0.4, (1.0, 0.18, 0.2), 4.0),
    "glass": ((0.1, 0.2, 0.25), 0.0, 0.2, (0.45, 0.8, 0.95), 2.0),
}


class Model:
    def __init__(self, name):
        self.name = name
        self.P = OUT / f"{name}.blend-cli.json"
        self.mats = {}

    def cli(self, *args, json_out=True):
        # 新建工程时不能带 --project（它会先去打开还不存在的文件）
        proj = [] if args[:2] == ("scene", "new") else ["--project", str(self.P)]
        # 让工具启动的 Blender 用出厂设置：本机 Blender 是中文界面并开了「翻译新建数据名称」，新建材质的节点叫「原理化 BSDF」，
        # 工具生成的脚本按英文名 "Principled BSDF" 找节点，找不到就不设颜色 / 自发光（预览全是灰的）。指向空的配置目录即可，不改用户的 Blender
        cfg = OUT / "blender-config"
        cfg.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "BLENDER_USER_CONFIG": str(cfg)}
        cmd = ["cli-anything-blender", *(["--json"] if json_out else []), *proj, *map(str, args)]
        r = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            raise RuntimeError(f"cli-anything-blender {' '.join(map(str, args))}\n{r.stderr}{r.stdout}")
        if not json_out:
            return r.stdout
        try:
            return json.loads(r.stdout)
        except json.JSONDecodeError:
            return r.stdout

    def new(self):
        OUT.mkdir(parents=True, exist_ok=True)
        if self.P.exists():
            self.P.unlink()
        self.cli("scene", "new", "-o", self.P)
        for name, (color, metal, rough, emit, strength) in MATERIALS.items():
            mid = self.cli("material", "create", "-n", name, "-c", v3((*color, 1.0)), "--metallic", metal, "--roughness", rough)["id"]
            if emit:
                self.cli("material", "set", mid, "emission_color", v3((*emit, 1.0)))
                self.cli("material", "set", mid, "emission_strength", strength)
            self.mats[name] = mid
        return self

    def part(self, kind, name, loc, half=(1, 1, 1), rot=(0, 0, 0), m="steel", params=None, bevel=None):
        """一个基本体部件：立方体默认边长 2 m，所以 half 就是半尺寸；圆柱 / 圆锥 / 圆环的尺寸用 params 给、half 当缩放；rot 是角度（度）"""
        args = ["object", "add", kind, "-n", name, "-l", v3(loc), "-s", v3(half), "-r", v3(rot)]
        for k, v in (params or {}).items():
            args += ["-p", f"{k}={v}"]
        oid = self.cli(*args)["id"]
        self.cli("material", "assign", self.mats[m], oid)
        if bevel:
            self.cli("modifier", "add", "bevel", "-o", oid, "-p", f"width={bevel}", "-p", "segments=2")
        return oid

    def array(self, oid, count, offset):
        """阵列修改器：offset 是 (x, y, z) 相对偏移（物体自身尺寸的倍数，沿物体局部轴）"""
        self.cli("modifier", "add", "array", "-o", oid, "-p", f"count={count}", "-p", f"relative_offset_x={offset[0]}", "-p", f"relative_offset_y={offset[1]}", "-p", f"relative_offset_z={offset[2]}")

    def beam(self, name, a, b, thick, m="steel"):
        """任意两点之间的一根方梁：立方体沿局部 Y 拉长，再绕 X 抬起、绕 Z 转向。
        Blender 的 XYZ 欧拉角先转 X 再转 Z：局部 +Y → (−sinθz·cosθx, cosθz·cosθx, sinθx)，所以 θx = atan2(dz, 水平长度)、θz = atan2(−dx, dy)"""
        dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        rx = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
        rz = math.degrees(math.atan2(-dx, dy))
        c = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
        return self.part("cube", name, c, (thick / 2, length / 2, thick / 2), (rx, 0, rz), m)

    def finish(self, cam_loc, cam_target, focal=35):
        """预览用的相机（看向 cam_target）+ 灯光；导出工具生成的 bpy 脚本供 Blender 构建截取建模部分"""
        dx, dy, dz = cam_target[0] - cam_loc[0], cam_target[1] - cam_loc[1], cam_target[2] - cam_loc[2]
        # 相机默认朝 −Z：绕 X 转 (90° − 俯角) 再绕 Z 转到方位
        pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
        yaw = math.degrees(math.atan2(-dx, dy))
        self.cli("camera", "add", "-n", "cam", "-l", v3(cam_loc), "-r", v3((90 + pitch, 0, yaw)), "-f", focal, "--active")
        self.cli("light", "add", "sun", "-n", "sun", "-r", v3((50, 0, 30)), "-w", 2.5, "-c", v3((0.75, 0.85, 1.0)))
        self.cli("light", "add", "area", "-n", "fill", "-l", v3((cam_loc[0] * -0.6, cam_loc[1] * -0.6, cam_loc[2])), "-w", 20000, "-c", v3((0.4, 0.6, 1.0)))
        script = self.cli("render", "script", OUT / f"{self.name}_render.png", json_out=False)
        (OUT / f"{self.name}_build.py").write_text(script, encoding="utf-8")
        return self

    def preview(self):
        """工具自带的 quick 预览（Eevee + Workbench 两张），返回 hero.png 路径；要在 Claude 沙盒外跑（会启动 Blender）"""
        r = self.cli("preview", "capture", "--recipe", "quick", "--force", "--root-dir", OUT / "preview" / self.name)
        return str(Path(r["_bundle_dir"]) / "artifacts" / "hero.png")
