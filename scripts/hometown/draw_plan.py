"""老家（营山 · 五通村）简易地图草图。

地物全部按卫星截图 docs/design/hometown/satellite-outline-v2.webp（1704×1282）
人工描绘，坐标是该图的像素坐标 (x 向右, y 向下)。
- 比例：0.2165 m/px（与 2017 截图配准求得：0.410 m/px × 0.528）
- 方位：图像"上"= 真方位约 76.2°，真北指向图像左上偏左

运行：python3 scripts/hometown/draw_plan.py
输出：
  docs/design/hometown/plan-v1.png        草图（地物分类着色 + 图例 + 回家路线）
  docs/design/hometown/plan-v1-check.png  地物叠在卫星图上，用来核对描得准不准
"""

import json
import math
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import patheffects  # noqa: E402
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.patches import Polygon, FancyArrowPatch  # noqa: E402
from matplotlib.path import Path as MplPath  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan_hd as HD  # noqa: E402  高清卫星图重新识别的地图数据（build_site 用 P.HD）
from PIL import Image  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DESIGN = os.path.join(ROOT, "docs", "design", "hometown")
SAT = os.path.join(DESIGN, "satellite-outline-v2.webp")
FONT = FontProperties(fname="/System/Library/Fonts/Hiragino Sans GB.ttc")

M_PER_PX = 0.2165
UP_AZIMUTH = 76.2  # 图像"上"方向的真方位角（度）

# ---------------------------------------------------------------- 范围红线
OUTLINE = [
    (195, 420), (210, 385), (270, 375), (310, 352), (335, 320), (345, 262),
    (360, 200), (390, 150), (425, 118), (460, 113), (520, 127), (600, 143),
    (650, 152), (700, 170), (760, 200), (800, 213), (830, 222), (875, 252),
    (905, 287), (940, 315), (962, 345), (960, 370), (1000, 368), (1050, 358),
    (1072, 348), (1085, 300), (1110, 252), (1160, 205), (1230, 180),
    (1300, 175), (1400, 172), (1445, 182), (1472, 205), (1475, 260),
    (1460, 312), (1430, 352), (1405, 392), (1442, 402), (1455, 418),
    (1452, 500), (1452, 572), (1438, 592), (1430, 640), (1428, 760),
    (1422, 835), (1312, 845), (1312, 905), (1305, 968), (1280, 975),
    (1200, 995), (1100, 1020), (1000, 1050), (920, 1075), (850, 1100),
    (800, 1150), (700, 1200), (650, 1212), (520, 1225), (420, 1225),
    (350, 1200), (300, 1150), (250, 1060), (215, 960), (205, 880),
    (255, 862), (245, 780), (235, 700), (215, 620), (200, 560), (195, 500),
]


def rect(cx, cy, w, h, ang=0):
    """以中心、长宽、旋转角（度，图像坐标下顺时针为正）生成矩形四角。"""
    a = math.radians(ang)
    c, s = math.cos(a), math.sin(a)
    pts = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2),
                   (-w / 2, h / 2)):
        pts.append((cx + dx * c - dy * s, cy + dx * s + dy * c))
    return pts


# 田埂路（田块之间能走的田埂）：卫星图上看得见的照描（西侧田块分界、小路延长线），
# 大田内部看不清的，按中间斜路的走向（西南—东北）和两期影像的色块分界推断，
# 田块约 25–40 m。所有田埂与 PATHS / 回家路线连成网，每块田都走得到。
FIELD_BUNDS = [
    # 中间斜路往西南延伸到大田南沿
    [(640, 780), (585, 840), (530, 905), (500, 945)],
    # 与斜路平行的两条（把大田分成三长条）
    [(985, 600), (870, 712), (760, 820), (655, 925), (575, 1010)],
    [(1040, 770), (935, 860), (830, 960), (760, 1050), (700, 1115)],
    # 横向（西北—东南）分隔
    [(700, 690), (800, 775), (905, 870), (975, 935)],
    [(505, 950), (600, 1035), (690, 1115)],
    [(845, 555), (920, 615), (990, 680)],
    [(585, 840), (690, 935), (790, 1030), (850, 1080)],
    # 西侧小块水田一分为二
    [(228, 748), (300, 742), (378, 752)],
    # 旱地斜条之间（卫星图上可见的亮暗条带分界）
    [(575, 700), (660, 640), (765, 560)],
    [(600, 740), (690, 680), (790, 610)],
    # 西侧旱地中间的分界
    [(345, 700), (440, 690), (540, 705)],
]

