<!-- 顶栏：左系统名、居中标题牌、右班次 / 天气 / 安全天数 / 时钟（只有一个页面，不放页签；用户 2026-10-28 要求去掉） -->
<template>
  <header class="top">
    <!-- 左：系统名 + 矿名（图标是一台皮带机：头尾滚筒 + 承载带 + 煤堆） -->
    <div class="brand">
      <svg class="logo" viewBox="0 0 44 44">
        <rect
          x="1.5"
          y="1.5"
          width="41"
          height="41"
          rx="6"
          fill="none"
          stroke="currentColor"
          stroke-opacity="0.45"
        />
        <path
          d="M9 29L35 21"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
        />
        <circle cx="9" cy="29" r="3.6" fill="currentColor" />
        <circle cx="35" cy="21" r="3.6" fill="currentColor" />
        <path
          d="M16 25.6l4-5.2 5 3.6 3-4.4 2 2.4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </svg>
      <div>
        <h2>地面输送系统</h2>
        <p>{{ s.mine }} · QINGFENG MINE · 虚构演示数据</p>
      </div>
    </div>

    <!-- 中：标题牌（梯形，底边一道橙色光线；两侧箭头表示煤流方向） -->
    <div class="title-plate">
      <i class="flow l"><b></b><b></b><b></b></i>
      <div class="tp-body">
        <h1>带式输送机安全孪生</h1>
        <p>BELT CONVEYOR SAFETY &amp; PHM TWIN</p>
      </div>
      <i class="flow r"><b></b><b></b><b></b></i>
    </div>

    <div class="meta">
      <div class="m">
        <span>{{ s.shift.name }}</span>
        <small>{{ s.running ? "生产" : "检修" }} · {{ s.shift.range }}</small>
      </div>
      <div class="m">
        <span>{{ s.weather.temp }} <u>℃</u></span>
        <small
          >{{ s.weather.wind }} {{ fmt(s.weather.windSpeed, 1) }} m/s</small
        >
      </div>
      <div class="m">
        <span>{{ fmt(s.safeDays) }} <u>天</u></span>
        <small>安全生产</small>
      </div>
      <div class="clock">
        <b>{{ s.time.hms.slice(0, 5) }}</b>
        <small
          >{{ s.time.date.replaceAll("-", "/") }} 周{{ s.time.week }}</small
        >
      </div>
    </div>
  </header>
</template>

<script setup>
  import { fmt } from "./fmt.js"

  defineProps({ s: { type: Object, required: true } })
</script>
