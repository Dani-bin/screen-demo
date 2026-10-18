<!-- 顶栏：左侧矿区当地日期时间与天气，中间标题，右侧安全生产天数、井下人数、当班 -->
<template>
  <header class="head">
    <div class="meta l">
      <span
        ><b class="num">{{ t.date }}</b> {{ t.week }}</span
      >
      <span
        ><b class="num">{{ t.hm }}</b> {{ zone }}</span
      >
      <span>Somerset · 晴 <b class="num">8</b>℃</span>
    </div>
    <div class="wing l"></div>
    <div class="wing r"></div>
    <div class="title">
      <h1>West Elk 智能矿山综合管控平台</h1>
      <p>美国科罗拉多州 · 北福克河谷 · 井工长壁开采</p>
    </div>
    <div class="meta r">
      <span class="safe"
        >安全生产 <b class="num">{{ fmt(safeDays) }}</b> 天</span
      >
      <span
        >井下 <b class="num">{{ people }}</b> 人</span
      >
      <span>当班 {{ shift }}</span>
    </div>
  </header>
</template>

<script setup>
  import { fmt } from "../utils"

  defineProps({
    /** 矿区当地时间（simulator.localTime） */
    t: { type: Object, required: true },
    safeDays: { type: Number, default: 0 },
    people: { type: Number, default: 0 },
    shift: { type: String, default: "" }
  })
  /** 山地时区的夏令 / 冬令简称 */
  const zone =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      timeZoneName: "short"
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value || "MT"
</script>

<style lang="scss" scoped>
  .head {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    z-index: 5;
    height: 96px;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      rgba(2, 8, 20, 0.92) 0%,
      rgba(2, 8, 20, 0.55) 60%,
      rgba(2, 8, 20, 0) 100%
    );
  }

  .title {
    position: absolute;
    left: 50%;
    top: 10px;
    transform: translateX(-50%);
    text-align: center;
    white-space: nowrap;

    h1 {
      margin: 0;
      font-family: "Alimama ShuHeiTi", sans-serif;
      font-size: 38px;
      font-weight: normal;
      line-height: 46px;
      letter-spacing: 5px;
      color: transparent;
      background: linear-gradient(180deg, #fff 20%, #9fe9ff 100%);
      -webkit-background-clip: text;
      background-clip: text;
      filter: drop-shadow(0 0 14px rgba(54, 224, 255, 0.45));
    }

    p {
      margin: 2px 0 0;
      font-size: 14px;
      letter-spacing: 6px;
      color: var(--sub);
    }
  }

  .wing {
    position: absolute;
    top: 34px;
    width: 230px;
    height: 2px;

    &.l {
      right: calc(50% + 330px);
      background: linear-gradient(
        90deg,
        rgba(54, 224, 255, 0),
        rgba(54, 224, 255, 0.7)
      );
    }

    &.r {
      left: calc(50% + 330px);
      background: linear-gradient(
        270deg,
        rgba(54, 224, 255, 0),
        rgba(54, 224, 255, 0.7)
      );
    }

    &::after {
      content: "";
      position: absolute;
      top: -3px;
      width: 8px;
      height: 8px;
      background: var(--cyan);
      transform: rotate(45deg);
      box-shadow: 0 0 10px var(--cyan);
    }

    &.l::after {
      right: -4px;
    }

    &.r::after {
      left: -4px;
    }
  }

  .meta {
    position: absolute;
    top: 22px;
    display: flex;
    align-items: baseline;
    gap: 22px;
    font-size: 15px;
    color: var(--sub);

    &.l {
      left: 28px;
    }

    &.r {
      right: 28px;
    }

    b {
      margin: 0 2px;
      font-size: 20px;
      font-weight: normal;
      color: var(--text);
    }

    .safe b {
      font-size: 24px;
      color: #3ddc97;
    }
  }
</style>
