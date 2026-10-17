"""极简 DXF（R12 / AC1009）写出器：只用 LINE / POLYLINE / ARC / CIRCLE / TEXT / SOLID。

不依赖 ezdxf，生成的文件 AutoCAD、浩辰、中望、LibreCAD 都能打开。
中文用 \\U+XXXX 转义写进 TEXT，字体用国标 gbenor.shx + 大字体 gbcbig.shx（中文版 CAD 自带）。
单位：米（1 个图形单位 = 1 m）。
"""


def _esc(s):
    return "".join(c if ord(c) < 128 else f"\\U+{ord(c):04X}" for c in s)


class DXF:
    def __init__(self):
        self.layers = {}  # 名称 → (颜色, 线型, 关闭)
        self.ents = []

    def layer(self, name, color=7, ltype="CONTINUOUS", off=False):
        self.layers[name] = (color, ltype, off)

    def _g(self, *pairs):
        for code, val in pairs:
            if isinstance(val, float):
                val = f"{val:.4f}".rstrip("0").rstrip(".") if abs(val) >= 1e-9 else "0"
            self.ents.append(f"{code}\n{val}")

    def line(self, L, a, b):
        self._g((0, "LINE"), (8, L), (10, float(a[0])), (20, float(a[1])), (30, 0.0), (11, float(b[0])), (21, float(b[1])), (31, 0.0))

    def poly(self, L, pts, closed=True):
        self._g((0, "POLYLINE"), (8, L), (66, 1), (10, 0.0), (20, 0.0), (30, 0.0), (70, 1 if closed else 0))
        for x, y in pts:
            self._g((0, "VERTEX"), (8, L), (10, float(x)), (20, float(y)), (30, 0.0))
        self._g((0, "SEQEND"), (8, L))

    def solid(self, L, pts):
        """实心填充（3 或 4 点）。DXF 的 SOLID 四点顺序是 1-2-4-3，这里按多边形顺序传入即可。"""
        p = list(pts) + [pts[-1]] * (4 - len(pts))
        order = [p[0], p[1], p[3], p[2]]
        g = [(0, "SOLID"), (8, L)]
        for k, (x, y) in enumerate(order):
            g += [(10 + k, float(x)), (20 + k, float(y)), (30 + k, 0.0)]
        self._g(*g)

    def arc(self, L, c, r, a0, a1):
        self._g((0, "ARC"), (8, L), (10, float(c[0])), (20, float(c[1])), (30, 0.0), (40, float(r)), (50, float(a0 % 360)), (51, float(a1 % 360)))

    def circle(self, L, c, r):
        self._g((0, "CIRCLE"), (8, L), (10, float(c[0])), (20, float(c[1])), (30, 0.0), (40, float(r)))

    def text(self, L, p, s, h, ha="center", va="center", rot=0.0):
        """ha: left / center / right；va: bottom / center / top（在文字自身坐标系里）"""
        h72 = {"left": 0, "center": 1, "right": 2}[ha]
        v73 = {"bottom": 1, "center": 2, "top": 3}[va]
        g = [(0, "TEXT"), (8, L), (10, float(p[0])), (20, float(p[1])), (30, 0.0), (40, float(h)), (1, _esc(s)), (7, "CN")]
        if rot:
            g.append((50, float(rot)))
        g += [(72, h72), (73, v73), (11, float(p[0])), (21, float(p[1])), (31, 0.0)]
        self._g(*g)

    def save(self, path, extents):
        (x0, y0), (x1, y1) = extents
        out = []

        def g(code, val):
            out.append(f"{code}\n{val}")

        g(0, "SECTION"), g(2, "HEADER")
        g(9, "$ACADVER"), g(1, "AC1009")
        g(9, "$DWGCODEPAGE"), g(3, "ANSI_936")
        g(9, "$EXTMIN"), g(10, x0), g(20, y0), g(30, 0)
        g(9, "$EXTMAX"), g(10, x1), g(20, y1), g(30, 0)
        g(9, "$LTSCALE"), g(40, 1.0)
        g(0, "ENDSEC")

        g(0, "SECTION"), g(2, "TABLES")
        # 线型
        ltypes = [
            ("CONTINUOUS", "Solid line", []),
            ("CENTER", "Center ____ _ ____ _", [2.0, -0.5, 0.5, -0.5]),
            ("DASHED", "Dashed __ __ __", [0.8, -0.4]),
        ]
        g(0, "TABLE"), g(2, "LTYPE"), g(70, len(ltypes))
        for name, desc, pat in ltypes:
            g(0, "LTYPE"), g(2, name), g(70, 0), g(3, desc), g(72, 65), g(73, len(pat)), g(40, sum(abs(x) for x in pat))
            for x in pat:
                g(49, x)
        g(0, "ENDTAB")
        # 图层
        g(0, "TABLE"), g(2, "LAYER"), g(70, len(self.layers) + 1)
        g(0, "LAYER"), g(2, "0"), g(70, 0), g(62, 7), g(6, "CONTINUOUS")
        for name, (color, ltype, off) in self.layers.items():
            g(0, "LAYER"), g(2, name), g(70, 0), g(62, -color if off else color), g(6, ltype)
        g(0, "ENDTAB")
        # 文字样式：国标字体 + 中文大字体
        g(0, "TABLE"), g(2, "STYLE"), g(70, 2)
        for name in ("STANDARD", "CN"):
            g(0, "STYLE"), g(2, name), g(70, 0), g(40, 0.0), g(41, 0.7), g(50, 0.0), g(71, 0), g(42, 2.5), g(3, "gbenor.shx"), g(4, "gbcbig.shx")
        g(0, "ENDTAB")
        g(0, "ENDSEC")

        g(0, "SECTION"), g(2, "ENTITIES")
        out.extend(self.ents)
        g(0, "ENDSEC")
        g(0, "EOF")
        with open(path, "w", encoding="ascii") as fh:
            fh.write("\n".join(out) + "\n")
