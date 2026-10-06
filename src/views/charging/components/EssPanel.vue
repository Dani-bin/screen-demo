<!-- 储能状态：电池 SOC 图形 + 功率 / 容量 / 策略 + 循环、健康度、温度 -->
<template>
  <section class="panel ess">
    <div class="ptitle" style="color: var(--ess)">
      <BatteryCharging />
      <h3>储能状态</h3>
      <span class="more">···</span>
    </div>
    <div class="row2">
      <svg class="battery" viewBox="0 0 130 92">
        <defs>
          <linearGradient id="essFill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stop-color="#0f8f3f" />
            <stop offset="1" stop-color="#5bff8a" />
          </linearGradient>
        </defs>
        <rect x="14" y="4" width="18" height="6" rx="2" fill="#5b6b80" />
        <rect
          x="4"
          y="10"
          width="38"
          height="78"
          rx="5"
          fill="rgba(255,255,255,.05)"
          stroke="#5b6b80"
          stroke-width="2"
        />
        <rect
          x="8"
          :y="14 + 70 * (1 - ess.soc)"
          width="30"
          :height="70 * ess.soc"
          rx="3"
          fill="url(#essFill)"
          class="fill"
        />
        <line
          v-for="i in 4"
          :key="i"
          x1="8"
          x2="38"
          :y1="14 + i * 14"
          :y2="14 + i * 14"
          stroke="rgba(0,0,0,.25)"
        />
        <text x="54" y="50" class="soc">
          {{ Math.round(ess.soc * 100) }}
          <tspan font-size="15">%</tspan>
        </text>
        <text x="56" y="70" class="lab">储能 SOC</text>
      </svg>
      <div class="rows">
        <div class="r">
          <Activity style="color: var(--ess)" /><span>当前功率</span
          ><span class="v" style="color: var(--ess)"
            >{{ fmt(Math.abs(ess.power))
            }}<small>kW {{ ess.mode }}</small></span
          >
        </div>
        <div class="r">
          <Battery style="color: var(--load)" /><span>电池容量</span
          ><span class="v"
            >{{ ess.capacity.toFixed(2) }}<small>MWh</small></span
          >
        </div>
        <div class="r">
          <BatteryCharging style="color: var(--pv)" /><span>可用电量</span
          ><span class="v"
            >{{ ess.available.toFixed(2) }}<small>MWh</small></span
          >
        </div>
        <div class="r">
          <LayoutGrid style="color: var(--cyan)" /><span>充放电策略</span
          ><span class="v txt">{{ ess.strategy }}</span>
        </div>
      </div>
    </div>
    <div class="stats">
      <div>
        <span>循环次数</span><b>{{ ess.cycles }}<small>次</small></b>
      </div>
      <div>
        <span>健康度 SOH</span
        ><b style="color: var(--ess)"
          >{{ (ess.soh * 100).toFixed(1) }}<small>%</small></b
        >
      </div>
      <div>
        <span>电芯温度</span><b>{{ ess.temp.toFixed(1) }}<small>℃</small></b>
      </div>
    </div>
  </section>
</template>

<script setup>
  import {
    Activity,
    Battery,
    BatteryCharging,
    LayoutGrid
  } from "lucide-vue-next"
  import { fmt } from "../utils"

  defineProps({ ess: { type: Object, required: true } })
</script>

<style lang="scss" scoped>
  .ess {
    height: 250px;
  }

  .battery {
    flex: none;
    width: 130px;
    height: 92px;
  }

  .fill {
    filter: drop-shadow(0 0 8px #34e07a);
    transition: all 0.8s ease;
  }

  .soc {
    fill: #fff;
    font-family: "DIN", sans-serif;
    font-size: 30px;
  }

  .lab {
    fill: var(--muted);
    font-size: 12px;
  }

  .txt {
    font-family: "Source Han Sans CN", sans-serif !important;
    font-size: 13.5px !important;
    color: var(--ess) !important;
  }
</style>
