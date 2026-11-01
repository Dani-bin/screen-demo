#!/usr/bin/env python3
"""
/estate 还原：为规格里每种材质从参考图裁片提取参考 PBR（albedo / roughness / height / normal / ao）
----------------------------------------------------------
img2threejs 的 material-evidence 步骤：对 build_spec.py 里 CROPS 表的每个材质，从 scene-a1.png 裁出代表性区域，
调 extract_pbr_evidence.py（--spec --in-place）把 referencePbr 写回规格。置信度 < 0.7 的会被脚本拒绝（退出码非 0），
这里把结果逐条打印出来，低置信度的材质需要换裁片重来，不放宽阈值。

用法：python3 scripts/estate/img2/extract_materials.py --skill <img2threejs 目录> [--spec .img2threejs/object-sculpt-spec.json]
"""
import argparse
import importlib.util
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
spec_mod = importlib.util.spec_from_file_location("build_spec", os.path.join(ROOT, "scripts", "estate", "img2", "build_spec.py"))
bs = importlib.util.module_from_spec(spec_mod)
spec_mod.loader.exec_module(bs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", required=True)
    ap.add_argument("--spec", default=os.path.join(ROOT, ".img2threejs", "object-sculpt-spec.json"))
    ap.add_argument("--only", default="", help="只处理这些材质 id，逗号分隔")
    args = ap.parse_args()

    src = Image.open(os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png")).convert("RGB")
    out_root = os.path.join(ROOT, ".img2threejs", "evidence", "mat")
    os.makedirs(out_root, exist_ok=True)
    only = {s for s in args.only.split(",") if s}
    ok = bad = 0
    for mid, box in bs.CROPS.items():
        if only and mid not in only:
            continue
        crop = src.crop(box)
        # 裁片太小时放大到短边 ≥ 256，免得提取算法吃不到统计量
        k = max(1, 256 // max(1, min(crop.size)))
        crop = crop.resize((crop.width * k, crop.height * k), Image.Resampling.LANCZOS)
        cpath = os.path.join(out_root, f"{mid}.png")
        crop.save(cpath)
        odir = os.path.join(out_root, mid)
        r = subprocess.run(
            [sys.executable, os.path.join(args.skill, "forge/stage1_intake/extract_pbr_evidence.py"), cpath,
             "--out-dir", odir, "--material-id", mid, "--size", "1024", "--target-threshold", "0.7",
             # 开发阶段让 dev 服务直接从证据目录取图（生产要压缩成 webp 放进 public，见优化 pass）
             "--url-prefix", f"/.img2threejs/evidence/mat/{mid}/",
             "--spec", args.spec, "--in-place", "--report", os.path.join(odir + "-report.json")],
            capture_output=True, text=True)
        status = "通过" if r.returncode == 0 else f"未通过(exit {r.returncode})"
        conf = ""
        try:
            import json
            conf = json.load(open(os.path.join(odir + "-report.json")))["confidence"]
        except Exception:
            pass
        print(f"{mid:18s} {status:14s} 置信度 {conf}")
        ok += r.returncode == 0
        bad += r.returncode != 0
    print(f"通过 {ok}，未通过 {bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
