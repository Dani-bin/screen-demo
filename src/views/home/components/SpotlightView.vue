<!--
  首页 · 聚焦视图（深色）
  ----------------------------------------------------------
  当前演示的预览图放大铺满全屏做背景（缓慢推近），左侧大字介绍与指标，右侧玻璃质感竖向目录。
  目录可滚动、可按行业筛选，演示再多也能浏览；当前项自动滚到可见处。

  自动轮播沿用旧首页的做法：当前项底边进度条的 CSS 动画就是计时器，动画走完即切到下一个；
  鼠标停在介绍区或目录上时只是把动画停住，计时与进度显示始终同源，不另设定时器。
  键盘：↑ ← 上一个，↓ → 下一个，Enter 进入（便于翻页笔 / 遥控器操作）。
-->
<template>
  <section class="spot-view" :style="accentVars">
    <!-- 背景：切换时新旧两张交叉淡入淡出 -->
    <Transition name="bg">
      <div v-if="demo" :key="demo.key" class="spot-bg">
        <PreviewImage :demo="demo" class="spot-bg-img" />
      </div>
    </Transition>
    <div class="spot-shade"></div>

    <!-- 左侧介绍 -->
    <Transition name="intro" mode="out-in">
      <div
        v-if="demo"
        :key="demo.key"
        class="spot-intro"
        @mouseenter="hovering = true"
        @mouseleave="hovering = false"
      >
        <div class="intro-index">
          <b>{{ pad2(current + 1) }}</b> / {{ pad2(list.length) }}
          <i></i>
          <span>{{ demo.category }}</span>
        </div>
        <h2 class="intro-name">{{ demo.name }}</h2>
        <div class="intro-en">{{ demo.en }}</div>
        <div class="intro-sub">{{ demo.subTitle }}</div>
        <p class="intro-desc">{{ demo.desc }}</p>
        <div class="intro-tags">
          <span v-for="t in demo.tags" :key="t">{{ t }}</span>
        </div>
        <div class="intro-stats">
          <div v-for="s in demo.stats" :key="s.key">
            <b>{{ s.value }}</b
            ><small>{{ s.unit }}</small>
            <p>{{ s.key }}</p>
          </div>
        </div>
        <button type="button" class="intro-go" @click="emit('enter', demo)">
          进入演示 <ArrowRight class="go-icon" aria-hidden="true" />
        </button>
      </div>
    </Transition>

    <div class="spot-hint">
      <span><kbd>↑</kbd><kbd>↓</kbd>切换演示</span>
      <span><kbd>Enter</kbd>进入</span>
      <span v-if="autoplay">自动轮播 {{ AUTOPLAY_SECONDS }} 秒 · 悬停暂停</span>
    </div>

    <!-- 右侧目录 -->
    <aside
      class="catalog"
      aria-label="演示目录"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    >
      <div class="catalog-head">
        <h3>
          全部演示<em>{{ pad2(demos.length) }}</em>
        </h3>
        <div class="catalog-tabs">
          <button
            v-for="c in categories"
            :key="c.name"
            type="button"
            :class="{ active: category === c.name }"
            :aria-pressed="category === c.name"
            @click="setCategory(c.name)"
          >
            {{ c.name }} {{ c.count }}
          </button>
        </div>
      </div>

      <div ref="listRef" class="catalog-list">
        <button
          v-for="(d, i) in list"
          :key="d.key"
          :ref="(el) => (rowEls[i] = el)"
          type="button"
          class="row"
          :class="{ active: i === current }"
          :style="{ '--row-accent': d.accent }"
          :aria-current="i === current ? 'true' : null"
          @click="select(i)"
          @dblclick="emit('enter', d)"
        >
          <PreviewImage :demo="d" class="row-thumb" />
          <span class="row-text">
            <span class="row-no">{{ pad2(demos.indexOf(d) + 1) }}</span>
            <span class="row-name">{{ d.name }}</span>
            <span class="row-sub">
              <i class="row-dot"></i>{{ d.category }} · {{ d.subTitle }}
            </span>
          </span>
          <!-- 轮播计时：进度条动画走完即切到下一个；以 round 为 key，每次切换从头走 -->
          <span v-if="autoplay && i === current" class="row-progress">
            <i
              :key="round"
              :style="{
                animationDuration: `${AUTOPLAY_SECONDS}s`,
                animationPlayState: hovering ? 'paused' : 'running'
              }"
              @animationend="next"
            ></i>
          </span>
        </button>
      </div>

      <div class="catalog-foot">
        <span>第 {{ current + 1 }} / {{ list.length }} 个</span>
        <div class="foot-nav">
          <button type="button" aria-label="上一个" @click="prev">
            <ChevronUp aria-hidden="true" />
          </button>
          <button type="button" aria-label="下一个" @click="next">
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  </section>
</template>

