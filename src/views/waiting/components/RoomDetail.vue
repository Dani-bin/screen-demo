<!--
  右栏：轮播到（或被叫、被锁定）的诊室详情
    轮播进度（8 个点 + 状态文字）→ 诊室牌（科室色）→ 当前就诊 / 叫号中 → 待诊 / 复诊 / 过诊三组名单
  mode：tour 轮播中 · call 叫号插播 · lock 手动锁定 · overview 全景（显示最近叫号的诊室）· free 用户点"看全景"拉回的全景
-->
<template>
  <aside class="detail">
    <div class="progress">
      <span class="lab">诊室轮播</span>
      <span class="dots">
        <i
          v-for="i in total"
          :key="i"
          :class="{ on: i - 1 === index, call: mode === 'call' }"
        ></i>
      </span>
      <span class="state" :class="mode">{{ stateText }}</span>
    </div>

    <section class="sign" :style="{ background: room.color }">
      <b class="no">{{ room.no }}</b>
      <div class="name">
        <h2>{{ room.dept }}</h2>
        <p>{{ room.doctor }} {{ room.title }}</p>
      </div>
      <div class="foot">
        <span>{{ session }}</span>
        <span
          >已诊 <b>{{ room.done }}</b> 人</span
        >
      </div>
    </section>

    <section class="current" :class="{ calling: room.state === 'calling' }">
      <template v-if="room.state === 'calling' && room.current">
        <span class="chip call">叫号中 · 等待入室</span>
        <p class="who">
          <b>{{ room.current.no }}</b
          >{{ room.current.name }}
        </p>
        <p class="meta">
          {{ hms(room.calledAt) }} 第 {{ room.callCount }} 次呼叫
          <span
            >已等 <b class="call">{{ mmss(now - room.calledAt) }}</b></span
          >
        </p>
      </template>
      <template v-else-if="room.state === 'consulting' && room.current">
        <span class="chip busy">当前就诊</span>
        <span v-if="room.current.kind === '复诊'" class="chip recheck"
          >复诊</span
        >
        <p class="who">
          <b>{{ room.current.no }}</b
          >{{ room.current.name }}
        </p>
        <p class="meta">{{ hm(room.startAt) }} 开始</p>
        <div class="timer">
          <span>已就诊</span>
          <b :class="{ over: elapsed > OVERTIME }">{{ mmss(elapsed) }}</b>
        </div>
        <div class="bar">
          <i
            :class="{ over: elapsed > OVERTIME }"
            :style="{ width: `${Math.min(100, (elapsed / OVERTIME) * 100)}%` }"
          ></i>
        </div>
        <span class="bar-note">15 分钟提醒</span>
      </template>
      <p v-else class="idle">等待叫号</p>
    </section>

    <section class="list wait">
      <header>
        <span class="pill">待诊</span><b>{{ room.waiting.length }}</b
        ><small>人</small>
        <em>按签到顺序</em>
      </header>
      <ul class="two">
        <li v-for="p in room.waiting.slice(0, 8)" :key="p.no">
          <b>{{ p.no }}</b
          >{{ p.name }}
        </li>
      </ul>
      <p v-if="room.waiting.length > 8" class="more">
        …… 等 {{ room.waiting.length - 8 }} 人
      </p>
      <p v-if="!room.waiting.length" class="none">暂无</p>
    </section>

    <section class="list recheck">
      <header>
        <span class="pill">复诊</span><b>{{ room.recheck.length }}</b
        ><small>人</small>
        <em>带结果回诊 · 优先插叫</em>
      </header>
      <ul>
        <li v-for="p in room.recheck.slice(0, 3)" :key="p.no">
          <b>{{ p.no }}</b
          >{{ p.name }}<i>{{ hm(p.returnAt) }} 回诊</i>
        </li>
      </ul>
      <p v-if="!room.recheck.length" class="none">暂无</p>
    </section>

    <section class="list missed">
      <header>
        <span class="pill">过诊</span><b>{{ room.missed.length }}</b
        ><small>人</small>
        <em>重签后排第 3 位</em>
      </header>
      <ul>
        <li v-for="p in room.missed.slice(0, 3)" :key="p.no">
          <b>{{ p.no }}</b
          >{{ p.name }}<i>{{ hm(p.missedAt) }} 未到</i>
        </li>
      </ul>
      <p v-if="!room.missed.length" class="none">暂无</p>
    </section>
  </aside>
</template>

