# 演示中心首页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/home` 演示中心首页（聚焦轮播版），集中展示每个演示的介绍与真实截图预览，点击进入对应演示。

**Architecture:** 页面外壳 `src/views/home/index.vue` 持有当前索引与轮播状态，四个展示组件只收 props、发事件；演示列表是纯数据文件 `data/demos.js`，页面与截图脚本共用。轮播计时由底部当前项进度条的 CSS 动画驱动（`animationend` → 下一个），暂停即停住动画。预览图由 Node 脚本经 Chrome 调试协议截图生成，存为 `public/home/<key>.webp`。

**Tech Stack:** Vue 3 `<script setup>`（`ref` / `computed` / `onMounted` 等自动导入）、vue-router hash 模式、SCSS（px 自动转 rem，设计稿 1920 × 1080）、Node 22 内置 WebSocket + Chrome DevTools Protocol。

**设计文档：** `docs/superpowers/specs/2026-10-06-home-showcase-design.md`

**关于测试：** 项目没有测试框架（见 CLAUDE.md），每个任务以 ESLint + 浏览器实际效果验证，不写单元测试。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/views/home/data/demos.js` | 演示列表（纯数据，无任何 import；Node 截图脚本也直接引用） |
| `src/views/home/utils.js` | 预览图地址拼 `BASE_URL`、主题色转 rgba、序号补零 |
| `src/views/home/components/PreviewImage.vue` | 单张预览图，加载失败显示主题色占位块 |
| `src/views/home/components/HomeHead.vue` | 顶栏：品牌 + 时钟 |
| `src/views/home/components/DemoDetail.vue` | 左栏：当前演示介绍 + 「进入演示」 |
| `src/views/home/components/DemoStage.vue` | 右侧大预览，所有预览图叠放交叉淡入淡出（顺带预加载） |
| `src/views/home/components/DemoRail.vue` | 底部演示列表 + 进度条，发出 `select` / `finish` |
| `src/views/home/index.vue` | 页面外壳：布局、当前索引、轮播、键盘、跳转 |
| `scripts/capture-home-previews.mjs` | 预览图截图脚本 |
| `public/home/school.webp`、`public/home/city.webp` | 预览图（脚本产物） |
| 修改 `src/router/index.js` | 新增 `/home`，根路径重定向改指 `/home` |
| 修改 `src/permission.js` | `PUBLIC_PATHS` 加 `/home` |
| 修改 `CLAUDE.md` | 路由、免登录名单、截图脚本命令 |

---

### Task 1: 演示数据与工具函数

**Files:**
- Create: `src/views/home/data/demos.js`
- Create: `src/views/home/utils.js`

- [ ] **Step 1: 写 `src/views/home/data/demos.js`**

```js
/*
 * 演示中心首页 演示列表
 * ----------------------------------------------------------
 * 首页的全部内容都来自这里。新增演示的步骤：
 *   1. 在 DEMOS 末尾追加一项；
 *   2. 在 src/router/index.js 注册该演示的路由（免登录演示还要加进 permission.js 的 PUBLIC_PATHS）；
 *   3. 启动开发服务器后运行 scripts/capture-home-previews.mjs 生成预览图。
 * 页面与组件都不用改。
 *
 * 本文件不能有任何 import：截图脚本在 Node 里直接引用它。
 * 指标取自各演示自身的数据与设计文档，不写示意值。
 */

/**
 * 字段说明：
 * key       唯一标识，也是预览图文件名（public/home/<key>.webp）
 * path      演示路由
 * name / en 中文名 / 英文名
 * subTitle  副标题：演示对象
 * desc      介绍，控制在两三行
 * tags      特性标签，最多 3 个
 * stats     关键指标，固定 3 个：{ value, unit, key }
 * accent    主题色（十六进制）：序号、标签、进度条与右侧背景色块都用它
 * preview   预览图，相对 public/ 的路径，页面会拼上 BASE_URL
 */
