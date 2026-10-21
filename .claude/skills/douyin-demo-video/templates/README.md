# 抖音口播视频：<demo 中文名> · 30 秒版（剪映素材）

开头 3 秒直接上<招牌效果>。口播第一句「<开头那句>」<（用户定的）>。

**视频和字幕分开交付**：成片只有画面（不带字幕、配音、配乐），字幕是单独的 `字幕-30秒.srt`。

## 文件

| 文件 | 说明 |
|---|---|
| `<name>-30秒-无字幕.mp4` | 成片画面，1920×1080 / 30 fps，<实际时长> 秒（含末尾定格 1 秒）；分镜硬切拼接，**不带字幕、配音、配乐** |
| `字幕-30秒.srt` | 字幕，<条数> 条，时间轴已按成片对齐，剪映「本地字幕」导入 |
| `口播-30秒.txt` / `口播-30秒.md` | 口播纯文本（每段一行）/ 定稿和分镜表 |
| `发布文案.txt` | 标题（四选一）+ 描述 + 话题标签 |
| `cover-3x4.png` `cover-4x3.png` | 封面：竖版 1080×1440（建议上传）、横版 1440×1080 |
| `clips/` | 分镜片段（想自己加转场、调节奏时用，顺序见下表） |
| `stills/` | 封面底图和缩略图 |
| `shots.mjs` `helpers.js` | 录屏分镜和页面工具 |
| `video.json` `cover.json` | 成片 / 字幕、封面的配置 |
| `hook-sheet.png` `storyboard.png` | 开头 3 秒逐帧检查图、逐段画面与口播对照图 |

## 重新生成

在仓库根目录、开发服务器开着时运行（录屏要在沙箱外）：

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs <devServerUrl> all
python3 .claude/skills/douyin-demo-video/scripts/build.py docs/design/<demo>/douyin
python3 .claude/skills/douyin-demo-video/scripts/make_cover.py docs/design/<demo>/douyin
```

只重录某几段：把 `all` 换成分镜名。改口播：改 `video.json` 的 `text`（再同步 `口播-30秒.md`），重跑 `build.py`。

## 分镜与口播

| 时间 | 分镜 | 画面 | 口播 |
|---|---|---|---|
| 0:00 | 01-hook | | |

## 剪映操作

1. 拖入 `<name>-30秒-无字幕.mp4`（想加转场就改拖 `clips/` 里的片段，顺序见上表）。
2. 「文本」→「本地字幕」导入 `字幕-30秒.srt`；全选字幕 →「文本朗读」生成配音，语速调到 <1.1> 倍左右。
3. 配乐选<风格>，音量 15% 左右；<0:03 招牌效果高潮> 卡一个重拍。
4. 配音和画面个别地方对不齐时，拖动字幕或对应片段即可。
