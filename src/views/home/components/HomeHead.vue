<!--
  首页顶栏：品牌标题 + 时钟
  与各演示页的顶栏相互独立，不复用 SchoolHead.vue / CityHead.vue。
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
