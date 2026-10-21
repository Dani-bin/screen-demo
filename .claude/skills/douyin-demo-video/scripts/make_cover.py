"""
抖音封面合成：按 <douyin 目录>/cover.json 出竖版 3:4（1080×1440，抖音推荐上传这张）和横版 4:3（1440×1080）
----------------------------------------------------------
通用版，提炼自 docs/design/hospital|waiting/douyin/make_cover.py。版式沿用这一系列：
  左上标签 + 小字说明、三维大图（四边羽化、淡进底色）、两行大标题（[方括号] 里的词用强调色）、一行副标题、
  底部三步缩略图（最后一步高亮）、一张歪着贴的道具卡片（检查单、排队小票……）用弧形箭头指进大图里的招牌效果。
style：flat  = 平面圆角块 + 柔和投影（院内导航那种）；
       candy = 深色粗描边 + 右下实心错位阴影（候诊叫号的缤纷插画风）。
自动排版只是起点：生成后看一眼，标题压住主体、箭头没指准、卡片挡住重点时，在 cover.json 的 layout 里调
（字段说明见 skill 的 references/cover.md）。
用法：python3 make_cover.py <douyin目录> [--only 3x4|4x3]
"""

import json
import math
import os
import random
import re
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = None  # douyin 目录
CFG = {}


# ---------------------------------------------------------------- 基础
def rgb(c):
    if isinstance(c, (list, tuple)):
        return tuple(int(v) for v in c[:3])
    c = c.lstrip("#")
    return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))


def mix(a, b, k):
    return tuple(round(x + (y - x) * k) for x, y in zip(a, b))


def find_fonts():
    """项目字体目录：从 douyin 目录和本脚本所在位置往上找 src/assets/fonts"""
    for d in (ROOT, os.path.dirname(os.path.abspath(__file__))):
        while True:
            f = os.path.join(d, "src", "assets", "fonts")
            if os.path.exists(os.path.join(f, "AlimamaShuHeiTi-Bold.ttf")):
                return f
            up = os.path.dirname(d)
            if up == d:
                break
            d = up
    raise SystemExit("找不到 src/assets/fonts（阿里妈妈数黑体 / 思源黑体 / DIN）；在 cover.json 的 fonts 里写明路径")


_fonts = {}


def font(kind, size):
    """kind: title（阿里妈妈数黑体）/ body（思源黑体）/ num（DIN Bold，数字、字母编号用）"""
    key = (kind, int(size))
    if key not in _fonts:
        fd = find_fonts() if not CFG.get("fonts") else None
        default = {"title": "AlimamaShuHeiTi-Bold.ttf", "body": "SourceHanSansCN-Regular.otf", "num": "DIN-Bold.otf"}
        path = (CFG.get("fonts") or {}).get(kind) or os.path.join(fd or find_fonts(), default[kind])
        if not os.path.isabs(path):
            path = os.path.join(ROOT, path)
        _fonts[key] = ImageFont.truetype(path, int(size))
    return _fonts[key]


def is_code(s):
    """全是字母、数字、符号（A113、309、97 m）就用 DIN，有汉字就用黑体"""
    return not re.search(r"[一-鿿]", s)


def parse_title(line, P):
    """「整间诊室会[亮起来]」→ [("整间诊室会", ink), ("亮起来", accent)]"""
    parts = []
    for m in re.finditer(r"\[([^\]]*)\]|([^\[]+)", line):
        if m.group(1) is not None:
            parts.append((m.group(1), P["accent"]))
        else:
            parts.append((m.group(2), P["ink"]))
    return parts


