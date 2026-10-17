"""
候诊大厅人物 · 定义
----------------------------------------------------------
对照 docs/design/waiting/draft/characters-concept.png（盲盒潮玩风）：
大头（头身比约 1 : 1.5）、黑色椭圆大眼带高光、腮红、小鼻子、微笑；身体、四肢、头发都是元球融出来的软胶形状。

坐姿模板（Blender 坐标，Z 向上，人物面朝 -Y，单位米）：
  座面 z = 0.45（与页面里的连排椅、医生椅座面同高），脚踩地面 z = 0；
  头心 (0, -0.005, 0.99)，头半径约 0.23；座椅本身不建（页面里已有）。
手位按姿势选：knees 手放膝盖、lap 双手在腿上拿东西、clasp 双手握在两膝间、cane 双手拄拐。
"""

import math

from mathutils import Euler, Quaternion, Vector

from .toy import B, C, E, Toy, face_rot

RAD = math.radians
HEAD_C = Vector((0, -0.005, 0.99))
HEAD_R = (0.235, 0.22, 0.215)  # 头的三个半径（宽、深、高），略扁更显可爱

# Q 版小椅子的座面高：人物按 0.45 m 座面搭好后整体换成这个比例（腿变短），页面里再放大 0.45 / SEAT 倍
SEAT = 0.34

EYE = "#1E1A24"
WHITE = "#FFFFFF"
BLUSH = "#F59E9E"
MOUTH = "#A0424A"
SKIN = {"light": "#FFE1CC", "warm": "#F8CFAE", "tan": "#EAB892"}

# 手（掌心）的位置：左右两只，x 负为人物右手（面朝 -Y 时 +X 在人物左边，这里不区分）
HANDS = {
    "knees": [(-0.12, -0.25, 0.565), (0.12, -0.25, 0.565)],
    "lap": [(-0.06, -0.235, 0.6), (0.06, -0.235, 0.6)],
    "clasp": [(-0.035, -0.255, 0.555), (0.035, -0.255, 0.555)],
    "cane": [(-0.022, -0.33, 0.705), (0.026, -0.335, 0.665)],
}


