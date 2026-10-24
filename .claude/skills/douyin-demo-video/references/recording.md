# 逐帧录屏

## 为什么要逐帧

无头 Chrome 渲染这些三维页面很慢（/hospital 开着 GTAO 实时只有约 11 fps），直接录屏会卡、会掉帧。
`scripts/vclock.js` 在页面任何脚本运行前接管 `performance.now` / `requestAnimationFrame` / `setTimeout` / `setInterval` / `Date`。
开录后时间是冻结的，`rec.mjs` 每次把虚拟时间推进 1/30 秒，跑到点的定时器和这一帧的帧回调，渲染完截一张图。
所以每帧渲染再慢，成片也是均匀的 30 帧；页面里按 `Date.now()` 走的仿真、计时、镜头缓动、gsap 也都按虚拟时间走。

CSS 动画 / 过渡按真实时间播放，逐帧录制时会一闪而过，所以 `rec.mjs` 默认把它们全关了。
需要的动效（闪光、弹一下、高亮框）用 `REC.flash` / `REC.pulse` / `REC.highlight` / `REC.tween` 逐帧重做。

## 前提

- **开发服务器**：`preview_start`（`.claude/launch.json` 的 `bi-demo`，http，端口自动分配，以结果里的地址为准），或用户自己的 `yarn dev`（https://localhost:8892，`rec.mjs` 忽略自签名证书）。
- **在沙箱外跑**：Claude 的沙箱里 Chrome 起不来（建不了进程锁目录）。用终端面板跑：先用 ToolSearch 加载 `mcp__terminal__run_in_terminal`，在仓库根目录执行命令，再用 `mcp__terminal__read_terminal` 看输出。
- Chrome（`CHROME_PATH` 可改）、ffmpeg（Homebrew 的 `/opt/homebrew/bin/ffmpeg`，`FFMPEG` 可改）、Python 的 Pillow。
- 耗时：轻的页面一帧不到 0.3 秒，重的（GTAO、阴影、大地形）1–3 秒；30 秒成片 900 帧，录完要 5–30 分钟。先只录开头那段看效果，再录全部。

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs http://localhost:8893 hook
```

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs http://localhost:8893 all
```

## 分镜文件 shots.mjs（模板 `templates/shots.mjs`）

```js
export const CONFIG = {
  ready: "!!window.__ranchScene && !document.querySelector('.loading')", // 页面就绪条件
  epoch: "2026-07-25T13:58:00+08:00", // 虚拟时钟起算时刻：各段分开录也在同一条时间轴上
  helpers: ["helpers.js"] // 这个 demo 专用的页面工具（相对本文件）
}
export const SHOTS = [
  { name: "hook", url: "/#/smart-ranch?tour=0", setup: async () => {...}, preroll: () => {...}, play: async () => {...} }
]
```

| 字段 | 什么时候跑 | 约定 |
|---|---|---|
| `url` | | 拼在 devServerUrl 后面，带上让页面状态确定的参数（`?tour=0` 停自动巡游，`?at=` 固定仿真时刻，`?focus=` / `?room=` 指定对象） |
| `setup(arg)` | 页面就绪后、真实时间里跑一次 | 摆好初始状态：停巡游、藏面板、镜头就位、关掉会打断镜头的插播。跑完等 `setupWait`（默认 1500）毫秒 |
| `preroll()` | 切到逐帧模式后、开录前反复调 | 返回 `null` = 再快进 0.1 秒（不截图）；返回数字 = 再快进这么多毫秒就开录。用来等仿真走到某个事件前 0.3 秒（新叫号、告警），开头那段正好拍到效果发生 |
| `play()` | 开录，每推进 1/30 秒截一张 | 返回 Promise，结束即这段结束，**play 的时长 = 片段时长**，按 video.json 里这段的 `plan` 来排（`REC.sleep` / `REC.tween` 都是虚拟时间） |

注意：

- setup / preroll / play 会被转成源码注入页面执行，**只能用页面里的全局**（`REC`、`window.__xxxScene`、`document`），引用不到 shots.mjs 里的常量。要拼 Node 这边的值，就把函数写成字符串：``preroll: `() => REC.prerollAfter(${HOOK_ID}, 8.5)` ``。
- 写成箭头函数（`setup: async () => {}`），不要写成方法简写（`setup() {}` 转出来不是合法表达式）。
- 每段分镜都是重新打开页面录的，上一段的状态不会带过来；setup 要自己把状态摆好。
- 片段写到 `clips/NN-<name>.mp4`（NN 是在 SHOTS 里的序号），`build.py` 按名字找。

## 页面录屏接口

先用现成的：screen-demo 的页面在开发模式下都把三维场景挂在 `window.__<demo>Scene` 上（CLAUDE.md 里每个页面都写了），URL 参数也多半能固定状态。读页面的 `index.vue` 和 `scene/*.js`，弄清楚怎么：