<script setup>
  import { ArrowRight, ChevronDown, ChevronUp } from "lucide-vue-next"
  import PreviewImage from "./PreviewImage.vue"
  import { ALL, alpha, categoriesOf, filterDemos, pad2 } from "../utils"

  const props = defineProps({
    demos: { type: Array, required: true }
  })

  const emit = defineEmits(["enter"])

  /** 自动轮播间隔（秒），也是当前项进度条走完一次的时长 */
  const AUTOPLAY_SECONDS = 8

  const category = ref(ALL)
  /** 当前演示在筛选后列表里的索引 */
  const current = ref(0)
  /** 切换计数：作为进度条的 key，每次切换让进度条从头再走 */
  const round = ref(0)
  /** 鼠标停在介绍区 / 目录上时暂停轮播 */
  const hovering = ref(false)
  const listRef = ref(null)
  /** 目录各行的元素，用于把当前项滚到可见处 */
  const rowEls = []

  const categories = computed(() => categoriesOf(props.demos))
  const list = computed(() => filterDemos(props.demos, category.value))
  const demo = computed(() => list.value[current.value])
  /** 只有一个演示时不轮播 */
  const autoplay = computed(() => list.value.length > 1)

  /** 当前演示的主题色及其淡色，作为 CSS 变量下发 */
  const accentVars = computed(() => {
    const c = demo.value?.accent || "#1f7fd6"
    return {
      "--accent": c,
      "--accent-soft": alpha(c, 0.22),
      "--accent-line": alpha(c, 0.5)
    }
  })

  /** 切到指定项，越界时首尾循环 */
  const select = (index) => {
    const n = list.value.length
    if (!n) return
    current.value = ((index % n) + n) % n
    round.value += 1
  }
  const next = () => select(current.value + 1)
  const prev = () => select(current.value - 1)

  const setCategory = (name) => {
    category.value = name
    current.value = 0
    round.value += 1
  }

  /** 把当前项滚到目录可视区中部（只滚目录本身，不用 scrollIntoView，以免带动整页） */
  watch(current, async () => {
    await nextTick()
    const el = listRef.value
    const row = rowEls[current.value]
    if (!el || !row) return
    el.scrollTo({
      top: row.offsetTop - (el.clientHeight - row.offsetHeight) / 2,
      behavior: "smooth"
    })
  })

  /** 键盘：↑ ← 上一个，↓ → 下一个，Enter 进入当前演示 */
  const onKeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault()
      next()
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault()
      prev()
    } else if (e.key === "Enter") {
      // 焦点在按钮上时，回车会触发按钮自己的点击，这里不再重复处理
      if (e.target.closest && e.target.closest("button, a, input")) return
      if (demo.value) emit("enter", demo.value)
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown))
  onUnmounted(() => window.removeEventListener("keydown", onKeydown))
</script>