# 回家路线（蓝线）：公路路口 → 我家
ROUTE = [(1100, 995), (1070, 940), (1045, 880), (1045, 855), (1065, 830),
         (1070, 800), (1050, 750), (1025, 705), (1000, 640), (985, 580),
         (985, 540), (970, 525), (940, 515), (895, 500), (893, 485),
         (920, 460), (905, 445), (870, 425), (840, 400), (810, 378)]


def beside_route(i0, i1, dx):
    """取回家路线第 i0..i1 个点（可倒序），整体横移 dx 像素。

    大田和厂区之间就是这条小路：大田右边缘 = 路线左移，厂区左边缘 = 路线右移，
    两边各让出约 7 px（≈1.5 m），中间留出路面。
    """
    step = 1 if i1 >= i0 else -1
    return [(ROUTE[k][0] + dx, ROUTE[k][1]) for k in range(i0, i1 + step, step)]


# ---------------------------------------------------------------- 面状地物
# kind: paddy 水田 / dry 旱地 / veg 菜地 / wood 树林 / pond 池塘 / yard 院坝·晒坝
#       / rubble 回收料场
AREAS = [
    # 树林：北侧坡上的林带、东北角整片林子、西侧林团、田边树带
    ("wood", [(425, 118), (520, 127), (600, 143), (700, 170), (760, 200),
              (830, 222), (875, 252), (905, 287), (940, 315), (962, 345),
              (900, 345), (850, 292), (770, 272), (700, 288), (660, 300),
              (600, 285), (560, 290), (520, 262), (470, 255), (430, 262),
              (400, 300), (360, 300), (360, 200), (390, 150)]),
    ("wood", [(1085, 300), (1110, 252), (1160, 205), (1230, 180), (1300, 175),
              (1400, 172), (1445, 182), (1472, 205), (1475, 260), (1460, 312),
              (1430, 352), (1405, 392), (1442, 402), (1455, 418), (1452, 470),
              (1300, 462), (1225, 475), (1170, 450), (1150, 425), (1085, 420),
              (1080, 360)]),
    ("wood", [(310, 352), (440, 335), (455, 420), (420, 470), (340, 475),
              (300, 430), (270, 395)]),
    # （大田上方那一片原先当成树带，用户确认是水田，已删除 → 底色即水稻田）
    ("wood", [(985, 470), (1040, 515), (1150, 535), (995, 545)]),
    ("wood", [(205, 880), (255, 862), (290, 900), (280, 1000), (300, 1100),
              (330, 1170), (300, 1150), (250, 1060), (215, 960)]),
    ("wood", [(420, 860), (470, 870), (480, 1000), (470, 1080), (430, 1070),
              (415, 960)]),
    # 池塘：西北片那块深色水面
    ("pond", [(450, 312), (515, 296), (562, 318), (572, 378), (545, 415),
              (482, 422), (446, 388)]),
    # 菜地：坡上一条条的小块菜地
    ("veg", [(362, 205), (420, 190), (430, 262), (400, 300), (360, 298)]),
    ("veg", [(700, 205), (790, 235), (840, 268), (770, 272), (700, 255)]),
    ("veg", [(540, 470), (650, 455), (690, 490), (640, 515), (550, 520)]),
    ("veg", [(605, 375), (690, 365), (700, 425), (650, 450), (600, 430)]),
    ("veg", [(1340, 195), (1420, 190), (1425, 250), (1345, 255)]),
    ("veg", [(200, 505), (300, 520), (310, 600), (250, 640), (210, 620)]),
    # 旱地：西南的黄褐色地块和斜向长条地
    ("dry", [(320, 640), (430, 600), (520, 640), (560, 720), (560, 795),
             (470, 805), (400, 765), (345, 700)]),
    ("dry", [(560, 640), (640, 580), (760, 505), (800, 520), (760, 600),
             (680, 650), (600, 690)]),
    # 水田：中部的大片稻田（用户确认种水稻）+ 西侧一块
    ("paddy", [(760, 610), (850, 548), (905, 525)] + beside_route(10, 2, -7)
     + [(1000, 920),
               (930, 965), (870, 1010), (840, 1080), (760, 1110),
               (640, 1130), (560, 1085), (500, 1000), (480, 900),
               (480, 830), (570, 800), (620, 740), (690, 670)]),
    ("paddy", [(215, 650), (300, 640), (345, 700), (400, 765), (380, 830),
               (290, 860), (250, 858), (240, 760)]),
    # 院坝 / 晒坝
    ("yard", [(300, 945), (400, 925), (420, 1040), (380, 1080), (320, 1080)]),  # 气罐仓库院子
    ("yard", [(875, 430), (930, 455), (920, 475), (860, 455)]),  # 我家门前院坝
    ("yard", [(1180, 860), (1300, 850), (1305, 965), (1180, 990)]),
    # 厂区硬地面：用户红圈的范围，左边缘就是大田旁的小路
    ("factory", beside_route(2, 10, 7)
     + [(1212, 534), (1248, 486), (1318, 459), (1386, 470), (1426, 530),
        (1424, 604), (1382, 663), (1328, 695), (1321, 741), (1323, 792),
        (1246, 820), (1132, 847), (1092, 876)]),
    # 回收站的料场（白色碎料堆）
    ("rubble", [(1040, 650), (1180, 640), (1200, 745), (1060, 765)]),
]

