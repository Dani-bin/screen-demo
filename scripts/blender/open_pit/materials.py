"""青原露天矿 · 材质（节点树）。

风格 A「全息透视 · 煤能青蓝」：近黑的深蓝岩体，只有台阶沿口、道路和灯是亮的，坑底有暖色琥珀光池。
这些材质是 Blender 里的程序化节点，导出 GLB 前要烘焙成贴图（GLB 不带节点）；先用它在 Eevee 里看效果、定参数。
节点用类型名建（不依赖界面语言），贴图坐标用物体空间（岩壁的 UV 只有一圈角度 × 很窄的宽度，不适合当纹理坐标）。
"""
import bpy

# 坑底暖光池中心（世界米）由 build.py 传入
AMBER = (1.0, 0.5, 0.1)
CYAN = (0.1, 0.8, 1.0)


def _nt(m):
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return nt


def N(nt, typ, **kw):
    n = nt.nodes.new(typ)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def L(nt, a, ao, b, bi):
    nt.links.new(a.outputs[ao], b.inputs[bi])


def _out(nt, shader):
    o = N(nt, "ShaderNodeOutputMaterial")
    L(nt, shader, "BSDF", o, "Surface")
    return o


def _math(nt, op, a=None, b=None, clamp=False):
    n = N(nt, "ShaderNodeMath", operation=op, use_clamp=clamp)
    if a is not None:
        if isinstance(a, (int, float)):
            n.inputs[0].default_value = a
        else:
            L(nt, a[0], a[1], n, 0)
    if b is not None:
        if isinstance(b, (int, float)):
            n.inputs[1].default_value = b
        else:
            L(nt, b[0], b[1], n, 1)
    return n


def _ramp(nt, stops):
    r = N(nt, "ShaderNodeValToRGB")
    cr = r.color_ramp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    for pos, col in stops[1:]:
        e = cr.elements.new(pos)
        e.color = (*col, 1)
    return r


