<!-- 顶栏：左侧合规信息（化工园区属于管制空域）、居中标题、右侧气象 · 时间 · 实时 / 回放标识 -->
<template>
  <header class="head">
    <div class="side compl">
      <span>{{ C.airspace }} · {{ C.approval }}</span>
      <span>
        有效期至 {{ C.validTo }} ·
        <span class="ok"
          >● 今日计划已报备（{{ reportDay }} {{ C.reportedAt }}）</span
        >
        · 运行识别报送正常
      </span>
    </div>
    <div class="title ttl">临江化工园区 · 无人机巡检监控平台</div>
    <div class="side right">
      <span>{{ weather }}</span>
      <span>
        {{ dateText }} 星期{{ weekday(cursor) }}
        <b class="num time">{{ hms(cursor) }}</b>
      </span>
      <span v-if="live" class="live"><i class="dot"></i>实时</span>
      <span v-else class="replay" @click="$emit('live')"
        >回放中 · 回到实时</span
      >
    </div>
  </header>
</template>

<script setup>
  import { COMPLIANCE as C } from "../data/catalog.js"
  import { compass, dateOf, hms, weekday } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    cursor: { type: Number, required: true },
    live: { type: Boolean, default: true }
  })
  defineEmits(["live"])

  const dateText = computed(() => dateOf(props.cursor).replaceAll("-", "."))
  // 计划在前一日报备（条例第 26 条）
  const reportDay = computed(() => {
    const d = new Date(props.cursor + 8 * 3600e3 - 86400e3)
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  })
  // 顶栏气象取指挥中心屋顶 4# 机场的气象站
  const weather = computed(() => {
    const d = props.state.docks["DK-04"]
    const sky = d.rain ? ["", "小雨", "中雨", "大雨"][d.rain] : "晴"
    return `${sky} ${d.temp.toFixed(0)}℃ · ${compass(d.windDir)}风 ${d.windLevel} 级`
  })
</script>

<style lang="scss" scoped>
  .head {
    position: absolute;
    left: 0;
    top: 0;
    width: 1920px;
    height: 80px;
    padding: 0 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(#0a1428, rgba(10, 20, 40, 0));
    pointer-events: none;
    z-index: 5;
  }
  .side {
    width: 560px;
    display: flex;
    gap: 18px;
    align-items: center;
    color: var(--sub);
    font-size: 14px;
  }
  .compl {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    font-size: 12px;
  }
  .ok {
    color: var(--ok);
  }
  .right {
    justify-content: flex-end;
    pointer-events: auto;
  }
  .title {
    font-size: 34px;
    letter-spacing: 3px;
    text-align: center;
  }
  .time {
    font-size: 20px;
    color: var(--text);
    font-weight: normal;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ok);
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 0 3px rgba(54, 227, 216, 0.25);
    }
  }
  .replay {
    font-size: 13px;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
  }
</style>