def gradient(size, stops):
    """竖向渐变遮罩：stops = [(y 比例, alpha)]，255 = 完全是底色"""
    w, h = size
    g = Image.new("L", (1, h))
    for y in range(h):
        t = y / (h - 1)
        for (t0, a0), (t1, a1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                g.putpixel((0, y), int(a0 + (a1 - a0) * (t - t0) / ((t1 - t0) or 1)))
                break
    return g.resize((w, h))


def hgradient(size, x0, x1, a0=250):
    """横向渐变遮罩：x0 以左为 a0，x1 以右为 0（横版左侧标题区铺底色）"""
    w, h = size
    m = Image.new("L", (w, 1))
    for x in range(w):
        m.putpixel((x, 0), int(max(0, min(a0, a0 * (1 - (x - x0) / (x1 - x0))))))
    return m.resize((w, h))


class Cover:
    def __init__(self):
        c = CFG
        self.style = c.get("style", "flat")
        self.hero = Image.open(os.path.join(ROOT, c["hero"]["image"])).convert("RGB")
        self.target = c["hero"].get("target", [self.hero.width / 2, self.hero.height / 2])
        pal = c.get("palette", {})
        # 底色默认取大图上沿一条的平均色：大图边缘才能无缝融进去
        bg = pal.get("bg", "auto")
        if bg == "auto":
            strip = self.hero.crop((0, 0, self.hero.width, max(4, self.hero.height // 60))).resize((1, 1), Image.Resampling.BOX)
            bg = strip.getpixel((0, 0))
        self.P = {
            "bg": rgb(bg),
            "ink": rgb(pal.get("ink", "#1B1F24")),
            "sub": rgb(pal.get("sub", "#5B6470")),
            "brand": rgb(pal.get("brand", "#0F5B4C")),
            "onBrand": rgb(pal.get("onBrand", "#FFFFFF")),
            "accent": rgb(pal.get("accent", "#F26B1D")),
            "card": rgb(pal.get("card", "#FFFFFF")),
            "white": (255, 255, 255),
        }
        self.steps = []
        for s in c.get("steps", []):
            img = Image.open(os.path.join(ROOT, s["image"])).convert("RGB")
            if s.get("crop"):
                img = img.crop(tuple(s["crop"]))
            else:  # 居中裁成 4:3
                w, h = img.size
                cw, ch = (h * 4 // 3, h) if w / h > 4 / 3 else (w, w * 3 // 4)
                img = img.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2))
            self.steps.append((img, s["label"]))

    # ------------------------------------------------------------ 圆角块（两种风格）
    def block(self, cv, box, r, fill, outline=None, shadow=7, width=4):
        """candy：深墨描边 + 右下实心错位阴影；flat：柔和投影 + 无描边（outline 给了就画一圈该色的边）"""
        x0, y0, x1, y1 = [int(v) for v in box]
        P = self.P
        if self.style == "candy":
            d = ImageDraw.Draw(cv)
            if shadow:
                d.rounded_rectangle((x0 + shadow, y0 + shadow, x1 + shadow, y1 + shadow), r, fill=P["ink"])
            d.rounded_rectangle((x0, y0, x1, y1), r, fill=fill, outline=outline or P["ink"], width=width)
        else:
            if shadow:
                sh = Image.new("RGBA", cv.size, (0, 0, 0, 0))
                ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + shadow, x1, y1 + shadow), r, fill=P["ink"] + (70,))
                cv.alpha_composite(sh.filter(ImageFilter.GaussianBlur(shadow * 1.6)))
            d = ImageDraw.Draw(cv)
            if outline:
                d.rounded_rectangle((x0 - width, y0 - width, x1 + width, y1 + width), r + width, fill=outline)
            d.rounded_rectangle((x0, y0, x1, y1), r, fill=fill)

    def badge(self, cv, xy, text, size):
        """品牌色标签：candy 是胶囊 + 描边阴影，flat 是圆角块"""
        f = font("title", size)
        d = ImageDraw.Draw(cv)
        b = d.textbbox((0, 0), text, font=f)
        pad = (int(size * 0.58), int(size * 0.27))
        w, h = b[2] - b[0] + pad[0] * 2, b[3] - b[1] + pad[1] * 2
        x, y = xy
        r = h // 2 if self.style == "candy" else int(size * 0.24)
        self.block(cv, (x, y, x + w, y + h), r, self.P["brand"], shadow=6 if self.style == "candy" else 0)
        ImageDraw.Draw(cv).text((x + pad[0] - b[0], y + pad[1] - b[1]), text, font=f, fill=self.P["onBrand"])
        return w, h

    def title(self, cv, xy, line, size, max_w):
        """一行标题，太长自动缩字号；加一圈底色描边，压在大图上也清楚"""
        parts = parse_title(line, self.P)
        d = ImageDraw.Draw(cv)
        while size > 40 and sum(d.textlength(s, font=font("title", size)) for s, _ in parts) > max_w:
            size -= 2
        f = font("title", size)
        x, y = xy
        for s, col in parts:
            d.text((x, y), s, font=f, fill=col, stroke_width=max(3, size // 24), stroke_fill=self.P["bg"])
            x += d.textlength(s, font=f)
        return size

    def wrap(self, text, f, max_w):
        """副标题按逗号断行（放不下才断）"""
        d = ImageDraw.Draw(Image.new("L", (1, 1)))
        if d.textlength(text, font=f) <= max_w:
            return [text]
        lines, cur = [], ""
        for piece in re.findall(r"[^，,、]+[，,、]?", text):
            if cur and d.textlength(cur + piece, font=f) > max_w:
                lines.append(cur)
                cur = piece
            else:
                cur += piece
        return lines + [cur]

    # ------------------------------------------------------------ 大图
    def place_hero(self, cv, k, x, y):
        hero = self.hero.resize((int(self.hero.width * k), int(self.hero.height * k)), Image.Resampling.LANCZOS).convert("RGBA")
        # 四边羽化：三维画面的底色和封面底色差一点点，硬边会露出接缝
        m = Image.new("L", hero.size, 0)
        ImageDraw.Draw(m).rectangle((40, 40, hero.width - 41, hero.height - 41), fill=255)
        hero.putalpha(m.filter(ImageFilter.GaussianBlur(18)))
        cv.alpha_composite(hero, (int(x), int(y)))
        return lambda px, py: (x + px * k, y + py * k)

    def fade(self, cv, mask):
        return Image.composite(Image.new("RGBA", cv.size, self.P["bg"] + (255,)), cv, mask)

    def hero_tags(self, cv, at, scale):
        """
        大图里页面自带的标签缩到封面上只有十来个像素，看不清：在原位置盖一个放大的同款标签。
        带 "arrow": true 的那个标签记下外框，箭头改为停在它的边上（不戳进字里）
        """
        self.arrow_box = None
        for t in CFG.get("heroTags", []):
            f = font("body", 26 * scale)
            d = ImageDraw.Draw(cv)
            b = d.textbbox((0, 0), t["text"], font=f)
            w, h = b[2] - b[0] + 28 * scale, 44 * scale
            cx, cy = at(*t["at"])
            col = rgb(t.get("color", CFG.get("palette", {}).get("accent", "#F26B1D")))
            self.block(cv, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), int(6 * scale), col, shadow=4 if self.style == "candy" else 6, width=3)
            ImageDraw.Draw(cv).text((cx, cy), t["text"], font=f, fill=(255, 255, 255), anchor="mm")
            if t.get("arrow"):
                self.arrow_box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

    def aim(self, p0, tgt):
        """箭头终点：有 arrow 标签就停在标签朝向箭头起点的那条边的中点外一点，否则停在目标点前"""
        b = self.arrow_box
        if not b:
            return self.short(p0, tgt)
        x0, y0, x1, y1 = b
        if p0[0] < x0:
            edge = (x0, (y0 + y1) / 2)
        elif p0[0] > x1:
            edge = (x1, (y0 + y1) / 2)
        else:
            edge = ((x0 + x1) / 2, y0 if p0[1] < y0 else y1)
        return self.short(p0, edge, 14)

    # ------------------------------------------------------------ 三步缩略图
    def step_row(self, cv, x, y, w, gap, size):
        h = w * 3 // 4
        P = self.P
        for i, (pic, name) in enumerate(self.steps):
            last = i == len(self.steps) - 1
            cx = x + i * (w + gap)
            frame = P["accent"] if last else P["white"]
            self.block(cv, (cx - 4, y - 4, cx + w + 4, y + h + 4), 16, frame, shadow=6, width=4)
            m = Image.new("L", (w, h), 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), 12, fill=255)
            cv.paste(pic.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA"), (cx, y), m)
            sh = int(size * 1.8)
            strip = Image.new("RGBA", (w, sh), (255, 255, 255, 235))
            sm = Image.new("L", (w, sh), 0)
            ImageDraw.Draw(sm).rounded_rectangle((0, -14, w - 1, sh - 1), 12, fill=255)
            cv.paste(strip, (cx, y + h - sh), sm)
            d = ImageDraw.Draw(cv)
            d.text((cx + w // 2, y + h - sh // 2), name, font=font("title" if self.style == "candy" else "body", size), fill=P["accent"] if last else P["ink"], anchor="mm")
            if not last:
                ax, ay = cx + w + gap // 2 + 3, y + h // 2
                d.line([(ax - 8, ay - 13), (ax + 5, ay), (ax - 8, ay + 13)], fill=P["sub"], width=5)
        return h

    # ------------------------------------------------------------ 道具卡片
    def card(self, w, angle):
        """
        歪着贴的道具卡片：品牌色抬头（小字机构名 + 卡片名）、若干字段（标签 + 值）、底部虚线撕口 + 提示 / 条形码，
        左上角一个强调色气泡。内容全在 cover.json 的 card 里。返回 RGBA 图（含阴影和留白）
        """
        c = CFG["card"]
        P = self.P
        k = w / 300  # 以 300 宽为基准缩放
        S = lambda v: int(v * k)  # noqa: E731
        rows = []
        for fld in c.get("fields", []):
            size = fld.get("size", "md")
            rows.append((fld, {"xl": 112, "lg": 86, "md": 66}[size]))
        foot = 58 if c.get("footer") else (70 if c.get("barcode") else 18)
        h = S(84 + 18 + sum(r for _, r in rows) + foot)
        pad = S(46)
        out = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        x0, y0, x1, y1 = pad, pad, pad + w, pad + h
        r = S(18)
        self.block(out, (x0, y0, x1, y1), r, P["card"], shadow=S(8) if self.style == "candy" else 0, width=max(3, S(4)))
        d = ImageDraw.Draw(out)
        # 抬头：品牌色条（只圆上面两个角）
        hh = S(84)
        inset = 3 if self.style == "candy" else 0
        d.rounded_rectangle((x0 + inset, y0 + inset, x1 - inset, y0 + hh), r - inset, fill=P["brand"])
        d.rectangle((x0 + inset, y0 + hh - r, x1 - inset, y0 + hh), fill=P["brand"])
        if self.style == "candy":
            d.line((x0, y0 + hh, x1, y0 + hh), fill=P["ink"], width=max(2, S(3)))
        if c.get("org"):
            d.text((x1 - S(20), y0 + S(12)), c["org"], font=font("body", S(18)), fill=mix(P["brand"], P["white"], 0.72), anchor="ra")
        d.text((x0 + S(22), y0 + S(40)), c.get("title", ""), font=font("title", S(28)), fill=P["onBrand"])
        # 字段
        y = y0 + hh + S(18)
        for fld, rh in rows:
            size = fld.get("size", "md")
            val = str(fld["value"])
            col = P["accent"] if fld.get("accent") else P["ink"]
            d.text((x0 + S(22), y), fld.get("label", ""), font=font("body", S(18)), fill=P["sub"])
            if size == "md":
                vf = font("num", S(30)) if is_code(val) else font("body", S(24))
                vy = y + S(24)
            else:
                big = {"xl": 78, "lg": 56}[size]
                vf = font("num", S(big)) if is_code(val) else font("title", S(big * 0.66))
                vy = y + S(16 if size == "xl" else 18)
            d.text((x0 + S(20), vy), val, font=vf, fill=col)
            if fld.get("note"):
                vx = x0 + S(20) + d.textlength(val, font=vf) + S(14)
                d.text((vx, vy + (vf.size - S(24)) * 0.55), fld["note"], font=font("body", S(24)), fill=P["ink"])
            y += S(rh)
        # 底部：虚线撕口 + 提示，或条形码
        if c.get("footer"):
            yy = y1 - S(46)
            for xx in range(x0 + S(14), x1 - S(14), S(14)):
                d.line((xx, yy, xx + S(7), yy), fill=mix(P["sub"], P["white"], 0.55), width=max(2, S(2)))
            d.text(((x0 + x1) // 2, yy + S(23)), c["footer"], font=font("body", S(18)), fill=P["sub"], anchor="mm")
        elif c.get("barcode"):
            rnd = random.Random(str(c.get("title")))
            bx, by, bh = x0 + S(22), y1 - S(58), S(36)
            while bx < x1 - S(24):
                bw = rnd.choice((1, 1, 2, 3)) * max(1, S(2))
                d.rectangle((bx, by, bx + bw - 1, by + bh), fill=P["ink"])
                bx += bw + rnd.choice((2, 3, 4)) * max(1, int(1.5 * k))
        # 左上角气泡
        if c.get("bubble"):
            fb = font("title" if self.style == "candy" else "body", S(22))
            b = d.textbbox((0, 0), c["bubble"], font=fb)
            bw, bh = b[2] - b[0] + S(32), b[3] - b[1] + S(20)
            bx0, by0 = x0 - S(22), y0 - S(26)
            self.block(out, (bx0, by0, bx0 + bw, by0 + bh), bh // 2, P["accent"], shadow=S(4) if self.style == "candy" else 0, width=max(2, S(3)))
            ImageDraw.Draw(out).text((bx0 + S(16) - b[0], by0 + S(10) - b[1]), c["bubble"], font=fb, fill=P["white"])
        out = out.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        if self.style == "flat":  # 平面风格的投影在旋转之后加
            res = Image.new("RGBA", (out.width + 60, out.height + 60), (0, 0, 0, 0))
            sh = Image.new("RGBA", res.size, (0, 0, 0, 0))
            sh.paste(P["ink"] + (90,), (30, 44), out.split()[3])
            res.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
            res.alpha_composite(out, (30, 30))
            out = res
        return out

    # ------------------------------------------------------------ 箭头
    def arrow(self, cv, p0, p1, c0, c1, width=8):
        """三次贝塞尔弧形箭头：先画一圈描边（candy 深墨 / flat 白色）再画强调色，压在三维图上也清楚"""
        P = self.P
        (x0, y0), (x1, y1) = p0, p1
        pts = []
        for i in range(61):
            t = i / 60
            a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t**3
            pts.append((a * x0 + b * c0[0] + c * c1[0] + e * x1, a * y0 + b * c0[1] + c * c1[1] + e * y1))
        ax, ay = pts[-1]
        bx, by = pts[-6]
        ang = math.atan2(ay - by, ax - bx)
        L = 34
        head = [(ax, ay), (ax - L * math.cos(ang - 0.5), ay - L * math.sin(ang - 0.5)), (ax - L * math.cos(ang + 0.5), ay - L * math.sin(ang + 0.5))]
        # 箭杆停在箭头根部，免得线头从三角形尖上戳出来
        shaft = [p for p in pts if math.hypot(p[0] - ax, p[1] - ay) > L * 0.7]
        d = ImageDraw.Draw(cv)
        edge = P["ink"] if self.style == "candy" else P["white"]
        d.line(shaft, fill=edge, width=width + 7, joint="curve")
        hx, hy = sum(p[0] for p in head) / 3, sum(p[1] for p in head) / 3
        d.polygon([(hx + (x - hx) * 1.27, hy + (y - hy) * 1.27) for x, y in head], fill=edge)
        d.line(shaft, fill=P["accent"], width=width, joint="curve")
        d.polygon(head, fill=P["accent"])

    @staticmethod
    def short(p0, p1, gap=26):
        """箭头尖停在目标点前 gap 像素，不戳进标签里"""
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        n = math.hypot(dx, dy) or 1
        return (p1[0] - dx / n * gap, p1[1] - dy / n * gap)

    # ------------------------------------------------------------ 两种版式
    def portrait(self):
        """竖版 3:4：上标签行；中三维大图（卡片贴在上角、箭头指进招牌效果）；下标题、副标题、三步"""
        W, H = 1080, 1440
        L = CFG.get("layout", {}).get("3x4", {})
        cv = Image.new("RGBA", (W, H), self.P["bg"] + (255,))
        k = L.get("heroScale", 0.56 * H / self.hero.height)
        tx, ty = L.get("targetAt", [0.55 * W, None])
        hw = self.hero.width * k
        x = L.get("heroX", tx - self.target[0] * k)
        if "heroX" not in L:
            x = (W - hw) / 2 if hw <= W else min(0, max(W - hw, x))
        y = L.get("heroY", (ty - self.target[1] * k) if ty is not None else 130)
        at = self.place_hero(cv, k, x, y)
        cv = self.fade(cv, gradient((W, H), L.get("fade", [(0, 255), (0.09, 0), (0.52, 0), (0.62, 255), (1, 255)])))
        self.hero_tags(cv, at, 1.0)
        bw, bh = self.badge(cv, (56, 52), CFG["badge"], 50)
        if CFG.get("kicker"):
            ImageDraw.Draw(cv).text((W - 56, 52 + bh // 2), CFG["kicker"], font=font("body", 30), fill=self.P["sub"], anchor="rm")
        tgt = at(*self.target)
        if CFG.get("card"):
            left = tgt[0] >= W * 0.42  # 目标在右半边，卡片贴左上；反之贴右上
            C = L.get("card", {})
            img = self.card(C.get("width", 196), C.get("angle", 7 if left else -7))
            cx, cy = C.get("at", [12, 186] if left else [W - img.width - 12, 186])
            cv.alpha_composite(img, (int(cx), int(cy)))
            A = L.get("arrow", {})
            p0 = A.get("from", [cx + img.width * (0.78 if left else 0.22), cy + img.height * 0.34])
            p1 = A.get("to") or self.aim(p0, tgt)
            dx = p1[0] - p0[0]
            top = min(p0[1], p1[1])
            c0 = A.get("c0", [p0[0] + dx * 0.25, max(110, top - abs(dx) * 0.3)])
            c1 = A.get("c1", [p0[0] + dx * 0.7, max(110, top - abs(dx) * 0.25)])
            self.arrow(cv, p0, p1, c0, c1)
        ty0 = L.get("titleY", 880)
        size = L.get("titleSize", 116)
        lines = CFG["title"]
        for i, line in enumerate(lines):
            self.title(cv, (60, ty0 + i * int(size * 1.14)), line, size, W - 120)
        sy = ty0 + len(lines) * int(size * 1.14) + 6
        if CFG.get("subtitle"):
            ImageDraw.Draw(cv).text((62, sy), CFG["subtitle"].replace("\n", ""), font=font("body", 34), fill=self.P["sub"])
        if self.steps:
            gap = 51
            w = (W - 120 - gap * (len(self.steps) - 1)) // len(self.steps)
            self.step_row(cv, 60, L.get("stepsY", H - 14 - w * 3 // 4), w, gap, 26)
        return cv

    def landscape(self):
        """横版 4:3：左标签行、两行标题、副标题（压在淡出的大图左半边上）；右三维大图；下三步；右下卡片，箭头往上绕进大图"""
        W, H = 1440, 1080
        L = CFG.get("layout", {}).get("4x3", {})
        cv = Image.new("RGBA", (W, H), self.P["bg"] + (255,))
        k = L.get("heroScale", 0.6 * H / self.hero.height)
        tx, ty = L.get("targetAt", [0.7 * W, None])
        hw = self.hero.width * k
        x = L.get("heroX", tx - self.target[0] * k)
        if "heroX" not in L:
            # 左边压在淡出的标题区下面，露空也看不出来；只保证右边铺到底（大图超出右边裁掉没关系）
            x = max(x, W - hw)
        y = L.get("heroY", (ty - self.target[1] * k) if ty is not None else 150)
        at = self.place_hero(cv, k, x, y)
        hf = L.get("hfade", [0.39, 0.65])
        cv = self.fade(cv, hgradient((W, H), hf[0] * W, hf[1] * W))
        cv = self.fade(cv, gradient((W, H), L.get("fade", [(0, 255), (0.09, 0), (0.68, 0), (0.74, 255), (1, 255)])))
        self.hero_tags(cv, at, 0.95)
        bw, bh = self.badge(cv, (72, 70), CFG["badge"], 54)
        if CFG.get("kicker"):
            ImageDraw.Draw(cv).text((72 + bw + 30, 70 + bh // 2), CFG["kicker"], font=font("body", 32), fill=self.P["sub"], anchor="lm")
        ty0 = L.get("titleY", 226)
        size = L.get("titleSize", 108)
        lines = CFG["title"]
        for i, line in enumerate(lines):
            self.title(cv, (72, ty0 + i * int(size * 1.2)), line, size, W * 0.66)
        sy = ty0 + len(lines) * int(size * 1.2) + 34
        if CFG.get("subtitle"):
            f = font("body", 38)
            sub = CFG["subtitle"].split("\n") if "\n" in CFG["subtitle"] else self.wrap(CFG["subtitle"], f, W * 0.36)
            for j, line in enumerate(sub):
                ImageDraw.Draw(cv).text((76, sy + j * 52), line, font=f, fill=self.P["sub"])
        if self.steps:
            gap = 52
            self.step_row(cv, 72, L.get("stepsY", 806), 300, gap, 28)
        if CFG.get("card"):
            C = L.get("card", {})
            img = self.card(C.get("width", 196), C.get("angle", -6))
            cx, cy = C.get("at", [W - img.width + 10, 600])
            cv.alpha_composite(img, (int(cx), int(cy)))
            tgt = at(*self.target)
            A = L.get("arrow", {})
            p0 = A.get("from", [cx + img.width * 0.6, cy + 44])
            p1 = A.get("to") or self.aim(p0, tgt)
            c0 = A.get("c0", [min(W - 20, p0[0] + 90), p0[1] - 0.45 * (p0[1] - p1[1])])
            c1 = A.get("c1", [p1[0] + 0.5 * (W - p1[0]), max(40, p1[1] - 90)])
            self.arrow(cv, p0, p1, c0, c1)
        return cv


def main():
    global ROOT, CFG
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        raise SystemExit(__doc__)
    ROOT = os.path.abspath(args[0])
    path = os.path.join(ROOT, "cover.json")
    if not os.path.exists(path):
        raise SystemExit(f"没有 {path}（模板在 skill 的 templates/cover.json）")
    CFG = json.load(open(path, encoding="utf-8"))
    only = args[args.index("--only") + 1] if "--only" in args else None
    cov = Cover()
    if only in (None, "3x4"):
        cov.portrait().convert("RGB").save(os.path.join(ROOT, "cover-3x4.png"))
        print("写出 cover-3x4.png")
    if only in (None, "4x3"):
        cov.landscape().convert("RGB").save(os.path.join(ROOT, "cover-4x3.png"))
        print("写出 cover-4x3.png")


if __name__ == "__main__":
    main()