def _get(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    return m


def rock_wall(name="op_wall", bench=None):
    """陡坎岩壁：设计稿里是一块块的岩体（约 8–12 m）+ 块间的暗裂隙 + 竖向冲沟，高对比，带法线凹凸。
    特征尺寸按总览镜头选：3.5 km 外一个像素约 2 m，1 m 的纹理会糊成一片。
    第 17 轮重写：原来的噪声经色带映射后几乎是平的（烘焙贴图里陡坎是一条条没纹理的暗带），页面上岩壁读成光滑的色带。
    bench（台阶高，米）给了时每级陡坎从坎顶到坡脚由亮到暗（设计稿里每级台阶上沿受光、下部发暗，层次就靠这个分出来）"""
    m = _get(name, (0.02, 0.045, 0.07))
    nt = _nt(m)
    tc = N(nt, "ShaderNodeTexCoord")
    # 1. 岩块：Voronoi，横向 ~9 m、竖向 ~12 m；每块一个随机明暗（Color 转灰度），块边缘（到边界的距离小）是暗裂隙
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.15, 0.15, 0.045)  # 竖向拉长成柱状岩块（~7 m 宽、~22 m 高），不是圆卵石
    L(nt, tc, "Object", mp, "Vector")
    vo = N(nt, "ShaderNodeTexVoronoi", feature="F1")
    vo.inputs["Scale"].default_value = 1.0
    vo.inputs["Randomness"].default_value = 1.0
    L(nt, mp, "Vector", vo, "Vector")
    block = N(nt, "ShaderNodeRGBToBW")
    L(nt, vo, "Color", block, "Color")
    ve = N(nt, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    ve.inputs["Scale"].default_value = 1.0
    L(nt, mp, "Vector", ve, "Vector")
    crack = _math(nt, "DIVIDE", (ve, "Distance"), 0.09)
    crack = _math(nt, "MINIMUM", (crack, 0), 1.0)  # 0 在裂隙上 … 1 在块中间
    # 2. 竖向冲沟：横向 ~7 m、竖向 ~45 m 的噪声（拉长成竖条）
    mp2 = N(nt, "ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (0.14, 0.14, 0.022)
    L(nt, tc, "Object", mp2, "Vector")
    st = N(nt, "ShaderNodeTexNoise")
    st.inputs["Scale"].default_value = 1.0
    st.inputs["Detail"].default_value = 4.0
    st.inputs["Roughness"].default_value = 0.55
    L(nt, mp2, "Vector", st, "Vector")
    # 3. 细颗粒 ~2.5 m
    mp3 = N(nt, "ShaderNodeMapping")
    mp3.inputs["Scale"].default_value = (0.4, 0.4, 0.4)
    L(nt, tc, "Object", mp3, "Vector")
    gr = N(nt, "ShaderNodeTexNoise")
    gr.inputs["Detail"].default_value = 6.0
    L(nt, mp3, "Vector", gr, "Vector")
    # 明暗：0.5 岩块 + 0.35 冲沟 + 0.15 颗粒，再乘裂隙（裂隙处压到 30 %）
    v = _math(nt, "MULTIPLY", (block, "Val"), 0.5)
    v = _math(nt, "ADD", (v, 0), (_math(nt, "MULTIPLY", (st, "Fac"), 0.35), 0))
    v = _math(nt, "ADD", (v, 0), (_math(nt, "MULTIPLY", (gr, "Fac"), 0.15), 0))
    k = _math(nt, "MULTIPLY", (crack, 0), 0.7)
    k = _math(nt, "ADD", (k, 0), 0.3)
    v = _math(nt, "MULTIPLY", (v, 0), (k, 0))
    if bench:
        # 坎顶 → 坡脚：t = fract(-z / bench)，0 在坎顶、1 在坡脚，亮度 × (1.3 − 0.75 t)
        sep = N(nt, "ShaderNodeSeparateXYZ")
        L(nt, tc, "Object", sep, 0)
        t = _math(nt, "MULTIPLY", (sep, "Z"), -1.0 / bench)
        t = _math(nt, "FRACT", (t, 0))
        g = _math(nt, "MULTIPLY", (t, 0), -0.75)
        g = _math(nt, "ADD", (g, 0), 1.3)
        v = _math(nt, "MULTIPLY", (v, 0), (g, 0))
    ramp = _ramp(nt, [(0.08, (0.003, 0.007, 0.013)), (0.3, (0.018, 0.04, 0.07)), (0.5, (0.05, 0.1, 0.15)), (0.75, (0.13, 0.22, 0.3))])  # 第 19 轮：背光面看不清，中间调提亮
    L(nt, v, 0, ramp, "Fac")
    # 凹凸：岩块起伏 + 冲沟 + 裂隙凹进去
    h = _math(nt, "ADD", (_math(nt, "MULTIPLY", (block, "Val"), 0.6), 0), (_math(nt, "MULTIPLY", (st, "Fac"), 0.5), 0))
    h = _math(nt, "ADD", (h, 0), (_math(nt, "MULTIPLY", (crack, 0), 0.6), 0))
    bump = N(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 4.0
    L(nt, h, 0, bump, "Height")
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.85
    L(nt, ramp, "Color", bs, "Base Color")
    L(nt, bump, "Normal", bs, "Normal")
    _out(nt, bs)
    return m


def rock_platform(name="op_rock", tint=(1.0, 1.0, 1.0)):
    """平台 / 土堆：碎石路面，深色，带大块明暗斑（约 5 m）"""
    m = _get(name, (0.04, 0.08, 0.12))
    nt = _nt(m)
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.2, 0.2, 0.2)
    L(nt, tc, "Object", mp, "Vector")
    nz = N(nt, "ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 8.0
    nz.inputs["Roughness"].default_value = 0.65
    L(nt, mp, "Vector", nz, "Vector")
    ramp = _ramp(nt, [(0.25, (0.02 * tint[0], 0.04 * tint[1], 0.062 * tint[2])), (0.55, (0.055 * tint[0], 0.1 * tint[1], 0.145 * tint[2])), (0.85, (0.12 * tint[0], 0.19 * tint[1], 0.25 * tint[2]))])  # 第 19 轮：平台比陡坎亮一档，路和台阶分得出来
    L(nt, nz, "Fac", ramp, "Fac")
    bump = N(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    bump.inputs["Distance"].default_value = 1.5
    L(nt, nz, "Fac", bump, "Height")
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.9
    L(nt, ramp, "Color", bs, "Base Color")
    L(nt, bump, "Normal", bs, "Normal")
    _out(nt, bs)
    return m


def pit_floor(pools, name="op_coal", strength=1.1):
    """坑底煤层：近黑褐色 + 几处琥珀色暖光池（pools 是世界坐标 (x, y, z) 列表，σ 约 220 m），光里有颗粒"""
    m = _get(name, (0.06, 0.04, 0.025))
    nt = _nt(m)
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.5, 0.5, 0.5)
    L(nt, tc, "Object", mp, "Vector")
    nz = N(nt, "ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 12.0
    nz.inputs["Roughness"].default_value = 0.75
    L(nt, mp, "Vector", nz, "Vector")
    ramp = _ramp(nt, [(0.2, (0.008, 0.007, 0.007)), (0.6, (0.05, 0.036, 0.026)), (0.9, (0.16, 0.11, 0.07))])
    L(nt, nz, "Fac", ramp, "Fac")
    # 光池：每个池子一个高斯 exp(-(d/σ)²)，三个相加
    total = None
    for (x, y, z), sigma in pools:
        d = N(nt, "ShaderNodeVectorMath", operation="DISTANCE")
        L(nt, tc, "Object", d, 0)
        d.inputs[1].default_value = (x, y, z)
        q = _math(nt, "DIVIDE", (d, "Value"), sigma)
        q2 = _math(nt, "POWER", (q, 0), 2.0)
        neg = _math(nt, "MULTIPLY", (q2, 0), -1.0)
        g = _math(nt, "EXPONENT", (neg, 0))
        total = g if total is None else _math(nt, "ADD", (total, 0), (g, 0))
    grain = _math(nt, "MULTIPLY", (nz, "Fac"), 1.6)
    glow = _math(nt, "MULTIPLY", (total, 0), (grain, 0), clamp=True)
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.9
    bs.inputs["Emission Color"].default_value = (*AMBER, 1)
    L(nt, ramp, "Color", bs, "Base Color")
    k = _math(nt, "MULTIPLY", (glow, 0), strength)  # 发光强度
    L(nt, k, 0, bs, "Emission Strength")
    _out(nt, bs)
    return m


def ground(name="op_ground", spacing=400.0, grid=False):
    """坑外地面：暗绿黑的噪声；grid=True 时再叠每 spacing 米一条淡青网格线（烘焙时不用：改用真几何的网格线）"""
    m = _get(name, (0.014, 0.03, 0.028))
    nt = _nt(m)
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.012, 0.012, 0.012)
    L(nt, tc, "Object", mp, "Vector")
    nz = N(nt, "ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 8.0
    L(nt, mp, "Vector", nz, "Vector")
    ramp = _ramp(nt, [(0.3, (0.006, 0.014, 0.014)), (0.7, (0.02, 0.045, 0.04))])
    L(nt, nz, "Fac", ramp, "Fac")
    if not grid:
        bs = N(nt, "ShaderNodeBsdfPrincipled")
        bs.inputs["Roughness"].default_value = 1.0
        L(nt, ramp, "Color", bs, "Base Color")
        _out(nt, bs)
        return m
    sep = N(nt, "ShaderNodeSeparateXYZ")
    L(nt, tc, "Object", sep, 0)
    lines = []
    for ch in ("X", "Y"):
        a = _math(nt, "DIVIDE", (sep, ch), spacing)
        a = _math(nt, "ADD", (a, 0), 0.5)
        a = _math(nt, "FRACT", (a, 0))
        a = _math(nt, "SUBTRACT", (a, 0), 0.5)
        a = _math(nt, "ABSOLUTE", (a, 0))
        a = _math(nt, "MULTIPLY", (a, 0), spacing)  # 到最近网格线的距离（米）
        a = _math(nt, "MULTIPLY", (a, 0), -1.0 / 2.5)
        a = _math(nt, "ADD", (a, 0), 1.0, clamp=True)  # 线宽约 2.5 m
        lines.append(a)
    line = _math(nt, "MAXIMUM", (lines[0], 0), (lines[1], 0))
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 1.0
    bs.inputs["Emission Color"].default_value = (*CYAN, 1)
    L(nt, ramp, "Color", bs, "Base Color")
    k = _math(nt, "MULTIPLY", (line, 0), 0.05)  # 设计稿里的网格线很淡
    L(nt, k, 0, bs, "Emission Strength")
    _out(nt, bs)
    return m


def emissive(name, color, strength, base=None):
    """纯发光材质：道路、沿口线、灯"""
    m = _get(name, color)
    nt = _nt(m)
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Base Color"].default_value = (*(base or [c * 0.3 for c in color]), 1)
    bs.inputs["Roughness"].default_value = 0.5
    bs.inputs["Emission Color"].default_value = (*color, 1)
    bs.inputs["Emission Strength"].default_value = strength
    _out(nt, bs)
    return m


def plain(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=0.0):
    """单色材质：设备、建筑"""
    m = _get(name, color)
    nt = _nt(m)
    bs = N(nt, "ShaderNodeBsdfPrincipled")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emit:
        bs.inputs["Emission Color"].default_value = (*emit, 1)
        bs.inputs["Emission Strength"].default_value = emit_strength
    _out(nt, bs)
    return m


def world_and_lights():
    """夜景：近黑的深蓝天空，一盏很弱的冷色日光做轮廓光"""
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.006, 0.014, 0.03, 1)
    bg.inputs["Strength"].default_value = 2.5
    sun = bpy.data.lights.get("op_sun") or bpy.data.lights.new("op_sun", "SUN")
    sun.energy = 1.4
    sun.color = (0.6, 0.75, 1.0)
    sun.angle = 0.05
    return sun
