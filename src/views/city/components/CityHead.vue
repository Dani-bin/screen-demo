<!-- 城市大屏顶部标题栏 -->
<template>
  <header class="city-head">
    <div v-if="info.tag" class="head-tag">{{ info.tag }}</div>
    <h1 class="head-title">
      {{ info.name }}
      <em>{{ info.en }}</em>
    </h1>
    <div class="head-meta">
      <div class="head-clock">
        <b>{{ dateText }}</b> {{ weekText }} {{ clockText }}
      </div>
      <div class="head-sub">
        <i
          class="state-dot"
          :class="{ paused: !playing }"
          aria-hidden="true"
        ></i>
        {{ playing ? "自动巡览中" : "已接管 · 空闲后恢复" }}
        <!-- 天气为静态示意数据，标注"示意"以免被当成实时数据 -->
        <template v-if="info.weather">
          · {{ info.weather }}<small class="weather-note">（示意）</small>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup>
  defineProps({
    info: { type: Object, required: true },
    playing: { type: Boolean, default: true }
  })

  const WEEK = [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六"
  ]
  const dateText = ref("")
  const weekText = ref("")
  const clockText = ref("--:--")
  let timer = null

  const pad = (v) => String(v).padStart(2, "0")

  /** 每秒刷新一次时钟 */
  const tick = () => {
    const now = new Date()
    dateText.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    weekText.value = WEEK[now.getDay()]
    clockText.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`
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
  .city-head {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    /* 高度改动时同步 index.vue 的 LABEL_SAFE_TOP（景点标签避让的顶部保留带 = 顶栏高 + 6px） */
    height: 74px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 渐变保持到文字底部再淡出：否则英文副标题与状态行压在楼体纹理上看不清 */
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(255, 255, 255, 0.85) 70%,
      rgba(255, 255, 255, 0) 100%
    );
  }

  .head-tag {
    position: absolute;
    /* 左右内边距与两侧面板、工具栏一致，均为 28px */
    left: 28px;
    top: 22px;
    padding: 5px 12px;
    border-radius: 6px;
    background: var(--city-teal);
    font-size: 12px;
    letter-spacing: 2px;
    color: #fff;
  }

  .head-title {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 5px;
    color: var(--city-ink);
    text-align: center;

    em {
      display: block;
      margin-top: 3px;
      font-style: normal;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 5px;
      color: var(--city-teal);
    }
  }

  .head-meta {
    position: absolute;
    right: 28px;
    top: 20px;
    text-align: right;
    font-size: 13px;
    line-height: 1.7;
    color: var(--city-ink-soft);
  }

  .head-clock b {
    font-weight: 600;
    color: var(--city-ink);
    font-variant-numeric: tabular-nums;
  }

  .head-sub {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .weather-note {
    font-size: 11px;
    opacity: 0.8;
  }

  .state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--city-teal);
    box-shadow: 0 0 0 4px rgba(47, 143, 150, 0.15);

    &.paused {
      background: #b0b8c0;
      box-shadow: 0 0 0 4px rgba(176, 184, 192, 0.2);
    }
  }
</style>
