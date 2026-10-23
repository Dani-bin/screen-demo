<!-- 重大告警横幅：有待确认的重大事件时出现在 KPI 下方（不用模态框、不持续闪烁），倒计时到确认时限 -->
<template>
  <div class="banner">
    <b class="ttl">重大告警</b>
    <!-- 整句拼成一个字符串：模板换行会在"）"和"·"之间多出空格，设计稿是紧挨着的 -->
    <span>{{ detail }}</span>
    <span class="push">{{
      alarm.overdue ? "已超时 · 督办" : "待确认 剩余"
    }}</span>
    <span v-if="!alarm.overdue" class="cd num">{{ mmss(remain) }}</span>
    <span class="go" @click="$emit('locate', alarm)">定位</span>
  </div>
</template>

<script setup>
  import { EVENT_TYPES } from "../data/catalog.js"
  import { TARGETS } from "../data/layout.js"
  import { mmss, thousands } from "../utils.js"

  const props = defineProps({
    alarm: { type: Object, required: true },
    remain: { type: Number, default: 0 }
  })
  defineEmits(["locate"])

  const type = computed(() => EVENT_TYPES[props.alarm.type].label)
  const target = computed(
    () => TARGETS[props.alarm.target]?.name || props.alarm.target
  )
  const source = computed(() =>
    props.alarm.review?.self
      ? `${props.alarm.drone} 原地监视中`
      : props.alarm.drone
  )
  // 横幅正文：类型 · 对象（编号）· 读数（仅气体）· 来源，与设计稿的拼接方式一致
  // （全角括号后面的"·"前不留空格）
  const detail = computed(() => {
    const a = props.alarm
    const gas = a.type === "gas" ? `· CH₄ ${thousands(a.reading)} ppm·m ` : ""
    return `${type.value} · ${target.value}（${a.target}）${gas}· ${source.value}`
  })
</script>

<style lang="scss" scoped>
  .banner {
    position: absolute;
    left: 560px;
    top: 186px;
    width: 800px;
    // 40px 换算成 0.20833rem 后只有 39.9994px，布局取整成 39.984px：高度为奇数的"重大告警"
    // 和"定位"按钮居中后落在 x.484 而不是 x.5，文字栅格化时整体上移 1px。多写 0.01px 让取整后正好 40px
    height: 40.01px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    // 与设计稿相同的取色：重大红 88% + 黑 12%
    background: color-mix(in srgb, var(--major) 88%, #000);
    color: #fff;
    border-radius: 3px;
    font-size: 14px;
    white-space: nowrap;
    // 设计稿未设行高（normal）；不改的话继承 Tailwind preflight 的 1.5
    line-height: normal;
    z-index: 4;
    b {
      font-weight: normal;
      font-size: 16px;
    }
  }
  .push {
    margin-left: auto;
  }
  .cd {
    font-size: 18px;
  }
  .go {
    margin-left: 8px;
    padding: 3px 10px;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
