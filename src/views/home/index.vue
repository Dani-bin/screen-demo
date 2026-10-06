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
