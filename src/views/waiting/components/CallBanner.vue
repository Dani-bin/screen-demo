<!--
  中上：叫号条（常驻显示最近一次叫号）
  "请 A102 潘*涛 到 [216 诊室] 就诊"；被叫诊室用橙色块，与三维里的橙色高亮对应
  新叫号 / 第二次呼叫时整条闪一下（key 变化重播动画）
-->
<template>
  <section class="banner">
    <div :key="flashKey" class="flash"></div>
    <div class="icon">
      <SpeakerIcon />
      <span>正在叫号</span>
    </div>
    <template v-if="call">
      <div class="main">
        <p class="line">
          <span class="w">请</span>
          <b class="no">{{ call.no }}</b>
          <b class="name">{{ call.name }}</b>
          <span class="w">到</span>
          <span class="room"
            ><b>{{ call.room }}</b
            ><i>诊室</i></span
          >
          <span class="w">就诊</span>
        </p>
        <p v-if="room" class="sub">
          {{ room.dept }} · {{ room.doctor }} {{ room.title }}
        </p>
      </div>
      <div class="side">
        <span class="state" :class="call.state">{{ stateText }}</span>
        <p v-if="next" class="next">
          下一位 <b>{{ next.no }}</b> {{ next.name }}
        </p>
      </div>
    </template>
    <p v-else class="empty">暂无叫号</p>
  </section>
</template>

<script setup>
  import SpeakerIcon from "./SpeakerIcon.vue"

  const props = defineProps({
    call: { type: Object, default: null },
    room: { type: Object, default: null }
  })

  const stateText = computed(() => {
    const c = props.call
    if (!c) return ""
    if (c.state === "calling") return `第 ${c.n} 次呼叫`
    return c.state === "missed" ? "未到 · 已过号" : "已入室"
  })
  // 下一位：该诊室待诊队首（待诊为空时是复诊队首）
  const next = computed(() => {
    const r = props.room
    if (!r) return null
    return r.waiting[0] || r.recheck[0] || null
  })
  const flashKey = computed(() =>
    props.call ? `${props.call.id}-${props.call.n}` : "none"
  )
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .banner {
    @include card(20px);
    position: absolute;
    left: 430px;
    top: 96px;
    width: 1060px;
    height: 104px;
    border-width: 3px;
    box-shadow: 6px 6px 0 $ink;
    background: $brand;
    color: #fff;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .flash {
    position: absolute;
    inset: 0;
    background: #fff;
    opacity: 0;
    animation: flash 1.6s ease-out;
    pointer-events: none;
  }
  @keyframes flash {
    0%,
    30% {
      opacity: 0.45;
    }
    15%,
    100% {
      opacity: 0;
    }
  }
  .icon {
    flex: none;
    width: 92px;
    height: 60px;
    border-right: 1px solid rgba(255, 255, 255, 0.3);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    svg {
      width: 34px;
      height: 34px;
      color: #fff;
    }
    span {
      font-size: 15px;
      color: $brand-sub;
    }
  }
  .main {
    margin-left: 26px;
    flex: 1;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 62px;
    white-space: nowrap;
    .w {
      font-size: 30px;
    }
    .no {
      font-family: $num;
      font-weight: normal;
      font-size: 46px;
    }
    .name {
      font-family: $title;
      font-weight: normal;
      font-size: 40px;
    }
    // 诊室块：数字和"诊室"两种字体，各自行高 1，整组在橙色块里上下居中
    .room {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 62px;
      // 两种字体的字框下沿留白比上沿多，底部多垫 3px，字形才在视觉上正好居中
      padding: 0 16px 3px;
      border: 2.5px solid $ink;
      border-radius: 12px;
      background: $call;
      box-shadow: 4px 4px 0 $ink;
      b {
        font-family: $num;
        font-weight: normal;
        font-size: 44px;
        line-height: 1;
      }
      i {
        font-style: normal;
        font-family: $title;
        font-size: 32px;
        line-height: 1;
      }
    }
  }
  .sub {
    margin-top: 2px;
    font-size: 16px;
    color: $brand-sub;
  }
  .side {
    flex: none;
    height: 70px;
    margin-right: 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: space-between;
  }
  .state {
    height: 28px;
    padding: 0 12px;
    border: 1.6px solid $ink;
    border-radius: 14px;
    background: #fff;
    color: $ink;
    font-size: 15px;
    line-height: 25px;
    &.calling {
      color: $call-deep;
    }
    &.missed {
      color: $missed;
    }
  }
  .next {
    font-size: 16px;
    color: $brand-sub;
    b {
      margin: 0 4px 0 6px;
      font-family: $num;
      font-weight: normal;
      font-size: 17px;
      color: #fff;
    }
  }
  .empty {
    margin-left: 26px;
    font-size: 26px;
    color: $brand-sub;
  }
</style>