def on_head(az, el, out=0.0):
    """头表面上的点：az = 从正前方向人物左侧（+X）转的角度，el = 仰角；返回 (位置, 外法线)"""
    a, e = RAD(az), RAD(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    p = Vector((d.x * HEAD_R[0], d.y * HEAD_R[1], d.z * HEAD_R[2]))
    n = Vector((d.x / HEAD_R[0], d.y / HEAD_R[1], d.z / HEAD_R[2])).normalized()
    return HEAD_C + p + n * out, n


def darker(hexcolor, k=0.7):
    c = hexcolor.lstrip("#")
    return "#" + "".join(f"{int(int(c[i:i + 2], 16) * k):02x}" for i in (0, 2, 4))


# ---------------------------------------------------------------- 身体


def body(t, s):
    hands = [Vector(h) for h in HANDS[s["pose"]]]
    # 裤子：骨盆 + 大腿（向前平伸）+ 小腿（垂下）融成一块
    pants = [E((0, 0.02, 0.5), 0.12, (1.35, 1.05, 0.65))]
    for sx in (-1, 1):
        pants += [
            C((sx * 0.09, 0.0, 0.5), (sx * 0.1, -0.25, 0.515), 0.085),
            C((sx * 0.1, -0.28, 0.47), (sx * 0.1, -0.29, 0.13), 0.07),
        ]
    t.metaball(pants, s["pants"])
    # 鞋：前后拉长的软椭球
    t.metaball([E((sx * 0.1, -0.33, 0.065), 0.066, (1.05, 1.6, 0.98)) for sx in (-1, 1)], s["shoes"])
    # 上衣：躯干 + 肩 + 两条手臂（上臂、前臂两段胶囊，肘部向外下方弯）
    top = [E((0, 0.03, 0.66), 0.15, (1.12, 0.85, 1.25)), E((0, 0.03, 0.745), 0.13, (1.3, 0.8, 0.65))]
    for sx, h in zip((-1, 1), sorted(hands, key=lambda v: v.x)):
        sh = Vector((sx * 0.165, 0.03, 0.745))
        elbow = sh.lerp(h, 0.5) + Vector((sx * 0.045, 0.02, -0.07))
        wrist = h + (elbow - h).normalized() * 0.04
        top += [C(sh, elbow, 0.056), C(elbow, wrist, 0.05)]
    top += s.get("top_extra", [])
    t.metaball(top, s["top"])
    # 手：小软球
    for h in hands:
        t.sphere(h, 0.047, s["skin"], scale=(1.0, 1.2, 0.8), seg=(16, 10))


def head(t, s):
    skin = s["skin"]
    t.sphere(HEAD_C, 1.0, skin, scale=HEAD_R, seg=(40, 24))
    for sx in (-1, 1):
        p, n = on_head(sx * 88, -6)
        t.sphere(p, 0.045, skin, scale=(0.7, 1.0, 1.2), seg=(16, 10))
    # 眼睛：黑色扁椭球嵌在脸上，右上一个大高光、左下一个小高光
    brow = darker(s["hair_c"], 0.75)
    for sx in (-1, 1):
        p, n = on_head(sx * 21, -7, -0.004)
        q = face_rot(n)
        t.sphere(p, 1.0, EYE, scale=(0.034, 0.016, 0.043), rot=q, seg=(20, 12))
        t.sphere(p + q @ Vector((0.011, -0.016, 0.016)), 0.0105, WHITE, seg=(10, 6))
        t.sphere(p + q @ Vector((-0.012, -0.014, -0.017)), 0.005, WHITE, seg=(8, 5))
        if s.get("lashes"):
            t.sphere(p + q @ Vector((sx * 0.031, -0.01, 0.03)), 1.0, EYE, scale=(0.016, 0.006, 0.007), rot=q, seg=(10, 6))
        # 眉毛
        p, n = on_head(sx * 21, 13)
        t.sphere(p, 1.0, brow, scale=(0.03, 0.008, 0.009), rot=face_rot(n), seg=(12, 6))
        # 腮红
        p, n = on_head(sx * 37, -21, -0.002)
        t.sphere(p, 1.0, BLUSH, scale=(0.038, 0.006, 0.024), rot=face_rot(n), seg=(16, 8))
    # 小鼻子、微笑
    p, n = on_head(0, -13)
    t.sphere(p, 0.017, skin, seg=(12, 8))
    p, n = on_head(0, -25, -0.001)
    q = face_rot(n)
    # 嘴：一串沿笑弧排开、贴着脸的扁椭球（表面朝向和脸一致，不会像细管那样单独反出一道白光）
    for u in [i / 5 - 1 for i in range(11)]:
        c = p + q @ Vector((0.025 * u, 0.0, 0.011 * u * u - 0.004))
        t.sphere(c, 1.0, MOUTH, scale=(0.0075, 0.0035, 0.0058), rot=q, seg=(10, 6))


# ---------------------------------------------------------------- 发型（元球；负元素把脸挖出来）


def _dir(az, el):
    a, e = RAD(az), RAD(el)
    return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))


# 刘海：(方位角, 仰角, 半径)，从人物右侧额角排到左侧，斜着扫向一边
BANGS = {
    "long": [(-40, 30, 0.06), (-16, 36, 0.068), (10, 36, 0.066), (34, 30, 0.058)],
    "bun_low": [(-34, 34, 0.058), (-8, 38, 0.066), (20, 35, 0.06)],
    "bob": [(-42, 26, 0.06), (-18, 34, 0.068), (8, 36, 0.068), (32, 32, 0.06), (50, 22, 0.05)],
    "short": [(-20, 40, 0.06), (10, 42, 0.06)],
}


