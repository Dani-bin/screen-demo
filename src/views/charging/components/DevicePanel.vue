<!-- 设备状态：六类设备的正常 / 故障 / 总数；充电桩按实时状态统计，其余为示范设定（全部正常） -->
<template>
  <section class="panel devices">
    <div class="ptitle">
      <Cpu />
      <h3>设备状态</h3>
      <span class="more">···</span>
    </div>
    <div class="grid">
      <div v-for="d in list" :key="d.key" class="dev">
        <div class="icon" :style="{ '--c': d.color }">
          <component :is="d.icon" />
        </div>
        <div>
          <h5>{{ d.name }}</h5>
          <p>
            正常 <b class="g">{{ d.ok }}</b> · 故障
            <b :class="{ r: d.bad }">{{ d.bad }}</b>
          </p>
          <p>
            总数 <b>{{ d.total }}</b>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import {
    BatteryCharging,
    Cctv,
    Cpu,
    PlugZap,
    Server,
    SunMedium,
    Zap
  } from "lucide-vue-next"
  import { DEVICES } from "../data/station"

  const props = defineProps({ piles: { type: Object, required: true } })

  const ICONS = { PlugZap, BatteryCharging, SunMedium, Zap, Server, Cctv }
  const COLORS = {
    pile: "#2de2e6",
    ess: "#34e07a",
    inverter: "#f5c242",
    transformer: "#ff9f43",
    switchgear: "#2de2e6",
    camera: "#2de2e6"
  }

  const list = computed(() =>
    DEVICES.map((d) => {
      const bad = d.key === "pile" ? props.piles.abnormal : 0
      return {
        ...d,
        icon: ICONS[d.icon],
        color: COLORS[d.key],
        bad,
        ok: d.total - bad
      }
    })
  )
</script>

<style lang="scss" scoped>
  .devices {
    flex: 1;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
  }

  .dev {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px;
    border: 1px solid rgba(74, 144, 226, 0.2);
    border-radius: 4px;
    background: rgba(40, 90, 160, 0.12);
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    border-radius: 6px;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 10%, transparent);

    svg {
      width: 22px;
      height: 22px;
    }
  }

  h5 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: normal;
    color: #fff;
  }

  p {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    white-space: nowrap;
    color: var(--muted);

    b {
      font-family: "DIN", sans-serif;
      font-weight: normal;
      color: #fff;

      &.g {
        color: var(--ess);
      }

      &.r {
        color: var(--red);
      }
    }
  }
</style>
