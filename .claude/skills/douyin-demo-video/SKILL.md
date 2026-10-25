---
name: douyin-demo-video
description: 给 screen-demo 里做完的演示页面（/hospital、/waiting、/smart-ranch、/smart-port 这类三维大屏 demo）出一整套抖音发布素材：口播文案 + 分镜 →【用户确认口播后才录】→ 逐帧录屏拼成不少于 30 秒的无字幕成片 + 单独的 .srt 字幕 → 竖版 / 横版封面 → 标题、描述、话题标签；口播和画面的前 3 秒都按钩子清单检查。用户说"出个抖音视频 / 短视频 / 宣传视频 / 演示视频""写口播 / 口播文案""剪个视频发抖音 / 视频号""做封面、写标题和描述""功能做完了，发个视频"时都用它；只要其中一项（只写口播、只做封面、只改标题、重录某一段）也先读它。
---

# 演示页面 → 抖音视频

把一个做完的演示页面变成一条能直接发的抖音视频：**口播（用户确认）→ 无字幕成片 + .srt 字幕 → 封面 → 标题描述**。
往期成品可以直接参考：`docs/design/hospital/douyin/`（院内导航）、`docs/design/waiting/douyin/`（候诊叫号）、`docs/design/energy/douyin/`、`docs/design/hometown/douyin/`。

**skill 目录**：本文件所在目录 `.claude/skills/douyin-demo-video/`。下文 `scripts/`、`references/`、`templates/` 都相对于它，命令在仓库根目录运行。

## 铁律

1. **口播没经用户确认，不写分镜脚本、不录视频。** 确认后口播一字不改，要动字先问。
2. **视频和字幕分开交付，不要合在一起**：成片只有画面，不压字幕、不配音、不配乐；字幕单独一个 `.srt`（用户剪映里导入、文本朗读配音）。
3. **前 3 秒抓人**：口播第一句说结果（≤ 16 字，3.5 秒内念完）；画面第 0 帧就是成品，0.5 秒内开始变化，3 秒内把招牌效果演到高潮，口播和画面说同一件事。细则 `references/hooks.md`。
4. **成片和字幕都不少于 30 秒**：字幕最后一条 ≥ 30 秒才结束，成片（含末尾定格）≥ 30 秒，`build.py` 每次都检查。30 秒是下限不是目标，不设上限：长短按看点多少定，不为凑时长加水词，也不为压到 30 秒砍看点。画面 1920×1080、30 fps。
5. 页面数据是模拟 / 虚构的，口播和描述里不把它说成真实客户、真实成效；真实的部分（真实地形、卫星影像）如实说。

## 产出（`docs/design/<demo>/douyin/`，被 .gitignore 的 `douyin` 规则忽略，不进仓库）

| 文件 | 内容 |
|---|---|
| `口播.md` / `口播.txt` | 定稿（分镜表 + 纯文本）/ 每段一行的纯文本 |
| `video.json` | 片段顺序、每段计划时长、口播（`build.py` 读它） |
| `shots.mjs` `helpers.js` | 录屏分镜、这个 demo 专用的页面工具 |
| `clips/` | 每段分镜的片段 |
| `<名字>-无字幕.mp4` | 成片（只有画面） |
| `字幕.srt` | 字幕 |
| `hook-sheet.png` `storyboard.png` | 开头 3 秒逐帧检查图、逐段画面和口播对照图 |
| `stills/` `cover.json` `cover-3x4.png` `cover-4x3.png` | 封面素材、配置、成图 |
| `发布文案.txt` | 标题四选一、描述、话题、上传哪张封面 |
| `README.md` | 文件说明、分镜表、重新生成命令、剪映操作 |

文件名不带时长；同一个 demo 出两个版本时用 video.json 的 `label` 区分（`label: "长版"` → `字幕-长版.srt`）。往期目录里的 `-30秒` 文件是旧规则留下的，照旧能用。

已有 douyin 目录时先读它的 README：用户要的是改某一段 / 换开头 / 重做整条，按需要只做那几步。

## 流程

### 1. 摸清这个 demo

- 读 CLAUDE.md 里这个路由的说明、`docs/design/<demo>/README.md`、项目记忆里这个 demo 的那条，以及页面的 `index.vue` 和 `scene/`：页面有哪些看点和交互，开发模式下挂了什么（`window.__<demo>Scene`），有哪些 URL 参数能固定状态（`?tour=0`、`?at=`、`?focus=`）。
- 用 `preview_start`（`bi-demo`）在 in-app 浏览器里打开页面实际看一遍，把能当开头的效果截几张图。

### 2. 定招牌效果，写口播和分镜

- 列 2–3 个招牌效果候选，推荐一个（标准见 `references/hooks.md`）。
- 按 `references/script.md` 写口播（钩子 → 痛点 → "我用 AI 把……做成了 3D" → 看点 → 评论区提问），一句一镜。字幕要念到 30 秒以后，至少约 140 字；看点多就多写几镜，长度不封顶。
- 写 `口播.md`（模板 `templates/口播.md`）和 `video.json`（模板 `templates/video.json`），然后跑时间检查，有"注意"就改到通过（不到 30 秒也是"注意"，补一个看点，不要拖慢语速或拉长空镜）：

