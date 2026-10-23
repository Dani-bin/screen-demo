"""
十堰东环路综合能源站效果图 · 材质（白天，照参考效果图：深蓝光伏 + 白色厚檐口 + 黄色立柱 / 檐口下沿、浅色混凝土、草坪）
----------------------------------------------------------
全部是 Principled + 程序化纹理（噪声、砖纹），只给 Cycles 出图用。
build() 返回 {名字: 材质}。
"""

from . import lib
from .lib import hex_lin, mix_color, noise, ramp


def plain(name, color, rough=0.5, metal=0.0, spec=0.5, coat=0.0):
    m, nt, b, _ = lib.new_material(name)
    b.inputs["Base Color"].default_value = hex_lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Specular IOR Level"].default_value = spec
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.05
    return m


def varied(name, c1, c2, scale=0.08, rough=0.8, lo=0.35, hi=0.7, bump=0.0, metal=0.0):
    """两色噪声斑驳（地面、墙面），bump>0 加细凹凸"""
    m, nt, b, _ = lib.new_material(name)
    col = mix_color(nt, ramp_bw(nt, noise(nt, scale), lo, hi), hex_lin(c1), hex_lin(c2))
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if bump:
        bn = nt.nodes.new("ShaderNodeBump")
        bn.inputs["Strength"].default_value = bump
        nt.links.new(noise(nt, 2.5, 6.0), bn.inputs["Height"])
        nt.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    return m