def hair(t, style, color):
    cap = E((0, 0.02, 1.03), 0.245, (1.04, 1.05, 1.0))
    face = E((0, -0.235, 0.925), 0.215, (0.95, 1.0, 1.0), neg=True)
    ears = [B((sx * 0.25, -0.02, 0.9), 0.07, neg=True) for sx in (-1, 1)]
    el = [cap, face, *ears]
    if style == "side_part":
        # 男医生：侧分、前额一个蓬起的发顶
        el += [E((0.02, -0.06, 1.17), 0.12, (1.6, 1.3, 0.6)), B((-0.09, -0.15, 1.12), 0.07), B((0.1, -0.16, 1.1), 0.065),
               B((0.18, -0.08, 1.08), 0.07)]
    elif style == "bun_low":
        # 低发髻 + 两鬓垂下的发束
        el += [B((0, 0.215, 0.93), 0.085)]
        el += [C((sx * 0.165, -0.16, 1.05), (sx * 0.19, -0.14, 0.9), 0.028) for sx in (-1, 1)]
    elif style == "bun_high":
        el += [B((0, 0.1, 1.22), 0.08)]
    elif style == "long":
        # 长发：后背一大片 + 脸两侧垂到肩下；挖脸的范围收窄，别把两侧发帘挖掉
        el[1] = E((0, -0.235, 0.92), 0.2, (0.85, 1.0, 1.05), neg=True)
        el += [E((0, 0.13, 0.84), 0.24, (1.05, 0.6, 1.3))]
        el += [C((sx * 0.2, -0.07, 1.0), (sx * 0.22, -0.02, 0.68), 0.062) for sx in (-1, 1)]
    elif style == "curly":
        # 老人：灰白卷发，发际线靠后
        el[0] = E((0, 0.03, 1.03), 0.24, (1.03, 1.04, 0.98))
        el[1] = E((0, -0.23, 0.97), 0.21, (1.0, 1.0, 1.0), neg=True)
        for az in range(60, 301, 30):
            for e in (5, 35):
                el.append(B(HEAD_C + _dir(az, e) * 0.245, 0.052))
        for az in (0, 90, 180, 270):
            el.append(B(HEAD_C + _dir(az, 68) * 0.235, 0.05))
    elif style == "short":
        el += [E((0, -0.02, 1.15), 0.12, (1.5, 1.4, 0.55))]
    elif style == "messy":
        # 少年：一簇簇翘起的短发
        for az, e in ((0, 55), (40, 50), (-40, 50), (80, 40), (-80, 40), (120, 45), (-120, 45), (180, 50), (0, 80), (90, 70),
                      (-90, 70), (20, 30), (-25, 32)):
            d = _dir(az, e)
            el.append(E(HEAD_C + d * 0.228, 0.05, (1.0, 1.0, 1.7), rot=Vector((0, 0, 1)).rotation_difference(d)))
    elif style == "bob":
        # 波波头：头发包到下巴高度
        el[0] = E((0, 0.02, 0.97), 0.255, (1.07, 1.06, 0.95))
        el[1] = E((0, -0.245, 0.9), 0.205, (0.92, 1.0, 1.05), neg=True)
    t.metaball(el, color, res=0.013)
    if style in BANGS:
        bangs = []
        for az, e, r in BANGS[style]:
            p, n = on_head(az, e, 0.012)
            bangs.append(E(p, r, (1.35, 0.42, 1.0), rot=face_rot(n) @ Quaternion((0, 1, 0), RAD(-az * 0.6))))
        t.metaball(bangs, color, res=0.011)


# ---------------------------------------------------------------- 服装配件


def coat_m(t, s):
    """男医生白大褂：胸前浅蓝衬衫 V 领 + 藏青领带 + 灰白翻领"""
    t.sphere((0, -0.096, 0.712), 1.0, "#9EC3EA", scale=(0.055, 0.02, 0.095), seg=(16, 10))
    t.sphere((0, -0.116, 0.69), 1.0, "#26365E", scale=(0.022, 0.012, 0.08), seg=(12, 8))
    for sx in (-1, 1):
        t.sphere((sx * 0.055, -0.11, 0.705), 1.0, "#E9EDF3", scale=(0.03, 0.012, 0.085), rot=Euler((0, RAD(-sx * 22), 0)),
                 seg=(12, 8))


def coat_f(t, s):
    """女医生：白大褂里面是蓝色刷手服 V 领"""
    t.sphere((0, -0.098, 0.715), 1.0, "#6E95CF", scale=(0.05, 0.02, 0.085), seg=(16, 10))
    for sx in (-1, 1):
        t.sphere((sx * 0.052, -0.11, 0.705), 1.0, "#E9EDF3", scale=(0.03, 0.012, 0.085), rot=Euler((0, RAD(-sx * 22), 0)),
                 seg=(12, 8))