# ---------------------------------------------------------------- 建筑
# roof: red 红瓦 / grey 青瓦·深色 / blue 蓝色彩钢 / white 浅色平顶 / home 我家
BUILDINGS = [
    # 北坡一排
    ("blue", rect(485, 217, 55, 45, -20)),
    ("white", rect(598, 222, 48, 28, -10)),
    ("red", rect(640, 245, 45, 55, 20)),
    ("red", rect(800, 332, 85, 55, 28)),
    ("red", rect(685, 410, 45, 40, 25)),
    ("home", rect(912, 398, 105, 48, 30)),
    ("grey", rect(980, 465, 45, 35, 30)),
    ("blue", rect(998, 512, 25, 22, 0)),
    ("red", rect(1065, 493, 75, 35, -40)),
    # 东北林子里
    ("red", [(1095, 330), (1130, 300), (1160, 330), (1160, 410),
             (1110, 420), (1088, 395)]),
    ("grey", rect(1335, 315, 70, 55, 30)),
    ("red", rect(1357, 380, 30, 32, 0)),
    # 西侧一片
    ("white", rect(290, 450, 45, 40, 0)),
    ("red", rect(315, 500, 55, 45, 25)),
    ("grey", rect(358, 470, 48, 45, 10)),
    ("grey", rect(440, 492, 60, 45, 10)),
    ("white", rect(478, 545, 35, 28, 0)),
    # 西南气罐仓库（长条库房 + 围墙院子）及其南边的人家
    ("white", rect(335, 895, 80, 35, -28)),
    ("grey", rect(300, 1010, 30, 90, -20)),
    ("grey", rect(372, 1110, 60, 40, -25)),
    ("blue", rect(335, 1160, 40, 60, -25)),
    ("grey", rect(482, 1118, 70, 45, -20)),
    ("blue", rect(595, 1125, 60, 50, -15)),
    ("red", rect(525, 1170, 70, 40, -15)),
    ("white", rect(470, 1178, 30, 25, 0)),
    # 公路边
    ("grey", rect(965, 985, 60, 45, -20)),
    ("grey", rect(900, 1045, 80, 40, -20)),
    ("blue", rect(1120, 905, 55, 45, -5)),
    ("grey", rect(1200, 925, 70, 50, -5)),
    ("grey", rect(1270, 920, 40, 60, 0)),
    # 回收站
    ("blue", rect(1225, 620, 95, 150, -8)),
    ("blue", rect(1085, 648, 70, 45, -10)),
    ("blue", rect(1058, 702, 40, 40, -10)),
    ("white", rect(1030, 645, 32, 30, -10)),
    # 养猪场
    ("white", rect(1365, 512, 140, 60, 3)),
    ("grey", rect(1320, 630, 35, 140, 2)),
    ("grey", rect(1395, 645, 45, 160, 2)),
    ("red", rect(1305, 702, 55, 75, 0)),
    # 下面的小厂
    ("blue", rect(1250, 812, 100, 45, -8)),
    ("blue", rect(1110, 835, 45, 50, -8)),
]