```bash
python3 .claude/skills/douyin-demo-video/scripts/build.py docs/design/<demo>/douyin --plan
```

### 3. 【关卡】用户确认口播

发给用户：分镜表（时间 / 画面 / 口播）、口播全文、字数和预计时长、开头画面截图。
再用 AskUserQuestion 出两道选择题：「开头用哪句？」（2–3 个候选，推荐项排第一）和「整体文案？」（确认开始录 / 要改）。
用户要改就改完再问，**直到用户明确确认才往下走**。问法细节见 `references/script.md` 的"确认关卡"。

### 4. 录屏准备

- 写 `shots.mjs`（模板 `templates/shots.mjs`）和 `helpers.js`（模板 `templates/helpers.js`）：每段 play 的时长按 video.json 的 `plan`，开头那段用 preroll 卡在效果发生前 0.3 秒开录。约定、页面接口、通用工具 `REC.*` 见 `references/recording.md`。
- 页面现成接口不够时，加一个只在开发模式存在的录屏接口（`import.meta.env.DEV`），不改生产行为，交付时告诉用户改了哪些页面文件。
- 开发服务器开着；录屏**在沙箱外**跑（终端面板：ToolSearch 加载 `mcp__terminal__run_in_terminal`）。

### 5. 录、拼、检查

先只录开头那段看效果，满意了再录全部：

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs <devServerUrl> hook
```

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs <devServerUrl> all
```

组装成片、字幕和检查图：

```bash
python3 .claude/skills/douyin-demo-video/scripts/build.py docs/design/<demo>/douyin
```

**必看**两张检查图（用 Read 打开）：

- `hook-sheet.png`：按 `references/hooks.md` 末尾的清单逐条对开头 3 秒。
- `storyboard.png`：每段画面和它那句口播是不是同一件事、面板 / 镜头有没有穿帮（加载中、标签错位、空白）。

还要看 `build.py` 打印的时间表：余量为负 = 这句念不完画面就切了，加长那段 play 重录（不改字）；片段实际录得比 plan 短、字幕或成片掉到 30 秒以下，也会报"注意"，同样加长短了的那段重录。有问题只重录那几段，再跑一次 build。

### 6. 封面

按 `references/cover.md`：封面分镜 `--still --dpr 2` 渲染底图、从片段里 `--grab` 截三步缩略图、写 `cover.json`（模板 `templates/cover.json`），然后：

```bash
python3 .claude/skills/douyin-demo-video/scripts/make_cover.py docs/design/<demo>/douyin
```

两张都打开看，标题压主体、箭头没指准就调 `layout` 重出。封面标题和开头口播是同一个钩子。

### 7. 标题、描述、README

按 `references/publish.md` 写 `发布文案.txt`（模板 `templates/发布文案.txt`）和 douyin 目录的 `README.md`（模板 `templates/README.md`，分镜表里的时间用成片实际时间）。

### 8. 交付

- 用 SendUserFile 发：成片 mp4、`.srt`、两张封面、`发布文案.txt`。
- 回复里写：成片时长和字幕结束时间（都 ≥ 30 秒）、开头 3 秒拍了什么、推荐的标题、剪映里怎么导字幕配音（README 里那几步的简版）、改过的页面文件（如有）。
- 更新项目记忆里这个 demo 的那条：视频已出、目录、开头口播，以及用户这次新提的要求。

## 只做其中一项时

| 用户要的 | 做哪几步 |
|---|---|
| 只写口播 | 1–3，停在确认 |
| 口播已确认，出视频 | 4–8 |
| 重录 / 改某一段 | 改 shots.mjs 那段 → 只录那段 → build → 检查图 |
| 换开头那句 | 回到 3（重新确认）→ 重录开头 → build |
| 只做封面 / 只写标题描述 | 6 / 7（素材不够时先 `--still` 渲染底图） |

## 脚本速查

| 脚本 | 用法 |
|---|---|
| `scripts/rec.mjs` | `node rec.mjs <shots.mjs> <devServerUrl> [分镜名… \| all] [--still <png> --dpr 2]`：逐帧录屏 / 渲染单帧，沙箱外运行 |
| `scripts/build.py` | `python3 build.py <douyin目录> [--plan \| --srt-only \| --grab <分镜> <秒> <png>]`：时间检查、拼成片、出字幕和口播文本、检查图、截帧 |
| `scripts/make_cover.py` | `python3 make_cover.py <douyin目录> [--only 3x4\|4x3]`：按 cover.json 出两张封面 |
| `scripts/vclock.js` `scripts/rec-helpers.js` | rec.mjs 注入页面的虚拟时钟和通用页面工具（`window.REC`），不用单独跑 |
