"""
老家沙盘建模 · 效果图增强（只用于出图，放在 PREVIEW 集合，不导出到 GLB）
----------------------------------------------------------
用几何节点在地面上撒植被实例（Cycles 渲染实例几乎不占内存）：
  稻株  水稻田平台上，一丛丛 0.7 m 高的盛夏稻
  草丛  田坎坡带、林下、沙盘边缘
  菜    菜地里的矮叶丛
选区：按地面的材质（Material Selection）+ 顶点属性 bank（田坎权重）+ 坡度。
网页版另做（烘焙贴图 + 少量实例），这里只为效果图服务。
"""

import math
import random

import bmesh
import bpy

from . import lib


# ---------------------------------------------------------------- 植株原型


def _blade_tuft(name, blades, height, spread, mats, seed, lean=0.35,
                width=0.035):
    """一丛叶片：每片是一条向外弯的细长三角带（3 段），叶尖收窄。"""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for i in range(blades):
        a = rnd.uniform(0, 2 * math.pi)
        h = height * rnd.uniform(0.7, 1.05)
        r0 = rnd.uniform(0, spread * 0.35)
        bend = lean * rnd.uniform(0.6, 1.2)
        w = width * rnd.uniform(0.8, 1.2)
        ca, sa = math.cos(a), math.sin(a)
        px, py = -sa, ca                       # 叶片宽度方向
        pts = []
        for k in range(4):
            t = k / 3
            rr = r0 + spread * t + bend * t * t * h
            z = h * (t - 0.18 * t * t * bend)
            ww = w * (1 - t * 0.85)
            cx, cy = ca * rr, sa * rr
            pts.append(((cx - px * ww, cy - py * ww, z),
                        (cx + px * ww, cy + py * ww, z)))
        vs = [(bm.verts.new(l), bm.verts.new(r)) for l, r in pts]
        mi = rnd.randrange(len(mats))
        for k in range(3):
            f = bm.faces.new((vs[k][0], vs[k][1], vs[k + 1][1], vs[k + 1][0]))
            f.material_index = mi
            f.smooth = True
    me = lib.make_mesh(name, bm, mats)
    return me


def _proto_object(name, me, col):
    ob = bpy.data.objects.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = (0, 0, -500)  # 原型本身藏到沙盘下面
    ob.hide_render = True
    return ob


# ---------------------------------------------------------------- 几何节点散布