# 用户一栋一栋手描的房屋轮廓（trace_houses.py 生成）。被它盖住的粗描矩形去掉，
# 判断方法：在矩形里撒 7×7 个采样点，超过 20% 落在任一手描轮廓内就算同一栋
with open(os.path.join(os.path.dirname(__file__), "houses.json")) as _f:
    TRACED = [(h["roof"], [tuple(p) for p in h["pts"]])
              for h in json.load(_f)["houses"]]
_TRACED_PATHS = [MplPath(pts) for _, pts in TRACED]


def _covered(pts):
    own = MplPath(pts)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    samples = [(min(xs) + (max(xs) - min(xs)) * (i + 0.5) / 7,
                min(ys) + (max(ys) - min(ys)) * (j + 0.5) / 7)
               for i in range(7) for j in range(7)]
    samples = [q for q in samples if own.contains_point(q)]
    hit = sum(any(t.contains_point(q) for t in _TRACED_PATHS) for q in samples)
    return samples and hit / len(samples) > 0.2


BUILDINGS = [b for b in BUILDINGS if not _covered(b[1])] + TRACED

# 我家：2026-10-13 用户要求"按照真实卫星地图排列"——放到高清图上真实的红瓦大屋顶处。
# 屋顶约 20 × 10.5 m（四角约 (761, 335) (839, 288) (860, 330) (782, 380)），长边朝东南，
# 正面朝 150°（截图正上方为 0°、顺时针）。模型的红瓦顶 = 正房 12 m + 右侧新修那栋 5.8 m，
# 正房在西南头、新修那栋在东北头（面对房子的右手边），两头各留约 0.7 m 挑檐；
# 正房中心在屋顶中心往西南 2.9 m。门前地坝正好落在屋顶东南那块浅色地面上（用户："只有下方才有院坝"）。
# 之前的位置 (780, 385)、朝向 188° 是按旧截图和 3D 图圈定的，已作废
HOME_AT = (799, 340)
HOME_BEARING = 150.0


def home_local(x, f):
    """我家局部坐标（米：x 向右（面对房子看）、f 向正前方，原点是正房中心）→ v2 像素。"""
    a_ = math.radians(90 - HOME_BEARING)
    fx, fy = math.cos(a_), math.sin(a_)          # 米制里的正前方
    rx, ry = -fy, fx                             # 面对房子时的右手方向
    return (HOME_AT[0] + (rx * x + fx * f) / M_PER_PX,
            HOME_AT[1] - (ry * x + fy * f) / M_PER_PX)


# 草图上画出地坝和新修那栋（尺寸同 houses.py：地坝 12.4 × 9 m、铁门中心 x = 1.8；
# 新修那栋 x 6 → 11.8、f -2.8 → 7.6），看得出回家路线怎么绕到铁门
HOME_YARD = [home_local(x, f) for x, f in ((-6.2, 5), (6.2, 5), (6.2, 14), (-6.2, 14))]
HOME_EXT = [home_local(x, f) for x, f in ((6, -2.8), (11.8, -2.8), (11.8, 7.6), (6, 7.6))]
HOME_GATE = [home_local(0.9, 14), home_local(2.7, 14)]
# 2026-10-13 用户给了高清卫星图（plan_hd.py），要求"以新图为准重做地图，我的房子模型保留"：
# 其它房子全部换成高清图上逐栋描的屋顶；上面按旧截图描的房屋数据只留作历史，不再使用
BUILDINGS = list(HD.HD_BUILDINGS) + [
    ("home", rect(HOME_AT[0], HOME_AT[1], 12 / M_PER_PX, 10 / M_PER_PX,
                  HOME_BEARING - 180))]