<style lang="scss" scoped>
  .spot-view {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: #fff;
  }

  /* ---------------- 背景 */
  .spot-bg {
    position: absolute;
    inset: 0;
  }

  /* 预览图是各演示整屏截图：放大到中部的三维场景，避开原大屏的标题栏与两侧面板；
     再缓慢推近，画面不至于静止 */
  .spot-bg-img {
    width: 100%;
    height: 100%;
    font-size: 40px;
    transform-origin: 50% 46%;
    animation: bg-push 16s ease-out forwards;
  }

  @keyframes bg-push {
    from {
      transform: scale(1.6) translate(2%, 3%);
    }
    to {
      transform: scale(1.72) translate(2%, 3%);
    }
  }

  /* 压暗：左侧最深（文字区），中部透出场景，右侧略深（目录），上下再收一道 */
  .spot-shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
        90deg,
        rgba(5, 10, 20, 0.96) 0%,
        rgba(5, 10, 20, 0.86) 30%,
        rgba(5, 10, 20, 0.35) 58%,
        rgba(5, 10, 20, 0.55) 72%,
        rgba(5, 10, 20, 0.85) 100%
      ),
      linear-gradient(0deg, rgba(5, 10, 20, 0.9) 0%, rgba(5, 10, 20, 0) 30%),
      linear-gradient(180deg, rgba(5, 10, 20, 0.92) 0%, rgba(5, 10, 20, 0) 22%);
  }

  .bg-enter-active,
  .bg-leave-active {
    transition: opacity 0.9s ease;
  }

  .bg-enter-from,
  .bg-leave-to {
    opacity: 0;
  }

  /* ---------------- 左侧介绍 */
  .spot-intro {
    position: absolute;
    left: 96px;
    top: 230px;
    width: 780px;
  }

  .intro-enter-active {
    transition:
      opacity 0.45s ease,
      transform 0.45s ease;
  }

  .intro-leave-active {
    transition:
      opacity 0.25s ease,
      transform 0.25s ease;
  }

  .intro-enter-from {
    opacity: 0;
    transform: translateY(18px);
  }

  .intro-leave-to {
    opacity: 0;
    transform: translateY(-10px);
  }

  .intro-index {
    display: flex;
    align-items: center;
    gap: 16px;
    font-family: "DIN";
    font-size: 22px;
    color: rgba(255, 255, 255, 0.55);

    b {
      font-weight: normal;
      color: var(--accent);
    }

    i {
      width: 64px;
      height: 2px;
      background: var(--accent);
    }

    span {
      margin-left: 8px;
      padding: 4px 14px;
      border-radius: 14px;
      font-family: "Source Han Sans CN";
      font-size: 15px;
      color: #fff;
      background: var(--accent);
    }
  }

  .intro-name {
    margin: 26px 0 0;
    font-family: "Alimama ShuHeiTi";
    font-weight: normal;
    font-size: 92px;
    line-height: 1.1;
    letter-spacing: 4px;
    text-shadow: 0 6px 30px rgba(0, 0, 0, 0.6);
  }

  .intro-en {
    margin-top: 14px;
    font-family: "DIN";
    font-size: 18px;
    letter-spacing: 10px;
    color: var(--accent);
    filter: brightness(1.5);
  }

  .intro-sub {
    margin-top: 26px;
    font-size: 24px;
    color: rgba(255, 255, 255, 0.92);
  }

  .intro-desc {
    width: 640px;
    margin: 16px 0 0;
    font-size: 18px;
    line-height: 1.8;
    color: rgba(255, 255, 255, 0.72);
  }

  .intro-tags {
    margin-top: 22px;
    display: flex;
    gap: 12px;

    span {
      padding: 6px 16px;
      border-radius: 16px;
      font-size: 15px;
      color: rgba(255, 255, 255, 0.88);
      border: 1px solid var(--accent-line);
      background: var(--accent-soft);
    }
  }

  .intro-stats {
    margin-top: 40px;
    display: flex;
    gap: 56px;

    b {
      font-family: "DIN";
      font-weight: normal;
      font-size: 52px;
    }

    small {
      margin-left: 4px;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.6);
    }

    p {
      margin: 2px 0 0;
      font-size: 15px;
      color: rgba(255, 255, 255, 0.55);
    }
  }

  .intro-go {
    margin-top: 44px;
    height: 60px;
    padding: 0 34px;
    border: 0;
    border-radius: 30px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-size: 19px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    box-shadow: 0 10px 30px var(--accent-line);
    cursor: pointer;
    transition:
      transform 0.2s ease,
      filter 0.2s ease;

    &:hover {
      transform: translateY(-2px);
      filter: brightness(1.12);
    }

    &:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 3px;
    }
  }

  .go-icon {
    width: 20px;
    height: 20px;
  }

  .spot-hint {
    position: absolute;
    left: 96px;
    bottom: 54px;
    display: flex;
    align-items: center;
    gap: 24px;
    font-size: 15px;
    color: rgba(255, 255, 255, 0.5);

    kbd {
      margin-right: 6px;
      padding: 3px 9px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      font-family: "DIN";
      font-size: 13px;
      color: rgba(255, 255, 255, 0.8);
    }
  }

  /* ---------------- 右侧目录 */
  .catalog {
    position: absolute;
    right: 80px;
    top: 128px;
    bottom: 54px;
    width: 500px;
    border-radius: 22px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(9, 16, 30, 0.72);
    backdrop-filter: blur(18px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .catalog-head {
    flex: none;
    padding: 24px 26px 16px;

    h3 {
      margin: 0;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 2px;
    }

    em {
      margin-left: 8px;
      font-style: normal;
      font-family: "DIN";
      color: var(--accent);
      filter: brightness(1.5);
    }
  }

  .catalog-tabs {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    button {
      padding: 5px 13px;
      border: 0;
      border-radius: 14px;
      font-size: 14px;
      white-space: nowrap;
      color: rgba(255, 255, 255, 0.65);
      background: rgba(255, 255, 255, 0.06);
      cursor: pointer;
      transition:
        background-color 0.2s ease,
        color 0.2s ease;

      &:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.12);
      }

      &.active {
        color: #0b1424;
        font-weight: 600;
        background: #fff;
      }
    }
  }

  .catalog-list {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 14px 24px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.25) transparent;

    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.25);
    }
  }

  .row {
    position: relative;
    width: 100%;
    margin-bottom: 6px;
    padding: 12px;
    border: 0;
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 16px;
    text-align: left;
    color: #fff;
    background: transparent;
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    &:focus-visible {
      outline: 2px solid var(--row-accent);
      outline-offset: -2px;
    }

    /* 当前项：主题色底 + 描边 + 左侧竖条 */
    &.active {
      background: var(--accent-soft);
      box-shadow: inset 0 0 0 1px var(--accent-line);

      &::before {
        content: "";
        position: absolute;
        left: 0;
        top: 18px;
        bottom: 18px;
        width: 4px;
        border-radius: 2px;
        background: var(--accent);
      }
    }
  }

  .row-thumb {
    flex: none;
    width: 150px;
    height: 84px;
    border-radius: 10px;
    font-size: 13px;
  }

  .row-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .row-no {
    font-family: "DIN";
    font-size: 14px;
    color: rgba(255, 255, 255, 0.4);
  }

  .row-name {
    margin-top: 2px;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: 1px;
  }

  .row-sub {
    margin-top: 4px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--row-accent);
  }

  .row-progress {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 6px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;

    i {
      display: block;
      height: 100%;
      border-radius: 2px;
      background: var(--accent);
      filter: brightness(1.4);
      transform-origin: left center;
      animation-name: progress;
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }
  }

  /* 用 scaleX 走进度（只动 transform，不触发重排） */
  @keyframes progress {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }

  .catalog-foot {
    flex: none;
    padding: 14px 26px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.55);
  }

  .foot-nav {
    display: flex;
    gap: 10px;

    button {
      width: 44px;
      height: 44px;
      padding: 0;
      border-radius: 22px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      display: grid;
      place-items: center;
      color: #fff;
      background: transparent;
      cursor: pointer;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
      }
    }

    svg {
      width: 18px;
      height: 18px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spot-bg-img {
      animation: none;
      transform: scale(1.6) translate(2%, 3%);
    }
  }
</style>
