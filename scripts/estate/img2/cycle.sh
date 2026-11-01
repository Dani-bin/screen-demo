#!/bin/bash
# 还原评审一轮：规格 → 严格校验 → 生成工厂 → 截图 → 并排叠图
# 用法：scripts/estate/img2/cycle.sh <pass id> <截图名> [capture_lab 的额外参数…]
# 需要环境变量 IMG2_SKILL（img2threejs 目录）和 IMG2_SKELETON（new_sculpt_spec.py 的骨架 json）；截图一步要在沙盘外跑
set -e
cd "$(dirname "$0")/../../.."
PASS=$1; NAME=$2; shift 2
python3 scripts/estate/img2/build_spec.py --skeleton "$IMG2_SKELETON" --out .img2threejs/object-sculpt-spec.json
python3 "$IMG2_SKILL/forge/stage2_spec/validate_sculpt_spec.py" .img2threejs/object-sculpt-spec.json --strict-quality | head -n 3
python3 "$IMG2_SKILL/forge/stage3_build/generate_threejs_factory.py" .img2threejs/object-sculpt-spec.json --out src/views/estate/scene/img2/createEstateModel.ts --pass-id "$PASS" --force | tail -n 1
node scripts/estate/img2/capture_lab.mjs ".img2threejs/renders/$NAME.png" "$@"
python3 scripts/estate/img2/compare.py ".img2threejs/renders/$NAME.png" ".img2threejs/renders/cmp-$NAME.png"