# 回家路线（2026-10-13 用户在高清图上重画的红线，route-fields-sketch-1.webp）：
# 公路路口 → 沿厂区西边、大田东边的小路往北 → 大田东北角往西拐 →
# 穿过我家右侧两户人家门前的地坝（plan_hd.HD_YARDS）→ 走到我家地坝前墙外。
# 红线骨架化后平滑、约每 8 px 取一点；离厂房不到 7 px 的点往西推（路面半宽约 1.1 m）。
# 红线随后从前墙铁门进地坝、走到大门：这一段由 build_site.route_to_gate 接上
# （铁门中心 x = 1.8），所以这里截到进地坝之前（最后一点在我家局部坐标 右 4.5 m、前 17.2 m）
ROUTE = [
    (1131.1, 1028.0), (1127.4, 1021.0), (1123.1, 1014.4), (1118.1, 1008.2),
    (1112.3, 1002.2), (1105.4, 996.3), (1098.4, 990.4), (1093.4, 984.5),
    (1089.9, 978.5), (1086.0, 972.3), (1082.0, 965.7), (1078.8, 958.5),
    (1076.7, 950.9), (1075.6, 943.0), (1074.8, 935.1), (1073.8, 927.1),
    (1072.5, 919.3), (1070.7, 911.5), (1068.4, 903.9), (1065.4, 896.5),
    (1062.3, 889.1), (1059.2, 881.7), (1056.3, 874.3), (1053.0, 867.0),
    (1049.5, 859.9), (1046.5, 852.6), (1045.1, 845.2), (1046.0, 837.7),
    (1048.7, 830.4), (1051.7, 823.0), (1054.3, 815.5), (1056.1, 807.8),
    (1056.9, 799.9), (1057.0, 791.9), (1056.3, 784.0), (1054.7, 776.3),
    (1052.5, 768.7), (1050.1, 761.0), (1047.5, 753.5), (1044.6, 746.1),
    (1040.1, 738.7), (1031.8, 731.4), (1021.3, 724.1), (1014.3, 716.7),
    (1012.0, 709.4), (1011.4, 702.1), (1011.2, 694.7), (1010.9, 687.2),
    (1009.9, 679.5), (1008.3, 671.7), (1007.1, 663.7), (1006.5, 655.8),
    (1006.1, 647.8), (1006.1, 639.9), (1006.9, 632.0), (1008.3, 624.1),
    (1009.3, 616.1), (1009.4, 608.1), (1009.1, 600.1), (1008.7, 592.1),
    (1008.0, 584.2), (1006.7, 576.3), (1004.8, 568.6), (1002.1, 561.1),
    (998.4, 554.4), (993.1, 548.9), (986.5, 544.9), (979.1, 542.2),
    (971.4, 539.9), (963.8, 537.5), (956.2, 534.9), (948.7, 532.1),
    (941.3, 529.0), (934.0, 525.8), (926.9, 522.3), (919.9, 518.3),
    (913.7, 513.7), (909.3, 507.8), (907.4, 500.8), (907.5, 493.2),
    (908.0, 485.7), (908.5, 478.2), (909.3, 470.7), (910.3, 462.9),
    (911.5, 455.1), (911.7, 447.8), (909.7, 442.0), (904.8, 437.6),
    (898.6, 433.4), (892.9, 428.2), (887.6, 422.4), (881.9, 417.0),
    (875.7, 412.1), (869.5, 407.2), (863.4, 402.3), (856.6, 398.4)]

# 厂区范围：用户黄圈里左侧回收站 / 右侧猪场 / 下面小厂，加上西南的气罐仓库（围墙院子）
ZONES = [
    ("垃圾回收站", [(1224, 473), (1194, 533), (1134, 553), (994, 598),
                 (1039, 763), (1184, 743), (1285, 735), (1285, 470)]),
    ("养猪场", [(1285, 470), (1294, 458), (1444, 458), (1449, 528),
             (1404, 683), (1369, 728), (1324, 733), (1285, 735)]),
    ("气罐仓库", [(285, 870), (385, 855), (425, 920), (440, 1060), (410, 1100),
              (320, 1110), (285, 1030)]),
    ("小工厂", [(1069, 778), (1349, 758), (1344, 798), (1234, 833),
             (1079, 863)]),
]

ZONE_LABEL_AT = {"小工厂": (1160, 790)}

# ---------------------------------------------------------------- 线状地物
# 公路（沿红线南边，左窄右宽，路口处是一片开阔路面）：上沿 + 下沿围成的面
ROAD = [(360, 1282), (560, 1215), (800, 1130), (1000, 1062), (1200, 1025),
        (1400, 1010), (1704, 985), (1704, 1100), (1400, 1110), (1200, 1100),
        (1000, 1095), (850, 1135), (700, 1190), (560, 1250), (450, 1282)]