export const DEMOS = [
  {
    key: "school",
    path: "/school",
    name: "智慧校园三维导览",
    en: "SMART CAMPUS 3D",
    subTitle: "成都市实验小学西区分校",
    desc: "程序化建模还原红砖学院风校园，镜头沿南校门、中轴广场、钟楼、罗马议事厅、运动场自动巡览，可随时拖拽接管、点击建筑查看介绍。",
    tags: ["Three.js 实时三维", "程序化建模", "自动巡览"],
    // 依据：schoolData.js 的 LANDMARKS 共 6 站；占地 30 亩见百科；场景 148m × 130m 见校园设计文档
    stats: [
      { value: "6", unit: "站", key: "导览地标" },
      { value: "30", unit: "亩", key: "校园还原" },
      { value: "148×130", unit: "m", key: "场景尺度" }
    ],
    // 取自校园的清水红砖色
    accent: "#a8432e",
    preview: "home/school.webp"
  },
  {
    key: "city",
    path: "/city",
    name: "城市三维总览",
    en: "CITY 3D OVERVIEW",
    subTitle: "锦绣天府 · 安逸四川",
    desc: "基于 OpenStreetMap 真实数据还原成都市中心街区，12 处地标精细建模、到站人流漫步，缤纷插画风自动巡览城市名片。",
    tags: ["OSM 真实街区", "地标精细建模", "人流动画"],
    // 依据：cityData.js 的 SPOTS 共 12 站；建筑数取 public/city/chengdu.json 的 meta.mainCounts.buildings；
    // 范围取 meta.clip 的东西跨度 8835 m、南北跨度 7453 m
    stats: [
      { value: "12", unit: "站", key: "城市地标" },
      { value: "18,750", unit: "栋", key: "真实建筑" },
      { value: "8.8×7.5", unit: "km", key: "街区范围" }
    ],
    // 与城市页界面强调色一致
    accent: "#2f8f96",
    preview: "home/city.webp"
  }
]
```

- [ ] **Step 2: 写 `src/views/home/utils.js`**

```js
/*
 * 首页公共小工具：预览图地址、主题色透明度、序号补零
 */

/**
 * 预览图地址：demos.js 里写相对 public/ 的路径，这里拼上 BASE_URL
 * （生产环境部署在 /bi/ 下）；以 / 或 http(s) 开头的地址原样使用
 */
export const previewUrl = (src) => {
  if (!src) return ""
  if (/^(\/|https?:)/.test(src)) return src
  return `${import.meta.env.BASE_URL}${src}`
}

/**
 * 十六进制主题色转 rgba。
 * 用透明度代替 CSS color-mix()：大屏终端的浏览器内核可能较旧，不一定支持 color-mix
 */
export const alpha = (hex, a) => {
  const v = hex.replace("#", "")
  const n = parseInt(v.length === 3 ? v.replace(/./g, "$&$&") : v, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** 两位补零：1 → "01"，用于序号与时钟 */
export const pad2 = (n) => String(n).padStart(2, "0")
```

- [ ] **Step 3: 校验数据文件可被 Node 直接引用（截图脚本依赖这一点）**

Run: `node -e "import('./src/views/home/data/demos.js').then(m => console.log(m.DEMOS.map(d => d.key + ' ' + d.path).join('\n')))"`
Expected:
```
school /school
city /city
```

- [ ] **Step 4: Lint**

Run: `npx eslint --max-warnings 0 "src/views/home/**/*.{vue,js}"`
Expected: 无输出（通过）

- [ ] **Step 5: Commit**

```bash
git add src/views/home/data/demos.js src/views/home/utils.js
git commit -m "feat(home): 首页演示列表数据与工具函数"
```

---

### Task 2: 预览图组件与顶栏

**Files:**
- Create: `src/views/home/components/PreviewImage.vue`
- Create: `src/views/home/components/HomeHead.vue`

说明：`src/views/home/components` 不在自动注册范围内（只有 `src/components` 会自动注册），使用方必须显式 import。
颜色变量 `--ink` / `--ink-soft` / `--ink-faint` / `--accent` 等由页面外壳 `.home-page` 统一定义（Task 4），组件直接取用。

- [ ] **Step 1: 写 `PreviewImage.vue`**

```vue
<!--
  演示预览图
  图片加载失败（如新演示还没跑截图脚本）时显示主题色淡色占位块与演示名，不露破图。
  占位文字字号继承父元素：大预览与缩略图各自设定。
-->
<template>
  <div
    class="preview-image"
    :style="{ '--ph-bg': alpha(demo.accent, 0.14), '--ph-ink': demo.accent }"
  >
    <img
      v-if="!failed"
      :src="previewUrl(demo.preview)"
      :alt="`${demo.name} 预览图`"
      draggable="false"
      @error="failed = true"
    />
    <span v-else class="preview-placeholder">{{ demo.name }}</span>
  </div>
</template>

<script setup>
  import { previewUrl, alpha } from "../utils"

  defineProps({
    demo: { type: Object, required: true }
  })

  /** 图片是否加载失败 */
  const failed = ref(false)
</script>

<style lang="scss" scoped>
  .preview-image {
    position: relative;
    overflow: hidden;
    background: var(--ph-bg);

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  .preview-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    letter-spacing: 2px;
    color: var(--ph-ink);
  }
</style>
```

- [ ] **Step 2: 写 `HomeHead.vue`**

```vue
<!--
  首页顶栏：品牌标题 + 时钟
  与各演示页的顶栏相互独立，不复用 Head.vue / SchoolHead.vue。
-->
<template>
  <header class="home-head">
    <div class="head-brand">
      <i class="brand-mark"></i>
      <h1 class="brand-name">三维可视化大屏 · 演示中心</h1>
      <span class="brand-en">SHOWCASE</span>
    </div>
    <div class="head-clock">
      <time class="clock-time">{{ time }}</time>
      <span class="clock-date">{{ date }}</span>
    </div>
  </header>
</template>

<script setup>
  import { pad2 } from "../utils"

  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]

  const time = ref("--:--:--")
  const date = ref("")
  let timer = null

  /** 每秒刷新时钟；日期一并刷新，跨零点时不会停在前一天 */
  const tick = () => {
    const now = new Date()
    time.value = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(pad2)
      .join(":")
    date.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
      now.getDate()
    )} 星期${WEEKDAYS[now.getDay()]}`
  }

  onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })
</script>

<style lang="scss" scoped>
  .home-head {
    flex: none;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .head-brand {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* 品牌标记：深色圆角方块里一个转 45° 的空心方框 */
  .brand-mark {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--ink);
    display: grid;
    place-items: center;

    &::after {
      content: "";
      width: 14px;
      height: 14px;
      border: 2.5px solid var(--bg);
      border-radius: 3px;
      transform: rotate(45deg);
    }
  }

  .brand-name {
    margin: 0;
    font-family: "Alimama ShuHeiTi";
    /* 字体文件本身是粗体，不再叠加浏览器的伪粗体 */
    font-weight: normal;
    font-size: 26px;
    letter-spacing: 3px;
    color: var(--ink);
  }

  .brand-en {
    margin-left: 6px;
    font-family: "DIN";
    font-size: 13px;
    letter-spacing: 5px;
    color: var(--ink-faint);
  }

  .head-clock {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }

  .clock-time {
    font-family: "DIN";
    font-size: 26px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  .clock-date {
    font-size: 15px;
    color: var(--ink-soft);
  }
</style>
```

