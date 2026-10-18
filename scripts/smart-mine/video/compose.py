"""
智能矿山解说视频：合成成片
----------------------------------------------------------
读 timeline.json / shots.json / 字幕.srt 与 record.mjs 录好的三维镜头帧，生成平面镜头
（钻场识别平面图），在三维镜头上按字幕时间叠加说明，相邻镜头 0.5 s 叠化，
逐帧送进 ffmpeg 编码成 1920 × 1080 / 30 fps 的 H.264 视频（无声，配音在剪映里做）。

画面下方约 180 px 留给剪映字幕，说明文字都放在上半部分。
输出：models/smart-mine/video/out/智能矿山解说.mp4

用法：python scripts/smart-mine/video/compose.py [--preview 秒]（--preview 只导出该时刻一帧 PNG，调版式用）
需要 numpy、Pillow、imageio-ffmpeg。
"""

import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

Image.MAX_IMAGE_PIXELS = None
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
VIDEO = ROOT / "models" / "smart-mine" / "video"
RAW = ROOT / "models" / "smart-mine" / "raw"
RENDER = ROOT / "models" / "smart-mine" / "render"
FONTS = ROOT / "src" / "assets" / "fonts"
W, H, FPS = 1920, 1080, 30

CYAN = (54, 224, 255)
LIME = (198, 255, 90)
ORANGE = (255, 154, 61)
VIOLET = (184, 174, 240)
WHITE = (236, 244, 255)
SUB = (160, 184, 214)


def font(name, size):
    f = {"title": "AlimamaShuHeiTi-Bold.ttf", "body": "SourceHanSansCN-Regular.otf", "num": "DIN-Bold.otf"}[name]
    return ImageFont.truetype(str(FONTS / f), size)


F = {
    "hero": font("title", 92),
    "title": font("title", 46),
    "h2": font("title", 34),
    "body": font("body", 30),
    "small": font("body", 24),
    "num": font("num", 30),
}

# ---------------- 时间轴 ----------------

TL = json.loads((VIDEO / "timeline.json").read_text("utf8"))
SH = json.loads((HERE / "shots.json").read_text("utf8"))
SEG = {s["key"]: s["start"] for s in TL["segments"]}
FADE = SH["fade"]


def at(ref):
    key, off = ref
    return TL["duration"] if key == "END" else SEG[key] + off


SHOTS = [{**s, "t0": at(s["from"]), "t1": at(s["to"])} for s in SH["shots"]]


def parse_srt(path):
    out = []
    for block in path.read_text("utf-8-sig").strip().split("\n\n"):
        lines = block.split("\n")
        a, b = lines[1].split(" --> ")
        sec = lambda s: int(s[:2]) * 3600 + int(s[3:5]) * 60 + int(s[6:8]) + int(s[9:]) / 1000
        out.append((sec(a), sec(b), lines[2]))
    return out


SUBS = parse_srt(VIDEO / "out" / "字幕.srt")


def cue(text):
    """含指定文字的那条字幕的开始时间（说明文字跟着口播出现）"""
    for a, _, s in SUBS:
        if text in s:
            return a
    raise KeyError(text)


# ---------------- 绘图小工具 ----------------

ease = lambda x: x * x * (3 - 2 * x)


def ramp(t, a, d=0.35):
    """t 在 a 之后 d 秒内从 0 渐变到 1"""
    return ease(min(1.0, max(0.0, (t - a) / d)))


def window(t, a, b, d=0.35):
    """a 出现、b 消失的淡入淡出系数"""
    return min(ramp(t, a, d), 1 - ramp(t, b - d, d))


def card(img, x, y, lines, alpha=1.0, accent=CYAN, anchor="lt", pad=(26, 18), dy=0):
    """半透明深色说明卡：左侧青色竖条；lines = [(文字, 字体键, 颜色), ...]"""
    if alpha <= 0.01:
        return
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    sizes = [d.textbbox((0, 0), s, font=F[f]) for s, f, _ in lines]
    lh = [b[3] - b[1] for b in sizes]
    gap = 12
    w = max(b[2] - b[0] for b in sizes) + pad[0] * 2 + 8
    h = sum(lh) + gap * (len(lines) - 1) + pad[1] * 2
    if anchor == "mt":
        x -= w // 2
    elif anchor == "rt":
        x -= w
    y += int(dy * (1 - alpha))
    a = int(255 * alpha)
    d.rounded_rectangle((x, y, x + w, y + h), 6, fill=(4, 12, 26, int(205 * alpha)), outline=(*accent, int(150 * alpha)), width=2)
    d.rectangle((x, y + 8, x + 6, y + h - 8), fill=(*accent, a))
    cy = y + pad[1]
    for (s, f, c), b, hh in zip(lines, sizes, lh):
        d.text((x + pad[0] + 8 - b[0], cy - b[1]), s, font=F[f], fill=(*c, a))
        cy += hh + gap
    img.alpha_composite(ov)