def _scatter(name, ground, proto, col, material, density, seed,
             bank=(0.0, 1.0), min_up=0.9, scale=(0.8, 1.2), max_up=1.01):
    """在 ground 上按材质 + bank 属性 + 坡度选区撒 proto 的实例。"""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="OUTPUT",
                            socket_type="NodeSocketGeometry")
    N = ng.nodes
    L = ng.links
    out = N.new("NodeGroupOutput")
    gi = N.new("GeometryNodeObjectInfo")
    gi.inputs["Object"].default_value = ground
    gi.transform_space = "RELATIVE"
    ms = N.new("GeometryNodeMaterialSelection")
    ms.inputs["Material"].default_value = material
    na = N.new("GeometryNodeInputNamedAttribute")
    na.data_type = "FLOAT"
    na.inputs["Name"].default_value = "bank"
    lo = N.new("FunctionNodeCompare")
    lo.data_type = "FLOAT"
    lo.operation = "GREATER_EQUAL"
    lo.inputs["B"].default_value = bank[0]
    hi = N.new("FunctionNodeCompare")
    hi.data_type = "FLOAT"
    hi.operation = "LESS_EQUAL"
    hi.inputs["B"].default_value = bank[1]
    nrm = N.new("GeometryNodeInputNormal")
    sep = N.new("ShaderNodeSeparateXYZ")
    up = N.new("FunctionNodeCompare")
    up.data_type = "FLOAT"
    up.operation = "GREATER_EQUAL"
    up.inputs["B"].default_value = min_up
    upmax = N.new("FunctionNodeCompare")
    upmax.data_type = "FLOAT"
    upmax.operation = "LESS_EQUAL"
    upmax.inputs["B"].default_value = max_up
    and1 = N.new("FunctionNodeBooleanMath")
    and2 = N.new("FunctionNodeBooleanMath")
    and3 = N.new("FunctionNodeBooleanMath")
    and4 = N.new("FunctionNodeBooleanMath")
    dist = N.new("GeometryNodeDistributePointsOnFaces")
    dist.inputs["Density"].default_value = density
    dist.inputs["Seed"].default_value = seed
    pi = N.new("GeometryNodeObjectInfo")
    pi.inputs["Object"].default_value = proto
    iop = N.new("GeometryNodeInstanceOnPoints")
    rz = N.new("FunctionNodeRandomValue")
    rz.data_type = "FLOAT"
    rz.inputs["Min"].default_value = 0.0
    rz.inputs["Max"].default_value = 6.283
    rz.inputs["Seed"].default_value = seed + 1
    comb = N.new("ShaderNodeCombineXYZ")
    rs = N.new("FunctionNodeRandomValue")
    rs.data_type = "FLOAT"
    rs.inputs["Min"].default_value = scale[0]
    rs.inputs["Max"].default_value = scale[1]
    rs.inputs["Seed"].default_value = seed + 2

    L.new(gi.outputs["Geometry"], dist.inputs["Mesh"])
    L.new(na.outputs["Attribute"], lo.inputs["A"])
    L.new(na.outputs["Attribute"], hi.inputs["A"])
    L.new(nrm.outputs["Normal"], sep.inputs["Vector"])
    L.new(sep.outputs["Z"], up.inputs["A"])
    L.new(sep.outputs["Z"], upmax.inputs["A"])
    L.new(ms.outputs["Selection"], and1.inputs[0])
    L.new(lo.outputs["Result"], and1.inputs[1])
    L.new(and1.outputs["Boolean"], and2.inputs[0])
    L.new(hi.outputs["Result"], and2.inputs[1])
    L.new(and2.outputs["Boolean"], and3.inputs[0])
    L.new(up.outputs["Result"], and3.inputs[1])
    L.new(and3.outputs["Boolean"], and4.inputs[0])
    L.new(upmax.outputs["Result"], and4.inputs[1])
    L.new(and4.outputs["Boolean"], dist.inputs["Selection"])
    L.new(dist.outputs["Points"], iop.inputs["Points"])
    L.new(pi.outputs["Geometry"], iop.inputs["Instance"])
    L.new(rz.outputs["Value"], comb.inputs["Z"])
    L.new(comb.outputs["Vector"], iop.inputs["Rotation"])
    L.new(rs.outputs["Value"], iop.inputs["Scale"])
    L.new(iop.outputs["Instances"], out.inputs["Geometry"])
    mod = ob.modifiers.new(name, "NODES")
    mod.node_group = ng
    return ob