- [ ] **Step 3: Lint**

Run: `npx eslint --max-warnings 0 "src/views/home/**/*.{vue,js}"`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add src/views/home/components/PreviewImage.vue src/views/home/components/HomeHead.vue
git commit -m "feat(home): 预览图组件与首页顶栏"
```

---

### Task 3: 左栏介绍、大预览、底部列表

**Files:**
- Create: `src/views/home/components/DemoDetail.vue`
- Create: `src/views/home/components/DemoStage.vue`
- Create: `src/views/home/components/DemoRail.vue`

- [ ] **Step 1: 写 `DemoDetail.vue`**

```vue
<!--
  左栏：当前演示的介绍
  切换演示时整块淡出、再从下方淡入（Transition 以演示 key 为 key）。
-->
<template>
  <section class="demo-detail">
    <Transition name="swap" mode="out-in">
      <div :key="demo.key" class="detail-body">
        <div class="detail-index">
          {{ pad2(index + 1) }}<small> / {{ pad2(total) }}</small>
        </div>
        <h2 class="detail-name">{{ demo.name }}</h2>
        <div class="detail-en">{{ demo.en }}</div>
        <div class="detail-sub">{{ demo.subTitle }}</div>
        <p class="detail-desc">{{ demo.desc }}</p>
        <ul class="detail-tags">
          <li v-for="tag in demo.tags" :key="tag">{{ tag }}</li>
        </ul>
        <div class="detail-stats">
          <div v-for="stat in demo.stats" :key="stat.key" class="stat">
            <b>{{ stat.value }}<small>{{ stat.unit }}</small></b>
            <span>{{ stat.key }}</span>
          </div>
        </div>
        <button type="button" class="enter-btn" @click="emit('enter')">
          进入演示
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </Transition>
  </section>
</template>

<script setup>
  import { pad2 } from "../utils"

  defineProps({
    demo: { type: Object, required: true },
    /** 当前演示的序号（从 0 起） */
    index: { type: Number, required: true },
    /** 演示总数 */
    total: { type: Number, required: true }
  })

  const emit = defineEmits(["enter"])
</script>

