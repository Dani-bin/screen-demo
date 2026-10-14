"""从用户手描的黄色房屋轮廓里提取每一栋房子的平面多边形。

用户在两张截图上用黄线把农村房子一栋一栋圈了出来（相邻的也分开圈）：
  docs/design/hometown/houses-north-2013.webp  北坡那排（Google 地球 2013 影像）
  docs/design/hometown/houses-road.webp        公路边两栋（2017 影像）
做法：
  1. SIFT + RANSAC 求每张图到 satellite-outline-v2.webp 的相似变换（黄线本身不参与匹配）
  2. 黄色描边 → 闭运算补缝 → 取描边围出的"洞" = 每栋房子的内部
  3. 洞向外扩半个线宽回到描边中线，变换到 v2 像素坐标，简化顶点
  4. 在 v2 卫星图上取多边形内的平均颜色，判断屋顶：red / grey / blue / white

运行：python3 scripts/hometown/trace_houses.py
输出：scripts/hometown/houses.json（draw_plan.py 读取，不要手改）
"""

import json
import os

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DESIGN = os.path.join(ROOT, "docs", "design", "hometown")
OUT = os.path.join(os.path.dirname(__file__), "houses.json")

# (文件名, 地图区域 [x0, y0, x1, y1]：截掉浏览器界面，None 表示整张都是地图,
#  补线：手描线没封口的地方，给出两个断头的大致位置，脚本吸附到最近的黄线像素再连上)
SOURCES = [
    # 你家西北边那栋大红瓦房，左上角有个小断口
    ("houses-north-2013.webp", (0, 345, 2000, 1230),
     [((1022, 557), (1017, 561))]),
    # 公路边左边那栋的左上角没画封口
    ("houses-road.webp", None, [((1015, 1050), (1000, 1062))]),
]
# 我家在 v2 上的位置：用户在 3D 预览图上圈定的那栋大红瓦房（回家路线的终点就在它门前）。
# 早先按 2017 截图红圈配准得到的 (906, 400) 落在了它东南边的邻居家，已作废。
HOME_PX = (805, 318)


def yellow_mask(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (15, 120, 150), (35, 255, 255))


def register(img, region, v2_kp, v2_desc, sift):
    """求 img → v2 的相似变换（旋转 + 等比缩放 + 平移）。"""
    mask = np.zeros(img.shape[:2], np.uint8)
    if region:
        x0, y0, x1, y1 = region
        mask[y0:y1, x0:x1] = 255
    else:
        mask[:] = 255
    mask[cv2.dilate(yellow_mask(img), np.ones((9, 9))) > 0] = 0
    kp, desc = sift.detectAndCompute(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY),
                                     mask)
    pairs = cv2.BFMatcher().knnMatch(desc, v2_desc, k=2)
    good = [a for a, b in pairs if a.distance < 0.75 * b.distance]
    p1 = np.float32([kp[a.queryIdx].pt for a in good])
    p2 = np.float32([v2_kp[a.trainIdx].pt for a in good])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC,
                                         ransacReprojThreshold=4)
    return M, int(inl.sum())


def outlines(img, region, bridges):
    """黄线围出的每个封闭区域 → 多边形（原图像素坐标）。"""
    m = yellow_mask(img)
    if region:
        x0, y0, x1, y1 = region
        keep = np.zeros_like(m)
        keep[y0:y1, x0:x1] = m[y0:y1, x0:x1]
        m = keep
    # 大断口：按给定的两个断头位置，吸附到最近的黄线像素后画线连上
    ys, xs = np.nonzero(m)
    stroke = np.stack([xs, ys], 1)
    for a, b in bridges:
        pa = stroke[np.argmin(((stroke - a) ** 2).sum(1))]
        pb = stroke[np.argmin(((stroke - b) ** 2).sum(1))]
        cv2.line(m, tuple(int(v) for v in pa), tuple(int(v) for v in pb),
                 255, 4)
    # 小断点：闭运算补上
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    contours, hier = cv2.findContours(m, cv2.RETR_CCOMP,
                                      cv2.CHAIN_APPROX_NONE)
    polys = []
    for c, h in zip(contours, hier[0]):
        if h[3] < 0:  # 只要"洞"（有父轮廓的内边界）
            continue
        if cv2.contourArea(c) < 150:  # 描边交叉处的小碎洞
            continue
        # 洞向外扩约半个线宽，回到描边中线
        blob = np.zeros_like(m)
        cv2.drawContours(blob, [c], -1, 255, -1)
        blob = cv2.dilate(blob, np.ones((5, 5), np.uint8))
        cs, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL,
                                 cv2.CHAIN_APPROX_NONE)
        polys.append(max(cs, key=cv2.contourArea).reshape(-1, 2))
    return polys


def roof_of(v2, poly):
    """多边形内平均颜色 → 屋顶类别。"""
    mask = np.zeros(v2.shape[:2], np.uint8)
    cv2.fillPoly(mask, [np.int32(poly)], 255)
    b, g, r = [float(x) for x in cv2.mean(v2, mask)[:3]]
    if b > r + 18 and b > g:
        return "blue"
    if r > g + 12 and r > b + 12:
        return "red"
    if min(r, g, b) > 150:
        return "white"
    return "grey"


def main():
    v2 = cv2.imread(os.path.join(DESIGN, "satellite-outline-v2.webp"))
    sift = cv2.SIFT_create(10000)
    v2_kp, v2_desc = sift.detectAndCompute(
        cv2.cvtColor(v2, cv2.COLOR_BGR2GRAY), None)
    houses = []
    for name, region, bridges in SOURCES:
        img = cv2.imread(os.path.join(DESIGN, name))
        M, inliers = register(img, region, v2_kp, v2_desc, sift)
        polys = outlines(img, region, bridges)
        print(f"{name}: 配准内点 {inliers}，提取 {len(polys)} 栋")
        for p in polys:
            q = cv2.transform(p.reshape(-1, 1, 2).astype(np.float32), M)
            q = cv2.approxPolyDP(q, 1.5, True).reshape(-1, 2)
            pts = [[round(float(x), 1), round(float(y), 1)] for x, y in q]
            is_home = cv2.pointPolygonTest(
                q.astype(np.float32), HOME_PX, False) >= 0
            houses.append({
                "source": name,
                "roof": "home" if is_home else roof_of(v2, q),
                "pts": pts,
            })
    houses.sort(key=lambda h: (h["source"], h["pts"][0][0]))
    with open(OUT, "w") as f:
        json.dump({"note": "由 trace_houses.py 生成，不要手改",
                   "houses": houses}, f, ensure_ascii=False, indent=1)
    print("写出", os.path.relpath(OUT, ROOT), "共", len(houses), "栋",
          "（含我家）" if any(h["roof"] == "home" for h in houses)
          else "（未找到我家！）")


if __name__ == "__main__":
    main()