def apply(meta, density=1.0):
    """在当前场景上加植被散布。density 整体缩放密度（出近景时可调大）。"""
    col = lib.collection("PREVIEW")
    ground = bpy.data.objects["ground"]
    m = lib.material
    rice_a = m("V_rice_a", "#5e9a2e", rough=0.7)
    rice_b = m("V_rice_b", "#79b03a", rough=0.7)
    grass_a = m("V_grass_a", "#557f30", rough=0.8)
    grass_b = m("V_grass_b", "#7a9c3c", rough=0.8)
    grass_c = m("V_grass_c", "#8f8a4a", rough=0.85)
    veg_a = m("V_veg_a", "#6f9e45", rough=0.6)
    veg_b = m("V_veg_b", "#9cbd5a", rough=0.6)

    rice = _proto_object("proto_rice", _blade_tuft(
        "proto_rice", 14, 0.75, 0.12, [rice_a, rice_b], 1, lean=0.25,
        width=0.03), col)
    grass = _proto_object("proto_grass", _blade_tuft(
        "proto_grass", 10, 0.45, 0.18, [grass_a, grass_b, grass_c], 2,
        lean=0.5, width=0.04), col)
    veg = _proto_object("proto_veg", _blade_tuft(
        "proto_veg", 9, 0.32, 0.2, [veg_a, veg_b], 3, lean=0.9,
        width=0.12), col)

    M = {mm.name: mm for mm in bpy.data.materials}
    n = {}
    # 稻：水稻田（田埂以外、坡度不太陡的面）
    n["rice"] = _scatter("sc_rice", ground, rice, col, M["G_paddy"],
                         22 * density, 11, bank=(0.0, 0.2), min_up=0.94)
    # 田埂草：稻田 / 旱地 / 菜地交界处的田埂
    for i, mat in enumerate(("G_paddy", "G_dry", "G_veg")):
        # 田埂两侧长草，中线（>0.8）是踩出来的土路，不长草
        _scatter(f"sc_bank_{i}", ground, grass, col, M[mat], 14 * density,
                 20 + i, bank=(0.4, 0.8), min_up=0.0, scale=(0.6, 1.1))
    # 林下与杂草地
    _scatter("sc_wood", ground, grass, col, M["G_wood"], 6 * density, 31,
             min_up=0.5, scale=(0.8, 1.6))
    _scatter("sc_bund", ground, grass, col, M["G_bund"], 14 * density, 32,
             min_up=0.0)
    # 菜地
    _scatter("sc_veg", ground, veg, col, M["G_veg"], 7 * density, 41,
             bank=(0.0, 0.45), min_up=0.95, scale=(0.8, 1.4))
    # 旱地：盛夏种红苕，藤叶铺满地面
    _scatter("sc_dry", ground, veg, col, M["G_dry"], 9 * density, 51,
             bank=(0.0, 0.45), min_up=0.95, scale=(1.0, 1.6))
    return n


# ---------------------------------------------------------------- 材质 / 光影（只影响效果图）


def leaf_variation():
    """树叶按实例随机明暗 / 色相微调（Object Info → Random），避免整片林子一个颜色；
    同时给叶子一点次表面散射，逆光时透亮。"""
    for name in ("T_cypress", "T_broad", "T_bamboo", "T_loquat", "V_rice_a",
                 "V_rice_b"):
        m = bpy.data.materials.get(name)
        if m is None or m.get("varied"):
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        base = tuple(bsdf.inputs["Base Color"].default_value)
        oi = nt.nodes.new("ShaderNodeObjectInfo")
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = base
        hsv = nt.nodes.new("ShaderNodeHueSaturation")
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = 0.72
        mr.inputs["To Max"].default_value = 1.2
        mh = nt.nodes.new("ShaderNodeMapRange")
        mh.inputs["To Min"].default_value = 0.47
        mh.inputs["To Max"].default_value = 0.53
        if name.startswith("V_rice"):
            # 稻田：按实例所在位置取大尺度噪声，一块块田长势 / 颜色深浅不一
            nz = nt.nodes.new("ShaderNodeTexNoise")
            nz.inputs["Scale"].default_value = 0.022
            nz.inputs["Detail"].default_value = 1.0
            nt.links.new(oi.outputs["Location"], nz.inputs["Vector"])
            nt.links.new(nz.outputs["Fac"], mr.inputs["Value"])
            nt.links.new(nz.outputs["Fac"], mh.inputs["Value"])
            mr.inputs["From Min"].default_value = 0.3
            mr.inputs["From Max"].default_value = 0.7
            mr.inputs["To Min"].default_value = 0.62
            mr.inputs["To Max"].default_value = 1.3
            mh.inputs["From Min"].default_value = 0.3
            mh.inputs["From Max"].default_value = 0.7
            mh.inputs["To Min"].default_value = 0.46
            mh.inputs["To Max"].default_value = 0.54
        else:
            nt.links.new(oi.outputs["Random"], mr.inputs["Value"])
            nt.links.new(oi.outputs["Random"], mh.inputs["Value"])
        nt.links.new(mr.outputs["Result"], hsv.inputs["Value"])
        nt.links.new(mh.outputs["Result"], hsv.inputs["Hue"])
        nt.links.new(rgb.outputs[0], hsv.inputs["Color"])
        nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Subsurface Weight"].default_value = 0.15
        m["varied"] = True


