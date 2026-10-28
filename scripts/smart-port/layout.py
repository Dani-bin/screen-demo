"""
智慧港口（洋山四期）对象编号与布局规则
----------------------------------------------------------
编号规则见 docs/design/smart-port/03-scope.md：编号就是三维里的对象名，自西向东编号。
这里是编号和平面布局（u / v 坐标）的唯一来源，仿真器、三维场景、设计稿都读它生成的 layout.json。
尺寸依据见 02-research.md：公开参数（箱区数、轨距、设备数）+ Sentinel-2 10 m 上核对过的箱区分组，
精度约 ±10 m（《公开地图内容表示规范》要求平面精度不优于 10 m）。

坐标系（02-research.md）：原点 = 四期集装箱岸线西端（30.6558084N, 122.0101067E），
u 沿岸线指向方位 106°（往东南为正），v 垂直岸线指向陆地（方位 16°），单位米。

用法：python3 scripts/smart-port/layout.py
      → 写 docs/design/smart-port/devices.json 和 src/views/smart-port/data/layout.json（生成文件，不要手改）
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "design" / "smart-port"

# 泊位：7 个，沿岸线均分；B03、B04 为 7 万吨级（位置是假设，资料没写）
BERTHS = 7
BIG_BERTHS = {"B03", "B04"}

# 岸桥：28 台双小车岸桥，共轨
CRANES = 28

# 箱区分组：自西向东 11 组，每组的箱区数（子代理在影像上量的，Sentinel-2 上核对过分界）
BLOCK_GROUPS = [1, 4, 4, 6, 8, 8, 8, 8, 6, 7, 1]
# 冷藏箱集中的箱区（推断：影像上 u≈850、u≈1300 附近有整条白色冷藏箱带）
REEFER_BLOCKS = {"Y19", "Y20", "Y31"}
# 只设 1 台轨道吊的箱区：西端孤立的短箱区，使总数 = 1 + 60 × 2 = 121（振华完工数）
SINGLE_RMG_BLOCKS = {"Y01"}

# ---------- 平面布局（u 沿岸线、v 向陆地，米） ----------
ORIGIN = (30.6558084, 122.0101067)  # 集装箱岸线西端
U_BEARING = 106.0  # u 轴方位角（度，正北顺时针）

# 集装箱岸线：OSM 海岸线上的直线段 u 0–2314（公开数字 2350 m 含两端过渡）；
# 工作船码头退后 42 m，u 2407–2748（拖轮、工作船，背景）
QUAY = (0.0, 2314.0)
WORKBOAT_QUAY = (2407.0, 2748.0, 42.0)

# 岸桥轨道：海侧轨 v=6、陆侧轨 v=36（轨距 30 m）；岸桥"驻车位"沿岸线均布
QC_RAIL = (6.0, 36.0)
QC_MIN_GAP = 30.0  # 相邻岸桥中心最小间距（门腿外宽约 27 m，假设）

# 从岸线往陆地的分带（中东段量测，见 02-research.md）
BANDS = {
    "apron": (0.0, 6.0),  # 前沿、护舷
    "qc": (6.0, 36.0),  # 岸桥轨距
    "backreach": (42.0, 68.0),  # 后伸距带：门架小车向 AGV 放箱
    "buffer": (70.0, 92.0),  # AGV 缓冲停车
    "lanes": (93.0, 126.0),  # AGV 行驶车道
    "seaTransfer": (127.0, 152.0),  # 海侧交换区（AGV 支架）
    "yard": (152.0, 510.0),  # 自动化箱区（各组长度不同）
    "landTransfer": (510.0, 535.0),  # 陆侧交换区（外集卡）
    "road": (538.0, 585.0),  # 陆侧集卡主干道
}
AGV_LANES = 6  # 行驶车道数（推断 6–8 条）

# 箱区：每组的起点 u（影像量测）与堆存段长度（沿 v，量测三档）；组内箱区中心距 36 m
BLOCK_PITCH = 36.0
BLOCK_SPAN = 31.0  # 轨道吊轨距
BLOCK_ROWS = 10  # 每区 10 列箱（排距约 2.9 m）
BLOCK_TIERS = 5  # 堆 5 层（高箱"堆 5 过 6"）
GROUP_START_U = [125, 178, 337, 496, 728, 1032, 1347, 1655, 1963, 2193, 2466]
GROUP_LENGTH_V = [240, 245, 245, 310, 310, 310, 355, 355, 355, 240, 240]

AGVS = 145
SWAP_STATIONS = ["BS-1", "BS-2"]


def block_ids():
    n = sum(BLOCK_GROUPS)
    return [f"Y{i:02d}" for i in range(1, n + 1)]


def block_group(block_id):
    """箱区所在的组号（0 起）"""
    i = int(block_id[1:]) - 1
    for g, count in enumerate(BLOCK_GROUPS):
        if i < count:
            return g
        i -= count
    raise ValueError(block_id)


def devices():
    """全部对象清单（不含动态生成的船舶航次）"""
    out = []
    for i in range(1, BERTHS + 1):
        bid = f"B{i:02d}"
        grade = "7 万吨级" if bid in BIG_BERTHS else "5 万吨级"
        out.append({"id": bid, "name": f"{i} 号泊位", "kind": "berth", "node": bid, "grade": grade})
    for i in range(1, CRANES + 1):
        qid = f"QC{i:02d}"
        out.append({"id": qid, "name": f"{i} 号岸桥", "kind": "sts", "node": qid})
    for bid in block_ids():
        item = {"id": bid, "name": f"{bid} 箱区", "kind": "block", "node": bid, "group": block_group(bid)}
        if bid in REEFER_BLOCKS:
            item["reefer"] = True
        out.append(item)
    for bid in block_ids():
        sides = ["S"] if bid in SINGLE_RMG_BLOCKS else ["S", "L"]
        for s in sides:
            rid = f"{bid}-{s}"
            side = "海侧" if s == "S" else "陆侧"
            out.append({"id": rid, "name": f"{bid} {side}轨道吊", "kind": "armg", "node": rid, "block": bid})
    for i in range(1, AGVS + 1):
        aid = f"AGV{i:03d}"
        # 实例化渲染：node 记编号，场景里用编号 → 实例下标的映射表
        out.append({"id": aid, "name": f"AGV {i:03d}", "kind": "agv", "node": aid, "instanced": True})
    for sid, where in zip(SWAP_STATIONS, ["东端", "西端"]):
        out.append({"id": sid, "name": f"{where}换电站", "kind": "swap", "node": sid})
    out += [
        {"id": "DG-01", "name": "危险品 / 超限箱区", "kind": "special", "node": "DG-01"},
        {"id": "MET-01", "name": "码头气象站", "kind": "met", "node": "MET-01"},
        {"id": "CC-01", "name": "生产指挥中心", "kind": "building", "node": "CC-01"},
        {"id": "GATE-E", "name": "东闸口", "kind": "gate", "node": "GATE-E"},
        {"id": "GATE-W", "name": "西闸口", "kind": "gate", "node": "GATE-W"},
    ]
    return out


def blocks_layout():
    """箱区的 u 中心、v 范围与箱位容量"""
    out, k = [], 0
    for g, (count, u0, length) in enumerate(zip(BLOCK_GROUPS, GROUP_START_U, GROUP_LENGTH_V)):
        for i in range(count):
            k += 1
            bid = f"Y{k:02d}"
            uc = u0 + BLOCK_SPAN / 2 + i * BLOCK_PITCH
            v0 = BANDS["yard"][0]
            # 20 尺箱位按 6.1 m 一个贝（含箱间隙），容量 = 贝 × 列 × 层（TEU）
            bays = int(length // 6.1)
            out.append(
                {
                    "id": bid,
                    "group": g,
                    "u": round(uc, 1),
                    "v0": v0,
                    "v1": v0 + length,
                    "bays": bays,
                    "capTeu": bays * BLOCK_ROWS * BLOCK_TIERS,
                    "reefer": bid in REEFER_BLOCKS,
                    "rmg": ["S"] if bid in SINGLE_RMG_BLOCKS else ["S", "L"],
                }
            )
    return out


def layout():
    """页面用的平面布局（src/views/smart-port/data/layout.json）"""
    q0, q1 = QUAY
    berth_len = (q1 - q0) / BERTHS
    berths = [
        {
            "id": f"B{i + 1:02d}",
            "u0": round(q0 + i * berth_len, 1),
            "u1": round(q0 + (i + 1) * berth_len, 1),
            "grade": "7 万吨级" if f"B{i + 1:02d}" in BIG_BERTHS else "5 万吨级",
        }
        for i in range(BERTHS)
    ]
    # 岸桥驻车位：沿岸线均布（仿真按作业计划再把它们移到船位上）
    qc_pitch = (q1 - q0) / CRANES
    cranes = [{"id": f"QC{i + 1:02d}", "home": round(q0 + (i + 0.5) * qc_pitch, 1)} for i in range(CRANES)]
    lanes = BANDS["lanes"]
    lane_v = [round(lanes[0] + (lanes[1] - lanes[0]) * (i + 0.5) / AGV_LANES, 1) for i in range(AGV_LANES)]
    return {
        "note": "由 scripts/smart-port/layout.py 生成，不要手改。u 沿岸线（方位 106°，往东南为正），v 垂直岸线向陆地，米",
        "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1], "uBearing": U_BEARING},
        "quay": {"u0": q0, "u1": q1},
        "workboatQuay": {"u0": WORKBOAT_QUAY[0], "u1": WORKBOAT_QUAY[1], "v": WORKBOAT_QUAY[2]},
        "bands": BANDS,
        "qcRail": {"sea": QC_RAIL[0], "land": QC_RAIL[1], "minGap": QC_MIN_GAP},
        "agvLanes": lane_v,
        "berths": berths,
        "cranes": cranes,
        "blocks": blocks_layout(),
        "agvs": AGVS,
        # 换电站：BS-1 在 AGV 带东端（影像上的长条构筑物），BS-2 在西端（假设）；每站 16 个充电位
        "swapStations": [
            {"id": "BS-1", "u0": 2330.0, "u1": 2400.0, "v0": 95.0, "v1": 125.0, "slots": 16},
            {"id": "BS-2", "u0": -60.0, "u1": 0.0, "v0": 95.0, "v1": 125.0, "slots": 16},
        ],
        "special": [{"id": "DG-01", "u0": -25.0, "u1": 95.0, "v0": 160.0, "v1": 400.0}],
        "landmarks": [
            {"id": "CC-01", "u": 850.0, "v": 560.0, "r": 15.0},
            {"id": "MET-01", "u": 830.0, "v": 545.0},
            {"id": "GATE-E", "u": 2588.0, "v": 500.0},
            {"id": "GATE-W", "u": 100.0, "v": 600.0},
        ],
    }


def check(items):
    """编号唯一；各类数量与公开数据一致"""
    ids = [d["id"] for d in items]
    assert len(ids) == len(set(ids)), "编号重复"
    count = lambda k: sum(d["kind"] == k for d in items)  # noqa: E731
    assert count("sts") == 28 and count("armg") == 121 and count("agv") == 145, "设备数量与振华完工数不符"
    assert count("block") == 61 and count("berth") == 7, "箱区 / 泊位数量不符"


if __name__ == "__main__":
    items = devices()
    check(items)
    (DOCS / "devices.json").write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n")
    lay = layout()
    assert sum(len(b["rmg"]) for b in lay["blocks"]) == 121
    out = ROOT / "src" / "views" / "smart-port" / "data" / "layout.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(lay, ensure_ascii=False, indent=1) + "\n")
    cap = sum(b["capTeu"] for b in lay["blocks"])
    print(f"layout.json：{len(lay['blocks'])} 个箱区，堆场容量约 {cap} TEU，最后一个箱区 u = {lay['blocks'][-1]['u']}")
    kinds = {}
    for d in items:
        kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
    print(f"devices.json：{len(items)} 个对象", kinds)