def label(img, x, y, text, color, alpha=1.0, side="right", length=90):
    """引线标签：从屏幕点 (x, y) 拉一根横线，末端写字"""
    if alpha <= 0.01:
        return
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    a = int(255 * alpha)
    x2 = x + length if side == "right" else x - length
    d.ellipse((x - 7, y - 7, x + 7, y + 7), outline=(*color, a), width=3)
    d.line((x, y, x2, y), fill=(*color, a), width=3)
    b = d.textbbox((0, 0), text, font=F["h2"])
    tw = b[2] - b[0]
    tx = x2 + 14 if side == "right" else x2 - 14 - tw
    d.rounded_rectangle((tx - 12, y - 28, tx + tw + 12, y + 26), 5, fill=(4, 12, 26, int(200 * alpha)))
    d.text((tx - b[0], y - (b[1] + b[3]) / 2), text, font=F["h2"], fill=(*color, a))
    img.alpha_composite(ov)


def stamp(img, text, t, a, d=1.4):
    """模式切换时画面上方中央的大字（透视 / 剖切）"""
    k = window(t, a, a + d, 0.25)
    if k <= 0.01:
        return
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    b = dr.textbbox((0, 0), text, font=F["hero"])
    x = (W - (b[2] - b[0])) / 2 - b[0]
    y = 150 - b[1]
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((x, y), text, font=F["hero"], fill=(*CYAN, int(200 * k)))
    ov.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
    dr.text((x, y), text, font=F["hero"], fill=(255, 255, 255, int(255 * k)))
    img.alpha_composite(ov)


# ---------------- 三维镜头帧 ----------------

_meta = {}


def meta(shot_id):
    if shot_id not in _meta:
        _meta[shot_id] = json.loads((VIDEO / "frames" / shot_id / "meta.json").read_text("utf8"))
    return _meta[shot_id]


def frame3d(shot_id, t):
    m = meta(shot_id)
    k = min(m["frames"] - 1, max(0, round((t - m["start"]) * FPS)))
    img = Image.open(VIDEO / "frames" / shot_id / f"{k:05d}.jpg").convert("RGBA")
    return img, (m["points"][k] if m["points"] else None)


# ---------------- 平面镜头 ----------------

BLOCKS = json.loads((RAW / "blocks.json").read_text("utf8"))
LAYOUT = json.loads((RENDER / "layout.json").read_text("utf8"))
_naip = None


def naip():
    global _naip
    if _naip is None:
        _naip = Image.open(RAW / "overview_naip.jpg").convert("RGB")
    return _naip


def to_px(x, y):
    """全景局部坐标 → 全景航拍像素（1.5 m / 像素，左上角为西北角）"""
    return (x + 6000) / 1.5, (5000 - y) / 1.5


def crop_view(cx, cy, cw):
    """以 (cx, cy) 为中心、宽 cw 像素的 16:9 航拍裁切，缩放到画面大小"""
    ch = cw * H / W
    img = naip()
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return img.resize((W, H), Image.BILINEAR, box=box).convert("RGBA")