def stethoscope(t, s):
    """听诊器：挂在脖子上的灰色管 + 胸前的听头"""
    t.torus((0, -0.01, 0.795), 0.115, 0.008, "#5D6170", rot=Euler((RAD(-24), 0, 0)), seg=(40, 8))
    for sx in (-1, 1):
        t.tube([(sx * 0.07, -0.11, 0.77), (sx * 0.075, -0.125, 0.71), (sx * 0.07, -0.128, 0.665)], 0.007, "#5D6170", seg=6)
    t.cyl((0.07, -0.122, 0.655), (0.07, -0.14, 0.655), 0.022, "#9AA0AE", seg=16)


def glasses(t, s):
    """黑框圆眼镜：两个镜圈 + 鼻梁 + 镜腿"""
    rims = []
    for sx in (-1, 1):
        p, n = on_head(sx * 21, -6, 0.022)
        t.torus(p, 0.05, 0.0065, "#2A2630", rot=Vector((0, 0, 1)).rotation_difference(n), seg=(28, 6))
        rims.append(p)
    a, b = rims
    t.tube([a + (b - a).normalized() * 0.05, b - (b - a).normalized() * 0.05], 0.006, "#2A2630", seg=6)
    for sx, p in zip((-1, 1), rims):
        ear, _ = on_head(sx * 82, -2, 0.006)
        t.tube([p + Vector((sx * 0.05, 0.0, 0.0)), ear], 0.005, "#2A2630", seg=6)


def nurse_cap(t, s):
    """护士帽：头顶偏前的白色小帽，前沿一道粉色条"""
    t.box((0, -0.04, 1.262), (0.21, 0.1, 0.07), WHITE, rot=Euler((RAD(-22), 0, 0)), bevel=0.02)
    t.box((0, -0.094, 1.258), (0.18, 0.008, 0.018), "#F47FA8", rot=Euler((RAD(-22), 0, 0)), bevel=0.003)


def badge(t, s):
    """胸牌：蓝色挂绳 + 白色卡片"""
    for sx in (-1, 1):
        t.tube([(sx * 0.07, -0.06, 0.805), (sx * 0.045, -0.11, 0.73), (0.0, -0.118, 0.68)], 0.0045, "#3B6FD8", seg=6)
    t.box((0, -0.122, 0.645), (0.055, 0.008, 0.07), WHITE, bevel=0.005)
    t.box((0, -0.127, 0.668), (0.045, 0.004, 0.012), "#3B6FD8", bevel=0.001)


def clipboard(t, s):
    """病历夹：斜放在腿上，双手扶着"""
    rot = Euler((RAD(62), 0, 0))
    t.box((0, -0.215, 0.635), (0.18, 0.012, 0.24), "#9A6B47", rot=rot, bevel=0.006)
    t.box((0, -0.222, 0.632), (0.15, 0.004, 0.2), "#FAFAFA", rot=rot, bevel=0.002)
    t.box((0, -0.16, 0.7), (0.06, 0.016, 0.025), "#B8BEC8", rot=rot, bevel=0.004)


def phone(t, s):
    t.box((0, -0.255, 0.655), (0.06, 0.011, 0.11), "#2A2A33", rot=Euler((RAD(48), 0, 0)), bevel=0.006)


def cane(t, s):
    """拐杖：落地的木杖 + 弯把手，双手握在把手上"""
    t.cyl((0.005, -0.37, 0.0), (0.0, -0.335, 0.66), 0.013, "#8A5A3B", seg=12)
    t.torus((0.0, -0.36, 0.66), 0.03, 0.013, "#8A5A3B", rot=Euler((RAD(90), 0, 0)), arc=(0, math.pi), seg=(16, 8))


def mask(t, s):
    """口罩：浅蓝软椭球罩住下半张脸 + 挂耳绳"""
    p, n = on_head(0, -19, 0.004)
    t.sphere(p, 1.0, "#BFDDF5", scale=(0.12, 0.045, 0.078), rot=face_rot(n), seg=(28, 14))
    for sx in (-1, 1):
        ear, _ = on_head(sx * 84, -8, 0.006)
        t.tube([p + face_rot(n) @ Vector((sx * 0.115, 0.0, 0.02)), ear], 0.004, "#DDEAF5", seg=5)


def headphones(t, s):
    """头戴耳机：头顶半环 + 两侧耳罩"""
    t.torus((0, 0.005, 0.99), 0.255, 0.016, "#2B2B35", rot=Euler((RAD(90), 0, 0)), arc=(RAD(8), RAD(172)), seg=(32, 8))
    for sx in (-1, 1):
        t.sphere((sx * 0.25, 0.005, 0.965), 1.0, "#3A3A46", scale=(0.035, 0.055, 0.065), seg=(16, 10))


