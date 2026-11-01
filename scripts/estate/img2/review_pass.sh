#!/bin/bash
# 还原评审一个 pass 的机器闸门部分：换角度截图 → 一级诊断（记进规格）→ 多角度 → 轮廓内部差异
# 用法：scripts/estate/img2/review_pass.sh <pass id> <主图名（renders 下，不带 .png）> [lab 额外 query，如 "mat=gen"]
# 需要环境变量 IMG2_SKILL；截图要在沙盒外跑。AI 视觉评分和 append_review 由人 / agent 看图后手动做。
set -e
cd "$(dirname "$0")/../../.."
PASS=$1; NAME=$2; QX=${3:-"mat=flat"}
R=.img2threejs/renders; S=.img2threejs/object-sculpt-spec.json
for a in 35 -35; do node scripts/estate/img2/capture_lab.mjs "$R/$NAME-az$a.png" --q "$QX&az=$a" | tail -n 1; done
node scripts/estate/img2/capture_lab.mjs "$R/$NAME-long.png" --q "$QX&az=90" | tail -n 1
node scripts/estate/img2/capture_lab.mjs "$R/$NAME-top.png" --q "$QX&cam=top" | tail -n 1
python3 -c "
from PIL import Image
a = Image.open('$R/$NAME-long.png').resize((768, 432)); b = Image.open('$R/$NAME-top.png').resize((768, 432))
s = Image.new('RGB', (1544, 432), (245, 242, 235)); s.paste(a, (0, 0)); s.paste(b, (776, 0)); s.save('$R/axial-$NAME.png')"
python3 "$IMG2_SKILL/forge/stage4_review/diagnose_render.py" --reference docs/design/estate/design/src/scene-a1.png --render "$R/$NAME.png" \
  --map-stripped-render "$R/$NAME.png" --spec $S --pass-id "$PASS" --in-place --json | python3 -c "
import json,sys
raw=sys.stdin.read(); d=json.loads(raw[raw.find('{'):]); print('一级诊断 passed:', d['passed'], d['failures'])"
python3 "$IMG2_SKILL/forge/stage4_review/diagnose_render_multi_angle.py" --reference "$R/$NAME.png" --orbit "$R/$NAME-az35.png" --orbit "$R/$NAME-az-35.png" --json > "$R/multi-angle-$NAME.json"
python3 -c "import json; print('多角度 degenerate:', json.load(open('$R/multi-angle-$NAME.json'))['degenerate'])"
python3 "$IMG2_SKILL/forge/stage4_review/interior_difference.py" docs/design/estate/design/src/scene-a1.png "$R/$NAME.png" --grid 24 --json > "$R/interior-$NAME.json"
python3 -c "import json; d=json.load(open('$R/interior-$NAME.json')); print('轮廓内部差异', round(d['interiorDifference'], 3), '格数', d['cellsCompared'])"
