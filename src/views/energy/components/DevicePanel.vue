<!-- 设备状态：8 类设备在线数，超充终端显示告警数、LNG 泵撬卸车时显示作业中 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <Server />
      <h3>设备状态</h3>
      <span class="unit">在线 / 总数</span>
    </div>
    <div class="grid">
      <div v-for="d in DEVICES" :key="d.key" class="kpi">
        <div class="l">{{ d.name }}</div>
        <div class="v">
          <span class="num">{{ d.total }}</span
          ><small>/{{ d.total }}</small>
          <em v-if="d.key === 'charger' && faults" class="chip bad"
            >{{ faults }} 告警</em
          >
          <em v-if="d.key === 'pump' && filling" class="chip lng">卸车中</em>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { Server } from "lucide-vue-next"
  import { DEVICES } from "../data/station"

  defineProps({
    faults: { type: Number, default: 0 },
    filling: { type: Boolean, default: false }
  })
</script>

<style lang="scss" scoped>
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }

  .kpi {
    padding: 8px 10px 7px;
    border: 1px solid rgba(45, 120, 200, 0.25);
    border-radius: 4px;
    background: rgba(30, 70, 130, 0.18);
  }

  .l {
    font-size: 13px;
    color: var(--muted);
  }

  .v {
    display: flex;
    align-items: baseline;
    margin-top: 2px;
    font-size: 24px;
    color: #fff;

    small {
      margin-left: 2px;
      font-size: 12px;
      color: var(--muted);
    }
  }

  .chip {
    margin-left: 8px;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-style: normal;

    &.bad {
      background: rgba(255, 77, 90, 0.2);
      color: var(--red);
    }

    &.lng {
      background: rgba(180, 140, 255, 0.2);
      color: #b48cff;
    }
  }
</style>
