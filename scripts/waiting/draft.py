"""候诊大厅 · 大屏设计稿合成脚本（只出设计稿，不是页面代码）。

用法：python3 scripts/waiting/draft.py
输入：docs/design/waiting/draft/ai-scene-a.png（中央三维场景，Figma generate_image 生成，无文字）
输出：docs/design/waiting/01-draft-call.png  叫号瞬间（全景，216 诊室刚叫号）
     docs/design/waiting/02-draft-tour.png  轮播推近 218 诊室（16 秒后，216 第 2 次呼叫）

场景取自 /hospital 那家虚构医院的 2F 内科组：南排 8 间诊室 213–220，隔着走廊正对内科候诊区。
镜头从北往南看，所以东侧的 213 在画面最左，房间号自左向右递增。

画面结构（1920 × 1080，配色沿用 /hospital 设计稿 v1 浅色版）：
  顶栏      院区名 + 候诊区 + 出诊时段 + 语音开关 + 时钟
  左栏      候诊概况（待诊 / 复诊 / 过诊 / 已诊）、诊室一览（8 行）、过号名单
  中上      叫号条（常驻显示最近一次叫号，新叫号时连呼 2 次）
  中间      三维场景（AI 图）+ 每间诊室上方的状态标签；被叫诊室橙色高亮
  中下      最近叫号记录（6 条）
  右栏      轮播到的诊室详情：医生、当前就诊（开始时刻 + 已就诊时长）、待诊 / 复诊 / 过诊三组名单
颜色语义：橙色只表示"叫号"；蓝 = 待诊，紫 = 复诊，玫红 = 过诊，深绿 = 导视牌 / 就诊中；就诊超 15 分钟的计时用暗琥珀色。
"""

import os
import random

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs/design/waiting")
FONT_DIR = os.path.join(ROOT, "src/assets/fonts")
S = 2  # 先按 2 倍画，最后缩到 1920 × 1080，边缘更干净
W_, H_ = 1920, 1080

C = dict(
    ground="#E2E8E6", panel="#F2F5F4", panel2="#E9EEEC", ink="#13201C", sub="#56665F", faint="#8C9A95",
    sign="#0F5B4C", sign_ink="#FFFFFF", sign_sub="#B9D9D0", line="#DDE5E2",
    call="#F26B1D", call_tint="#FBE2D2", call_deep="#C94F0C",
    wait="#2E6DB4", recheck="#7B5CC4", missed="#C0446A", done="#13201C",
    busy="#1F9D57", over="#B7791F",
)
STATUS = (("wait", "待诊"), ("recheck", "复诊"), ("missed", "过诊"))

# ---------------------------------------------------------------- AI 图里的几何（像素，按 ai-scene-a.png 量出）
AI_FILE = "ai-scene-a.png"
WALLS = [207, 322, 436, 549, 662, 776, 889, 1003, 1117]  # 8 间诊室的分隔墙（左 → 右）
DOORS = [231, 353, 471, 587, 707, 824, 943, 1063]  # 每间诊室门的中心 x
ROOM_TOP, ROOM_FLOOR = 154, (183, 325)  # 后墙顶、室内地面上下沿
DOOR_Y = 398  # 门前走廊地面

# ---------------------------------------------------------------- 演示数据（固定随机种子，保证两张图一致）
ROOMS = [  # 自左向右；el = 当前患者已就诊秒数（01 图时刻）
    dict(no="213", dept="内分泌科", short="内分泌", doctor="周文静", title="主治医师", wait=4, recheck=1, missed=0, done=12, el=108),
    dict(no="214", dept="神经内科", short="神经内科", doctor="何建平", title="副主任医师", wait=6, recheck=1, missed=1, done=10, el=665),
    dict(no="215", dept="消化内科诊室 1", short="消化内科", doctor="林海涛", title="主任医师", wait=8, recheck=2, missed=1, done=15, el=260),
    dict(no="216", dept="消化内科诊室 2", short="消化内科", doctor="李明华", title="副主任医师", wait=11, recheck=2, missed=1, done=17, el=8, called=True),
    dict(no="217", dept="呼吸内科诊室 1", short="呼吸内科", doctor="陈志远", title="主任医师", wait=5, recheck=1, missed=0, done=14, el=992),
    dict(no="218", dept="呼吸内科诊室 2", short="呼吸内科", doctor="刘雅琴", title="主治医师", wait=7, recheck=0, missed=1, done=11, el=372),
    dict(no="219", dept="心内科诊室 1", short="心内科", doctor="王国栋", title="主任医师", wait=9, recheck=2, missed=1, done=16, el=171, cur_recheck=True),
    dict(no="220", dept="心内科诊室 2", short="心内科", doctor="赵蕾", title="副主任医师", wait=5, recheck=1, missed=0, done=13, el=580),
]
NOW = 9 * 3600 + 42 * 60 + 18  # 01 图时刻 09:42:18（02 图晚 16 秒）
SUR = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤"
GIV = "明华芳军敏静丽强磊洋艳勇杰娟涛超秀霞平刚桂英兰文斌宇浩凯红玉梅琳鹏辉建国志海波晨欣怡婷丹雪峰亮成"


