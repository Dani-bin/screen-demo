// <demo 中文名> 抖音视频 · 30 秒版的录屏分镜（口播见 口播-30秒.md，时长按 video.json 的 plan）
// 用法（仓库根目录、沙箱外、开发服务器开着）：
//   node .claude/skills/douyin-demo-video/scripts/rec.mjs docs/design/<demo>/douyin/shots.mjs <devServerUrl> [分镜名… | all]
// setup / preroll / play 会被转成源码注入页面执行，只能用页面里的全局（REC、window.__<demo>Scene、document）；
// 要用这里的常量就把函数写成模板字符串。约定详见 skill 的 references/recording.md

export const CONFIG = {
  // 页面就绪：场景挂上了、加载遮罩没了
  ready: "!!window.__<demo>Scene && !document.querySelector('.loading')",
  // 虚拟时钟起点：各段分开录，时钟和仿真在同一条时间轴上（和页面 ?at= 参数对上）
  epoch: "2026-07-25T13:58:00+08:00",
  // 这个 demo 专用的镜头 / 面板工具
  helpers: ["helpers.js"]
}

const URL = "/#/<demo>?tour=0"

export const SHOTS = [
  {
    // 口播 1「<开头那句>」（0.3–3.3 s）
    // 第 0 帧：<成品画面>；0.3 s：<效果开始>；3 s：<高潮>
    name: "hook",
    url: URL,
    setup: async () => {
      REC.accent = "#FF7A00" // 页面强调色
      REC.hide(".side-left", ".side-right") // 全屏三维：主体在手机上才够大
      // 镜头就位、停掉会打断镜头的自动行为
    },
    // 等效果即将发生前 0.3 秒开录：返回 null 继续快进，返回毫秒数再快进这么多就开录
    preroll: () => {
      return 0
    },
    play: async () => {
      // 触发 / 等待招牌效果，3 秒内演到高潮
      await REC.sleep(3600)
    }
  },
  {
    // 口播 2「<痛点>」（0.3–4.3 s）：整屏盖一块仿制的"普通做法"
    name: "pain",
    url: URL,
    setup: async () => {
      REC.overlay(`<div style="display:grid;place-items:center;height:100%;background:#111;color:#f33;font:400 72px 'Source Han Sans CN'">普通做法</div>`)
    },
    play: async () => {
      await REC.sleep(4600)
    }
  },
  {
    // 封面底图（不进成片）：--still stills/hero.png --dpr 2
    name: "cover",
    url: URL,
    setup: async () => {
      REC.hide(".side-left", ".side-right", ".small-labels")
    },
    play: async () => {
      // 停在招牌效果最完整的那一刻
      await REC.sleep(3000)
    }
  }
]