ROAD_BRANCH = [(1215, 1100), (1290, 1100), (1270, 1282), (1200, 1282)]
# 小河（红线东侧外沿，混凝土河堤，过公路处有桥；用户确认是小河不是水渠）：西岸 + 东岸围成的面
CANAL = [(1475, 200), (1470, 300), (1460, 420), (1455, 520), (1445, 620),
         (1435, 720), (1425, 820), (1418, 985), (1450, 985), (1460, 880),
         (1490, 760), (1530, 650), (1560, 560), (1580, 450), (1600, 330),
         (1610, 200)]
# 田间小路
PATHS = [
    [(200, 560), (250, 620), (290, 660), (330, 700), (380, 760), (410, 800),
     (470, 830)],
    [(640, 780), (700, 720), (760, 655), (850, 560), (900, 525)],
    [(480, 560), (560, 525), (650, 500), (720, 470), (810, 380)],
    [(395, 1065), (410, 1150), (425, 1225)],
    [(1040, 850), (960, 940), (870, 1010)],
]
OUTLINE = HD.outline()
FIELD_BUNDS = HD.HD_BUNDS + HD.field_bunds()   # 两片按田埂分块的田（用户蓝线圈定）
PATHS = []
AREAS = []   # 面状地物改由 HD.landcover() 逐像素给出（build_site.py 直接读栅格）

STYLE = {
    "paddy": dict(fc="#9fd97f", ec="#5f9e48", hatch="---", label="水稻田（空地也是）"),
    "dry": dict(fc="#e2c98f", ec="#b49a5c", hatch="", label="旱地"),
    "veg": dict(fc="#c7e08a", ec="#8aa84a", hatch="|||", label="菜地"),
    "wood": dict(fc="#4f8a57", ec="#35633c", hatch="oo", label="树林 / 竹林"),
    "pond": dict(fc="#7ec3e6", ec="#3f8fbf", hatch="", label="池塘"),
    "yard": dict(fc="#ece4d2", ec="#b8ad95", hatch="", label="院坝 / 晒坝"),
    "factory": dict(fc="#dcd8cd", ec="#a9a394", hatch="", label="厂区硬地面"),
    "rubble": dict(fc="#d8d6cf", ec="#9a978e", hatch="..", label="回收料场"),
}
ROOF = {
    "red": dict(fc="#c9583e", label="红瓦房"),
    "brown": dict(fc="#8a5a3c", label="棕瓦房"),
    "grey": dict(fc="#6e6a66", label="青瓦 / 深色屋顶"),
    "blue": dict(fc="#3c7fd9", label="蓝色彩钢顶"),
    "white": dict(fc="#f3f2ee", label="平顶房（浅色）"),
    "home": dict(fc="#e0a31c", label="我家"),
}

HALO = [patheffects.withStroke(linewidth=4, foreground="white")]


_LC_CACHE = []