def hms(t, sec=False):
    h, m, s = t // 3600, t % 3600 // 60, t % 60
    return f"{h:02d}:{m:02d}:{s:02d}" if sec else f"{h:02d}:{m:02d}"


def mmss(t):
    return f"{t // 60:02d}:{t % 60:02d}"


def mask(n):
    """姓名脱敏：三个字留首尾（张*明），两个字留姓（李*）"""
    return n[0] + "*" + n[-1] if len(n) >= 3 else n[0] + "*"


def build_queue():
    """给每间诊室生成号码和名单。

    号码全区统一（分诊台签到时按先后发号 A001…），所以同一诊室的号码不连续：
    先把每间诊室的初诊患者按"已诊 → 过号（夹在已诊末尾）→ 当前 → 待诊"排好，
    再按各诊室剩余人数加权随机地交错合并，依次发号。复诊患者从已诊里挑（保留原号）。
    """
    rng = random.Random(20261017)

    def person():
        s = rng.choice(SUR)
        return s + "".join(rng.choice(GIV) for _ in range(2 if rng.random() < 0.7 else 1))

    seqs = []
    for r in ROOMS:
        seq = [("done", None)] * r["done"]
        for k in range(r["missed"]):  # 过号的人夹在已诊的最后几位里
            seq.insert(len(seq) - 1 - 2 * k, ("missed", None))
        if not r.get("cur_recheck"):
            seq.append(("cur", None))
        seq += [("wait", None)] * r["wait"]
        seqs.append(list(seq))
    nums = [[] for _ in ROOMS]
    n = 0
    while any(seqs):
        i = rng.choices(range(len(seqs)), weights=[len(s) for s in seqs])[0]
        kind, _ = seqs[i].pop(0)
        n += 1
        nums[i].append((kind, f"A{n:03d}", mask(person())))
    for r, items in zip(ROOMS, nums):
        r["wait_list"] = [(no, nm) for k, no, nm in items if k == "wait"]
        r["missed_list"] = [(no, nm) for k, no, nm in items if k == "missed"]
        done = [(no, nm) for k, no, nm in items if k == "done"]
        picks = done[: r["recheck"] + (1 if r.get("cur_recheck") else 0)]
        if r.get("cur_recheck"):
            r["cur"] = picks.pop(0) + ("复诊",)
        else:
            r["cur"] = [(no, nm) for k, no, nm in items if k == "cur"][0] + ("初诊",)
        r["recheck_list"] = picks
        r["start"] = NOW - r["el"]
    # 回诊 / 过号时刻（演示用，按位置推一个合理的时间）
    for r in ROOMS:
        r["recheck_time"] = [r["start"] - 600 - 420 * k for k in range(len(r["recheck_list"]))]
        early = {"214": "09:12", "215": "09:24", "216": "09:21", "219": "09:05"}
        if r["no"] in early:
            h, m = map(int, early[r["no"]].split(":"))
            r["missed_time"] = [h * 3600 + m * 60 + 17 - 900 * k for k in range(len(r["missed_list"]))]
        else:
            r["missed_time"] = [r["start"] - 40 - 900 * k for k in range(len(r["missed_list"]))]
    return n


# ---------------------------------------------------------------- 画布
def font(kind, size):
    path = {"title": "AlimamaShuHeiTi-Bold.ttf", "body": "SourceHanSansCN-Regular.otf", "num": "DIN-Bold.otf"}[kind]
    return ImageFont.truetype(os.path.join(FONT_DIR, path), int(size * S))


