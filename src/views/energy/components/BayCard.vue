<!-- 超充位详情浮窗：车牌、状态、SOC、功率、已充时长；随所选终端在画面上的位置移动 -->
<template>
  <div class="card" :style="{ left: rem(pick.x), top: rem(pick.y) }">
    <div class="hd">
      <b>{{ bay.id }}</b
      ><span>液冷超充终端 · 480 kW</span>
      <X class="x" @click="$emit('close')" />
    </div>
    <div class="st" :class="bay.status">{{ LABEL[bay.status] }}</div>
    <template v-if="bay.status !== 'idle'">
      <div class="row">
        <span>车牌</span><b>{{ bay.plate }}</b>
      </div>
      <div class="row">
        <span>SOC</span><b class="num">{{ pct(bay.soc, 0) }}%</b>
      </div>
      <div class="soc"><i :style="{ width: bay.soc * 100 + '%' }"></i></div>
      <div class="row">
        <span>实时功率</span><b class="num">{{ fmt(bay.kw) }} kW</b>
      </div>
      <div class="row">
        <span>已充时长</span><b class="num">{{ elapsed }}</b>
      </div>
    </template>
    <div v-else class="row"><span>等待车辆</span><b>—</b></div>
  </div>
</template>

<script setup>
  import { X } from "lucide-vue-next"
  import { fmt, pct, rem } from "../utils"

  const props = defineProps({
    pick: { type: Object, required: true },
    bay: { type: Object, required: true },
    now: { type: Date, required: true }
  })
  defineEmits(["close"])

  const LABEL = {
    idle: "空闲",
    arriving: "进站中",
    charging: "充电中",
    fault: "枪温过高 · 降功率",
    leaving: "充电完成 · 离站中"
  }
  // 已充时长：演示加速，按 6 倍折算成真实时长
  const elapsed = computed(() => {
    if (!props.bay.start) return "—"
    const s = Math.max(0, (props.now - new Date(props.bay.start)) / 1000) * 6
    return `${Math.floor(s / 60)} 分 ${String(Math.floor(s % 60)).padStart(2, "0")} 秒`
  })
</script>

<style lang="scss" scoped>
  .card {
    position: absolute;
    z-index: 6;
    width: 250px;
    padding: 12px 14px;
    border: 1px solid var(--cyan);
    border-radius: 6px;
    background: rgba(6, 18, 40, 0.94);
    box-shadow: 0 0 24px rgba(45, 226, 230, 0.25);
    transform: translate(-50%, calc(-100% - 46px));
  }

  .hd {
    display: flex;
    align-items: center;
    gap: 8px;

    b {
      font-family: "DIN", sans-serif;
      font-size: 20px;
      color: #fff;
    }

    span {
      font-size: 12px;
      color: var(--muted);
    }

    .x {
      width: 16px;
      height: 16px;
      margin-left: auto;
      color: var(--muted);
      cursor: pointer;
    }
  }

  .st {
    margin: 8px 0 6px;
    font-size: 14px;
    color: #2f9bff;

    &.charging {
      color: #3ddc97;
    }

    &.fault {
      color: var(--red);
    }
  }

  .row {
    display: flex;
    justify-content: space-between;
    margin: 5px 0;
    font-size: 13px;
    color: var(--muted);

    b {
      font-weight: normal;
      color: #fff;
    }
  }

  .soc {
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: rgba(60, 100, 160, 0.3);

    i {
      display: block;
      height: 100%;
      background: #3ddc97;
    }
  }
</style>
