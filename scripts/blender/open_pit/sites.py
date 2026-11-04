"""设计稿里没画、但 layout.json 里有的设备摆在哪（纯 numpy，不依赖 bpy）：钻机、推土机、洒水车、指挥巡检车、
移动 5G 基站、采场变电站、充电区、现场调度中心、办公生活区、疏干水处理站、卸载点、端帮皮带、排土皮带。

摆放原则（设计稿优先，见 CLAUDE.md /open-pit）：
- 设计稿里有标签点的（OF-01 / WT-01）按标签点反投影；
- 其余挑设计稿里的空地（深色林地 / 台阶平台），用设计稿像素给位置，反投影时按落点的台阶 / 排土场高度迭代；
- 在路上的车（洒水车、巡检车）取某台电铲运输路线上的点，朝向跟路走；
- 卸载点和推土机围着运输路线的终点（排土场坡脚上离坑最近的那段）摆。
世界坐标同 Blender：x 东、y 北、z 上（米）；朝向 yaw 是绕 z 的弧度，模型局部 +Y 朝前。
"""
import numpy as np

from . import camera as cam
from .pit import DUMPS, PLAT, Pit, dump_ground, ray_hit
from .routes import PLAN, anchors_world, build_route, dump_edge

# 排土场台阶：和 pit.mound() 同一套参数（平台占每级 62 %，整体向重心收拢 72 %）
MOUND_PLAT = 0.62
MOUND_SHRINK = 0.72


def _ray_radius(poly, c, th):
    """多边形 poly 上沿方向 th 离 c 最远的交点距离（排土场底面轮廓对重心星形）"""
    d = np.array([np.cos(th), np.sin(th)])
    Q = np.vstack([poly, poly[:1]])
    best = 0.0
    for a, b in zip(Q[:-1], Q[1:]):
        e = b - a
        M = np.array([[d[0], -e[0]], [d[1], -e[1]]])
        if abs(np.linalg.det(M)) < 1e-9:
            continue
        r, k = np.linalg.solve(M, a - c)
        if r > 0 and 0 <= k <= 1:
            best = max(best, r)
    return best


_GROUND = {}


def _dump_g(name):
    """排土场底面轮廓（推出坑沿后的，和 Blender 里建的土堆同一份），缓存"""
    if name not in _GROUND:
        _GROUND[name] = dump_ground(name)
    return _GROUND[name]


def mound_z(name, x, y):
    """排土场 name 在 (x, y) 处的表面高度；不在排土场上返回 None"""
    d = DUMPS[name]
    g = _dump_g(name)
    c = g.mean(0)
    th = float(np.arctan2(y - c[1], x - c[0]))
    R = _ray_radius(g, c, th)
    r = float(np.hypot(x - c[0], y - c[1]))
    if R <= 0 or r > R:
        return None
    f = min((1 - r / R) / MOUND_SHRINK, 1.0)  # 0 坡脚 … 1 顶面
    n = d["n"]
    k = min(int(f * n), n - 1)
    frac = f * n - k
    if f >= 1:
        return d["height"]
    if frac < MOUND_PLAT:
        return d["height"] * k / n
    return d["height"] * (k + (frac - MOUND_PLAT) / (1 - MOUND_PLAT)) / n