class Canvas:
    """按 1 倍坐标作画的小封装（内部乘 S）"""

    def __init__(self, bg):
        self.im = Image.new("RGB", (W_ * S, H_ * S), bg)
        self.d = ImageDraw.Draw(self.im)

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], fill=fill)

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, width=1):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], radius=r * S, fill=fill,
                                 outline=outline, width=int(width * S))

    def circle(self, x, y, r, fill):
        self.d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=fill)

    def poly(self, pts, fill):
        self.d.polygon([(x * S, y * S) for x, y in pts], fill=fill)

    def line(self, pts, fill, w):
        self.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=int(w * S), joint="curve")

    def arc(self, box, a0, a1, fill, w):
        self.d.arc([v * S for v in box], a0, a1, fill=fill, width=int(w * S))

    def text(self, x, y, s, kind, size, fill, anchor="la"):
        self.d.text((x * S, y * S), s, font=font(kind, size), fill=fill, anchor=anchor)

    def tw(self, s, kind, size):
        """文字宽度（1 倍坐标）"""
        b = self.d.textbbox((0, 0), s, font=font(kind, size), anchor="ls")
        return (b[2] - b[0]) / S

    def run(self, x, base, parts):
        """一行里混排多种字体：parts = [(文字, 字体, 字号, 颜色, 后间距)]，按基线对齐，返回结束 x"""
        for s, kind, size, color, gap in parts:
            self.text(x, base, s, kind, size, color, anchor="ls")
            x += self.tw(s, kind, size) + gap
        return x

    def pill(self, x, y, s, size, fg, bg, pad=8, h=None, anchor="l"):
        """圆角小标签；anchor = l / r / c 表示 x 是左边、右边还是中心，返回 (左, 右)"""
        w = self.tw(s, "body", size) + pad * 2
        h = h or size + 10
        x0 = {"l": x, "r": x - w, "c": x - w / 2}[anchor]
        self.rrect(x0, y, x0 + w, y + h, h / 2, fill=bg)
        self.text(x0 + w / 2, y + h / 2 + 1, s, "body", size, fg, anchor="mm")
        return x0, x0 + w


def speaker(cv, x, y, s, color):
    """喇叭图标（语音播报 / 正在叫号），(x, y) 为左上角，s 为边长"""
    k = s / 24
    cv.rect(x + 2 * k, y + 9 * k, x + 7 * k, y + 15 * k, color)
    cv.poly([(x + 7 * k, y + 9 * k), (x + 13 * k, y + 4 * k), (x + 13 * k, y + 20 * k), (x + 7 * k, y + 15 * k)], color)
    cv.arc([x + 9 * k, y + 7 * k, x + 19 * k, y + 17 * k], -55, 55, color, 2 * k)
    cv.arc([x + 7 * k, y + 3 * k, x + 23 * k, y + 21 * k], -55, 55, color, 2 * k)


