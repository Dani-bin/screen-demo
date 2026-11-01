#!/usr/bin/env python3
"""
把 ez-tree 轻量变体（tree_lab 的 exportLite，由 tree_lab_eval.mjs 导出到 .img2threejs/trees/export_lite.json）
打成页面用的树模型包：
  public/estate/img2/trees_ez.json      每个变体的树皮 / 叶片几何（Float32 / Uint16 的 base64）+ 尺寸统计
  public/estate/img2/trees/<名字>.png    叶片和树皮的贴图（叶片 128 px 带透明，树皮 64 px）
ez-tree 是 MIT 协议；它的包自带约 15 MB 贴图，所以只在离线造树页里用，页面只加载这里打好的小包。
用法：python3 scripts/estate/img2/pack_trees.py
"""
import base64
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SRC = os.path.join(ROOT, ".img2threejs", "trees", "export_lite.json")
OUT = os.path.join(ROOT, "public", "estate", "img2")


def main():
    d = json.load(open(SRC))
    os.makedirs(os.path.join(OUT, "trees"), exist_ok=True)
    tex_files = {}
    for k, url in d["textures"].items():
        if not url:
            continue
        data = base64.b64decode(url.split(",", 1)[1])
        path = os.path.join(OUT, "trees", f"{k}.png")
        open(path, "wb").write(data)
        tex_files[k] = f"trees/{k}.png"
        print(f"贴图 {k}: {len(data) / 1e3:.0f} KB")
    pack = {"textures": tex_files, "trees": d["trees"]}
    path = os.path.join(OUT, "trees_ez.json")
    json.dump(pack, open(path, "w"), separators=(",", ":"))
    print(f"几何包 {os.path.getsize(path) / 1e3:.0f} KB，变体 {len(d['trees'])} 个")
    for t in d["trees"]:
        s = t["stats"]
        print(f"  {t['name']:8s} {t['kind']:8s} 高 {s['height']:.1f} 冠径 {s['crownRadius']:.1f} 冠底 {s['crownBottom']:.1f}  面 {s['barkTris'] + s['leafTris']}")


if __name__ == "__main__":
    main()
