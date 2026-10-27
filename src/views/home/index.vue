<!--
  演示中心首页
  ----------------------------------------------------------
  两种视图，顶栏按钮切换：
    - wall      作品墙（浅色）：行业筛选 + 搜索 + 4 列卡片网格，最新上线占大格，可纵向滚动浏览全部
    - spotlight 聚焦（深色）：当前演示铺满全屏 + 右侧可滚动目录，8 秒自动轮播（大屏无人值守）
  视图取值优先级：地址参数 ?view= > 上次选择（localStorage）> 默认作品墙。切换时同步写回地址，便于分享与截图。
  演示列表全部来自 ./data/demos.js，新增演示不用改本页面。
-->
<template>
  <div class="home-page" :class="{ 'is-dark': view === 'spotlight' }">
    <HomeHead v-model:view="view" class="home-head-bar" />
    <Transition name="view" mode="out-in">
      <WallView v-if="view === 'wall'" :demos="DEMOS" @enter="enterDemo" />
      <SpotlightView v-else :demos="DEMOS" @enter="enterDemo" />
    </Transition>
  </div>
</template>

<script setup>
  import HomeHead from "./components/HomeHead.vue"
  import WallView from "./components/WallView.vue"
  import SpotlightView from "./components/SpotlightView.vue"
  import { DEMOS } from "./data/demos"

  /**
   * 视图取值与本地记忆的键名。
   * 2026-10-27 默认视图从聚焦改成作品墙，键名随之换成 v2：以前记住的"聚焦"失效一次，
   * 所有人重新从作品墙开始；之后再切换照样记住
   */
  const VIEWS = ["wall", "spotlight"]
  const STORE_KEY = "home:view:v2"

  const route = useRoute()
  const router = useRouter()

  /** 读上次选择（隐私模式等场景下 localStorage 可能不可用） */
  const readStored = () => {
    try {
      return localStorage.getItem(STORE_KEY)
    } catch {
      return null
    }
  }

  const initial = [route.query.view, readStored()].find((v) =>
    VIEWS.includes(v)
  )
  const view = ref(initial || "wall")

  watch(view, (v) => {
    try {
      localStorage.setItem(STORE_KEY, v)
    } catch {
      // 存不了就只在本次会话内生效
    }
    router.replace({ query: { ...route.query, view: v } })
  })

  const enterDemo = (demo) => router.push(demo.path)
</script>

<style lang="scss" scoped>
  .home-page {
    /* 浅色（作品墙）配色：暖白底 + 深灰蓝文字 */
    --bg: #f4f1ea;
    --card: #fffdf8;
    --ink: #1f2d3a;
    --ink-soft: #5b6672;
    --ink-faint: #8b939b;
    --line: #e4ddd0;
    --switch-bg: rgba(255, 255, 255, 0.6);

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--ink);
    font-family:
      "Source Han Sans CN",
      PingFang SC,
      Microsoft YaHei,
      sans-serif;
    transition: background-color 0.4s ease;

    /* 深色（聚焦）配色：顶栏等共用组件只读这些变量 */
    &.is-dark {
      --bg: #050a14;
      --card: #0b1424;
      --ink: #ffffff;
      --ink-soft: rgba(255, 255, 255, 0.7);
      --ink-faint: rgba(255, 255, 255, 0.45);
      --line: rgba(255, 255, 255, 0.16);
      --switch-bg: rgba(9, 16, 30, 0.55);
    }
  }

  /* 顶栏浮在两种视图之上（聚焦视图的背景图要铺到顶栏后面） */
  .home-head-bar {
    position: absolute;
    top: 44px;
    left: 80px;
    right: 80px;
    z-index: 3;
  }

  .view-enter-active,
  .view-leave-active {
    transition: opacity 0.3s ease;
  }

  .view-enter-from,
  .view-leave-to {
    opacity: 0;
  }
</style>
