<!--
  首页 · 作品墙视图（浅色）
  ----------------------------------------------------------
  顶部两行：上行「标题 + 数量 + 搜索」，下行行业筛选（宽度不够时整颗 chip 折到下一行，chip 和标题自身不折行）；
  下方 4 列卡片网格，区域内纵向滚动，演示再多也能全部浏览。
  未筛选、未搜索时，最新上线的演示（DEMOS 末项）占 2×2 大格，展示简介、指标与进入按钮；
  筛选或搜索后改为统一的小卡片，按原顺序排列。
  下方还有卡片没露出来时，底部渐隐并提示「向下滚动查看更多 · 还有 N 个」。
-->
<template>
  <section class="wall-view">
    <div class="wall-tools">
      <div class="wall-head">
        <div class="wall-title">
          <h2>全部演示</h2>
          <em>{{ pad2(list.length) }}</em>
          <p>点击卡片进入演示</p>
        </div>
        <label class="search">
          <Search class="search-icon" aria-hidden="true" />
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索演示"
            aria-label="搜索演示"
          />
          <button
            v-if="keyword"
            type="button"
            class="search-clear"
            aria-label="清空搜索"
            @click="keyword = ''"
          >
            <X aria-hidden="true" />
          </button>
        </label>
      </div>
      <div class="wall-filters" role="group" aria-label="按行业筛选">
        <button
          v-for="c in categories"
          :key="c.name"
          type="button"
          class="chip"
          :class="{ active: category === c.name }"
          :aria-pressed="category === c.name"
          @click="category = c.name"
        >
          {{ c.name }}<i>{{ c.count }}</i>
        </button>
      </div>
    </div>

    <div class="wall-body">
      <div ref="scrollerRef" class="wall-scroller" @scroll="updateMore">
        <div v-if="list.length" class="wall-grid">
          <button
            v-for="(d, i) in list"
            :key="d.key"
            type="button"
            class="card"
            :class="{ feature: featured && i === 0 }"
            :style="{
              '--card-accent': d.accent,
              '--card-accent-soft': alpha(d.accent, 0.4)
            }"
            @click="emit('enter', d)"
          >
            <div class="card-shot">
              <PreviewImage :demo="d" class="card-img" />
              <template v-if="featured && i === 0">
                <span class="card-badges">
                  <span class="badge-new">最新上线</span>
                  <span class="badge-cat">{{ d.category }}</span>
                </span>
              </template>
              <template v-else>
                <span class="card-no">{{ pad2(numberOf(d)) }}</span>
                <span class="card-cat">{{ d.category }}</span>
                <span class="card-enter">
                  <b>进入演示 <ArrowRight class="enter-icon" /></b>
                </span>
              </template>
            </div>

            <!-- 大格：名称 / 简介在左，指标与按钮在右 -->
            <div v-if="featured && i === 0" class="feature-info">
              <div class="feature-text">
                <h3>{{ d.name }}</h3>
                <div class="feature-en">{{ d.en }}</div>
                <p class="feature-desc">{{ d.desc }}</p>
              </div>
              <div class="feature-side">
                <div class="feature-stats">
                  <div v-for="s in d.stats" :key="s.key">
                    <b>{{ s.value }}</b
                    ><small>{{ s.unit }}</small>
                    <p>{{ s.key }}</p>
                  </div>
                </div>
                <span class="feature-go">
                  进入演示 <ArrowRight class="enter-icon" />
                </span>
              </div>
            </div>
            <div v-else class="card-info">
              <h3>{{ d.name }}</h3>
              <div class="card-sub">{{ d.subTitle }}</div>
              <div class="card-tags">
                <span v-for="t in d.tags.slice(0, 2)" :key="t">{{ t }}</span>
              </div>
            </div>
          </button>
        </div>

        <div v-else class="wall-empty">
          <p>没有匹配的演示</p>
          <button type="button" @click="resetFilter">清除筛选</button>
        </div>
      </div>

      <!-- 下方还有卡片时：底部渐隐 + 提示，点击提示向下翻一屏 -->
      <Transition name="more">
        <div v-if="hidden > 0" class="wall-more">
          <div class="more-fade"></div>
          <button type="button" class="more-tip" @click="pageDown">
            <ChevronDown class="more-icon" aria-hidden="true" />
            向下滚动查看更多 · 还有 {{ hidden }} 个
          </button>
        </div>
      </Transition>
    </div>
  </section>