def shot_plan(t):
    """钻场识别：扫描线走过，钻场逐个点亮；然后标出成排的规律与工作面"""
    s = next(x for x in SHOTS if x["id"] == "plan")
    # 局部坐标中心与宽（米）：上方留出放说明卡的空，下方留出剪映字幕的空
    cxl, cyl, wl = 1100, -2480, 8800
    cx, cy = to_px(cxl, cyl)
    cw = wl / 1.5
    img = crop_view(cx, cy, cw)
    # 稍压暗影像，让标注更醒目
    img = Image.blend(img, Image.new("RGBA", img.size, (3, 9, 18, 255)), 0.28)
    sc = W / cw
    P = lambda x, y: ((to_px(x, y)[0] - cx) * sc + W / 2, (to_px(x, y)[1] - cy) * sc + H / 2)
    t_find = cue("我让程序在航拍图里") - 0.2
    t_rows = cue("发现它们是一排一排")
    t_panel = cue("这就暴露了")
    sweep = min(1.0, max(0.0, (t - t_find) / 2.6))
    scan_x = sweep * (W + 80) - 40
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # 工作面（最后出现）
    k_panel = ramp(t, t_panel, 0.8)
    if k_panel > 0:
        col = {"mined": VIOLET, "active": ORANGE, "ready": CYAN, "planned": CYAN}
        # E 煤老采区（西翼，已闭）先画成灰紫，再按顺序点亮 B 煤各工作面
        for p in (q for q in LAYOUT["panels"] if q["seam"] == "E"):
            x0, y0, x1, y1 = p["rect"]
            a0, b0 = P(x0, y1)
            a1, b1 = P(x1, y0)
            d.rectangle((a0, b0, a1, b1), fill=(140, 136, 170, int(26 * k_panel)), outline=(150, 146, 180, int(170 * k_panel)), width=2)
        ex0, ey0 = P(-1000, -680)
        d.text((ex0, ey0), "E 煤老采区", font=F["small"], fill=(170, 166, 200, int(230 * k_panel)))
        for i, p in enumerate(q for q in LAYOUT["panels"] if q["seam"] == "B"):
            kk = ramp(t, t_panel + i * 0.18, 0.5)
            if kk <= 0:
                continue
            x0, y0, x1, y1 = p["rect"]
            a0, b0 = P(x0, y1)
            a1, b1 = P(x1, y0)
            c = col[p["status"]]
            fill = (*c, int((60 if p["status"] == "active" else 26) * kk))
            d.rectangle((a0, b0, a1, b1), fill=fill, outline=(*c, int(230 * kk)), width=3)
            d.text((a1 + 10, (b0 + b1) / 2 - 14), p["id"], font=F["small"], fill=(*c, int(230 * kk)))
    # 成排：沿每个工作面中线画虚线
    k_rows = window(t, t_rows, t_panel + 0.6, 0.4)
    if k_rows > 0:
        for p in (q for q in LAYOUT["panels"] if q["status"] != "planned"):
            yc = (p["rect"][1] + p["rect"][3]) / 2
            xa, ya = P(p["rect"][0] - 200, yc)
            xb, _ = P(p["rect"][2] + 200, yc)
            x = xa
            while x < xb:
                d.line((x, ya, min(x + 22, xb), ya), fill=(*WHITE, int(170 * k_rows)), width=3)
                x += 36
    # 钻场：扫描线经过时点亮（工作面上方的抽采钻场亮黄绿，其余识别结果淡白）
    wells = {(round(w["x"]), round(w["y"])) for w in LAYOUT["wells"]}
    for x, y in LAYOUT["pads"]:
        sx, sy = P(x, y)
        if not (0 <= sx <= W and 0 <= sy <= H) or sx > scan_x:
            continue
        hit = (round(x), round(y)) in wells
        age = (scan_x - sx) / (W + 80) * 2.6
        pop = 1 + 0.8 * max(0.0, 1 - age / 0.35)
        r = (9 if hit else 6) * pop
        if hit:
            d.ellipse((sx - r - 6, sy - r - 6, sx + r + 6, sy + r + 6), outline=(*LIME, 90), width=2)
            d.ellipse((sx - r, sy - r, sx + r, sy + r), outline=(*LIME, 255), width=3)
        else:
            d.ellipse((sx - r, sy - r, sx + r, sy + r), outline=(*WHITE, 150), width=2)
    img.alpha_composite(ov)
    if 0 < sweep < 1:
        dd = ImageDraw.Draw(img)
        dd.rectangle((scan_x - 2, 0, scan_x + 2, H), fill=(*CYAN, 220))
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(glow).rectangle((scan_x - 40, 0, scan_x, H), fill=(*CYAN, 40))
        img.alpha_composite(glow)
    n_pads = sum(1 for x, y in LAYOUT["pads"])
    card(
        img,
        70,
        110,
        [(f"航拍影像自动识别：钻场 {n_pads} 处", "h2", WHITE), (f"其中工作面上方的抽采钻场 {len(LAYOUT['wells'])} 处", "body", LIME)],
        alpha=ramp(t, t_find + 1.0),
        dy=16,
    )
    card(
        img,
        W - 70,
        110,
        [("一排一排：工作面东西走向", "h2", WHITE), ("一条挨着一条 · 埋深约 400 m", "body", ORANGE)],
        alpha=ramp(t, t_panel + 0.4),
        anchor="rt",
        dy=16,
    )
    # 指北针
    dd = ImageDraw.Draw(img)
    dd.polygon([(W - 90, 870), (W - 104, 910), (W - 76, 910)], fill=(255, 90, 95, 230))
    dd.text((W - 99, 830), "N", font=F["small"], fill=(*WHITE, 230))
    return img