<style lang="scss" scoped>
  .demo-detail {
    flex: none;
    width: 584px;
  }

  /* 序号：主题色数字 + 一段短横线 */
  .detail-index {
    display: flex;
    align-items: center;
    gap: 14px;
    font-family: "DIN";
    font-size: 20px;
    letter-spacing: 2px;
    color: var(--accent);
    transition: color 0.6s ease;

    small {
      font-size: inherit;
      color: var(--ink-faint);
    }

    &::after {
      content: "";
      width: 64px;
      height: 2px;
      background: currentColor;
    }
  }

  .detail-name {
    margin: 26px 0 0;
    font-family: "Alimama ShuHeiTi";
    font-weight: normal;
    font-size: 64px;
    line-height: 1.15;
    letter-spacing: 3px;
    color: var(--ink);
  }

  .detail-en {
    margin-top: 14px;
    font-family: "DIN";
    font-size: 15px;
    letter-spacing: 6px;
    color: var(--accent);
  }

  .detail-sub {
    margin-top: 22px;
    font-size: 20px;
    color: var(--ink);
  }

  .detail-desc {
    margin: 14px 0 0;
    font-size: 18px;
    line-height: 1.8;
    color: var(--ink-soft);
  }

  .detail-tags {
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;

    li {
      padding: 6px 14px;
      border: 1px solid var(--accent-soft);
      border-radius: 999px;
      font-size: 14px;
      color: var(--accent);
    }
  }

  .detail-stats {
    margin-top: 36px;
    display: flex;
    gap: 44px;

    b {
      font-family: "DIN";
      font-weight: normal;
      font-size: 40px;
      color: var(--ink);
    }

    small {
      margin-left: 4px;
      font-size: 15px;
      color: var(--ink-faint);
    }

    span {
      display: block;
      font-size: 15px;
      color: var(--ink-faint);
    }
  }

  .enter-btn {
    margin-top: 40px;
    height: 64px;
    padding: 0 36px;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    border: 0;
    border-radius: 999px;
    background: var(--ink);
    color: #fff;
    font-family: inherit;
    font-size: 20px;
    letter-spacing: 2px;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;

    svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.2s ease;
    }

    &:hover {
      background: var(--accent);

      svg {
        transform: translateX(4px);
      }
    }

    &:active {
      transform: scale(0.97);
    }

    &:focus-visible {
      outline: 3px solid var(--accent-soft);
      outline-offset: 3px;
    }
  }

  /* 切换动效：旧内容快速上移淡出，新内容从下方淡入 */
  .swap-enter-active {
    transition:
      opacity 0.35s ease-out,
      transform 0.35s ease-out;
  }

  .swap-leave-active {
    transition:
      opacity 0.2s ease-in,
      transform 0.2s ease-in;
  }

  .swap-enter-from {
    opacity: 0;
    transform: translateY(16px);
  }

  .swap-leave-to {
    opacity: 0;
    transform: translateY(-8px);
  }

  @media (prefers-reduced-motion: reduce) {
    .swap-enter-from,
    .swap-leave-to {
      transform: none;
    }

    .swap-enter-active,
    .swap-leave-active {
      transition-duration: 0.15s;
    }
  }
</style>
```

- [ ] **Step 2: 写 `DemoStage.vue`**

```vue
<!--
  右侧大预览
  所有演示的预览图叠放在同一块「屏幕」里，只显示当前项，切换时交叉淡入淡出；
  全部图片一开始就挂载，相当于预加载，切换时不闪白。整块屏幕可点击进入演示。
-->
<template>
  <section class="demo-stage">
    <button
      type="button"
      class="stage-screen"
      :aria-label="`进入演示：${demos[current].name}`"
      @click="emit('enter')"
    >
      <PreviewImage
        v-for="(item, i) in demos"
        :key="item.key"
        :demo="item"
        class="stage-shot"
        :class="{ active: i === current }"
      />
      <span class="stage-hint">点击进入全屏演示</span>
    </button>
  </section>
</template>

<script setup>
  import PreviewImage from "./PreviewImage.vue"

  defineProps({
    demos: { type: Array, required: true },
    current: { type: Number, required: true }
  })

  const emit = defineEmits(["enter"])
</script>

<style lang="scss" scoped>
  .demo-stage {
    flex: none;
    width: 1080px;
  }

  /* 模拟一块显示屏：白色外框 + 下方投影 */
  .stage-screen {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 0;
    border-radius: 18px;
    overflow: hidden;
    background: #fff;
    cursor: pointer;
    box-shadow:
      0 0 0 10px #fff,
      0 50px 100px -40px rgba(31, 45, 58, 0.45);
    transition:
      transform 0.3s ease,
      box-shadow 0.3s ease;

    &:hover {
      transform: translateY(-4px);
      box-shadow:
        0 0 0 10px #fff,
        0 60px 110px -40px rgba(31, 45, 58, 0.5);

      .stage-hint {
        opacity: 1;
        transform: none;
      }
    }

    &:focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 14px;
    }
  }

  .stage-shot {
    position: absolute;
    inset: 0;
    opacity: 0;
    /* 占位块里演示名的字号 */
    font-size: 32px;
    transition: opacity 0.6s ease;

    &.active {
      opacity: 1;
    }
  }

  /* 悬停时右下角浮出的进入提示 */
  .stage-hint {
    position: absolute;
    right: 24px;
    bottom: 24px;
    padding: 12px 22px;
    border-radius: 999px;
    background: rgba(31, 45, 58, 0.82);
    color: #fff;
    font-size: 16px;
    letter-spacing: 1px;
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .stage-screen,
    .stage-screen:hover {
      transform: none;
    }

    .stage-shot {
      transition-duration: 0.15s;
    }
  }
</style>
```

- [ ] **Step 3: 写 `DemoRail.vue`**

```vue
<!--
  底部演示列表
  当前项底边的进度条就是轮播计时器：CSS 动画走完一次即发出 finish，由页面切到下一个；
  暂停只是把动画停住（animation-play-state），恢复后从停住处继续。
  进度条以 round 为 key，每次切换都会重新挂载、从头开始走。