def sky(meta, sun_az=290.0, sun_el=13.0, strength=0.55):
    """物理天空（多次散射模型）+ 同方位的太阳灯：傍晚低角度暖光。"""
    from .preview import _dir
    s = bpy.context.scene
    w = s.world
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    st = next((n for n in nt.nodes if n.type == "TEX_SKY"), None)
    if st is None:
        st = nt.nodes.new("ShaderNodeTexSky")
        nt.links.new(st.outputs["Color"], bg.inputs["Color"])
    for t in ("MULTIPLE_SCATTERING", "NISHITA"):
        try:
            st.sky_type = t
            break
        except TypeError:
            continue
    to_sun = _dir(sun_az, sun_el, meta["up_azimuth"])
    st.sun_elevation = math.radians(sun_el)
    # 天空纹理的太阳方位：从 +y 起算、逆时针（与场地坐标一致）
    st.sun_rotation = math.atan2(-to_sun.x, to_sun.y)
    st.sun_disc = False
    bg.inputs["Strength"].default_value = strength
    sun = bpy.data.lights["L_sun"]
    sun.energy = 3.4
    sun.color = (1.0, 0.78, 0.55)
    sun.angle = math.radians(1.5)
    ob = bpy.data.objects["L_sun"]
    ob.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()


def dof(target, fstop):
    """景深：对焦到 target（世界坐标），fstop 越小越虚，模拟微缩模型的移轴感。"""
    from mathutils import Vector
    cam = bpy.context.scene.camera
    cam.data.dof.use_dof = True
    bpy.context.view_layer.update()
    cam.data.dof.focus_distance = (Vector(target) - cam.matrix_world.translation).length
    cam.data.dof.aperture_fstop = fstop


def poles(meta, spacing=32.0, offset=2.2):
    """沿回家路线每隔约 spacing 米立一根水泥电线杆（偏到路一侧），杆顶之间拉两根下垂的电线。"""
    from mathutils import Vector
    col = lib.collection("PREVIEW")
    for o in [o for o in col.objects if o.name.startswith(("pole_", "wires"))]:
        bpy.data.objects.remove(o, do_unlink=True)
    pts = [Vector(p) for p in meta["route"]]
    # 沿折线按弧长取点
    marks, acc, nxt = [], 0.0, 0.0
    for a, b in zip(pts, pts[1:]):
        seg = (b - a).length
        while nxt <= acc + seg:
            t = (nxt - acc) / max(seg, 1e-6)
            p = a.lerp(b, t)
            d = (b - a).normalized()
            side = Vector((d.y, -d.x, 0))
            marks.append(p + side * offset)
            nxt += spacing
        acc += seg
    M = {m.name: m for m in bpy.data.materials}
    pole_me = None
    bm = bmesh.new()
    lib.add_cyl(bm, 0.13, 8.0, (0, 0, 4.0), seg=8, mat=0, r2=0.09)
    lib.add_box(bm, (1.4, 0.12, 0.12), (0, 0, 7.4), mat=0)
    pole_me = lib.make_mesh("pole", bm, [M["P_pole"]])
    # 地坝（围墙内）不立杆：最后一段路线在地坝里，落在里面的点去掉
    home = next(h for h in meta["houses"] if h["kind"] == "home")
    f_ = Vector((math.cos(home["face"]), math.sin(home["face"]), 0))
    r_ = Vector((-math.sin(home["face"]), math.cos(home["face"]), 0))
    c_ = Vector((home["cx"], home["cy"], 0))

    def in_yard(p):
        d_ = Vector((p.x, p.y, 0)) - c_
        return -6 < d_.dot(f_) < 5 + 9.0 + 2.5 and abs(d_.dot(r_)) < 6.2 + 2.5

    marks = [p for p in marks if not in_yard(p)]
    tops = []
    for i, p in enumerate(marks):
        ob = lib.place(pole_me, f"pole_{i:02d}", col, loc=(p.x, p.y, p.z - 0.5))
        tops.append(p + Vector((0, 0, 7.0)))
    bm = bmesh.new()
    for a, b in zip(tops, tops[1:]):
        for dx in (-0.6, 0.6):
            off = Vector((dx, 0, 0))
            lib.add_tube(bm, lib.sag(a + off, b + off, 0.7, n=10), 0.02, seg=4)
    ob = bpy.data.objects.new("wires", lib.make_mesh("wires", bm, [M["P_wire"]]))
    col.objects.link(ob)
    return len(marks)