- 停自动巡游 / 轮播，按分镜指定镜头（场景一般有 `view` / `goal` / `focus(...)` 这类方法）；
- 让仿真立刻推进、找到下一个事件的时刻（模拟器一般是固定种子，可以在 Node 里跑一遍查事件时刻）；
- 打开某个面板 / 切某个 tab。

不够用时，在页面里加一个**只在开发模式存在**的录屏接口（`if (import.meta.env.DEV) window.__<demo>Page = { ... }`），只暴露分镜需要的几个方法（候诊叫号加过 `__waitingPage.blockCalls()`、模拟器的 `nextAt()`）。不改生产行为；改了页面源码要在交付时告诉用户。

这个 demo 专用的镜头、面板工具写在 douyin 目录的 `helpers.js` 里（模板 `templates/helpers.js`），用 `Object.assign(window.REC, {...})` 加到 REC 上。

## 通用页面工具（`scripts/rec-helpers.js`，注入后是 `window.REC`）

| 方法 | 用途 |
|---|---|
| `sleep(ms)` `tween(ms, fn(e, k))` `everyFrame(ms, fn)` `ease` `lerp` | 虚拟时间里等待、缓动、每帧做一件事（每帧推进仿真） |
| `clickEl(el或选择器)` `clickAt(x, y)` `hoverEl` `move(x, y)` `ripple()` | 假光标移过去点一下（DOM 元素用 clickEl，三维画布里的物体用 clickAt，或直接调场景方法、光标只做样子） |
| `typeInto(input, text, ms)` | 搜索框里逐字打字 |
| `highlight(el, {hold})` | 给面板上的某块套强调色高亮框（口播说到哪块就框哪块） |
| `pulse(el)` `flash(el)` | 弹一下、闪两下（替代页面原本的 CSS 动画） |
| `overlay(html, {background, fade})` `fadeOut(el)` | 整屏 2D 覆盖层：痛点镜头里仿制的"普通做法"（仿 LED 叫号屏、纸质地图）、对比卡片 |
| `hide(...选择器)` `show(...)` | 藏面板做全屏三维（开头、封面底图） |
| `accent` | 光标波纹、高亮框颜色，setup 里按页面强调色改 |

## 剪成"一镜到底"

各段分开录，剪到一起时希望右上角的时钟、仿真状态是连续的：

1. `CONFIG.epoch` 固定虚拟时钟起点（每段打开页面时都是这个时刻）。
2. 仿真固定种子（screen-demo 的模拟器都是），同一时刻状态相同。
3. 以开头那段拍到的事件为锚点，后面每段 preroll 快进到"锚点 + 这段在成片里的起点"再开录（候诊叫号的 `REC.prerollAfter(id, offset)`：等编号为 id 的叫号出现，快进到它之后 offset 秒前 0.3 秒）。

## 2D 画面

- 痛点镜头的"普通做法"：用 `REC.overlay` 在页面上盖一整屏 HTML（候诊叫号的仿 LED 黑底红字叫号屏，`docs/design/waiting/douyin/helpers.js` 的 `ledShow`）。
- 设计稿、卫星图、CAD、规划图：放进 `stills/`，在 video.json 里写成 `still` 段，`build.py` 做缓入缓出的推镜。
- 画面里的说明大字（"老板给的""我交的"）属于画面，可以有；**字幕不进画面**（字幕单独 .srt）。

## 封面底图

封面要 2 倍清晰的全屏三维图：shots.mjs 里加一段封面专用分镜（全屏三维、藏掉小标签、停在招牌效果最完整的那一刻），用 `--still` 渲染：

```bash
node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs http://localhost:8893 cover --still docs/design/<demo>/douyin/stills/hero.png --dpr 2
```

三步缩略图从录好的片段里截：`python3 .claude/skills/douyin-demo-video/scripts/build.py docs/design/<demo>/douyin --grab <分镜名> <秒> docs/design/<demo>/douyin/stills/<名>.png`。

## 坑

- **GPU 截图卡死**：/smart-mine 工业广场俯角大于约 42° 时 `Page.captureScreenshot` 在 GPU 路径上卡住。换软件渲染：`CHROME_FLAGS="--use-angle=swiftshader"`，并加长 `settle`。
- **加载遮罩**：GLB、贴图加载完之前别开始，`CONFIG.ready` 里写上"遮罩不存在"。
- **切后台停渲染**：有的页面在 `document.hidden` 时停渲染（/smart-ranch）。无头 Chrome 的页面是可见的，一般没事；画面不动时先查这个。
- **页面自己的 rem 适配**：录制窗口固定 1920×1080，正好是设计尺寸。
- **没接管的**：Web Worker 里的计时、`<video>` 播放、WebAudio 不走虚拟时钟；视频画面要提前暂停或换成静帧。
- **单段最长 60 秒**（`CONFIG.maxSeconds`），防止 play 卡住时无限录下去；快进最多 600 秒虚拟时间。
- **重录**：只重录有问题的那几段（命令后面跟分镜名），然后重跑 `build.py`。
