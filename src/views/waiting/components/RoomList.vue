<!--
  左栏：诊室一览（8 行）
  每行：房间号色块（科室色）· 科室 + 医生 · 当前状态（就诊中号码 + 时长 / 叫号中）· 平均等候条 · 待诊 / 复诊 / 过诊人数
  叫号中的诊室橙色底，轮播 / 锁定中的诊室紫色底；点一行 = 锁定看这间诊室
-->
<template>
  <section class="rooms">
    <header>
      <span class="pill">诊室一览</span>
    </header>
    <div class="cols">
      <span class="avg">平均等候</span>
      <span class="w">待诊</span>
      <span class="r">复诊</span>
      <span class="m">过诊</span>
    </div>
    <ul>
      <li
        v-for="r in rooms"
        :key="r.no"
        :class="{ called: r.state === 'calling', focus: r.no === focusNo }"
        @click="$emit('pick', r.no)"
      >
        <span class="no" :style="{ background: r.color }">{{ r.no }}</span>
        <div class="who">
          <p>
            <b>{{ r.short }}</b
            ><i>{{ r.doctor }}</i>
          </p>
          <p v-if="r.state === 'calling'" class="cur">
            <em>叫号中</em>{{ r.current.no }} {{ r.current.name }}
          </p>
          <p v-else-if="r.state === 'consulting' && r.current" class="cur">
            <span class="dot"></span>
            <b class="num">{{ r.current.no }}</b>
            <span v-if="r.current.kind === '复诊'" class="tag">复诊</span>
            <b class="num" :class="{ over: now - r.startAt > OVERTIME }">{{
              mmss(now - r.startAt)
            }}</b>
          </p>
          <p v-else class="cur idle">等待叫号</p>
        </div>
        <div class="avg">
          <b>{{ r.avgWait }}<small>分</small></b>
          <span class="bar">
            <i
              :class="{ long: r.avgWait >= 30 }"
              :style="{ width: `${Math.min(100, (r.avgWait / 40) * 100)}%` }"
            ></i>
          </span>
        </div>
        <b class="cnt w" :class="{ zero: !r.waiting.length }">{{
          r.waiting.length
        }}</b>
        <b class="cnt r" :class="{ zero: !r.recheck.length }">{{
          r.recheck.length
        }}</b>
        <b class="cnt m" :class="{ zero: !r.missed.length }">{{
          r.missed.length
        }}</b>
      </li>
    </ul>
    <p class="rule">复诊优先：每叫 2 位待诊，插叫 1 位复诊</p>
  </section>
</template>

<script setup>
  import { mmss, OVERTIME } from "../utils"

  defineProps({
    rooms: { type: Array, required: true },
    now: { type: Number, required: true },
    focusNo: { type: String, default: null }
  })
  defineEmits(["pick"])
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .rooms {
    @include card;
    position: absolute;
    left: 40px;
    top: 372px;
    width: 370px;
    height: 672px;
    padding: 14px 0 0;
  }
  header {
    padding: 0 16px;
    .pill {
      @include pill;
    }
  }
  .cols {
    position: relative;
    height: 22px;
    margin-top: 4px;
    font-size: 12px;
    span {
      position: absolute;
      top: 4px;
      transform: translateX(-100%);
      white-space: nowrap;
    }
    .avg {
      left: 258px;
      color: $faint;
    }
    .w {
      left: 296px;
      color: $wait;
    }
    .r {
      left: 324px;
      color: $recheck;
    }
    .m {
      left: 352px;
      color: $missed;
    }
  }
  ul {
    padding: 0 8px;
  }
  li {
    position: relative;
    height: 70px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: 2px solid transparent;
    border-radius: 12px;
    cursor: pointer;
    & + li::before {
      content: "";
      position: absolute;
      left: 10px;
      right: 10px;
      top: -1px;
      height: 1px;
      background: $track;
    }
    &.called {
      background: $call-tint;
      border-color: $call;
    }
    &.focus {
      background: $brand-sub;
      border-color: $brand;
    }
    &.called::before,
    &.focus::before,
    &.called + li::before,
    &.focus + li::before {
      display: none;
    }
  }
  .no {
    flex: none;
    width: 50px;
    height: 38px;
    display: grid;
    place-items: center;
    border: 1.8px solid $ink;
    border-radius: 10px;
    font-family: $num;
    font-size: 21px;
    color: $ink;
  }
  .who {
    width: 128px;
    margin-left: 10px;
    p {
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    p:first-child {
      b {
        font-weight: normal;
        font-size: 15px;
        color: $ink;
      }
      i {
        font-style: normal;
        font-size: 13px;
        color: $sub;
      }
    }
    .cur {
      margin-top: 4px;
      font-size: 13px;
      color: $ink;
      em {
        font-style: normal;
        color: $call-deep;
        margin-right: 2px;
      }
      &.idle {
        color: $faint;
      }
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: $busy;
    }
    .num {
      font-family: $num;
      font-weight: normal;
      font-size: 14px;
      color: $ink;
      &.over {
        color: $over;
      }
    }
    .tag {
      @include tag($recheck);
      height: 16px;
      font-size: 10px;
    }
  }
  .avg {
    width: 62px;
    margin-left: 2px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    b {
      font-family: $num;
      font-weight: normal;
      font-size: 15px;
      color: $ink;
      small {
        margin-left: 2px;
        font-family: "Source Han Sans CN";
        font-size: 11px;
        color: $sub;
      }
    }
    .bar {
      width: 58px;
      height: 6px;
      margin-top: 4px;
      border-radius: 3px;
      background: $track;
      i {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: $brand;
        &.long {
          background: $over;
        }
      }
    }
  }
  .cnt {
    width: 28px;
    text-align: right;
    font-family: $num;
    font-weight: normal;
    font-size: 22px;
    &.w {
      margin-left: 6px;
      color: $wait;
    }
    &.r {
      color: $recheck;
    }
    &.m {
      color: $missed;
    }
    &.zero {
      color: $faint;
    }
  }
  .rule {
    position: absolute;
    left: 20px;
    bottom: 12px;
    font-size: 12px;
    color: $faint;
  }
</style>