</template>

<script setup>
  import { ArrowRight, ChevronDown, Search, X } from "lucide-vue-next"
  import PreviewImage from "./PreviewImage.vue"
  import { ALL, alpha, categoriesOf, filterDemos, pad2 } from "../utils"

  const props = defineProps({
    demos: { type: Array, required: true }
  })

  const emit = defineEmits(["enter"])

  const category = ref(ALL)
  const keyword = ref("")
  const scrollerRef = ref(null)
  /** 还没完整露出的卡片数（用于底部提示） */
  const hidden = ref(0)

  const categories = computed(() => categoriesOf(props.demos))

  /** 未筛选、未搜索时才有 2×2 大格 */
  const featured = computed(
    () => category.value === ALL && !keyword.value.trim()
  )

  /** 网格里的演示：有大格时把最新上线（末项）提到最前，其余保持原顺序 */
  const list = computed(() => {
    const items = filterDemos(props.demos, category.value, keyword.value)
    if (!featured.value || items.length < 2) return items
    return [items[items.length - 1], ...items.slice(0, -1)]
  })

  /** 卡片编号固定取演示在 DEMOS 里的序号，筛选后不变 */
  const numberOf = (d) => props.demos.indexOf(d) + 1

  const resetFilter = () => {
    category.value = ALL
    keyword.value = ""
  }

  /** 统计底边超出可视区的卡片数（容差 24px，卡片只露出投影时不算） */
  const updateMore = () => {
    const el = scrollerRef.value
    if (!el) return
    const bottom = el.scrollTop + el.clientHeight + 24
    let n = 0
    for (const card of el.querySelectorAll(".card")) {
      if (card.offsetTop + card.offsetHeight > bottom) n++
    }
    hidden.value = n
  }

  /** 向下翻约一屏（留一行重叠，翻页后仍能看到上一屏的末行） */
  const pageDown = () => {
    const el = scrollerRef.value
    if (el) el.scrollBy({ top: el.clientHeight * 0.8, behavior: "smooth" })
  }

  // 筛选变化后回到顶部并重新统计；窗口尺寸变化（rem 缩放）同样要重算
  watch(list, async () => {
    await nextTick()
    if (scrollerRef.value) scrollerRef.value.scrollTop = 0
    updateMore()
  })

  let resizeObserver = null
  onMounted(() => {
    updateMore()
    resizeObserver = new ResizeObserver(updateMore)
    resizeObserver.observe(scrollerRef.value)
  })

  onUnmounted(() => {
    resizeObserver?.disconnect()
  })
</script>