def render_effects(meta, out_dir, samples=96):
    """出两张效果图底图（透明背景，后期用 scripts/hometown/compose_effects.py 合成）：
    <out_dir>/fx_overview.png 全景、<out_dir>/fx_home.png 我家近景（照片机位）。
    渲染较慢，在 bpy.app.timers 里跑，MCP 调用立即返回；完成后写出 <out_dir>/fx_done。"""
    import os
    from . import preview as pv
    home = next(h for h in meta["houses"] if h["kind"] == "home")
    done = os.path.join(out_dir, "fx_done")
    if os.path.exists(done):
        os.remove(done)

    def look(s):
        sky(meta, sun_az=290.0, sun_el=11.0, strength=0.16)
        bpy.data.lights["L_sun"].energy = 5.0
        s.view_settings.exposure = -0.35
        s.view_settings.look = "AgX - Medium High Contrast"
        s.render.film_transparent = True   # setup() 会重置，必须放在它后面
        pv.use_cycles(samples)

    def job():
        s = bpy.context.scene
        pv.setup(meta, dist=560.0, elevation=38.0, target=(4, 2, 4),
                 res=(1920, 1080))
        look(s)
        s.camera.data.dof.use_dof = False
        rl = route_line_obj = bpy.data.objects.get("route_line")
        if rl:
            rl.hide_render = False
        pv.render(os.path.join(out_dir, "fx_overview.png"))
        if route_line_obj:
            route_line_obj.hide_render = True
        # 照片机位：站在地坝里、离正立面约 8 m（前墙在身后），房子偏左、右边留给老照片卡片
        pv.home_view(meta, dist=12.0, eye=1.6, lens=13, side=-0.5, aim=-3.0)
        dof((home["cx"], home["cy"], home["z"] + 4), 0.6)
        pv.render(os.path.join(out_dir, "fx_home.png"))
        if route_line_obj:
            route_line_obj.hide_render = False
        open(done, "w").close()
        return None

    bpy.app.timers.register(job, first_interval=0.5)


# ---------------------------------------------------------------- 夜景（效果图 / 设计稿用）


def _window_mask(name, lit_color=(1.0, 0.72, 0.38)):
    """与 palette._facade 的窗洞位置一致（x 0.25–0.75、y 0.29–0.78）的发光遮罩：
    窗玻璃区域为暖黄，其余为黑。"""
    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = 0
        y0, y1, x0, x1 = int(0.29 * h), int(0.78 * h), int(0.25 * w), int(0.75 * w)
        a[y0:y1, x0:x1, :3] = lit_color
        # 窗框中梃不发光
        for k in (0.25, 0.5, 0.75):
            xx = int((0.25 + 0.5 * k) * w)
            a[y0:y1, xx - 1:xx + 2, :3] = 0
    return lib.image(name, 64, 56, paint)