<script setup>
  import { hm, hms, mmss, OVERTIME } from "../utils"

  const props = defineProps({
    room: { type: Object, required: true },
    now: { type: Number, required: true },
    session: { type: String, required: true },
    mode: { type: String, default: "tour" },
    index: { type: Number, default: 0 },
    total: { type: Number, default: 8 },
    remain: { type: Number, default: 0 } // 距下次切换的秒数
  })

  const elapsed = computed(() =>
    props.room.startAt ? props.now - props.room.startAt : 0
  )
  const stateText = computed(() => {
    if (props.mode === "call") return "叫号插播"
    if (props.mode === "lock") return "已锁定 · 30 秒无操作恢复"
    if (props.mode === "overview") return "全景 · 最近叫号诊室"
    if (props.mode === "free") return "全景 · 30 秒无操作恢复轮播"
    return `${props.index + 1} / ${props.total} · ${props.remain} 秒后切换`
  })
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .detail {
    position: absolute;
    left: 1510px;
    top: 96px;
    width: 370px;
    height: 948px;
  }
  .progress {
    height: 28px;
    display: flex;
    align-items: center;
    font-size: 14px;
    .lab {
      color: $sub;
    }
    .dots {
      display: flex;
      gap: 6px;
      margin-left: 12px;
      i {
        width: 8px;
        height: 8px;
        border: 1.5px solid $ink;
        border-radius: 4px;
        background: $track;
        transition: width 0.3s;
        &.on {
          width: 22px;
          background: $brand;
          &.call {
            background: $call;
          }
        }
      }
    }
    .state {
      margin-left: auto;
      color: $faint;
      &.call {
        color: $call-deep;
      }
      &.lock {
        color: $brand;
      }
    }
  }

  .sign {
    @include card;
    position: absolute;
    top: 36px;
    width: 370px;
    height: 150px;
    padding: 0 24px;
    .no {
      position: absolute;
      left: 24px;
      top: 22px;
      font-family: $num;
      font-weight: normal;
      font-size: 60px;
      line-height: 1;
      color: $ink;
    }
    .name {
      position: absolute;
      left: 150px;
      top: 22px;
      h2 {
        font-family: $title;
        font-weight: normal;
        font-size: 22px;
        color: $ink;
        white-space: nowrap;
      }
      p {
        margin-top: 8px;
        font-size: 16px;
        color: $sub;
      }
    }
    .foot {
      position: absolute;
      left: 24px;
      right: 24px;
      bottom: 16px;
      padding-top: 12px;
      border-top: 1px solid rgba(35, 25, 66, 0.35);
      display: flex;
      justify-content: space-between;
      font-size: 15px;
      color: $sub;
      b {
        font-family: $num;
        font-weight: normal;
        font-size: 18px;
        color: $ink;
      }
    }
  }

  .current {
    @include card;
    position: absolute;
    top: 198px;
    width: 370px;
    height: 128px;
    padding: 16px 24px 0;
    &.calling {
      background: $call-tint;
    }
    .chip {
      @include tag($busy);
      height: 26px;
      padding: 0 10px;
      border-radius: 13px;
      font-size: 14px;
      margin-right: 6px;
      &.call {
        background: $call;
      }
      &.recheck {
        background: $recheck;
      }
    }
    .who {
      margin-top: 8px;
      height: 40px;
      line-height: 40px;
      font-family: $title;
      font-size: 30px;
      color: $ink;
      white-space: nowrap;
      b {
        margin-right: 12px;
        font-family: $num;
        font-weight: normal;
        font-size: 34px;
      }
    }
    .meta {
      margin-top: 4px;
      white-space: nowrap;
      font-size: 15px;
      color: $sub;
      span {
        margin-left: 12px;
      }
      .call {
        font-family: $num;
        font-weight: normal;
        font-size: 17px;
        color: $call-deep;
      }
    }
    .timer {
      position: absolute;
      right: 24px;
      top: 40px;
      display: flex;
      align-items: baseline;
      gap: 4px;
      font-size: 15px;
      color: $sub;
      b {
        font-family: $num;
        font-weight: normal;
        font-size: 30px;
        color: $busy;
        &.over {
          color: $over;
        }
      }
    }
    .bar {
      position: absolute;
      right: 24px;
      top: 86px;
      width: 126px;
      height: 8px;
      border: 1.4px solid $ink;
      border-radius: 4px;
      background: $track;
      overflow: hidden;
      i {
        display: block;
        height: 100%;
        background: $busy;
        &.over {
          background: $over;
        }
      }
    }
    .bar-note {
      position: absolute;
      right: 24px;
      top: 100px;
      font-size: 11px;
      color: $faint;
    }
    .idle {
      margin-top: 32px;
      font-size: 22px;
      color: $faint;
    }
  }

  .list {
    @include card;
    position: absolute;
    width: 370px;
    padding: 14px 20px 0;
    header {
      display: flex;
      align-items: center;
      .pill {
        @include pill;
      }
      b {
        margin-left: 10px;
        font-family: $num;
        font-weight: normal;
        font-size: 22px;
      }
      small {
        margin-left: 3px;
        font-size: 14px;
      }
      em {
        margin-left: auto;
        font-style: normal;
        font-size: 12px;
        color: $faint;
      }
    }
    ul {
      margin-top: 12px;
      padding-left: 2px;
      &.two {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
    }
    li {
      height: 31px;
      font-size: 16px;
      color: $ink;
      white-space: nowrap;
      b {
        margin-right: 7px;
        font-family: $num;
        font-weight: normal;
        font-size: 16px;
      }
      i {
        margin-left: 8px;
        font-style: normal;
        font-size: 12px;
        color: $faint;
      }
    }
    .more {
      position: absolute;
      right: 20px;
      bottom: 12px;
      font-size: 13px;
      color: $sub;
    }
    .none {
      margin-top: 2px;
      font-size: 15px;
      color: $faint;
    }
    &.wait {
      top: 338px;
      height: 248px;
      .pill {
        background: $wait;
      }
      header b,
      header small {
        color: $wait;
      }
    }
    &.recheck {
      top: 598px;
      height: 162px;
      .pill {
        background: $recheck;
      }
      header b,
      header small {
        color: $recheck;
      }
    }
    &.missed {
      top: 772px;
      height: 176px;
      .pill {
        background: $missed;
      }
      header b,
      header small {
        color: $missed;
      }
    }
  }
</style>