def _landcover_rgba(alpha):
    """HD.landcover() 的分类结果 → RGBA 图（颜色取图例），沙盘外透明。"""
    if not _LC_CACHE:
        _LC_CACHE.append(HD.landcover())
    lc = _LC_CACHE[0]
    import numpy as np
    colors = {"wood": STYLE["wood"]["fc"], "paddy": STYLE["paddy"]["fc"],
              "dry": STYLE["dry"]["fc"], "veg": STYLE["veg"]["fc"],
              "pond": STYLE["pond"]["fc"], "hard": STYLE["yard"]["fc"],
              "road": "#f4f1ea"}
    out = np.zeros(lc.shape + (4,), np.float32)
    for k, c in colors.items():
        rgb = [int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        out[lc == HD.LC[k]] = rgb + [alpha]
    return out


def draw(ax, check):
    """画全部地物；check=True 时半透明叠在卫星图上供核对。"""
    alpha = 0.45 if check else 1.0
    clip = Polygon(OUTLINE, closed=True, transform=ax.transData)
    # 公路 / 小河放在最底层，作为红线外的参照
    for pts in (ROAD, ROAD_BRANCH):
        ax.add_patch(Polygon(pts, closed=True, fc="#f4f1ea", ec="#b9b2a2",
                             lw=2, alpha=alpha, zorder=1))
    ax.add_patch(Polygon(CANAL, closed=True, fc="#7ec3e6", ec="#3f8fbf",
                         lw=2, alpha=alpha, zorder=1))

    if not check:
        # 红线内没有单独标出的空地也都是水稻田（用户确认），底色直接用水田色
        ax.add_patch(Polygon(OUTLINE, closed=True, fc=STYLE["paddy"]["fc"],
                             ec="none", hatch=STYLE["paddy"]["hatch"],
                             zorder=1.5))
    # 高清图逐像素地块分类（树林 / 稻田 / 旱地 / 菜地 / 池塘 / 硬地 / 公路），按图例配色铺底
    lc_rgba = _landcover_rgba(alpha)
    if lc_rgba is not None:
        ax.imshow(lc_rgba, extent=(0, lc_rgba.shape[1], lc_rgba.shape[0], 0),
                  zorder=1.8, interpolation="nearest")
    for kind, pts in AREAS:
        st = STYLE[kind]
        p = Polygon(pts, closed=True, fc=st["fc"], ec=st["ec"], lw=1,
                    hatch=st["hatch"], alpha=alpha, zorder=2)
        p.set_clip_path(clip)
        ax.add_patch(p)
    for pts in FIELD_BUNDS:
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color="#5f7d3a", lw=5, alpha=alpha, zorder=2.9,
                solid_capstyle="round", clip_path=clip)
        ax.plot(xs, ys, color="#e9dfc2", lw=2, alpha=alpha, zorder=2.95,
                solid_capstyle="round", clip_path=clip)
    for pts in PATHS:
        xs, ys = zip(*pts)
        ax.plot(xs, ys, color="#fbf6e6", lw=4, alpha=alpha, zorder=3)
        ax.plot(xs, ys, color="#a8956a", lw=1, ls=(0, (4, 3)), alpha=alpha,
                zorder=3)
    for name, pts in ZONES:
        ax.add_patch(Polygon(pts, closed=True, fc="none", ec="#e8a400",
                             lw=2.5, ls=(0, (6, 4)), zorder=4))
        # 标注默认放在顶点平均位置；小工厂的平均位置正好压在厂房上，单独挪开
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        cx, cy = ZONE_LABEL_AT.get(name, (cx, cy))
        ax.text(cx, cy, name, fontproperties=FONT, fontsize=15, ha="center",
                va="center", color="#7a4f00", path_effects=HALO, zorder=9)
    for roof, pts in BUILDINGS:
        fc = ROOF[roof]["fc"]
        ec = "#8b1a1a" if roof == "home" else "#3d3a36"
        ax.add_patch(Polygon(pts, closed=True, fc=fc, ec=ec,
                             lw=3 if roof == "home" else 1.2,
                             alpha=1 if roof == "home" else alpha, zorder=5))
    # 我家地坝（围墙）、新修那栋、铁门
    ax.add_patch(Polygon(HOME_YARD, closed=True, fc="#ece4d2", ec="#8b1a1a",
                         lw=2, zorder=5))
    ax.add_patch(Polygon(HOME_EXT, closed=True, fc="#f0c75e", ec="#8b1a1a",
                         lw=2, zorder=5))
    (gx0, gy0), (gx1, gy1) = HOME_GATE
    ax.plot([gx0, gx1], [gy0, gy1], color="#222", lw=5, zorder=5.5,
            solid_capstyle="butt")
    # 范围红线
    ax.add_patch(Polygon(OUTLINE, closed=True, fc="none", ec="#e5322d",
                         lw=3, zorder=6))
    # 回家路线
    xs, ys = zip(*ROUTE)
    ax.plot(xs, ys, color="white", lw=9, zorder=7, solid_capstyle="round")
    ax.plot(xs, ys, color="#1f8fff", lw=5, zorder=7, solid_capstyle="round")
    for i in [len(ROUTE) * k // 5 for k in (1, 2, 3, 4)]:
        (x0, y0), (x1, y1) = ROUTE[i], ROUTE[i + 1]
        ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>",
                                     mutation_scale=26, color="#1f8fff",
                                     lw=0, zorder=8))
    ax.text(1112, 1000, "公路路口", fontproperties=FONT, fontsize=15,
            color="#0b5cb5", path_effects=HALO, zorder=9, va="center")
    ax.text(HOME_AT[0], HOME_AT[1] - 45, "我家", fontproperties=FONT, fontsize=20,
            color="#8b1a1a", ha="center", path_effects=HALO, zorder=9,
            weight="bold")
    if check:
        return
    # 地名标注
    for txt, x, y in (("北坡林子", 640, 225), ("东北林子", 1250, 300),
                      ("池塘", 508, 365), ("大田（水田）", 780, 860),
                      ("公路", 600, 1225), ("小河", 1530, 480)):
        ax.text(x, y, txt, fontproperties=FONT, fontsize=14, ha="center",
                va="center", color="#24402a", path_effects=HALO, zorder=9)