def night(meta, on=True):
    """切到夜景：深蓝夜空 + 弱月光；有窗的墙面材质按物体随机一部分窗户亮暖灯；
    红灯笼、回家路线发光；每户门口一盏暖色小点光。on=False 恢复傍晚。"""
    from mathutils import Vector
    s = bpy.context.scene
    col = lib.collection("PREVIEW")
    mask = bpy.data.images.get("night_win") or _window_mask("night_win")
    for m in bpy.data.materials:
        if not m.name.startswith("W_") or m.name.endswith("_plain") or \
                m.name in ("W_old", "W_shed", "W_brick"):
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        em = next((n for n in nt.nodes if n.name == "night_emit"), None)
        if em is None:
            tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
            em = nt.nodes.new("ShaderNodeTexImage")
            em.name = "night_emit"
            em.image = mask
            oi = nt.nodes.new("ShaderNodeObjectInfo")
            gt = nt.nodes.new("ShaderNodeMath")
            gt.operation = "GREATER_THAN"
            gt.inputs[1].default_value = 0.35       # 约 65% 的人家亮灯
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.name = "night_strength"
            # 发光贴图用与墙面贴图相同的 UV（默认 UV 层）
            nt.links.new(em.outputs["Color"], bsdf.inputs["Emission Color"])
            nt.links.new(oi.outputs["Random"], gt.inputs[0])
            nt.links.new(gt.outputs["Value"], mul.inputs[0])
            nt.links.new(mul.outputs["Value"], bsdf.inputs["Emission Strength"])
        mul = nt.nodes["night_strength"]
        mul.inputs[1].default_value = 6.0 if on else 0.0
    for name, k in (("D_lantern", 14.0), ("PV_route", 9.0)):
        m = bpy.data.materials.get(name)
        if m:
            b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            b.inputs["Emission Strength"].default_value = k if on else (
                0.0 if name == "D_lantern" else 6.0)
    # 门口暖灯：每栋房子正门外 1.2 m、高 2.6 m
    for o in [o for o in col.objects if o.name.startswith("NL_")]:
        bpy.data.objects.remove(o, do_unlink=True)
    if on:
        for h in meta["houses"]:
            if h["kind"] == "shed":
                continue
            d = 10.0 if h["kind"] == "home" else h["d"]
            f = Vector((math.cos(h["face"]), math.sin(h["face"]), 0))
            p = Vector((h["cx"], h["cy"], h["z"] + 2.6)) + f * (d / 2 + 1.2)
            li = bpy.data.lights.new(f"NL_{h['id']}", "POINT")
            li.energy = 260 if h["kind"] == "home" else 140
            li.color = (1.0, 0.68, 0.38)
            li.shadow_soft_size = 0.3
            ob = bpy.data.objects.new(f"NL_{h['id']}", li)
            ob.location = p
            col.objects.link(ob)
    # 天空与月光
    w = s.world
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    st = next((n for n in w.node_tree.nodes if n.type == "TEX_SKY"), None)
    if on:
        if st:
            for l in list(bg.inputs["Color"].links):
                w.node_tree.links.remove(l)
        bg.inputs["Color"].default_value = (0.012, 0.02, 0.05, 1)
        bg.inputs["Strength"].default_value = 1.0
        sun = bpy.data.lights["L_sun"]
        sun.energy = 0.35
        sun.color = (0.6, 0.72, 1.0)
        s.view_settings.exposure = 0.6
    elif st:
        w.node_tree.links.new(st.outputs["Color"], bg.inputs["Color"])


def render_night(meta, out_dir, samples=128):
    """夜景全景（透明背景）→ <out_dir>/fx_night.png，完成后写 fx_night_done。"""
    import os
    from . import preview as pv
    done = os.path.join(out_dir, "fx_night_done")
    if os.path.exists(done):
        os.remove(done)

    def job():
        s = bpy.context.scene
        pv.setup(meta, dist=560.0, elevation=38.0, target=(4, 2, 4),
                 res=(1920, 1080))
        sky(meta, sun_az=290.0, sun_el=11.0, strength=0.16)
        night(meta, True)
        s.view_settings.look = "AgX - Medium High Contrast"
        s.render.film_transparent = True
        s.camera.data.dof.use_dof = False
        rl = bpy.data.objects.get("route_line")
        if rl:
            rl.hide_render = False
        pv.use_cycles(samples)
        pv.render(os.path.join(out_dir, "fx_night.png"))
        night(meta, False)
        open(done, "w").close()
        return None

    bpy.app.timers.register(job, first_interval=0.5)