-->
<template>
  <nav class="demo-rail" aria-label="演示列表">
    <button
      v-for="(item, i) in demos"
      :key="item.key"
      type="button"
      class="rail-item"
      :class="{ active: i === current }"
      :style="{ '--item-accent': item.accent }"
      :aria-current="i === current ? 'true' : null"
      @click="emit('select', i)"
    >
      <PreviewImage :demo="item" class="rail-thumb" />
      <span class="rail-text">
        <b class="rail-no">{{ pad2(i + 1) }}</b>
        <span class="rail-name">{{ item.name }}</span>
        <span class="rail-sub">{{ item.subTitle }}</span>
      </span>
      <i
        v-if="autoplay && i === current"
        :key="round"
        class="rail-progress"
        :style="{
          animationDuration: `${duration}s`,
          animationPlayState: paused ? 'paused' : 'running'
        }"
        @animationend="emit('finish')"
      ></i>
    </button>
  </nav>
</template>

<script setup>
  import PreviewImage from "./PreviewImage.vue"
  import { pad2 } from "../utils"

  defineProps({
    demos: { type: Array, required: true },
    current: { type: Number, required: true },
    /** 切换计数，用作进度条的 key */
    round: { type: Number, required: true },
    /** 是否轮播：只有一个演示时为 false，不显示进度条 */
    autoplay: { type: Boolean, default: true },
    /** 是否暂停（鼠标悬停在内容区上） */
    paused: { type: Boolean, default: false },
    /** 轮播间隔（秒） */
    duration: { type: Number, required: true }
  })

  const emit = defineEmits(["select", "finish"])
</script>

<style lang="scss" scoped>
  .demo-rail {
    flex: none;
    margin-top: 24px;
    display: flex;
    /* 一行最多放 4 项（380 宽 + 24 间距）。不设 overflow 滚动：会把当前项的投影裁掉；
       演示超过 4 个时再改为横向滚动并给投影留出内边距 */
    gap: 24px;
  }

  .rail-item {
    position: relative;
    flex: none;
    width: 380px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px;
    border: 0;
    border-radius: 16px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.55);
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background-color 0.3s ease,
      box-shadow 0.3s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.85);
    }

    &.active {
      background: #fff;
      box-shadow: 0 16px 40px -20px rgba(31, 45, 58, 0.35);

      .rail-no {
        color: var(--item-accent);
      }
    }

    &:focus-visible {
      outline: 3px solid var(--item-accent);
      outline-offset: 2px;
    }
  }

  .rail-thumb {
    flex: none;
    width: 132px;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    /* 占位块里演示名的字号 */
    font-size: 12px;
  }

  .rail-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rail-no {
    font-family: "DIN";
    font-weight: normal;
    font-size: 14px;
    color: var(--ink-faint);
  }

  .rail-name {
    font-size: 18px;
    color: var(--ink);
  }

  .rail-sub {
    font-size: 14px;
    color: var(--ink-faint);
  }

  /* 进度条：用 scaleX 而不是 width 做动画，只走合成层 */
  .rail-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--item-accent);
    transform-origin: left center;
    animation-name: rail-progress;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes rail-progress {
    from {
      transform: scaleX(0);
    }

    to {
      transform: scaleX(1);
    }
  }
</style>
```

- [ ] **Step 4: Lint**

Run: `npx eslint --max-warnings 0 "src/views/home/**/*.{vue,js}"`
Expected: 通过

- [ ] **Step 5: Commit**

```bash
git add src/views/home/components/DemoDetail.vue src/views/home/components/DemoStage.vue src/views/home/components/DemoRail.vue
git commit -m "feat(home): 首页左栏介绍、大预览与底部演示列表"
```

---

### Task 4: 页面外壳、路由与免登录

**Files:**
- Create: `src/views/home/index.vue`
- Modify: `src/router/index.js`（`path: ""` 那一项及其注释，新增 `/home`）
- Modify: `src/permission.js:22`（`PUBLIC_PATHS`）

- [ ] **Step 1: 写 `src/views/home/index.vue`**

```vue
<!--
  演示中心首页（聚焦轮播）
  ----------------------------------------------------------
  左侧介绍当前演示、右侧大预览、底部演示列表；无人操作时每 AUTOPLAY_SECONDS 秒切到下一个。
  演示列表全部来自 ./data/demos.js，新增演示不用改本页面。

  轮播计时由 DemoRail 当前项进度条的 CSS 动画驱动：动画走完即触发 finish 切到下一个，
  鼠标悬停在内容区上时只是把动画停住，计时与进度显示始终同源，不另设定时器。
-->
<template>
  <div class="home-page" :style="accentVars">
    <!-- 右侧斜切色块：当前演示主题色的淡色，切换时颜色过渡 -->
    <div class="accent-wash"></div>

    <HomeHead />

    <main class="home-main">
      <DemoDetail
        :demo="demo"
        :index="current"
        :total="DEMOS.length"
        @enter="enterDemo"
        @mouseenter="hovering = true"
        @mouseleave="hovering = false"
      />
      <DemoStage
        :demos="DEMOS"
        :current="current"
        @enter="enterDemo"
        @mouseenter="hovering = true"
        @mouseleave="hovering = false"
      />
    </main>

    <DemoRail
      :demos="DEMOS"
      :current="current"
      :round="round"
      :autoplay="autoplay"
      :paused="hovering"
      :duration="AUTOPLAY_SECONDS"
      @select="select"
      @finish="next"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    />
  </div>