class Sites:
    def __init__(self):
        self.p = Pit()
        self.a = cam.outline()["anchors"]
        self.anchors, self.bases = anchors_world(self.p, self.a)
        self.sinks = {"DP-W": dump_edge(self.p, "DP-W"), "DP-I": dump_edge(self.p, "DP-I"), "CR-01": self.anchors["CR-01"], "CR-02": self.anchors["CR-02"]}
        self._routes = {}

    # ------------------------------------------------------------------ 高度
    def z_at(self, x, y):
        """地表高度：坑里按台阶，排土场上按土堆，其余是 0"""
        _, s = self.p.locate(x, y)
        if s > 0:
            return self.p.z_of_s(s)
        for name in DUMPS:
            z = mound_z(name, x, y)
            if z is not None:
                return z
        return 0.0

    def place(self, img):
        """设计稿像素 → 视线和地表（台阶 / 排土场 / 地面）的第一个交点 (x, y, z)；排土场高出地面，从 120 m 往下找"""
        return ray_hit(img, self.z_at, z_top=120.0)

    def on_platform(self, x, y, f_plat=0.8):
        """坑里的点吸附到所在台阶的平台上（不落在陡坎斜面上）：平台占每级的前 PLAT，路在平台中线（f_plat = 0.5），
        f_plat 是在平台上的位置（0 = 上一级陡坎的坡脚，1 = 本级坎顶）；离下一级平台更近就放到下一级"""
        th, s = self.p.locate(x, y)
        if s <= 0 or s >= 1:
            return x, y, self.z_at(x, y)
        k = int(s * cam.NB)
        f = s * cam.NB - k
        if f > (1 + PLAT) / 2 and k + 1 < cam.NB:
            k += 1
        s2 = (k + f_plat * PLAT) / cam.NB
        x2, y2 = self.p.point(th, s2)
        return float(x2), float(y2), self.p.z_of_s(s2)

    def place_bench(self, img):
        """设计稿像素 → 坑里的点吸附到平台上（坑外不变）"""
        return self.on_platform(*self.place(img)[:2])

    # ------------------------------------------------------------------ 路线上的点
    def route(self, es):
        if es not in self._routes:
            sink, d, extra = PLAN[es]
            self._routes[es] = np.array([q[:3] for q in build_route(self.p, self.anchors[es], self.sinks[sink], d, extra)], float)
        return self._routes[es]

    def on_route(self, es, frac):
        """电铲 es 的运输路线上按长度比例 frac 取一点：(x, y, z, yaw)，yaw 让车头朝路线前进方向"""
        R = self.route(es)
        seg = np.hypot(*np.diff(R[:, :2], axis=0).T)
        cum = np.r_[0, np.cumsum(seg)]
        s = frac * cum[-1]
        i = int(np.clip(np.searchsorted(cum, s) - 1, 0, len(R) - 2))
        t = (s - cum[i]) / max(seg[i], 1e-6)
        q = R[i] + (R[i + 1] - R[i]) * t
        d = R[i + 1] - R[i]
        return float(q[0]), float(q[1]), float(q[2]), float(np.arctan2(-d[0], d[1]))

    def _yaw_to(self, x, y, tx, ty):
        """让局部 +Y 指向 (tx, ty)"""
        return float(np.arctan2(-(tx - x), ty - y))

    # ------------------------------------------------------------------ 排土场坡脚（卸载点 / 推土机）
    def dump_foot(self, name, dth, f_ring):
        """排土场 name 上：从重心看，卸载点方向转 dth 弧度、环比例 f_ring（0 坡脚 … 1 顶面）处的点"""
        g = _dump_g(name)
        c = g.mean(0)
        sx, sy, _ = self.sinks[name]
        th = float(np.arctan2(sy - c[1], sx - c[0])) + dth
        R = _ray_radius(g, c, th)
        r = R * (1 - MOUND_SHRINK * f_ring)
        x, y = c[0] + r * np.cos(th), c[1] + r * np.sin(th)
        z = mound_z(name, x, y) or 0.0
        return float(x), float(y), float(z), th, (float(c[0]), float(c[1]))

    # ------------------------------------------------------------------ 全部
    def devices(self):
        """设备编号 → {kind, loc (x, y, z), yaw}"""
        out = {}

        def put(i, kind, loc, yaw=0.0):
            out[i] = {"kind": kind, "loc": tuple(round(float(v), 2) for v in loc), "yaw": round(float(yaw), 4)}

        # 建筑类：正面朝南（朝相机），yaw 0
        put("OF-01", "office", self.place((1000, 800)))
        put("WT-01", "water_plant", self.place((600, 78)))
        put("CC-01", "control_center", self.place((800, 708)))
        put("SS-01", "substation", self.place((518, 694)))
        put("CH-01", "charger", self.place((598, 702)))

        # 移动 5G 基站：坑外一圈 + 三台跟着工作面放在台阶上（「移动」基站，拖车式）
        bs_img = [
            (272, 640), (186, 455), (402, 250), (590, 118), (842, 78), (1110, 98),
            (1264, 198), (1186, 470), (1052, 586), (706, 548), (1000, 338), (700, 262),
        ]
        for i, img in enumerate(bs_img):
            x, y, z = self.place_bench(img)
            put(f"BS-{i + 1:02d}", "mast", (x, y, z), self._yaw_to(x, y, *self.p.center))

        # 穿孔钻机：上部台阶（爆破区在电铲前方的高台阶上），钻架朝坑壁
        for i, img in enumerate([(852, 214), (1118, 300), (586, 382)]):
            x, y, z = self.place_bench(img)
            cx, cy = self.p.center
            put(f"DR-{i + 1:02d}", "drill", (x, y, z), self._yaw_to(x, y, 2 * x - cx, 2 * y - cy))

        # 卸载点：每座排土场 4 个，沿坡脚第一级平台在运输路线终点两侧排开
        for name, tag in (("DP-W", "W"), ("DP-I", "I")):
            for j, dth in enumerate((-0.16, -0.055, 0.055, 0.16)):
                x, y, z, th, c = self.dump_foot(name, dth, 0.18 / DUMPS[name]["n"])
                # 挡车土埂沿坡脚走向（垂直于径向），局部 +Y = 切向
                put(f"UL-{tag}{j + 1:02d}", "unload", (x, y, z), th)
            # 推土机：在卸载点后面的平台上推土，铲刀朝外
            for j, dth in enumerate((-0.11, 0.11)):
                x, y, z, th, c = self.dump_foot(name, dth, 0.42 / DUMPS[name]["n"])
                k = j + (1 if name == "DP-W" else 3)
                put(f"BD-{k:02d}", "dozer", (x, y, z), self._yaw_to(x, y, 2 * x - c[0], 2 * y - c[1]))

        # 洒水车 / 指挥巡检车：停在运输路线上（取路线上的点，车头顺着路）
        for i, (es, f) in enumerate((("ES-03", 0.42), ("ES-05", 0.55), ("ES-01", 0.66))):
            x, y, z, yaw = self.on_route(es, f)
            put(f"WC-{i + 1:02d}", "water_truck", (x, y, z), yaw)
        for i, (es, f) in enumerate((("ES-04", 0.72), ("ES-06", 0.36), ("ES-02", 0.84), ("ES-05", 0.2))):
            x, y, z, yaw = self.on_route(es, f)
            put(f"CV-{i + 1:02d}", "patrol", (x, y, z), yaw)
        return out

    def belts(self):
        """端帮皮带 BC-01（坑内破碎站 CR-02 沿端帮爬到坑沿的 CR-01）、排土皮带 BC-03（轮斗挖掘机 BW-01 沿北坑沿到内排土场）。
        返回 编号 → [(x, y, z_地表), …]（中间按 25 m 加密，带地表高度，Blender 里按它立支架）"""

        def dense(pts, step=25.0, outside=False):
            """按 step 米加密并带上地表高度；outside 时把落进坑沿以内的点沿径向推回坑沿外（地面皮带不能切进坑里）"""
            out = []
            for a, b in zip(pts[:-1], pts[1:]):
                n = max(1, int(np.hypot(b[0] - a[0], b[1] - a[1]) / step))
                out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n)]
            out.append(tuple(pts[-1][:2]))
            res = []
            for x, y in out:
                if outside:
                    th, s = self.p.locate(x, y)
                    if s > -0.04:
                        x, y = self.p.point(th, -0.04)
                res.append((float(x), float(y), self.z_at(x, y)))
            return res

        bc01 = [self.anchors["CR-02"][:2], self.anchors["CR-01"][:2]]
        bw = self.bases["BW-01"]
        th0, _ = self.p.locate(bw[0], bw[1])
        sx, sy, _ = self.sinks["DP-I"]
        th1, _ = self.p.locate(sx, sy)
        # 沿坑沿外侧（s = -0.06）从轮斗的方位绕到内排土场方位，走短的那一边
        dth = (th1 - th0 + np.pi) % (2 * np.pi) - np.pi
        rim = [self.p.point(th0 + dth * t, -0.06) for t in np.linspace(0.08, 0.92, 8)]
        bc03 = [bw[:2], *rim, (sx, sy)]
        return {"BC-01": dense(bc01), "BC-03": dense(bc03, outside=True)}


def label_anchor(kind, loc):
    """标签锚点：设备顶上一点（按模型放大后的高度估的），选中光环用 loc"""
    up = {
        "office": 40, "water_plant": 26, "control_center": 60, "substation": 30, "charger": 30,
        "mast": 95, "drill": 75, "unload": 35, "dozer": 25, "water_truck": 25, "patrol": 15,
    }.get(kind, 30)
    return (loc[0], loc[1], loc[2] + up)