# ---------------- 三维镜头上的叠加说明 ----------------


def over_reveal(img, t, pts):
    card(
        img,
        W // 2,
        116,
        [("West Elk 煤矿", "title", WHITE), ("美国科罗拉多州 · 在产井工煤矿", "body", CYAN)],
        alpha=window(t, cue("美国科罗拉多州") - 0.15, at(["terrain", 0]) + 0.3),
        anchor="mt",
        dy=16,
    )


def over_terrain(img, t, pts):
    card(
        img,
        W // 2,
        120,
        [("地形：USGS 3DEP 激光雷达 · 精度 1 m", "h2", WHITE), ("影像：USDA NAIP 航拍 · 0.3 m", "body", SUB)],
        alpha=window(t, cue("地形用的是") - 0.2, cue("十二公里乘十公里") - 0.1),
        anchor="mt",
        dy=16,
    )
    card(
        img,
        W // 2,
        120,
        [("12 km × 10 km · 落差近 1000 m", "h2", WHITE), ("全部是真实地形", "body", CYAN)],
        alpha=window(t, cue("十二公里乘十公里") - 0.1, at(["strata", 0]) + 0.6),
        anchor="mt",
        dy=16,
    )


def over_strata(img, t, pts):
    card(
        img,
        70,
        110,
        [("按真实地层顺序上色", "h2", WHITE), ("曼科斯页岩 → 罗林斯砂岩 → 鲍伊页岩段 → 帕奥尼亚页岩段", "small", SUB)],
        alpha=ramp(t, at(["strata", 0]) + 0.3),
        dy=16,
    )
    if not pts:
        return
    k = ramp(t, cue("这几条黑线") - 0.2, 0.4)
    names = {"F": ("F 煤", WHITE), "E": ("E 煤", WHITE), "B": ("B 煤 · 在采", ORANGE)}
    for (x, y, front), key in zip(pts, ["F", "E", "B", "top"]):
        if key in names and front:
            off = {"F": -16, "E": 16, "B": 0}[key]
            label(img, x, y + off, names[key][0], names[key][1], alpha=k * ramp(t, cue("这几条黑线") + {"F": 0, "E": 0.15, "B": 0.3}[key], 0.3), length=120)


def over_slope(img, t, pts):
    k = ramp(t, cue("再看山上这些小白点") - 0.2, 0.5)
    if pts and k > 0:
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        for i, (x, y, front) in enumerate(pts):
            if not front or not (0 < x < W and 0 < y < H * 0.86):
                continue
            ph = (t * 1.2 + i * 0.137) % 1
            r = 8 + 16 * ph
            d.ellipse((x - r, y - r, x + r, y + r), outline=(*LIME, int(220 * (1 - ph) * k)), width=3)
            d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(*LIME, int(255 * k)))
        img.alpha_composite(ov)
    card(
        img,
        70,
        110,
        [("山上的小白点 = 瓦斯抽采钻场", "h2", WHITE), ("从地面往下打孔，抽出采空区的瓦斯", "body", LIME)],
        alpha=ramp(t, cue("它们是瓦斯抽采钻场") - 0.2),
        dy=16,
    )


def over_xray(img, t, pts):
    stamp(img, "透视", t, cue("点一下透视") - 0.1)
    stamp(img, "剖切", t, cue("再点剖切") - 0.1)


def over_night(img, t, pts):
    card(
        img,
        70,
        110,
        [("跟着矿区当地时间跑", "h2", WHITE), ("当地凌晨 1 点多 · 夜班检修 · 采煤机停机", "body", SUB)],
        alpha=window(t, cue("它跟着科罗拉多") - 0.2, at(["live", 5.2]) + 0.3),
        dy=16,
    )


def over_timelapse(img, t, pts):
    s = next(x for x in SHOTS if x["id"] == "timelapse")
    card(
        img,
        70,
        110,
        [("时间快进：凌晨 1 点至上午 10:40", "h2", WHITE), ("早班割煤 · 回风隅角瓦斯上升 · 接近 0.8% 预警", "body", ORANGE)],
        alpha=window(t, s["t0"] + 0.2, s["t1"] + 0.2),
        dy=16,
    )


