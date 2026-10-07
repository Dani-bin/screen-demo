<!-- 顶栏：左侧当前电价时段，中间标题框，右侧时间、天气、系统状态 -->
<template>
  <header class="head">
    <div class="left">
      <Menu class="menu" />
      <div v-if="period" class="price" :style="{ '--c': PRICE[period].color }">
        <i>{{ PRICE[period].name }}</i>
        <span>当前电价</span>
        <b class="num">{{ price.toFixed(2) }}</b>
        <span>+ 服务费</span>
        <b class="num">{{ serviceFee.toFixed(2) }}</b>
        <span>元/kWh</span>
      </div>
    </div>
    <svg class="frame" viewBox="0 0 760 62">
      <path
        d="M0 0 L60 54 L700 54 L760 0"
        fill="rgba(20,60,120,.35)"
        stroke="rgba(45,226,230,.6)"
        stroke-width="1.5"
      />
      <path d="M90 62 L670 62" stroke="#2de2e6" stroke-width="2" opacity=".8" />
    </svg>
    <h1>{{ STATION.name }}</h1>
    <div class="right">
      <span class="num clock">{{ dateText }}&nbsp;&nbsp;{{ timeText }}</span>
      <span class="wx"><Sun class="ico sun" />24℃ 晴</span>
      <span v-if="urgent" class="state bad"
        ><TriangleAlert class="ico" />紧急告警 {{ urgent }}</span
      >
      <span v-else class="state"><ShieldCheck class="ico" />系统正常</span>
    </div>
  </header>
</template>

<script setup>
  import { Menu, ShieldCheck, Sun, TriangleAlert } from "lucide-vue-next"
  import { PRICE, STATION } from "../data/station"

  const props = defineProps({
    now: { type: Date, required: true },
    period: { type: String, default: "" },
    price: { type: Number, default: 0 },
    serviceFee: { type: Number, default: 0 },
    urgent: { type: Number, default: 0 }
  })

  const pad = (n) => String(n).padStart(2, "0")
  const dateText = computed(() => {
    const d = props.now
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const timeText = computed(() => props.now.toTimeString().slice(0, 8))
</script>

<style lang="scss" scoped>
  .head {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 5;
    width: 100%;
    height: 62px;
    background: linear-gradient(
      180deg,
      rgba(6, 18, 38, 0.95),
      rgba(6, 18, 38, 0.4)
    );
    pointer-events: none;

    &::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(45, 226, 230, 0.5) 30%,
        rgba(45, 226, 230, 0.5) 70%,
        transparent
      );
    }
  }

  .frame {
    position: absolute;
    left: 50%;
    top: 0;
    width: 760px;
    height: 62px;
    transform: translateX(-50%);
  }

  h1 {
    position: absolute;
    left: 0;
    right: 0;
    top: 10px;
    margin: 0;
    text-align: center;
    font-family: "Alimama ShuHeiTi", sans-serif;
    font-size: 34px;
    letter-spacing: 4px;
    color: #fff;
    text-shadow: 0 0 18px rgba(80, 170, 255, 0.6);
  }

  .left {
    position: absolute;
    left: 24px;
    top: 0;
    height: 62px;
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .menu {
    width: 26px;
    height: 26px;
    color: #b9cbe2;
  }

  .price {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px 0 6px;
    border: 1px solid color-mix(in srgb, var(--c) 50%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--c) 12%, transparent);
    font-size: 13px;
    color: #c6d6ea;

    i {
      padding: 1px 6px;
      border-radius: 2px;
      font-style: normal;
      font-weight: bold;
      color: #10141a;
      background: var(--c);
    }

    b {
      font-size: 17px;
      font-weight: normal;
      color: var(--c);
    }
  }

  .right {
    position: absolute;
    right: 26px;
    top: 0;
    height: 62px;
    display: flex;
    align-items: center;
    gap: 26px;
    font-size: 15px;
    color: #c6d6ea;
  }

  .clock {
    font-size: 17px;
  }

  .ico {
    width: 18px;
    height: 18px;
  }

  .wx,
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sun {
    color: var(--pv);
  }

  .state {
    color: var(--ess);

    &.bad {
      color: var(--red);
    }
  }
</style>
