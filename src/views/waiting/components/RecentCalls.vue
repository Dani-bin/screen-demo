<!--
  中下左：最近叫号（4 条，最新在左）
  状态写成文字（呼叫中 / 已入室 / 复诊 · 已入室 / 未到 · 过号），不只靠颜色区分
-->
<template>
  <section class="recent">
    <header>
      <span class="pill">最近叫号</span>
      <em>同一号连呼 2 次</em>
    </header>
    <ul>
      <li
        v-for="c in calls"
        :key="c.id"
        :class="{ hot: c.state === 'calling' }"
      >
        <p class="top">
          <span class="t">{{ hm(c.at) }}</span>
          <span class="s" :class="cls(c)">{{ text(c) }}</span>
        </p>
        <p class="who">
          <b>{{ c.no }}</b
          >{{ c.name }}
        </p>
        <p class="where">
          <b>{{ c.room }}</b
          >{{ c.short }}
        </p>
      </li>
    </ul>
  </section>
</template>

<script setup>
  import { hm } from "../utils"

  defineProps({ calls: { type: Array, required: true } })

  const text = (c) => {
    if (c.state === "calling") return "呼叫中"
    if (c.state === "missed") return "未到 · 过号"
    return c.kind === "复诊" ? "复诊 · 已入室" : "已入室"
  }
  const cls = (c) =>
    c.state === "calling"
      ? "calling"
      : c.state === "missed"
        ? "missed"
        : c.kind === "复诊"
          ? "recheck"
          : "entered"
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .recent {
    @include card;
    position: absolute;
    left: 430px;
    top: 882px;
    width: 720px;
    height: 162px;
    padding: 14px 16px 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    .pill {
      @include pill;
    }
    em {
      font-style: normal;
      font-size: 13px;
      color: $faint;
    }
  }
  ul {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }
  li {
    flex: 1;
    min-width: 0;
    height: 90px;
    padding: 8px 12px 0;
    border: 1.8px solid $ink;
    border-radius: 12px;
    background: $soft;
    &.hot {
      background: $call-tint;
    }
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    .t {
      font-family: $num;
      font-size: 15px;
      color: $sub;
    }
    .s {
      font-size: 12px;
      &.calling {
        color: $call-deep;
      }
      &.entered {
        color: $busy;
      }
      &.recheck {
        color: $recheck;
      }
      &.missed {
        color: $missed;
      }
    }
  }
  .who {
    margin-top: 6px;
    font-size: 16px;
    color: $ink;
    white-space: nowrap;
    b {
      margin-right: 5px;
      font-family: $num;
      font-weight: normal;
      font-size: 17px;
    }
  }
  .where {
    margin-top: 4px;
    font-size: 12px;
    color: $sub;
    b {
      margin-right: 5px;
      font-family: $num;
      font-weight: normal;
      font-size: 13px;
    }
  }
</style>
