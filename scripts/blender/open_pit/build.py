"""青原露天矿 · Blender 建模入口（在打开的 Blender 里通过 MCP 运行，也能 --background）
----------------------------------------------------------
    import sys; sys.path.insert(0, "<repo>/scripts/blender"); import open_pit.build as b; b.run()
所有东西都建在 OPENPIT 集合里，重跑会先清掉这个集合再重建；默认的 Cube / Camera / Light 不动（Cube 只在视口里隐藏）。
相机 DesignCam 是设计稿相机（camera.py），视口切到相机视角并叠上设计稿底图，可以直接看建出来的模型和设计稿对得上不上。
"""
import importlib
import os

import bpy
import numpy as np
from mathutils import Vector

from . import camera as cam
from . import materials as M
from . import pit as pitmod
from . import props as PR
from . import routes
from . import sites

importlib.reload(cam)
importlib.reload(pitmod)
importlib.reload(M)
importlib.reload(PR)
importlib.reload(routes)
importlib.reload(sites)

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(REPO, "models", "open-pit")
DESIGN_IMG = os.path.join(REPO, "docs", "design", "open-pit", "design", "src", "scene-a1.png")
COL = "OPENPIT"


def _clear():
    col = bpy.data.collections.get(COL)
    if col:
        for o in list(col.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(col)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        if m.name.startswith("op_") and m.users == 0:
            bpy.data.materials.remove(m)


def _collection():
    col = bpy.data.collections.new(COL)
    bpy.context.scene.collection.children.link(col)
    return col


def material(name, color, rough=0.9, emit=None, emit_strength=0.0, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    # 按类型找节点：中文界面里节点名不是 "Principled BSDF"
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    m.diffuse_color = (*color, 1)  # 实体着色视口里也看得到颜色
    return m


def mesh_obj(name, V, F, col, mats=None, face_mat=None, uv=None, loop_uv=None, smooth=False):
    """numpy 顶点 / 面 → 网格物体；face_mat 是每个面的材质槽下标；loop_uv 是每个面各个角的 (u, v)（按面的顶点顺序）"""
    me = bpy.data.meshes.new(name)
    # 面可能是四边形和三角形混着（土堆顶面是扇形），所以不把 F 转成 numpy 数组
    me.from_pydata(np.asarray(V, float).tolist(), [], [tuple(int(i) for i in f) for f in F])
    me.update()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    for m in mats or []:
        me.materials.append(m)
    if face_mat is not None:
        me.polygons.foreach_set("material_index", np.asarray(face_mat, np.int32))
    if loop_uv is not None:
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", np.asarray([c for f in loop_uv for c in f], float).ravel())
    if uv is not None:
        layer = me.uv_layers.new(name="UVMap")
        loops = np.array([l.vertex_index for l in me.loops])
        layer.data.foreach_set("uv", np.asarray(uv, float)[loops].ravel())
    for p in me.polygons:
        p.use_smooth = smooth
    return o


def design_material():
    """地表 / 坑底的投影贴图材质：设计稿场景图（擦掉卡车和设备，scripts/open-pit/plate.py 生成），名字以 baked_ 开头，
    页面 GlbScene 把它当「自带光照的贴图」显示（不再受光）；贴图超出范围时取边缘（边缘是暗色地面）"""
    path = os.path.join(MODEL_DIR, "design_ground.png")
    m = bpy.data.materials.get("baked_design") or bpy.data.materials.new("baked_design")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.image.colorspace_settings.name = "sRGB"
    tex.extension = "EXTEND"
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    return m


def build_camera(col):
    C, fwd, _, _ = cam.pose()
    data = bpy.data.cameras.new("DesignCam")
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24.0
    data.lens = 12.0 / np.tan(np.radians(cam.VFOV) / 2)
    data.clip_start = 20
    data.clip_end = 60000
    o = bpy.data.objects.new("DesignCam", data)
    col.objects.link(o)
    o.location = Vector(C.tolist())
    o.rotation_euler = Vector(fwd.tolist()).to_track_quat("-Z", "Y").to_euler()
    sc = bpy.context.scene
    sc.camera = o
    sc.render.resolution_x, sc.render.resolution_y = cam.W, cam.H
    sc.render.resolution_percentage = 100
    # 设计稿作相机背景，半透明叠在模型上
    if os.path.exists(DESIGN_IMG):
        data.show_background_images = True
        for b in list(data.background_images):
            data.background_images.remove(b)
        bg = data.background_images.new()
        bg.image = bpy.data.images.load(DESIGN_IMG, check_existing=True)
        bg.alpha = 0.5
        bg.frame_method = "STRETCH"
    return o


def to_camera_view():
    """把第一个 3D 视口切到相机视角、实体着色（按材质颜色），并放宽裁剪面"""
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type != "VIEW_3D":
                continue
            sp = area.spaces.active
            sp.region_3d.view_perspective = "CAMERA"
            sp.shading.type = "RENDERED"
            sp.clip_end = 60000
            sp.overlay.show_floor = False
            sp.overlay.show_axis_x = sp.overlay.show_axis_y = False
            return True
    return False


# cli-anything-blender 建的设备（scripts/open-pit/cli/equipment.py）按真实尺寸建，场景里放大到总览看得见的大小
CLI_SCALE = {
    "shovel": 3.2,
    "truck": 2.4,
    "bucket_wheel": 3.4,
    "crusher": 2.4,
    "swap_station": 3.0,
    "radar_tower": 1.8,
    "cooling_tower": 1.25,
    "chimney": 1.25,
    "plant_blocks": 1.25,
}


TRUCK_MASTER = os.path.join(MODEL_DIR, "truck", "VH_HaulTruck_master.blend")
TRUCK_SCALE = 2.6  # 真实 9.4 m 长的车在总览 3.5 km 外只有 4–5 px，放大到和电铲同一量级（cli 矿卡是 2.4 倍）


def truck_template(col, P):
    """从矿卡母文件追加交付网格（车身 / 货堆 / 车灯），挂到空物体 truck_template 下（地面以下 400 m，页面里按它实例化）。
    车身材质换成场景调色板里同名的那套（op_white 页面按状态给实例色）；op_cargo / op_headlamp 页面按名字识别。"""
    if not os.path.exists(TRUCK_MASTER):
        return False
    names = {"VH_HaulTruck_LOD0": "truck_body", "VH_HaulTruck_Cargo": "truck_cargo", "VH_HaulTruck_Lamps": "truck_lamps"}
    with bpy.data.libraries.load(TRUCK_MASTER, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    root = bpy.data.objects.new("truck_template", None)
    col.objects.link(root)
    root.location = (0.0, 0.0, -400.0)
    root.scale = (TRUCK_SCALE,) * 3
    root.rotation_euler = (0.0, 0.0, float(np.pi))  # 车模按建模规范车头朝 -Y；页面（GlbScene._truckParts）沿用旧车模的车头朝 +Y
    for o in dst.objects:
        if o is None:
            continue
        o.name = names.get(o.name.split(".")[0], o.name)
        col.objects.link(o)
        o.parent = root
        me = o.data
        for i, m in enumerate(me.materials):
            key = m.name.split(".")[0].replace("op_", "") if m else ""
            if key in P:
                me.materials[i] = P[key]
            elif m and "." in m.name:
                m.name = m.name.split(".")[0]
    return True


def equipment(col, p, anchors):
    """按设计稿像素位置摆设备（落到对应台阶高度上）；电铲朝向坑壁（背向坑中心）。
    每种设备优先用 cli-anything-blender 建的网格（同类设备共用一份网格数据，GLB 里也只存一份），缺文件时退回 props.py 的方块模型。"""
    from . import cli_models

    P = PR.palette()
    cx, cy = p.center
    meshes = {}

    def cli_mesh(model):
        if model not in meshes:
            meshes[model] = cli_models.load_mesh(model, P) if cli_models.available(model) else None
        return meshes[model]

    def put(model, name, loc, yaw=0.0, scale=None, fallback=None):
        """放一台设备：有工具建的网格就用它（放大 CLI_SCALE 倍），否则调用 fallback()"""
        me = cli_mesh(model)
        if me is None:
            return fallback() if fallback else None
        o = bpy.data.objects.new(name, me)
        col.objects.link(o)
        o.location = loc
        o.rotation_euler = (0, 0, yaw)
        k = CLI_SCALE.get(model, 1.0)
        o.scale = scale or (k, k, k)
        return o

    def away(x, y, jitter=0.0):
        """朝向 = 从坑中心指向设备（吊臂伸向坑壁），yaw 使局部 +Y 对齐该方向"""
        dx, dy = x - cx, y - cy
        return float(np.arctan2(-dx, dy)) + jitter

    ground = lambda ix, iy: tuple(float(v) for v in (*cam.backproject([(ix, iy)], 0.0)[0], 0.0))  # noqa: E731

    jit = {"ES-01": 0.3, "ES-02": -0.4, "ES-03": 0.2, "ES-04": -0.2, "ES-05": 0.5, "ES-06": 0.7, "ES-07": -0.6}
    st = sites.Sites()
    for k, j in jit.items():
        # 标签锚点是设计稿标签点在台阶面上的落点（可能在陡坎斜面上）；电铲模型放到最近平台上靠坡脚处（电铲挖的是它面前的陡坎）
        x, y, z = st.on_platform(*p.place(anchors[k])[:2], f_plat=0.15)
        put("shovel", k, (x, y, z), away(x, y, j), fallback=lambda k=k, x=x, y=y, z=z, j=j: PR.shovel(P, k, col, (x, y, z), away(x, y, j)))
    x, y, z = p.place(anchors["CR-02"])
    put("crusher", "CR-02", (x, y, z), away(x, y), scale=(1.9, 1.9, 1.9), fallback=lambda: PR.crusher(P, "CR-02", col, (x, y, z), away(x, y)))
    x1, y1, z1 = p.place(anchors["CR-01"])
    put("crusher", "CR-01", (x1, y1, z1), 0.0, scale=(3.4, 3.4, 3.4), fallback=lambda: PR.crusher(P, "CR-01", col, (x1, y1, z1), 0.0))  # 设计稿里是一座多层亮灯的大钢构
    put("bucket_wheel", "BW-01", ground(940, 122), 0.0, fallback=lambda: PR.bucket_wheel(P, "BW-01", col, ground(940, 122), 0.0))
    # 边坡雷达塔（设计稿里塔顶在 y≈160 / 55 / 150，塔脚往下约 90 px）
    for k, pt in {"SR-01": (497, 248), "SR-02": (712, 143), "SR-03": (1297, 243)}.items():
        put("radar_tower", k, ground(*pt), fallback=lambda k=k, pt=pt: PR.radar_tower(P, k, col, ground(*pt)))
    for k in ("SW-01", "SW-02"):
        put("swap_station", k, ground(*anchors[k]), 0.0, fallback=lambda k=k: PR.swap_station(P, k, col, ground(*anchors[k]), 0.0))
    # 电厂：冷却塔 ×2（第 18 轮改成 equip.py 里的双曲线塔，按真实尺寸放，不再放大）、烟囱 ×2、厂房群
    from . import equip

    importlib.reload(equip)
    b_ = PR.Builder()
    equip.cooling_tower(b_, P)
    tower = b_.finish("_proto_tower", col)
    tower_me = tower.data
    tower_me.name = "eq_cooling_tower"
    bpy.data.objects.remove(tower, do_unlink=True)
    for k, pt in {"PP-01-T1": (1343, 690), "PP-01-T2": (1421, 677)}.items():  # 塔底中心（设计稿 3× 放大读的）
        o = bpy.data.objects.new(k, tower_me)
        col.objects.link(o)
        o.location = ground(*pt)
    for k, pt in {"PP-01-C1": (1445, 742), "PP-01-C2": (1492, 718)}.items():  # 烟囱底座（设计稿 10× 放大读的）
        put("chimney", k, ground(*pt), fallback=lambda k=k, pt=pt: PR.chimney(P, k, col, ground(*pt)))
    # 厂房群（第 18 轮改成 equip.py 的电厂主厂区，真实尺寸）：设计稿里厂房在冷却塔东南、烟囱脚下，约 (1450, 745)
    b_ = PR.Builder()
    equip.power_plant(b_, P)
    b_.finish("PP-01", col, ground(1452, 748), 0.0, 1.0)
    # 封闭煤场（第 18 轮改成 equip.py 的高拱棚）：设计稿里脊线从 (1217, 667) 到 (1380, 710)，拱高 62 m 投影约 32 px，
    # 所以地面上的轴线约从 (1212, 698) 到 (1382, 742)
    a0, a1 = np.array(ground(1212, 698)[:2]), np.array(ground(1382, 742)[:2])
    mid, d = (a0 + a1) / 2, a1 - a0
    length = float(np.hypot(*d)) * 1.02
    yaw = float(np.arctan2(-d[0], d[1]))
    b_ = PR.Builder()
    equip.barn(b_, P, length)
    b_.finish("CY-01", col, (float(mid[0]), float(mid[1]), 0.0), yaw, 1.0)
    # 输煤走廊：工具建的是 40 m 一节，沿走廊折线一节一节铺（每段等分成整数节，节长略微拉伸）
    belt = [ground(*q) for q in ((850, 585), (1010, 622), (1110, 650), (1205, 693))]
    if cli_mesh("belt_segment"):
        n_seg = 0
        for a, b in zip(belt[:-1], belt[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            seg_len = float(np.hypot(dx, dy))
            n = max(1, int(round(seg_len / 40.0)))
            for i in range(n):
                t = (i + 0.5) / n
                name = "BC-02" if n_seg == 0 else f"BC-02-{n_seg}"
                # 宽度放大 3.4 倍、高 2.4 倍：设计稿里输煤廊是一条约 14 px 粗的发光管（第 18 轮评审：原来 2.2 倍只是一根细管）
                put("belt_segment", name, (a[0] + dx * t, a[1] + dy * t, 0.0), float(np.arctan2(-dx, dy)), scale=(3.4, seg_len / n / 40.0, 2.4))
                n_seg += 1
    else:
        PR.belt_corridor(P, "BC-02", col, belt)
    # 光伏板阵列：西侧排土场坡面上（工具没做，仍用 props.py）
    PR.pv_field(P, "PV-01", col, (*cam.backproject([(40, 345)], 40.0)[0].tolist(), 40.0), 0.2)
    # 卡车模板：放在地面以下（页面里实例化 100 份）。2026-11-03 第 19 轮起用 blender-image-to-3d 按用户给的无人矿卡照片建的
    # VH_HaulTruck（scripts/blender/open_pit/truck/，母文件 models/open-pit/truck/VH_HaulTruck_master.blend）；没有母文件时退回 cli 工具的方块矿卡
    if not truck_template(col, P):
        put("truck", "truck_template", (0.0, 0.0, -400.0), fallback=lambda: PR.truck(P, "truck_template", col, (0.0, 0.0, -400.0)))
    # 设计稿里没画的其余设备（钻机、推土机、洒水车、巡检车、5G 基站、变电站、充电区、调度中心、办公区、水处理站、卸载点、两条皮带）：
    # 在 Blender 里直接建模（equip.py），位置来自 sites.py
    from . import equip

    importlib.reload(equip)
    return equip.place_all(col, P)


def run(view=True, use_baked=False, bake_mode=False):
    _clear()
    col = _collection()
    cube = bpy.data.objects.get("Cube")
    if cube:
        cube.hide_set(True)

    p = pitmod.Pit()
    anchors = cam.outline()["anchors"]
    # 坑底暖光池：坑底几台电铲 / 破碎站脚下
    pools = []
    for k in ("ES-06", "ES-07", "CR-02", "ES-02"):
        x, y = cam.backproject([anchors[k]], -cam.DEPTH)[0]
        pools.append(((float(x), float(y), -cam.DEPTH), 55.0))
    rock = M.rock_platform("op_rock")
    wall = M.rock_wall("op_wall", bench=cam.BENCH)
    coal = M.pit_floor(pools, strength=0.9)
    ground = M.ground()  # 不带网格（网格另用真几何）

    V, F, LUV, kind = p.terraces()
    # 坡道 / 出坑段 / 端帮皮带槽切进台阶（carve.py）：近景里路不再悬在陡坎上
    from . import carve

    importlib.reload(carve)
    V, n_carved = carve.carve(V, p)
    mesh_obj("pit_terraces", V, F, col, [rock, wall], face_mat=kind, loop_uv=LUV)
    # 坑底和坑外地表：贴设计稿（平面投影，换角度看也不拉伸）；台阶坑壁仍是程序化材质烘焙
    dmat = design_material()
    FV, FF, FUV = pitmod.floor_design(p)
    mesh_obj("pit_floor", FV, FF, col, [dmat], loop_uv=FUV)
    DGV, DGF, DGUV = pitmod.ground_design(p)
    dg = mesh_obj("ground_design", DGV, DGF, col, [dmat], loop_uv=DGUV)
    dg.hide_render = bake_mode  # 烘焙大地面时别让它挡住天光（它浮在地面上方 1.5 m）
    GV, GF, GUV = p.ground()
    mesh_obj("ground", GV, GF, col, [ground], loop_uv=GUV)
    # 地面网格线不再单独建：设计稿投影贴图里已经有了（单独的发光线在总览里成了贯穿画面的长直线）
    # 平台上的发光道路和每级沿口的亮边线（青色自发光）
    # 烘焙时把道路 / 亮边线的发光压低：它们会把青色光溢到岩壁上，整片岩壁被染成青绿（设计稿里岩壁是深蓝灰、只有线是亮的）
    # 2026-11-03 第 17 轮：原来每级平台一整圈路 + 一圈沿口线，十级就是二十多条亮线，读起来像等高线地图；
    # 设计稿北帮的亮度均值和我们一样（42.6 / 42.5），但我们是「近黑岩面 + 很亮的线」（标准差 34 vs 17.6）。
    # 现在路只画卡车真正走的那几段（七条运输路线，平台环路 + 斜坡 + 出坑），沿口线每级一条且再压暗
    # 第 18 轮评审：每级沿口的青线仍读成等高线 → 沿口线压到很暗（台阶层次靠岩壁坎顶亮、坡脚暗来分），
    # 运输道路改成设计稿的样子：暗的路面 + 两条亮边线
    # 路面：浅灰蓝的碎石路（第 19 轮：原来是很暗的青色带，转到背光面看「路面看不清、一坨黑」）；两条边线仍是亮青
    road = M.emissive("op_road", (0.42, 0.6, 0.68), 0.05 if bake_mode else 0.3)
    road_edge = M.emissive("op_road_edge", (0.2, 0.9, 1.0), 0.1 if bake_mode else 0.42)
    edge = M.emissive("op_edge", (0.2, 0.9, 1.0), 0.03 if bake_mode else 0.07)
    EV, EF = pitmod.crests(p)
    mesh_obj("pit_edges", EV, EF, col, [edge])
    lines = routes.ribbon_polylines(all_kinds=True)
    # 路面宽 22 m：矿卡放大 2.6 倍后车宽约 9.4 m，原来 9 m 的路比车还窄（第 20 轮）
    RPV, RPF = pitmod.polyline_ribbons(lines, width=22.0)
    mesh_obj("pit_ramps", RPV, RPF, col, [road])
    for side, off in (("L", 11.0), ("R", -11.0)):
        LV, LF = pitmod.polyline_ribbons(pitmod.offset_polylines(lines, off), width=2.6, lift=0.6)
        mesh_obj(f"pit_road_edge_{side}", LV, LF, col, [road_edge])
    RF = RPF
    # 排土场：阶梯土堆（西侧大的、东侧小的）
    dump = M.rock_platform("op_dump", tint=(1.0, 1.1, 1.0))
    dump_wall = M.rock_wall("op_dump_wall")
    mound_edge = M.emissive("op_edge_dump", (0.2, 0.9, 1.0), 0.1 if bake_mode else 0.35)
    for name, d in pitmod.DUMPS.items():
        g = pitmod.dump_ground(name)  # 底面轮廓已推出坑沿
        DV, DF, kind, DUV = pitmod.mound(g, d["height"], d["n"])
        mesh_obj(name, DV, DF, col, [dump, dump_wall, dump], face_mat=kind, loop_uv=DUV)
        MV, MF = pitmod.polyline_ribbons(pitmod.mound_loops(g, d["height"], d["n"]), width=2.0, lift=0.5)
        mesh_obj(name + "_edges", MV, MF, col, [mound_edge])
    # 夜景天空和一盏很弱的冷色日光
    sun = M.world_and_lights()
    so = bpy.data.objects.get("op_sun") or bpy.data.objects.new("op_sun", sun)
    if so.name not in col.objects:
        col.objects.link(so)
    so.rotation_euler = (np.radians(60), 0, 0)  # 日光从南面（相机一侧）低角度照来：坑北侧陡坎受光、南侧背光，和设计稿一致
    # 北面来的冷色补光（第 19 轮）：北帮投影了设计稿，南帮朝北的陡坎背光、只有程序化岩石，原来几乎全黑，
    # 用户转过去看「一坨黑的，岩壁也分不清」；补光强度是主光的一半，只为分出岩面层次
    fill = bpy.data.lights.get("op_fill") or bpy.data.lights.new("op_fill", "SUN")
    fill.energy = 0.7
    fill.color = (0.55, 0.72, 1.0)
    fill.angle = 0.1
    fo = bpy.data.objects.get("op_fill") or bpy.data.objects.new("op_fill", fill)
    if fo.name not in col.objects:
        col.objects.link(fo)
    fo.rotation_euler = (np.radians(-50), 0, np.radians(20))
    n_extra = equipment(col, p, anchors)
    build_camera(col)

    if use_baked:
        # 用烘焙好的贴图替换程序化材质（bake.py 的输出）：导出 GLB 必须走这条
        from . import bake as BK

        from . import project as PJ

        importlib.reload(PJ)
        for name in BK.TARGETS:
            f = os.path.join(BK.BAKE_DIR, name + ".png")
            if os.path.exists(f):
                img = bpy.data.images.load(f, check_existing=True)
                img.colorspace_settings.name = "sRGB"
                obj = bpy.data.objects[name]
                if name in PJ.TARGETS and os.path.exists(PJ.PIT_IMG):
                    # 台阶 / 排土场：程序化烘焙 + 设计稿投影两张贴图都带上，页面按镜头距离混合（project.apply_dual）
                    PJ.apply_dual(obj, img)
                else:
                    BK._apply_baked(obj, img)

    info = {
        "rim_m": [round(float(np.ptp(p.rim_g[:, 0])), 0), round(float(np.ptp(p.rim_g[:, 1])), 0)],
        "center": [round(float(v), 1) for v in p.center],
        "tris": len(F) + len(FF) + len(GF) + len(RF) + len(EF),
        "extra_devices": n_extra,
        "carved_verts": n_carved,
    }
    if view:
        info["view"] = to_camera_view()
    os.makedirs(MODEL_DIR, exist_ok=True)
    return info