def collar(color):
    """领口露出的衬衫领（开衫、夹克里面）"""

    def f(t, s):
        for sx in (-1, 1):
            t.sphere((sx * 0.038, -0.095, 0.79), 1.0, color, scale=(0.045, 0.014, 0.03), rot=Euler((0, RAD(-sx * 30), 0)),
                     seg=(12, 8))

    return f


def hoodie_strings(t, s):
    for sx in (-1, 1):
        t.tube([(sx * 0.035, -0.105, 0.79), (sx * 0.038, -0.122, 0.7)], 0.006, WHITE, seg=6)


EXTRAS = {
    "coat_m": coat_m, "coat_f": coat_f, "stethoscope": stethoscope, "glasses": glasses, "nurse_cap": nurse_cap,
    "badge": badge, "clipboard": clipboard, "phone": phone, "cane": cane, "mask": mask, "headphones": headphones,
    "collar_olive": collar("#7E8B5E"), "collar_blue": collar("#BFD3EA"), "hoodie_strings": hoodie_strings,
}

# 白大褂的下摆：坐着时盖住骨盆两侧（与上衣融成一块）
COAT_TAIL = [E((0, -0.02, 0.53), 0.15, (1.35, 1.15, 0.45))]
HOOD = [E((0, 0.12, 0.8), 0.12, (1.5, 0.8, 0.65))]

# ---------------------------------------------------------------- 人物表（医护 3 人 + 患者 6 人）
CHARACTERS = {
    "doctor_m": dict(skin=SKIN["light"], hair="side_part", hair_c="#24212B", top="#FFFFFF", pants="#2C3652", shoes="#1F1E25",
                     pose="knees", top_extra=COAT_TAIL, extras=["coat_m", "stethoscope", "glasses"]),
    "doctor_f": dict(skin=SKIN["light"], hair="bun_low", hair_c="#5B3B2C", top="#FFFFFF", pants="#6E95CF", shoes="#F5F5F7",
                     pose="lap", lashes=True, top_extra=COAT_TAIL, extras=["coat_f", "clipboard"]),
    "nurse": dict(skin=SKIN["light"], hair="bun_low", hair_c="#5B3B2C", top="#F7B8CC", pants="#F7B8CC", shoes="#F5F5F7",
                  pose="knees", lashes=True, extras=["nurse_cap", "badge"]),
    "elder": dict(skin=SKIN["warm"], hair="curly", hair_c="#CDCAC4", top="#D9C4A4", pants="#6E6852", shoes="#5C3D2B",
                  pose="cane", extras=["collar_olive", "cane"]),
    "woman": dict(skin=SKIN["light"], hair="long", hair_c="#6E4632", top="#EAB54E", pants="#8DB2DE", shoes="#F5F5F7",
                  pose="lap", lashes=True, extras=["phone"]),
    "man_mask": dict(skin=SKIN["warm"], hair="short", hair_c="#2F2B32", top="#35518E", pants="#C8B38D", shoes="#5C3D2B",
                     pose="knees", extras=["collar_blue", "mask"]),
    "teen": dict(skin=SKIN["tan"], hair="messy", hair_c="#201F27", top="#3F8B5D", pants="#2F2F38", shoes="#F5F5F7",
                 pose="clasp", top_extra=HOOD, extras=["hoodie_strings", "headphones"]),
    "auntie": dict(skin=SKIN["warm"], hair="bob", hair_c="#3C2B27", top="#F28B77", pants="#E6D8C4", shoes="#F5F5F7",
                   pose="knees", lashes=True, extras=[]),
    "granny": dict(skin=SKIN["warm"], hair="bun_low", hair_c="#BFBAB4", top="#A088CB", pants="#5D5969", shoes="#4B3B34",
                   pose="lap", lashes=True, extras=["collar_blue"]),
}


def build_person(key, collection):
    s = CHARACTERS[key]
    t = Toy(f"person_{key}")
    body(t, s)
    head(t, s)
    hair(t, s["hair"], s["hair_c"])
    for x in s.get("extras", []):
        EXTRAS[x](t, s)
    return t.finish(collection, seat=(0.45, SEAT))
