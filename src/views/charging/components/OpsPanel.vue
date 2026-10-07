<!-- 充电运营：桩在线率环图 + 桩数 / 今日电量 / 服务费 + 各类桩在用数 -->
<template>
  <section class="panel ops">
    <div class="ptitle">
      <PlugZap />
      <h3>充电运营</h3>
      <span class="more">···</span>
    </div>
    <div class="row2">
      <RingChart
        :segs="[{ v: online, color: '#34e07a' }]"
        :value="pct(online)"
        unit="%"
        label="充电桩在线率"
      />
      <div class="rows">
        <div class="r">
          <PlugZap style="color: var(--muted)" /><span>充电桩总数</span
          ><span class="v">{{ piles.total }}<small>个</small></span>
        </div>
        <div class="r">
          <PlugZap style="color: var(--ess)" /><span>在线数量</span
          ><span class="v">{{ piles.online }}<small>个</small></span>
        </div>
        <div class="r">
          <Activity style="color: var(--load)" /><span>今日充电量</span
          ><span class="v">{{ fmt(today.energy) }}<small>kWh</small></span>
        </div>
        <div class="r">
          <Receipt style="color: var(--pv)" /><span>今日服务费</span
          ><span class="v">¥{{ fmt(today.serviceFee) }}</span>
        </div>
      </div>
    </div>
    <div class="stats s4">
      <div>
        <span>超充在用</span
        ><b
          >{{ piles.superInUse }}<small>/ {{ piles.superTotal }}</small></b
        >
      </div>
      <div>
        <span>快充在用</span
        ><b
          >{{ piles.fastInUse }}<small>/ {{ piles.fastTotal }}</small></b
        >
      </div>
      <div>
        <span>空闲</span
        ><b style="color: var(--load)">{{ piles.idle }}<small>个</small></b>
      </div>
      <div>
        <span style="color: var(--red)">故障离线</span
        ><b style="color: var(--red)">{{ piles.abnormal }}<small>个</small></b>
      </div>
    </div>
  </section>
</template>

<script setup>
  import { Activity, PlugZap, Receipt } from "lucide-vue-next"
  import RingChart from "./RingChart.vue"
  import { fmt, pct } from "../utils"

  const props = defineProps({
    piles: { type: Object, required: true },
    today: { type: Object, required: true }
  })
  const online = computed(() => props.piles.online / props.piles.total)
</script>

<style lang="scss" scoped>
  .ops {
    height: 262px;
  }
</style>