# ---------------------------------------------------------------- 三维场景（AI 图）+ 高亮
def scene_layer(called_idx, tour_idx=None):
    """在 AI 图上给被叫诊室上色：室内浅蓝地面换成暖橙，门前走廊画两圈光环"""
    im = Image.open(os.path.join(OUT, "draft", AI_FILE)).convert("RGB")
    px = im.load()
    x0, x1 = WALLS[called_idx] + 7, WALLS[called_idx + 1] - 5
    for y in range(ROOM_FLOOR[0], ROOM_FLOOR[1]):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if 10 < b - r < 40 and r > 120:  # 浅蓝地面（检查床更蓝、饱和度更高，不动）
                lum = (r + g + b) / 3 / 200
                px[x, y] = tuple(min(255, int(v * lum)) for v in (252, 206, 176))
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    d.rectangle([x0 - 2, ROOM_TOP - 4, x1, ROOM_FLOOR[1] + 4], fill=(242, 107, 29, 26))
    if tour_idx is not None:
        tx0, tx1 = WALLS[tour_idx] + 4, WALLS[tour_idx + 1] - 2
        d.rectangle([tx0, ROOM_TOP - 2, tx1, ROOM_FLOOR[1] + 2], fill=(15, 91, 76, 18), outline=(15, 91, 76, 230), width=4)
    cx = DOORS[called_idx]
    for rx, a in ((58, 70), (40, 120)):
        ry = rx * 0.32
        d.ellipse([cx - rx, DOOR_Y - ry, cx + rx, DOOR_Y + ry], fill=(242, 107, 29, a // 2), outline=(242, 107, 29, a + 80), width=3)
    im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
    return im


def room_label(cv, cx, bottom, r, mode, now):
    """诊室上方的状态标签。mode: normal / called（叫号中，橙）/ tour（轮播中，深绿放大）"""
    counts = [len(r["wait_list"]), len(r["recheck_list"]), len(r["missed_list"])]
    if mode == "tour":
        w, h = 112, 78
        x0, y0 = cx - w / 2, bottom - h
        cv.rrect(x0, y0, x0 + w, y0 + h, 6, fill=C["sign"])
        cv.poly([(cx - 7, bottom - 1), (cx + 7, bottom - 1), (cx, bottom + 8)], C["sign"])
        cv.run(x0 + 12, y0 + 27, [(r["no"], "num", 24, "#FFFFFF", 6), (r["short"], "body", 13, C["sign_sub"], 0)])
        cv.text(x0 + 12, y0 + 47, f"就诊中 {mmss(now - r['start'])}", "body", 13, C["sign_sub"], anchor="ls")
        xs = x0 + 12
        for (k, lab), v in zip(STATUS, counts):
            xs = cv.run(xs, y0 + 69, [(lab[0], "body", 12, C["sign_sub"], 3), (str(v), "num", 16, "#FFFFFF", 9)])
        return
    called = mode == "called"
    w, h = (84, 60) if called else (76, 50)
    x0, y0 = cx - w / 2, bottom - h
    bg = C["call"] if called else "#FFFFFF"
    cv.rrect(x0, y0, x0 + w, y0 + h, 6, fill=bg)
    cv.poly([(cx - 6, bottom - 1), (cx + 6, bottom - 1), (cx, bottom + 7)], bg)
    cv.text(cx, y0 + (25 if called else 21), r["no"], "num", 22 if called else 19, "#FFFFFF" if called else C["ink"], anchor="ms")
    # 三个人数：待诊 · 复诊 · 过诊，各自颜色（叫号中时全白）
    parts = []
    for (k, _), v in zip(STATUS, counts):
        parts.append((str(v), "num", 16 if called else 15, "#FFFFFF" if called else C[k], 0))
    gap = 14
    tot = sum(cv.tw(p[0], "num", p[2]) for p in parts) + gap * 2
    xs = cx - tot / 2
    for i, p in enumerate(parts):
        cv.text(xs, y0 + h - 10, p[0], "num", p[2], p[3], anchor="ls")
        xs += cv.tw(p[0], "num", p[2])
        if i < 2:
            cv.circle(xs + gap / 2, y0 + h - 15, 1.6, "#FFFFFF" if called else C["faint"])
            xs += gap
    if called:
        cv.pill(cx, y0 - 30, "叫号中", 14, "#FFFFFF", C["call_deep"], pad=10, h=24, anchor="c")


# ---------------------------------------------------------------- 各区块
def header(cv, now):
    x = cv.run(40, 62, [("××医院 · 内科候诊区", "title", 30, C["ink"], 28)])
    cv.text(x, 61, "门诊医技综合楼 2F  ·  8 个诊室  ·  上午门诊 08:00–12:00", "body", 17, C["sub"], anchor="ls")
    cv.text(1880, 66, hms(now, sec=True), "num", 34, C["ink"], anchor="rs")
    x = 1880 - cv.tw(hms(now, sec=True), "num", 34) - 20
    cv.text(x, 62, "10月17日 周六", "body", 17, C["sub"], anchor="rs")
    x -= cv.tw("10月17日 周六", "body", 17) + 24
    w = 150
    cv.rrect(x - w, 34, x, 70, 18, fill=C["panel2"])
    speaker(cv, x - w + 14, 40, 24, C["sign"])
    cv.text(x - w + 46, 58, "语音播报 已开启", "body", 15, C["sign"], anchor="ls")


def overview(cv):
    """左上：候诊概况"""
    cv.rect(40, 92, 400, 262, C["panel"])
    cv.text(64, 112, "候诊概况", "title", 20, C["ink"])
    cv.text(376, 130, "按诊室汇总", "body", 14, C["faint"], anchor="rs")
    vals = [sum(len(r[k + "_list"]) for r in ROOMS) for k, _ in STATUS] + [sum(r["done"] for r in ROOMS)]
    labs = [("wait", "待诊"), ("recheck", "复诊"), ("missed", "过诊"), ("done", "已诊")]
    for i, ((k, lab), v) in enumerate(zip(labs, vals)):
        x = 64 + i * 80
        cv.run(x, 196, [(str(v), "num", 38, C[k], 3), ("人", "body", 14, C["sub"], 0)])
        cv.text(x, 222, lab, "body", 15, C["sub"], anchor="ls")
    cv.text(64, 248, "平均等候约 21 分钟  ·  平均就诊 6 分 40 秒", "body", 14, C["faint"], anchor="ls")


def room_list(cv, now, called_idx, tour_idx):
    """左中：诊室一览（每行：房间号 / 科室医生 / 当前状态 / 三个人数）"""
    cv.rect(40, 278, 400, 868, C["panel"])
    cv.text(64, 298, "诊室一览", "title", 20, C["ink"])
    cols = [296, 332, 368]
    for (k, lab), x in zip(STATUS, cols):
        cv.text(x, 318, lab, "body", 13, C[k], anchor="rs")
    y = 330
    for i, r in enumerate(ROOMS):
        rh = 62
        if i == called_idx:
            cv.rect(40, y, 400, y + rh, C["call_tint"])
            cv.rect(40, y, 44, y + rh, C["call"])
        elif i == tour_idx:
            cv.rect(40, y, 400, y + rh, C["panel2"])
            cv.rect(40, y, 44, y + rh, C["sign"])
        cv.text(64, y + 39, r["no"], "num", 24, C["ink"], anchor="ls")
        cv.run(118, y + 26, [(r["short"], "body", 16, C["ink"], 8), (r["doctor"], "body", 14, C["sub"], 0)])
        no, nm, kind = r["cur"]
        if i == called_idx:
            cv.run(118, y + 49, [("叫号中", "body", 14, C["call_deep"], 8), (f"{no} {nm}", "body", 14, C["ink"], 0)])
        else:
            el = now - r["start"]
            cv.circle(122, y + 44, 3.5, C["busy"])
            x = cv.run(130, y + 49, [(no, "num", 15, C["ink"], 6)])
            if kind == "复诊":
                x = cv.pill(x, y + 35, "复诊", 11, "#FFFFFF", C["recheck"], pad=5, h=17)[1] + 6
            cv.text(x, y + 49, mmss(el), "num", 15, C["over"] if el > 900 else C["sub"], anchor="ls")
        for (k, _), x in zip(STATUS, cols):
            v = len(r[k + "_list"])
            cv.text(x, y + 40, str(v), "num", 22, C[k] if v else C["faint"], anchor="rs")
        y += rh + 1
    cv.text(64, 858, "复诊优先：每叫 2 位待诊，插叫 1 位复诊", "body", 13, C["faint"], anchor="ls")


def missed_board(cv, now):
    """左下：过号名单（常驻，方便过号的人找到自己）"""
    cv.rect(40, 884, 400, 1040, C["panel"])
    cv.text(64, 904, "过号名单", "title", 20, C["ink"])
    cv.text(376, 922, "请到分诊台重新签到", "body", 14, C["missed"], anchor="rs")
    items = []
    for r in ROOMS:
        for (no, nm), t in zip(r["missed_list"], r["missed_time"]):
            items.append((t, no, nm, r["no"]))
    items.sort(reverse=True)
    for k, (t, no, nm, room) in enumerate(items[:6]):
        x, y = 64 + (k % 2) * 168, 960 + (k // 2) * 30
        cv.run(x, y, [(no, "num", 15, C["missed"], 6), (nm, "body", 15, C["ink"], 6), (room, "num", 13, C["faint"], 0)])


def call_banner(cv, r, n_call):
    """中上：叫号条（导视牌深绿底，被叫诊室用橙色块，与三维里的橙色高亮对应）"""
    x0, y0, x1, y1 = 416, 92, 1504, 196
    cv.rect(x0, y0, x1, y1, C["sign"])
    speaker(cv, x0 + 28, y0 + 26, 34, "#FFFFFF")
    cv.text(x0 + 46, y0 + 86, "正在叫号", "body", 15, C["sign_sub"], anchor="ms")
    cv.rect(x0 + 92, y0 + 22, x0 + 93, y1 - 22, "#2E7A69")
    no, nm, _ = r["cur"]
    base = y0 + 64
    x = cv.run(x0 + 118, base, [("请", "body", 30, "#FFFFFF", 14), (no, "num", 46, "#FFFFFF", 14),
                                 (nm, "title", 40, "#FFFFFF", 16), ("到", "body", 30, "#FFFFFF", 12)])
    w = cv.tw(r["no"], "num", 44) + cv.tw("诊室", "title", 32) + 34
    cv.rrect(x, y0 + 16, x + w, y0 + 78, 8, fill=C["call"])
    cv.run(x + 14, base + 1, [(r["no"], "num", 44, "#FFFFFF", 6), ("诊室", "title", 32, "#FFFFFF", 0)])
    cv.run(x + w + 12, base, [("就诊", "body", 30, "#FFFFFF", 0)])
    cv.text(x0 + 118, y1 - 16, f"{r['dept']}  ·  {r['doctor']} {r['title']}", "body", 16, C["sign_sub"], anchor="ls")
    # 右侧：第几次呼叫 + 该诊室下一位
    cv.pill(x1 - 24, y0 + 22, f"第 {n_call} 次呼叫", 15, C["sign"], "#FFFFFF", pad=12, h=28, anchor="r")
    nx_no, nx_nm = r["wait_list"][0]
    cv.run(x1 - 24 - cv.tw(f"下一位  {nx_no} {nx_nm}", "body", 16) - 4, y1 - 16,
           [("下一位  ", "body", 16, C["sign_sub"], 0), (nx_no, "num", 17, "#FFFFFF", 4), (nx_nm, "body", 16, "#FFFFFF", 0)])


def stage(cv, scene, crop, called_idx, tour_idx, now):
    """中间：三维场景 + 诊室标签 + 图例"""
    sx0, sy0, sx1, sy1 = 416, 204, 1504, 852
    cx0, cy0, cw = crop
    s = (sx1 - sx0) / cw
    ch = (sy1 - sy0) / s
    img = scene.crop((cx0, cy0, int(cx0 + cw), int(cy0 + ch)))
    cv.im.paste(img.resize((int((sx1 - sx0) * S), int((sy1 - sy0) * S)), Image.Resampling.LANCZOS), (sx0 * S, sy0 * S))

    def P(ax, ay):
        return sx0 + (ax - cx0) * s, sy0 + (ay - cy0) * s

    for i, r in enumerate(ROOMS):
        cx, top = P((WALLS[i] + WALLS[i + 1]) / 2, ROOM_TOP)
        if not (sx0 + 40 < cx < sx1 - 40):
            continue
        mode = "called" if i == called_idx else "tour" if i == tour_idx else "normal"
        room_label(cv, cx, top - 10, r, mode, now)
    # 图例（右上角空白处）
    x, y = sx1 - 16, sy0 + 14
    items = [("叫号中", C["call"]), ("过诊", C["missed"]), ("复诊", C["recheck"]), ("待诊", C["wait"])]
    for lab, col in items:
        x -= cv.tw(lab, "body", 14)
        cv.text(x, y + 14, lab, "body", 14, C["sub"], anchor="ls")
        x -= 16
        cv.rrect(x, y + 3, x + 10, y + 13, 2, fill=col)
        x -= 16
    cv.text(sx1 - 16, y + 38, "标签数字：待诊 · 复诊 · 过诊", "body", 13, C["faint"], anchor="rs")


def recent_calls(cv, now, events):
    """中下：最近叫号记录（最新在左）"""
    x0, y0, x1, y1 = 416, 868, 1504, 1040
    cv.rect(x0, y0, x1, y1, C["panel"])
    cv.text(x0 + 24, y0 + 20, "最近叫号", "title", 20, C["ink"])
    cv.text(x1 - 24, y0 + 38, "同一号连呼 2 次  ·  未到转入过号名单", "body", 14, C["faint"], anchor="rs")
    n = len(events)
    gap = 12
    w = (x1 - x0 - 48 - gap * (n - 1)) / n
    for k, (t, no, nm, room, dept, state) in enumerate(events):
        x = x0 + 24 + k * (w + gap)
        y = y0 + 58
        bg = C["call_tint"] if state == "呼叫中" else C["panel2"]
        cv.rect(x, y, x + w, y1 - 18, bg)
        if state == "呼叫中":
            cv.rect(x, y, x + 4, y1 - 18, C["call"])
        cv.text(x + 14, y + 24, hms(t), "num", 16, C["sub"], anchor="ls")
        col = {"呼叫中": C["call_deep"], "已入室": C["busy"], "复诊 · 已入室": C["recheck"], "未到 · 过号": C["missed"]}[state]
        cv.text(x + w - 12, y + 23, state, "body", 13, col, anchor="rs")
        cv.run(x + 14, y + 56, [(no, "num", 18, C["ink"], 6), (nm, "body", 17, C["ink"], 0)])
        cv.run(x + 14, y + 82, [(room, "num", 14, C["sub"], 6), (dept, "body", 13, C["sub"], 0)])


def room_detail(cv, now, r, i, mode, n_call):
    """右栏：轮播到（或被叫）的诊室详情"""
    x0, x1 = 1520, 1880
    # 轮播进度：8 个点，当前诊室加长
    cv.text(x0, 116, "诊室轮播", "body", 15, C["sub"], anchor="ls")
    x = x0 + 74
    for k in range(len(ROOMS)):
        on = k == i
        w = 22 if on else 8
        cv.rrect(x, 106, x + w, 114, 4, fill=(C["call"] if mode == "called" else C["sign"]) if on else "#C5D0CC")
        x += w + 6
    tag = "叫号插播" if mode == "called" else f"{i + 1} / {len(ROOMS)}  ·  5 秒后切换"
    cv.text(x1, 116, tag, "body", 14, C["call_deep"] if mode == "called" else C["faint"], anchor="rs")

    # 诊室牌（导视牌深绿）
    cv.rect(x0, 132, x1, 284, C["sign"])
    cv.text(x0 + 24, 206, r["no"], "num", 60, "#FFFFFF", anchor="ls")
    xn = x0 + 24 + cv.tw(r["no"], "num", 60) + 16
    cv.text(xn, 176, r["dept"], "title", 22, "#FFFFFF", anchor="ls")
    cv.text(xn, 204, f"{r['doctor']}  {r['title']}", "body", 16, C["sign_sub"], anchor="ls")
    cv.rect(x0 + 24, 228, x1 - 24, 229, "#2E7A69")
    cv.text(x0 + 24, 262, "上午 08:00–12:00", "body", 15, C["sign_sub"], anchor="ls")
    cv.run(x1 - 24 - cv.tw(f"已诊 {r['done']} 人", "body", 15) - 6, 262,
           [("已诊 ", "body", 15, C["sign_sub"], 2), (str(r["done"]), "num", 18, "#FFFFFF", 2), (" 人", "body", 15, C["sign_sub"], 0)])

    # 当前就诊 / 叫号中
    y = 296
    no, nm, kind = r["cur"]
    if mode == "called":
        cv.rect(x0, y, x1, y + 128, C["call_tint"])
        cv.rect(x0, y, x0 + 4, y + 128, C["call"])
        cv.pill(x0 + 24, y + 18, "叫号中 · 等待入室", 14, "#FFFFFF", C["call"], pad=10, h=26)
        cv.run(x0 + 24, y + 82, [(no, "num", 34, C["ink"], 12), (nm, "title", 30, C["ink"], 0)])
        cv.run(x0 + 24, y + 112, [(f"{hms(r['start'], True)} 第 {n_call} 次呼叫", "body", 15, C["sub"], 14),
                                   ("已等 ", "body", 15, C["sub"], 2), (mmss(now - r["start"]), "num", 17, C["call_deep"], 0)])
    else:
        el = now - r["start"]
        cv.rect(x0, y, x1, y + 128, C["panel"])
        cv.pill(x0 + 24, y + 18, "当前就诊", 14, "#FFFFFF", C["busy"], pad=10, h=26)
        if kind == "复诊":
            cv.pill(x0 + 128, y + 18, "复诊", 14, "#FFFFFF", C["recheck"], pad=10, h=26)
        cv.run(x0 + 24, y + 82, [(no, "num", 34, C["ink"], 12), (nm, "title", 30, C["ink"], 0)])
        cv.text(x0 + 24, y + 112, f"{hms(r['start'])} 开始", "body", 15, C["sub"], anchor="ls")
        cv.run(x1 - 24 - cv.tw(mmss(el), "num", 30) - cv.tw("已就诊 ", "body", 15) - 2, y + 66,
               [("已就诊 ", "body", 15, C["sub"], 2), (mmss(el), "num", 30, C["over"] if el > 900 else C["busy"], 0)])
        # 就诊时长条：满格 = 15 分钟提醒线
        bx0, bx1 = x1 - 150, x1 - 24
        cv.rect(bx0, y + 104, bx1, y + 110, C["panel2"])
        cv.rect(bx0, y + 104, bx0 + (bx1 - bx0) * min(1, el / 900), y + 110, C["busy"])
        cv.text(bx1, y + 124, "15 分钟提醒", "body", 11, C["faint"], anchor="rs")

    # 三组名单
    def section(y, h, key, lab, items, note, per_row=2, cap=8, extra=None):
        cv.rect(x0, y, x1, y + h, C["panel"])
        cv.rect(x0, y, x0 + 4, y + h, C[key])
        cv.run(x0 + 24, y + 32, [(lab, "title", 19, C[key], 8), (str(len(items)), "num", 22, C[key], 3), ("人", "body", 15, C[key], 0)])
        cv.text(x1 - 24, y + 31, note, "body", 13, C["faint"], anchor="rs")
        cw = (x1 - x0 - 48) / per_row
        for k, it in enumerate(items[:cap]):
            xx, yy = x0 + 24 + (k % per_row) * cw, y + 68 + (k // per_row) * 32
            parts = [(it[0], "num", 17, C["ink"], 7), (it[1], "body", 17, C["ink"], 8)]
            if extra:
                parts.append((extra(k), "body", 13, C["faint"], 0))
            cv.run(xx, yy, parts)
        if len(items) > cap:
            cv.text(x1 - 24, y + h - 14, f"…… 等 {len(items) - cap} 人", "body", 14, C["sub"], anchor="rs")

    wl = r["wait_list"]
    section(436, 236, "wait", "待诊", wl, "按签到顺序")
    rl = r["recheck_list"]
    section(684, 168, "recheck", "复诊", rl, "带检查结果回诊 · 优先插叫", per_row=1, cap=3,
            extra=lambda k: f"{hms(r['recheck_time'][k])} 回诊")
    ml = r["missed_list"]
    section(864, 176, "missed", "过诊", ml, "重新签到后排到第 3 位", per_row=1, cap=3,
            extra=lambda k: f"{hms(r['missed_time'][k])} 未到")
    if not rl:
        cv.text(x0 + 24, 684 + 68, "暂无", "body", 16, C["faint"], anchor="ls")
    if not ml:
        cv.text(x0 + 24, 864 + 68, "暂无", "body", 16, C["faint"], anchor="ls")


def events_at(now):
    """最近叫号：各诊室当前患者的叫号时刻 + 一次过号，按时间倒序取 6 条"""
    ev = []
    for r in ROOMS:
        no, nm, kind = r["cur"]
        state = "呼叫中" if r.get("called") else ("复诊 · 已入室" if kind == "复诊" else "已入室")
        ev.append((r["start"], no, nm, r["no"], r["short"], state))
        for (mno, mnm), t in zip(r["missed_list"], r["missed_time"]):
            ev.append((t, mno, mnm, r["no"], r["short"], "未到 · 过号"))
    ev.sort(reverse=True)
    return ev[:6]


def compose(out, now, crop, called_idx, tour_idx, mode, n_call):
    cv = Canvas(C["ground"])
    scene = scene_layer(called_idx, tour_idx)
    header(cv, now)
    overview(cv)
    room_list(cv, now, called_idx, tour_idx)
    missed_board(cv, now)
    call_banner(cv, ROOMS[called_idx], n_call)
    stage(cv, scene, crop, called_idx, tour_idx, now)
    recent_calls(cv, now, events_at(now))
    show = called_idx if mode == "called" else tour_idx
    room_detail(cv, now, ROOMS[show], show, mode, n_call)
    im = cv.im.resize((W_, H_), Image.Resampling.LANCZOS)
    im.save(os.path.join(OUT, out))
    print("写出", out)


def main():
    total = build_queue()
    print("全区已发号", total)
    called = next(i for i, r in enumerate(ROOMS) if r.get("called"))
    # 01：叫号瞬间，全景（裁切 = AI 图里的左上角 x、y 和宽度）
    compose("01-draft-call.png", NOW, (33, 20, 1470), called, None, "called", 1)
    # 02：16 秒后，轮播推近 218（216 仍在第 2 次呼叫）
    tour = next(i for i, r in enumerate(ROOMS) if r["no"] == "218")
    compose("02-draft-tour.png", NOW + 16, (311, 60, 1043), called, tour, "tour", 2)


if __name__ == "__main__":
    main()
