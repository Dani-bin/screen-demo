# 封面

两张：**竖版 3:4（1080×1440，抖音推荐上传这张）** 和 **横版 4:3（1440×1080）**，`scripts/make_cover.py` 按 `cover.json` 合成。

## 版式（这一系列固定的）

参考 `docs/design/hospital/douyin/cover-3x4.png`（平面风格）和 `docs/design/waiting/douyin/cover-3x4.png`（糖果风格）：

1. 左上**品牌色标签**（demo 名，4 个字左右）+ 一行小字说明（"门诊医技综合楼 · 3D 导航"）。
2. **三维大图**：全屏三维、停在招牌效果最完整那一刻的 2 倍图，四边羽化、上下（横版还有左边）淡进底色。
3. **两行大标题**：通常就是开头口播（压缩成两行、每行 ≤ 7–8 字），一个关键词用强调色（`[方括号]` 标出）。
4. 一行**副标题**：第二个卖点，≤ 22 字。
5. 底部**三步缩略图**："输入 → 过程 → 结果"或"普通做法 → 看点 → 招牌效果"，最后一步强调色。
6. 一张歪贴的**道具卡片**：这个场景里用户手上会拿的东西（检查申请单、排队小票、派车单、巡检工单、耳标卡……），用弧形箭头指进大图里的招牌效果。卡片上的号码和大图里的对得上（排队小票 A113 → 正在叫号的 214）。

配色取页面自己的：底色取大图上沿的颜色（默认 `auto` 自动取），墨色、品牌色、强调色取页面的 SCSS 变量。
页面是描边插画风（/waiting 那种）用 `"style": "candy"`，其余用 `"flat"`。

## cover.json（模板 `templates/cover.json`）

| 字段 | 说明 |
|---|---|
| `style` | `flat` / `candy` |
| `palette` | `bg`（默认 `auto`）、`ink` 标题字、`sub` 小字、`brand` 标签和卡片抬头、`onBrand` 标签上的字、`accent` 强调色、`card` 卡片底色 |
| `badge` `kicker` | 左上标签、旁边小字 |
| `title` | 两行，`[...]` 里用强调色，太长自动缩字号 |
| `subtitle` | 副标题；横版放不下按逗号自动断成两行，也可以用 `\n` 指定 |
| `hero` | `image`（相对 douyin 目录）、`target`：招牌效果在大图里的像素坐标（排版以它为中心，箭头指它） |
| `heroTags` | 可选：大图里的标签缩小后看不清时，盖一个放大的同款：`{"text", "at": [hero 像素], "color", "arrow": true}`；`arrow: true` 时箭头停在这个标签边上 |
| `steps` | 3 个 `{"image", "crop": [x0, y0, x1, y1], "label"}`，crop 取 4:3（不给就居中裁） |
| `card` | `title`、`org`（抬头右侧小字）、`bubble`（左上气泡）、`fields`（`{"label", "value", "size": "xl"/"lg"/"md", "accent", "note"}`）、`footer`（底部提示）或 `"barcode": true` |
| `layout` | 可选，自动排版不满意时按版式分别调：`{"3x4": {...}, "4x3": {...}}` |

`layout` 里能调的：`heroScale`（大图缩放）、`targetAt`（target 放到封面的哪个点）、`heroX` / `heroY`（直接给大图左上角）、`fade`（竖向淡出 `[[y 比例, alpha], ...]`）、`hfade`（横版左侧淡出 `[起, 止]` 比例）、`titleY` / `titleSize` / `stepsY`、`card`（`at`、`width`、`angle`）、`arrow`（`from` / `to` / `c0` / `c1` 贝塞尔控制点）。

## 做法

1. 底图：shots.mjs 里的封面分镜 `--still --dpr 2` 渲染成 `stills/hero.png`（3840×2160）；在图上量出招牌效果的像素坐标填 `hero.target`。
2. 缩略图：从片段里 `build.py --grab` 截，或者用设计稿、CAD、卫星图（放进 `stills/`）。
3. `python3 .claude/skills/douyin-demo-video/scripts/make_cover.py docs/design/<demo>/douyin`
4. **看两张成图**，常见问题和调法：
   - 标题压在主体上 → 竖版调 `heroScale` / `targetAt` 让主体上移，横版加大 `hfade` 或把 `targetAt` 往右；
   - 箭头没指准、穿过重要画面 → 改 `hero.target`，或给 `arrow.c0` / `c1`；
   - 卡片挡住主体 → 改 `card.at` / `angle`；
   - 大图里的小标签看不清 → 加 `heroTags`。
5. 缩到手机上看（宽约 400 像素）：标题两行一眼能读完、招牌效果认得出。