def pv(name="pv"):
    """光伏组件：深蓝玻璃面 + 组件边框分格（砖纹，UV 以米为单位，组件 2.28 × 1.14 m）"""
    m, nt, b, _ = lib.new_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 2.28
    br.inputs["Row Height"].default_value = 1.14
    br.inputs["Mortar Size"].default_value = 0.025
    br.inputs["Mortar Smooth"].default_value = 0.0
    br.inputs["Color1"].default_value = hex_lin("#1d2d58")
    br.inputs["Color2"].default_value = hex_lin("#22356a")
    br.inputs["Mortar"].default_value = hex_lin("#b9c2cf")
    nt.links.new(tc.outputs["UV"], br.inputs["Vector"])
    # 组件内电池片细格（更细的砖纹，颜色差很小）
    cell = nt.nodes.new("ShaderNodeTexBrick")
    cell.offset = 0.0
    cell.inputs["Scale"].default_value = 1.0
    cell.inputs["Brick Width"].default_value = 0.19
    cell.inputs["Row Height"].default_value = 0.19
    cell.inputs["Mortar Size"].default_value = 0.008
    cell.inputs["Color1"].default_value = (1, 1, 1, 1)
    cell.inputs["Color2"].default_value = (1, 1, 1, 1)
    cell.inputs["Mortar"].default_value = (0.82, 0.85, 0.9, 1)
    nt.links.new(tc.outputs["UV"], cell.inputs["Vector"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    lib.sock(mul, "Factor_Float").default_value = 1.0
    nt.links.new(br.outputs["Color"], lib.sock(mul, "A_Color"))
    nt.links.new(cell.outputs["Color"], lib.sock(mul, "B_Color"))
    nt.links.new(lib.sock(mul, "Result_Color", out=True), b.inputs["Base Color"])
    # 边框处粗糙、玻璃处光滑（反射天空）
    rough = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(br.outputs["Fac"], rough.inputs["Value"])
    rough.inputs["To Min"].default_value = 0.12
    rough.inputs["To Max"].default_value = 0.5
    nt.links.new(rough.outputs["Result"], b.inputs["Roughness"])
    b.inputs["Specular IOR Level"].default_value = 0.7
    b.inputs["Metallic"].default_value = 0.15
    return m


def glass(name, color="#41617d", rough=0.04, mullion=None, grid=(1.5, 3.6)):
    """幕墙玻璃：深蓝灰，强反射；mullion 颜色给定时用 UV（米）画竖梃 / 横梁"""
    m, nt, b, _ = lib.new_material(name)
    b.inputs["Base Color"].default_value = hex_lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.35
    b.inputs["Specular IOR Level"].default_value = 1.0
    if mullion:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.offset = 0.0
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = grid[0]
        br.inputs["Row Height"].default_value = grid[1]
        br.inputs["Mortar Size"].default_value = 0.06
        br.inputs["Color1"].default_value = hex_lin(color)
        br.inputs["Color2"].default_value = hex_lin(color)
        br.inputs["Mortar"].default_value = hex_lin(mullion)
        nt.links.new(tc.outputs["UV"], br.inputs["Vector"])
        nt.links.new(br.outputs["Color"], b.inputs["Base Color"])
        r = nt.nodes.new("ShaderNodeMapRange")
        nt.links.new(br.outputs["Fac"], r.inputs["Value"])
        r.inputs["To Min"].default_value = rough
        r.inputs["To Max"].default_value = 0.45
        nt.links.new(r.outputs["Result"], b.inputs["Roughness"])
    return m


def terrain():
    """
    大地形：顶点属性 forest（山林）/ meadow（后方现状荒地）/ field（远处农田）混合三种地面，
    远处按相机距离加空气透视
    """
    m, nt, b, _ = lib.new_material("terrain")

    def attr(name):
        a = nt.nodes.new("ShaderNodeAttribute")
        a.attribute_name = name
        return a.outputs["Fac"]

    def two(c1, c2, scale, lo=0.35, hi=0.7):
        f = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(ramp(nt, noise(nt, scale), lo, hi), f.inputs[0])
        return mix_color(nt, f.outputs[0], hex_lin(c1), hex_lin(c2))

    grass = two("#557f34", "#6d9440", 0.03)
    meadow = mix_color(nt, ramp_bw(nt, noise(nt, 0.02, 3.0), 0.42, 0.62), two("#8a8656", "#77804a", 0.08),
                       two("#9a8466", "#8c7a5c", 0.15))
    forest = two("#2b4325", "#3c5a2d", 0.012, 0.3, 0.75)
    field = two("#7f9a4e", "#a19a63", 0.006, 0.4, 0.6)
    c = mix_color(nt, attr("field"), grass, field)
    c = mix_color(nt, attr("meadow"), c, meadow)
    c = mix_color(nt, attr("forest"), c, forest)
    b.inputs["Roughness"].default_value = 0.95
    b.inputs["Specular IOR Level"].default_value = 0.25
    lib.haze(nt, c, b)
    return m


def ramp_bw(nt, fac, lo, hi):
    f = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(ramp(nt, fac, lo, hi), f.inputs[0])
    return f.outputs[0]


def far(name, color, rough=0.9):
    """远景物件（远山树林、高架）：纯色 + 空气透视"""
    m, nt, b, _ = lib.new_material(name)
    c = nt.nodes.new("ShaderNodeRGB")
    c.outputs[0].default_value = hex_lin(color)
    b.inputs["Roughness"].default_value = rough
    lib.haze(nt, c.outputs[0], b)
    return m


def leaf(name, c1, c2):
    """树叶：两色斑驳 + 一点次表面透光感（用 Sheen 模拟边缘提亮）"""
    m, nt, b, _ = lib.new_material(name)
    col = mix_color(nt, ramp_bw(nt, noise(nt, 0.9, 3.0, "Object"), 0.35, 0.7), hex_lin(c1), hex_lin(c2))
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    b.inputs["Sheen Weight"].default_value = 0.4
    b.inputs["Sheen Tint"].default_value = hex_lin("#c8e08a")
    bn = nt.nodes.new("ShaderNodeBump")
    bn.inputs["Strength"].default_value = 0.6
    nt.links.new(noise(nt, 6.0, 5.0), bn.inputs["Height"])
    nt.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    return m


def water():
    m, nt, b, _ = lib.new_material("water")
    b.inputs["Base Color"].default_value = hex_lin("#2d4b4c")
    b.inputs["Roughness"].default_value = 0.06
    b.inputs["Specular IOR Level"].default_value = 0.8
    bn = nt.nodes.new("ShaderNodeBump")
    bn.inputs["Strength"].default_value = 0.15
    nt.links.new(noise(nt, 0.4, 4.0), bn.inputs["Height"])
    nt.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    return m


def stone_wall(name="stone_wall"):
    """挡墙：浅灰毛石（砖纹按世界坐标），带凹凸"""
    m, nt, b, _ = lib.new_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    br = nt.nodes.new("ShaderNodeTexBrick")
    br.inputs["Scale"].default_value = 1.6
    br.inputs["Brick Width"].default_value = 0.9
    br.inputs["Row Height"].default_value = 0.45
    br.inputs["Mortar Size"].default_value = 0.02
    br.inputs["Color1"].default_value = hex_lin("#9a958b")
    br.inputs["Color2"].default_value = hex_lin("#857f74")
    br.inputs["Mortar"].default_value = hex_lin("#6e6a62")
    nt.links.new(tc.outputs["UV"], br.inputs["Vector"])
    nt.links.new(br.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    bn = nt.nodes.new("ShaderNodeBump")
    bn.inputs["Strength"].default_value = 0.5
    nt.links.new(br.outputs["Fac"], bn.inputs["Height"])
    nt.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    return m


def tiles(name="roof_tile"):
    """小青瓦屋面：深灰 + 沿坡向的瓦垄条纹（UV：u 沿屋脊，v 沿坡）"""
    m, nt, b, _ = lib.new_material(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 4.0  # UV 以米为单位，约 0.25 m 一道瓦垄
    nt.links.new(tc.outputs["UV"], wave.inputs["Vector"])
    col = mix_color(nt, ramp_bw(nt, wave.outputs["Fac"], 0.3, 0.8), hex_lin("#3c4046"), hex_lin("#565b62"))
    nt.links.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.75
    bn = nt.nodes.new("ShaderNodeBump")
    bn.inputs["Strength"].default_value = 0.4
    nt.links.new(wave.outputs["Fac"], bn.inputs["Height"])
    nt.links.new(bn.outputs["Normal"], b.inputs["Normal"])
    return m


def build():
    M = {}
    M["terrain"] = terrain()
    M["forest_far"] = far("forest_far", "#2f4a2a")
    M["highway"] = far("highway", "#b9bcbf", 0.7)
    M["highway_dark"] = far("highway_dark", "#6e7277", 0.7)
    M["asphalt"] = varied("asphalt", "#3a3d42", "#45484d", 0.25, 0.85, bump=0.08)
    M["asphalt_old"] = varied("asphalt_old", "#8e8d88", "#a3a19a", 0.08, 0.85, bump=0.1)  # 现状混凝土路
    M["concrete"] = varied("concrete", "#bdbbb4", "#cbc9c2", 0.06, 0.8, bump=0.05)
    M["pavers"] = varied("pavers", "#c9c1b2", "#d5cfc3", 0.3, 0.75)
    M["pavers_red"] = varied("pavers_red", "#9c6a58", "#a87866", 0.3, 0.8)
    M["grass"] = varied("grass", "#5a8a36", "#71a043", 0.05, 0.95)
    M["lawn_slope"] = varied("lawn_slope", "#628f3b", "#7aa64a", 0.2, 0.95)
    M["soil"] = varied("soil", "#8f7a5c", "#a08b6a", 0.1, 0.95)
    M["stone_wall"] = stone_wall()
    M["curb"] = plain("curb", "#d9d7d0", 0.7)
    M["paint_white"] = plain("paint_white", "#eeeeea", 0.6)
    M["paint_yellow"] = plain("paint_yellow", "#e8b829", 0.6)
    M["paint_green"] = plain("paint_green", "#3f9b62", 0.7)  # 新能源车位地面涂装
    M["paint_blue"] = plain("paint_blue", "#2f6fbf", 0.7)
    M["pv"] = pv()
    M["canopy_white"] = plain("canopy_white", "#eef0f1", 0.4)
    M["canopy_under"] = plain("canopy_under", "#dfe2e5", 0.6)
    M["trim_yellow"] = plain("trim_yellow", "#efb30b", 0.35, spec=0.6)
    M["steel_yellow"] = plain("steel_yellow", "#e9ad0c", 0.4, metal=0.3)
    M["steel_white"] = plain("steel_white", "#e6e8ea", 0.35, metal=0.3)
    M["steel_grey"] = plain("steel_grey", "#8e959c", 0.35, metal=0.7)
    M["steel_dark"] = plain("steel_dark", "#3e4349", 0.4, metal=0.6)
    M["wall_white"] = varied("wall_white", "#eceeef", "#f3f4f5", 0.4, 0.55)
    M["wall_grey"] = plain("wall_grey", "#b8bdc2", 0.6)
    M["glass"] = glass("glass", "#4a6d8a", mullion="#d7dbe0", grid=(1.5, 4.2))
    M["glass_band"] = glass("glass_band", "#3d5f7c", mullion="#c9ced4", grid=(1.4, 1.6))
    M["glass_dark"] = glass("glass_dark", "#1e2832", 0.08)
    M["blue"] = plain("blue", "#1f63c6", 0.4, spec=0.6)
    M["teal"] = plain("teal", "#13a8b6", 0.4, spec=0.6)
    M["green_brand"] = plain("green_brand", "#20a46b", 0.4)
    M["container"] = varied("container", "#e7eaec", "#dfe3e6", 0.5, 0.5)
    M["cabinet"] = plain("cabinet", "#c7cfc9", 0.5)
    M["tank"] = plain("tank", "#f2f4f5", 0.3, metal=0.15, coat=0.4)
    M["tank_blue"] = plain("tank_blue", "#2b6fb0", 0.35, metal=0.2)
    M["fence"] = plain("fence", "#3a7a4a", 0.6, metal=0.2)
    M["fence_grey"] = plain("fence_grey", "#a9afb5", 0.5, metal=0.5)
    M["wood"] = varied("wood", "#9b6e47", "#ad7e55", 0.6, 0.7)
    M["roof_tile"] = tiles()
    M["wall_ancient"] = varied("wall_ancient", "#e6e1d6", "#d8d2c5", 0.3, 0.85)
    M["brick_grey"] = varied("brick_grey", "#7d7f80", "#8f9191", 0.6, 0.85)
    M["pillar_red"] = plain("pillar_red", "#7e2a22", 0.6)
    M["trunk"] = plain("trunk", "#5b4a39", 0.9)
    M["leaf1"] = leaf("leaf1", "#3c6a2a", "#4f7e33")
    M["leaf2"] = leaf("leaf2", "#56883a", "#6a9a45")
    M["leaf3"] = leaf("leaf3", "#2f5726", "#3d6a2e")
    M["leaf_warm"] = leaf("leaf_warm", "#8e6a33", "#a87a3c")  # 照片里有几棵挂红褐色果穗的香椿 / 栾树
    M["water"] = water()
    M["tyre"] = plain("tyre", "#1b1c1e", 0.8)
    M["rim"] = plain("rim", "#b9bdc2", 0.3, metal=0.8)
    M["car_glass"] = plain("car_glass", "#1a222b", 0.06, spec=1.0)
    for k, c in (("white", "#eef0f1"), ("black", "#1d1f22"), ("silver", "#a7acb2"), ("grey", "#5d6268"),
                 ("red", "#a3242c"), ("blue", "#2a4c86"), ("green", "#3f7d63"), ("champagne", "#c9b99a")):
        M["car_" + k] = plain("car_" + k, c, 0.25, metal=0.4, coat=0.8)
    for k, c in (("white", "#f0f1f2"), ("red", "#b3262a"), ("blue", "#24539c"), ("orange", "#d9701f"),
                 ("green", "#2f7d4f")):
        M["cab_" + k] = plain("cab_" + k, c, 0.3, metal=0.2, coat=0.6)
    M["trailer"] = plain("trailer", "#e3e5e7", 0.45)
    M["trailer_grey"] = plain("trailer_grey", "#b4b9bf", 0.45)
    M["lamp_glow"] = plain("lamp_glow", "#fffbe8", 0.3)
    M["screen"] = plain("screen", "#0f2233", 0.2, spec=0.8)
    M["roof_blue"] = varied("roof_blue", "#8fb0cc", "#9cbad4", 0.05, 0.5)  # 周边厂房彩钢瓦
    M["roof_grey"] = varied("roof_grey", "#b9bec3", "#c6cacd", 0.05, 0.5)
    M["roof_red"] = varied("roof_red", "#9a5a48", "#a8685a", 0.05, 0.6)
    M["roof_orange"] = plain("roof_orange", "#b9693c", 0.7)
    return M