def over_recap(img, t, pts):
    a = at(["honest", 0])
    rows = [
        ("地形：真实（USGS 激光雷达）", "body", WHITE, cue("地形和航拍是真的")),
        ("航拍：真实（USDA NAIP）", "body", WHITE, cue("地形和航拍是真的") + 0.2),
        ("井下布置：示意（按钻场推断）", "body", ORANGE, cue("井下的布置")),
        ("运行数据：模拟", "body", ORANGE, cue("运行数据是模拟的")),
    ]
    shown = [(s, f, c) for s, f, c, tt in rows if t >= tt - 0.1]
    if shown:
        card(img, W // 2, 140, [("实话实说", "h2", CYAN)] + shown, alpha=ramp(t, a + 0.2), anchor="mt", dy=16)


def over_plant(img, t, pts):
    card(
        img,
        W // 2,
        120,
        [("拉近看：厂房、皮带还贴在地面上", "h2", WHITE), ("下一步：关键建筑单独建模", "body", ORANGE)],
        alpha=ramp(t, cue("拉近看") - 0.2),
        anchor="mt",
        dy=16,
    )


def over_outro(img, t, pts):
    a = cue("你觉得这个效果")
    k = ramp(t, a - 0.2, 0.5)
    if k > 0:
        dim = Image.new("RGBA", img.size, (2, 6, 14, int(150 * k)))
        img.alpha_composite(dim)
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        for s, fnt, y, col in [("能直接拿去给甲方演示吗？", F["hero"], 330, WHITE), ("评论区告诉我", F["title"], 480, CYAN)]:
            b = d.textbbox((0, 0), s, font=fnt)
            d.text(((W - (b[2] - b[0])) / 2 - b[0], y - b[1] + int(24 * (1 - k))), s, font=fnt, fill=(*col, int(255 * k)))
        img.alpha_composite(ov)
    card(
        img,
        W // 2,
        120,
        [("国内也能做：用矿方的无人机航测数据", "h2", WHITE)],
        alpha=window(t, at(["end", 0]) + 0.2, a - 0.1),
        anchor="mt",
        dy=16,
    )


OVER = {
    "reveal": over_reveal,
    "terrain": over_terrain,
    "strata": over_strata,
    "slope": over_slope,
    "xray": over_xray,
    "night": over_night,
    "timelapse": over_timelapse,
    "recap": over_recap,
    "plant": over_plant,
    "outro": over_outro,
}
GEN2D = {"plan": shot_plan}


def render_shot(s, t):
    if s["kind"] == "2d":
        return GEN2D[s["id"]](t)
    img, pts = frame3d(s["id"], t)
    if s["id"] in OVER:
        OVER[s["id"]](img, t, pts)
    return img


def frame_at(t):
    """t 时刻的成片画面：落在两个镜头交界的 0.5 s 内时叠化"""
    for i, s in enumerate(SHOTS):
        if t < s["t1"] - FADE / 2 or i == len(SHOTS) - 1:
            img = render_shot(s, t)
            if i > 0 and t < s["t0"] + FADE / 2:
                prev = render_shot(SHOTS[i - 1], t)
                w = ease((t - (s["t0"] - FADE / 2)) / FADE)
                img = Image.blend(prev, img, w)
            return img.convert("RGB")
        if t < s["t1"] + FADE / 2 and i + 1 < len(SHOTS):
            nxt = SHOTS[i + 1]
            a = render_shot(s, t)
            b = render_shot(nxt, t)
            w = ease((t - (s["t1"] - FADE / 2)) / FADE)
            return Image.blend(a, b, w).convert("RGB")
    return render_shot(SHOTS[-1], t).convert("RGB")


def main():
    if "--preview" in sys.argv:
        t = float(sys.argv[sys.argv.index("--preview") + 1])
        out = VIDEO / f"preview_{t:05.1f}.png"
        frame_at(t).save(out)
        print("saved", out)
        return
    import imageio_ffmpeg

    out = VIDEO / "out" / "智能矿山解说.mp4"
    n = int(round(TL["duration"] * FPS))
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out),
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k in range(n):
        p.stdin.write(frame_at(k / FPS).tobytes())
        if k % 150 == 0:
            print(f"{k}/{n}", flush=True)
    p.stdin.close()
    p.wait()
    print("saved", out, f"{n / FPS:.1f} s")


if __name__ == "__main__":
    main()