</template>

<script setup>
  import HomeHead from "./components/HomeHead.vue"
  import DemoDetail from "./components/DemoDetail.vue"
  import DemoStage from "./components/DemoStage.vue"
  import DemoRail from "./components/DemoRail.vue"
  import { DEMOS } from "./data/demos"
  import { alpha } from "./utils"

  /** 自动轮播间隔（秒），也是底部进度条走完一次的时长 */
  const AUTOPLAY_SECONDS = 8

  const router = useRouter()

  /** 当前演示索引 */
  const current = ref(0)
  /** 切换计数：每次切换 +1，作为进度条的 key，让进度条从头再走 */
  const round = ref(0)
  /** 鼠标停在左栏 / 大预览 / 列表上时暂停轮播 */
  const hovering = ref(false)
  /** 只有一个演示时不轮播 */
  const autoplay = DEMOS.length > 1

  const demo = computed(() => DEMOS[current.value])

  /** 当前演示的主题色及其淡色，作为 CSS 变量下发给各组件 */
  const accentVars = computed(() => ({
    "--accent": demo.value.accent,
    "--accent-soft": alpha(demo.value.accent, 0.35)
  }))

  /** 切到指定演示，越界时首尾循环 */
  const select = (index) => {
    const n = DEMOS.length
    current.value = ((index % n) + n) % n
    round.value += 1
  }

  const next = () => select(current.value + 1)
  const prev = () => select(current.value - 1)

  const enterDemo = () => router.push(demo.value.path)

  /** 键盘：← → 切换，Enter 进入当前演示（便于翻页笔 / 遥控器操作） */
  const onKeydown = (e) => {
    if (e.key === "ArrowRight") {
      next()
    } else if (e.key === "ArrowLeft") {
      prev()
    } else if (e.key === "Enter") {
      // 焦点在按钮上时，回车会触发按钮自己的点击，这里不再重复处理
      if (e.target.closest && e.target.closest("button, a")) return
      enterDemo()
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener("keydown", onKeydown)
  })
</script>

<style lang="scss" scoped>
  .home-page {
    /* 页面配色：暖白底 + 深灰蓝文字，与两个演示的明亮风格一致 */
    --bg: #f4f1ea;
    --ink: #1f2d3a;
    --ink-soft: #5b6672;
    --ink-faint: #8b939b;

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 52px 96px 48px;
    background: var(--bg);
    color: var(--ink);
    font-family:
      "Source Han Sans CN",
      PingFang SC,
      Microsoft YaHei,
      sans-serif;
  }

  /* 主题色铺底再降透明度，效果等同与底色按 12% 混色，又能做颜色过渡 */
  .accent-wash {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1240px;
    background: var(--accent);
    opacity: 0.12;
    clip-path: polygon(14% 0, 100% 0, 100% 100%, 0 100%);
    pointer-events: none;
    transition: background-color 0.6s ease;
  }

  /* 内容层压在色块之上（子组件根元素也带本组件的 scoped 属性，可在这里选中） */
  .home-head,
  .home-main,
  .demo-rail {
    position: relative;
    z-index: 1;
  }

  .home-main {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 64px;
  }
</style>
```

- [ ] **Step 2: 修改 `src/router/index.js`**

把

```js
  {
    // 注意：原默认重定向指向 /typhoon，但当前工作区中 typhoon 系列页面
    // 处于「已删除未提交」状态、对应路由也已移除，直接进根路径会白屏。
    // 因此暂时改指学校页；若恢复 typhoon 页面，把这里改回 "/typhoon" 即可。
    path: "",
    redirect: "/school"
  },
```

替换为

```js
  {
    // 根路径进入演示中心首页（各演示的统一入口）。
    // 原默认重定向指向 /typhoon，该系列页面已不在仓库中。
    path: "",
    redirect: "/home"
  },
  {
    // 演示中心首页：展示各演示的介绍与预览图，点击进入；独立页面，不加载百度地图
    path: "/home",
    name: "Home",
    component: () => import("@/views/home/index.vue")
  },
```

- [ ] **Step 3: 修改 `src/permission.js`**

```js
const PUBLIC_PATHS = ["/school", "/city"]
```

改为

```js
const PUBLIC_PATHS = ["/home", "/school", "/city"]
```

- [ ] **Step 4: Lint（只查本次改动的文件，避免 --fix 改到无关旧文件）**

Run: `npx eslint --max-warnings 0 "src/views/home/**/*.{vue,js}" src/router/index.js src/permission.js`
Expected: 通过

- [ ] **Step 5: 浏览器验证页面可达**

预览服务器（`.claude/launch.json` 的 `bi-demo`）打开 `http://localhost:<port>/#/`：
- 地址应变为 `#/home`，显示首页；此时预览图尚未生成，大预览与缩略图显示主题色占位块与演示名
- 控制台无报错