<style lang="scss" scoped>
  .wall-view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 118px 80px 0;
  }

  /* ---------------- 工具区（两行）
     页面按窗口宽度等比缩放，但浏览器有最小字号（中文常见 12px）：窗口窄时文字不再跟着缩，
     原来挤在一行的标题 + 9 个 chip + 搜索就会被压得竖排。所以标题、chip 一律不折行，
     行业筛选单独占一整行，放不下时整颗 chip 折到下一行 */
  .wall-tools {
    flex: none;
    margin-bottom: 22px;
  }

  .wall-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  .wall-title {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 16px;
    white-space: nowrap;

    h2 {
      margin: 0;
      font-family: "Alimama ShuHeiTi";
      font-weight: normal;
      font-size: 40px;
      letter-spacing: 2px;
    }

    em {
      font-style: normal;
      font-family: "DIN";
      font-size: 40px;
      color: #1f7fd6;
    }

    p {
      margin: 0;
      font-size: 16px;
      color: var(--ink-soft);
    }
  }

  .wall-filters {
    margin-top: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .chip {
    flex: none;
    white-space: nowrap;
    height: 40px;
    padding: 0 20px;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--card);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    color: var(--ink-soft);
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease;

    i {
      font-style: normal;
      font-family: "DIN";
      font-size: 14px;
      color: var(--ink-faint);
    }

    &:hover {
      border-color: var(--ink-faint);
      color: var(--ink);
    }

    &.active {
      background: var(--ink);
      border-color: var(--ink);
      color: #fff;

      i {
        color: rgba(255, 255, 255, 0.6);
      }
    }

    &:focus-visible {
      outline: 2px solid #1f7fd6;
      outline-offset: 2px;
    }
  }

  /* 搜索框在标题行右侧：空间够时 280px，窗口很窄时可以缩 */
  .search {
    flex: 0 1 280px;
    min-width: 160px;
    height: 40px;
    padding: 0 12px 0 16px;
    border-radius: 20px;
    border: 1px solid var(--line);
    background: var(--card);
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-faint);

    &:focus-within {
      border-color: #1f7fd6;
    }

    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: 15px;
      color: var(--ink);

      &::placeholder {
        color: var(--ink-faint);
      }

      /* 去掉浏览器自带的清空按钮，统一用右侧的 X */
      &::-webkit-search-cancel-button {
        display: none;
      }
    }
  }

  .search-icon {
    flex: none;
    width: 18px;
    height: 18px;
  }

  .search-clear {
    flex: none;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--ink-faint);
    cursor: pointer;

    svg {
      width: 16px;
      height: 16px;
    }

    &:hover {
      color: var(--ink);
    }
  }

  /* ---------------- 网格 */
  .wall-body {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .wall-scroller {
    position: relative;
    height: 100%;
    overflow-y: auto;
    /* 卡片悬停上浮与投影需要的余量；底部多留一行提示的位置 */
    margin: 0 -16px;
    padding: 8px 16px 110px;
    scrollbar-width: thin;
    scrollbar-color: #c9bfae transparent;

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 3px;
      background: #c9bfae;
    }
  }

  /* 行高至少 352px（设计稿尺寸，内容刚好放下）；窄窗口下文字被浏览器最小字号托住、相对卡片变大时，
     整行跟着长高，卡片里的文字不会被 overflow: hidden 裁掉 */
  .wall-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-auto-rows: minmax(352px, auto);
    gap: 22px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
    background: var(--card);
    color: var(--ink);
    text-align: left;
    font: inherit;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(31, 45, 58, 0.05);
    transition:
      transform 0.25s ease,
      box-shadow 0.25s ease,
      border-color 0.25s ease;

    /* 底边主题色条 */
    &::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 4px;
      background: var(--card-accent);
    }

    &:hover,
    &:focus-visible {
      transform: translateY(-6px);
      border-color: var(--card-accent);
      box-shadow: 0 18px 40px rgba(31, 45, 58, 0.16);
      outline: none;
    }

    &:hover .card-enter,
    &:focus-visible .card-enter {
      opacity: 1;
    }

    &:hover .card-img,
    &:focus-visible .card-img {
      transform: scale(1.04);
    }
  }

  .card-shot {
    position: relative;
    flex: none;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
  }

  .card-img {
    width: 100%;
    height: 100%;
    font-size: 18px;
    transition: transform 0.5s ease;
  }

  .card-no {
    position: absolute;
    left: 14px;
    top: 12px;
    padding: 3px 10px;
    border-radius: 12px;
    font-family: "DIN";
    font-size: 14px;
    color: #fff;
    background: rgba(15, 23, 33, 0.55);
  }

  .card-cat {
    position: absolute;
    right: 14px;
    top: 12px;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 13px;
    color: #fff;
    background: var(--card-accent);
  }

  /* 悬停时盖在截图上的「进入演示」 */
  .card-enter {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 33, 0.35);
    opacity: 0;
    transition: opacity 0.25s ease;

    b {
      height: 48px;
      padding: 0 26px;
      border-radius: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 17px;
      color: var(--ink);
      background: #fff;
    }
  }

  .enter-icon {
    width: 18px;
    height: 18px;
  }

  .card-info {
    /* 底部留出主题色条（4px）的位置；设计宽度下内容到 343px，加上 8px 正好不超过 352px 行高 */
    padding: 14px 18px 8px;

    /* 名称只占一行，放不下时省略（完整名称仍在按钮的可访问名称里） */
    h3 {
      margin: 0;
      font-size: 21px;
      font-weight: 600;
      letter-spacing: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .card-sub {
    margin-top: 4px;
    font-size: 14px;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 标签放不下时整颗折到下一行，单个标签不折行 */
  .card-tags {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    span {
      white-space: nowrap;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 12px;
      color: var(--card-accent);
      border: 1px solid var(--card-accent-soft);
    }
  }

  /* ---------------- 2×2 大格 */
  .card.feature {
    grid-column: span 2;
    grid-row: span 2;
  }

  .card-badges {
    position: absolute;
    left: 18px;
    top: 16px;
    display: flex;
    gap: 8px;

    span {
      padding: 5px 14px;
      border-radius: 14px;
      font-size: 14px;
      color: #fff;
    }
  }

  .badge-new {
    background: var(--ink);
  }

  .badge-cat {
    background: var(--card-accent);
  }

  /* 文字在左、指标与按钮在右；右侧放不下时（窄窗口下最小字号把指标撑宽）整块换到文字下方 */
  .feature-info {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px 24px;
    padding: 18px 26px 20px;
  }

  .feature-text {
    flex: 1 1 360px;
    min-width: 0;
  }

  /* 名称长时折成两行并把字数均分（text-wrap: balance），避免第二行只剩一个字 */
  .feature-text h3 {
    margin: 0;
    font-family: "Alimama ShuHeiTi";
    font-weight: normal;
    font-size: 36px;
    letter-spacing: 2px;
    text-wrap: balance;
  }

  .feature-en {
    margin-top: 6px;
    font-family: "DIN";
    font-size: 12px;
    letter-spacing: 6px;
    color: var(--card-accent);
  }

  .feature-desc {
    max-width: 470px;
    margin: 10px 0 0;
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .feature-side {
    flex: none;
  }

  .feature-stats {
    display: flex;
    gap: 28px;
    margin-top: 4px;

    b {
      font-family: "DIN";
      font-size: 30px;
      font-weight: normal;
    }

    small {
      margin-left: 3px;
      font-size: 13px;
      color: var(--ink-faint);
    }

    p {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--ink-faint);
    }
  }

  .feature-go {
    margin-top: 16px;
    height: 50px;
    padding: 0 28px;
    border-radius: 25px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    color: #fff;
    background: var(--ink);
    transition: background-color 0.25s ease;
  }

  .card.feature:hover .feature-go {
    background: var(--card-accent);
  }

  /* ---------------- 空结果 */
  .wall-empty {
    height: 60%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--ink-faint);
    font-size: 18px;

    p {
      margin: 0;
    }

    button {
      height: 40px;
      padding: 0 22px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: var(--card);
      font-size: 15px;
      color: var(--ink);
      cursor: pointer;
    }
  }

  /* ---------------- 底部「还有更多」 */
  .wall-more {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 170px;
    pointer-events: none;
  }

  .more-fade {
    position: absolute;
    inset: 0;
    background: linear-gradient(rgba(244, 241, 234, 0), var(--bg) 78%);
  }

  .more-tip {
    position: absolute;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    padding: 10px 22px;
    border-radius: 22px;
    border: 1px solid var(--line);
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    color: var(--ink-soft);
    background: var(--card);
    box-shadow: 0 6px 18px rgba(31, 45, 58, 0.08);
    cursor: pointer;
    pointer-events: auto;
    white-space: nowrap;
  }

  .more-icon {
    width: 18px;
    height: 18px;
  }

  .more-enter-active,
  .more-leave-active {
    transition: opacity 0.25s ease;
  }

  .more-enter-from,
  .more-leave-to {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .card-img {
      transition: none;
    }
  }
</style>