def legend(ax):
    """右下角图例 + 比例尺 + 指北针。"""
    from matplotlib.patches import Patch
    from matplotlib.lines import Line2D

    h = [Patch(fc=STYLE[k]["fc"], ec=STYLE[k]["ec"], hatch=STYLE[k]["hatch"],
               label=STYLE[k]["label"]) for k in
         ("paddy", "dry", "veg", "wood", "pond", "yard", "factory",
          "rubble")]
    h += [Patch(fc=ROOF[k]["fc"], ec="#3d3a36", label=ROOF[k]["label"])
          for k in ("home", "red", "brown", "grey", "blue", "white")]
    h += [Line2D([], [], color="#1f8fff", lw=4, label="回家路线（田边小路）"),
          Line2D([], [], color="#a8956a", lw=1, ls="--", label="田间小路"),
          Line2D([], [], color="#5f7d3a", lw=4, label="田埂（可走）"),
          Line2D([], [], color="#e8a400", lw=2, ls="--", label="厂区"),
          Line2D([], [], color="#e5322d", lw=2.5, label="建模范围")]
    ax.legend(handles=h, prop=FONT, loc="upper left", fontsize=12,
              framealpha=0.92, ncol=2, bbox_to_anchor=(0.005, 0.995))
    # 比例尺：50 m
    px = 50 / M_PER_PX
    x0, y0 = 60, 1240
    ax.plot([x0, x0 + px], [y0, y0], color="#222", lw=4, zorder=10)
    for x in (x0, x0 + px):
        ax.plot([x, x], [y0 - 10, y0 + 10], color="#222", lw=2, zorder=10)
    ax.text(x0 + px / 2, y0 - 16, "50 m", fontproperties=FONT, fontsize=13,
            ha="center", path_effects=HALO, zorder=10)
    # 指北针：真北相对图像上方逆时针 UP_AZIMUTH 度
    cx, cy, r = 1620, 1180, 55
    a = math.radians(-UP_AZIMUTH)
    dx, dy = math.sin(a) * r, -math.cos(a) * r
    ax.add_patch(FancyArrowPatch((cx - dx, cy - dy), (cx + dx, cy + dy),
                                 arrowstyle="-|>", mutation_scale=30,
                                 color="#222", lw=3, zorder=10))
    ax.text(cx + dx * 1.45, cy + dy * 1.45, "北", fontproperties=FONT,
            fontsize=16, ha="center", va="center", path_effects=HALO,
            zorder=10)


def render(path, check):
    img = Image.open(SAT).convert("RGB")
    w, h = img.size
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    if check:
        ax.imshow(img, extent=(0, w, h, 0))
    else:
        # 红线外用淡化的灰度卫星图做参照
        ax.imshow(img.convert("L"), cmap="gray", extent=(0, w, h, 0),
                  alpha=0.35, vmin=0, vmax=255)
        ax.set_facecolor("white")
    draw(ax, check)
    if not check:
        legend(ax)
        ax.text(w / 2, 40, "营山 · 五通村  简易地图草图（高清卫星图描绘）",
                fontproperties=FONT, fontsize=24, ha="center",
                path_effects=HALO, zorder=10)
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis("off")
    fig.savefig(path, dpi=100)
    plt.close(fig)
    print("写出", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    render(os.path.join(DESIGN, "plan-v1.png"), check=False)
    render(os.path.join(DESIGN, "plan-v1-check.png"), check=True)