- [ ] **Step 6: Commit**

```bash
git add src/views/home/index.vue src/router/index.js src/permission.js
git commit -m "feat(home): 演示中心首页外壳，根路径改指首页"
```

---

### Task 5: 预览图截图脚本与预览图

> **执行时修订**：下面 Step 1 的固定等待（`WAIT`）实测不可靠——12 s 时校园已离开首站、面板切到第 2 站而镜头还在飞。
> 两个演示的巡览按帧计时（校园 dt 上限 0.05 s），加载与帧率快慢都会让固定等待漂移。
> 实际脚本改为：轮询页面直到 `.scene-loading` 消失（上限 60 s），再按 `SETTLE`（校园 5 s、城市 6 s，默认 5 s）
> 等到首站停留中段截图。以 `scripts/capture-home-previews.mjs` 为准。

**Files:**
- Create: `scripts/capture-home-previews.mjs`
- Create: `public/home/school.webp`、`public/home/city.webp`（脚本产物）

- [ ] **Step 1: 写 `scripts/capture-home-previews.mjs`**

```js
/*
 * 首页预览图截图脚本
 * ----------------------------------------------------------
 * 用本机 Chrome 无头模式依次打开 src/views/home/data/demos.js 里的每个演示，
 * 等场景构建完、镜头到达首站后截 1920 × 1080 整屏，存为 public/<demo.preview>（webp）。
 * 新增演示或演示画面改版后重跑即可。
 *
 * 用法（先启动开发服务器）：
 *   node scripts/capture-home-previews.mjs [服务器地址] [演示 key…]
 *   - 服务器地址默认 https://localhost:8892（yarn dev 的地址）
 *   - 给出 key 时只重拍这几个，如：node scripts/capture-home-previews.mjs city
 * Chrome 路径默认取 macOS / Windows / Linux 的常见安装位置，可用 CHROME_PATH 环境变量覆盖。
 * 需要 Node 22+：用内置 WebSocket 直连 Chrome 调试协议，不额外安装依赖。
 */
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEMOS } from "../src/views/home/data/demos.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WIDTH = 1920
const HEIGHT = 1080
/** 默认等待秒数：场景构建 + 镜头飞到首站 */
const DEFAULT_WAIT = 12
/** 按演示单独指定等待秒数：城市场景几何数据大，首站还要等人流走起来 */
const WAIT = { city: 20 }
/** webp 质量：首页大预览最大约 1080 宽，82 已足够清晰 */
const QUALITY = 82

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome"
].filter(Boolean)

const isUrl = (s) => /^https?:\/\//.test(s)
const args = process.argv.slice(2)
const base = (args.find(isUrl) || "https://localhost:8892").replace(/\/$/, "")
const keys = args.filter((a) => !isUrl(a))
const targets = keys.length
  ? DEMOS.filter((d) => keys.includes(d.key))
  : DEMOS

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 启动无头 Chrome，返回进程、调试端口与临时用户目录 */
function launchChrome() {
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chromePath) throw new Error("找不到 Chrome，请用 CHROME_PATH 环境变量指定")
  const port = 9300 + Math.floor(Math.random() * 500)
  const profile = mkdtempSync(join(tmpdir(), "home-preview-"))
  const proc = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      "--hide-scrollbars",
      // yarn dev 是自签名 https
      "--ignore-certificate-errors",
      // 无头模式没有 GPU，靠 SwiftShader 软件渲染 WebGL
      "--enable-unsafe-swiftshader",
      "--no-first-run",
      "about:blank"
    ],
    { stdio: "ignore" }
  )
  return { proc, port, profile }
}

/** 连接第一个页面标签的调试协议，返回 send(method, params) 与 close() */
async function connect(port) {
  let page = null
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      page = list.find((t) => t.type === "page") || null
    } catch {
      // Chrome 还没起来，稍后重试
    }
    if (!page) await sleep(200)
  }
  if (!page) throw new Error("连接 Chrome 调试端口超时")

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === "Runtime.exceptionThrown") {
      // 页面脚本异常只提示、不中断：截图仍可能可用，由人判断
      const desc = msg.params.exceptionDetails.exception?.description || ""
      console.warn("  [页面异常]", desc.split("\n")[0])
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { send, close: () => ws.close() }
}

async function main() {
  if (typeof WebSocket === "undefined") {
    throw new Error("需要 Node 22 及以上版本（使用内置 WebSocket）")
  }
  if (!targets.length) {
    throw new Error(`没有匹配的演示 key：${keys.join(", ")}`)
  }

  const { proc, port, profile } = launchChrome()
  try {
    const { send, close } = await connect(port)
    await send("Runtime.enable")
    await send("Page.enable")
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    })

    for (const demo of targets) {
      const url = `${base}/#${demo.path}`
      const wait = WAIT[demo.key] ?? DEFAULT_WAIT
      console.log(`→ ${demo.name}  ${url}  等待 ${wait}s`)
      // 先回空白页，保证每个演示都整页重新加载，而不是在同一页面里切路由
      await send("Page.navigate", { url: "about:blank" })
      const nav = await send("Page.navigate", { url })
      if (nav.errorText) {
        throw new Error(`打不开 ${url}（${nav.errorText}），请确认开发服务器已启动`)
      }
      await sleep(wait * 1000)
      const { data } = await send("Page.captureScreenshot", {
        format: "webp",
        quality: QUALITY
      })
      const out = join(ROOT, "public", demo.preview)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, Buffer.from(data, "base64"))
      console.log(`  已保存 public/${demo.preview}`)
    }
    close()
  } finally {
    proc.kill()
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      // Chrome 退出时可能还在写临时目录，删不掉无妨，系统会清理
    }
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
```

- [ ] **Step 2: 生成预览图**

开发服务器在跑的前提下（本机预览服务器为 http，端口用 `lsof -iTCP -sTCP:LISTEN | grep node` 确认）：

Run: `node scripts/capture-home-previews.mjs http://localhost:8893`
Expected:
```
→ 智慧校园三维导览  http://localhost:8893/#/school  等待 12s
  已保存 public/home/school.webp
→ 城市三维总览  http://localhost:8893/#/city  等待 20s
  已保存 public/home/city.webp
```

