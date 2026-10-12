<!-- 重卡超充：10 个车位状态格（SOC、充电中 / 空闲 / 降功率），点击格子在场景里定位；底部利用率 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <PlugZap />
      <h3>重卡超充</h3>
      <span class="unit"
        >10 位 · 实时 <b class="num">{{ fmt(charge.kw) }}</b> kW</span
      >
    </div>
    <div class="bays">
      <button
        v-for="b in bays"
        :key="b.id"
        class="bay"
        :class="cls(b)"
        @click="$emit('pick', b.id)"
      >
        <div class="id num">{{ b.id }}</div>
        <div class="s num">
          {{ b.status === "idle" ? "—" : pct(b.soc, 0) + "%" }}
        </div>
        <div class="t">{{ LABEL[b.status] }}</div>
      </button>
    </div>
    <div class="util">
      <span>利用率</span>
      <div class="bar"><i :style="{ width: charge.util * 100 + '%' }"></i></div>
      <b class="num">{{ pct(charge.util, 0) }}%</b>
    </div>
  </section>
</template>

<script setup>
  import { PlugZap } from "lucide-vue-next"
  import { fmt, pct } from "../utils"

  defineProps({
    bays: { type: Array, required: true },
    charge: { type: Object, required: true }
  })
  defineEmits(["pick"])

  const LABEL = {
    idle: "空闲",
    arriving: "进站中",
    charging: "充电中",
    fault: "降功率",
    leaving: "离站中"
  }
  const cls = (b) => ({
    c: b.status === "charging",
    a: b.status === "fault",
    m: b.status === "arriving" || b.status === "leaving"
  })
</script>

<style lang="scss" scoped>
  .unit b {
    font-size: 15px;
    font-weight: normal;
    color: #3ddc97;
  }

  .bays {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }

  .bay {
    padding: 6px 2px;
    border: 1px solid #3a5378;
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
    cursor: pointer;

    .id {
      font-size: 15px;
    }

    .s {
      font-size: 18px;
      color: #fff;
    }

    &.c {
      border-color: #3ddc97;
      background: rgba(61, 220, 151, 0.1);
      color: #3ddc97;
    }

    &.a {
      border-color: var(--red);
      background: rgba(255, 77, 90, 0.15);
      color: var(--red);
    }

    &.m {
      border-color: var(--cyan);
      color: var(--cyan);
    }

    &:hover {
      box-shadow: 0 0 10px rgba(45, 226, 230, 0.35);
    }
  }

  .util {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    font-size: 14px;
    color: var(--muted);

    .bar {
      flex: 1;
      height: 10px;
      overflow: hidden;
      border-radius: 5px;
      background: rgba(60, 100, 160, 0.25);

      i {
        display: block;
        height: 100%;
        border-radius: 5px;
        background: #3ddc97;
        transition: width 0.8s;
      }
    }

    b {
      width: 46px;
      text-align: right;
      font-size: 16px;
      font-weight: normal;
      color: #fff;
    }
  }
</style>