- [ ] **Step 3: 人工检查两张图**

用 Read 打开 `public/home/school.webp`、`public/home/city.webp`：画面应为完整的演示大屏（校园南校门、城市天府广场站），非空白、非加载中。
`ls -lh public/home` 单张应在几百 KB 以内。

- [ ] **Step 4: Commit**

```bash
git add scripts/capture-home-previews.mjs public/home/school.webp public/home/city.webp
git commit -m "feat(home): 预览图截图脚本与两张演示预览图"
```

---

### Task 6: 文档

**Files:**
- Modify: `CLAUDE.md`（Commands、Routing、Auth flow 三处）

- [ ] **Step 1: Commands 一节，在 `yarn format` 那一条之后追加**

```markdown
- `node scripts/capture-home-previews.mjs [devServerUrl] [key…]` — regenerates the homepage preview images `public/home/<key>.webp` with headless Chrome (dev server must be running; default URL `https://localhost:8892`; Node 22+; `CHROME_PATH` overrides the Chrome location)
```

- [ ] **Step 2: Routing 一节**

把

```markdown
- **Routing**: `src/router/index.js`, **hash history**. Top-level pages are lazy-loaded views; the registered routes are `/school` and `/city`. Default redirect is `/school` (the former `/typhoon` section and its views are no longer in the repo; see the comment in the router).
```

替换为

```markdown
- **Routing**: `src/router/index.js`, **hash history**. Top-level pages are lazy-loaded views; the registered routes are `/home`, `/school` and `/city`. Default redirect is `/home` (the former `/typhoon` section and its views are no longer in the repo).
  - `/home` is the demo showcase homepage (focus carousel: intro + preview of one demo at a time, auto-rotates every 8 s, ←/→/Enter keys). Its content comes only from `src/views/home/data/demos.js`; to add a demo, append an entry there, register the route (plus `PUBLIC_PATHS` if it needs no login), then run the preview capture script (see Commands).
```

- [ ] **Step 3: Auth flow 一节**

把 `` `PUBLIC_PATHS` whitelist (`/school`, `/city`) `` 改为 `` `PUBLIC_PATHS` whitelist (`/home`, `/school`, `/city`) ``。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(home): CLAUDE.md 补首页路由与预览图截图脚本"
```

---

### Task 7: 整体验证

- [ ] **Step 1: 首页截图对照效果图**

Run: `node <scratchpad>/shot.mjs "http://localhost:8893/#/" home.png 3`（或内置浏览器截图）
Expected: 布局与效果图 C 一致：左栏介绍、右侧大预览（真实截图）、底部两项列表、右侧斜切色块。

- [ ] **Step 2: 轮播与交互**

在内置浏览器中：
1. 等 8 秒以上：左栏、大预览、色块、列表高亮切到下一个演示，进度条从头再走
2. 鼠标移到大预览上：进度条停住；移开后继续
3. 点击列表第 1 项：切到校园
4. 按 → / ←：前后切换；按 Enter（焦点不在按钮上）：进入当前演示
5. 点击「进入演示」与大预览：分别进入 `/school`、`/city`；浏览器后退回到首页
6. `read_console_messages` 无报错

- [ ] **Step 3: Lint 与构建**

Run: `npx eslint --max-warnings 0 "src/views/home/**/*.{vue,js}" src/router/index.js src/permission.js`
Expected: 通过

Run: `yarn build`
Expected: 构建成功；`ls dist/home` 有两张 webp

- [ ] **Step 4: 收尾**

使用 superpowers:finishing-a-development-branch 决定合并方式。
