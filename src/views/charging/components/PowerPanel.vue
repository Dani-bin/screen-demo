<!-- 实时功率：光伏 / 储能 / 电网 / 充电负荷 / 总负荷 五条横向功率条 -->
<template>
  <section class="panel power">
    <div class="ptitle">
      <Activity />
      <h3>实时功率</h3>
      <span class="unit">单位：kW</span>
    </div>
    <div v-for="b in bars" :key="b.name" class="bar">
      <span>{{ b.name }}</span>
      <div class="track">
        <i
          :style="{
            width: `${Math.min(100, (b.v / max) * 100)}%`,
            background: `linear-gradient(90deg, ${b.c}55, ${b.c})`,
            boxShadow: `0 0 8px ${b.c}`
          }"
        ></i>
      </div>
      <span class="num">{{ fmt(b.v) }}</span>
    </div>
  </section>
</template>

<script setup>
  import { Activity } from "lucide-vue-next"
  import { fmt } from "../utils"

  const props = defineProps({ power: { type: Object, required: true } })

  /** 刻度上限：取 4000 kW 与当前最大值的较大者，晚高峰负荷超过 4000 时自动放大 */
  const max = computed(() => Math.max(4000, props.power.total * 1.1))
  const bars = computed(() => {
    const p = props.power
    return [
      { name: "光伏发电", v: p.pv, c: "#f5c242" },
      {
        name: p.ess >= 0 ? "储能放电" : "储能充电",
        v: Math.abs(p.ess),
        c: "#34e07a"
      },
      { name: "电网购电", v: p.grid, c: "#ff9f43" },
      { name: "充电负荷", v: p.load, c: "#2f9bff" },
      { name: "总负荷", v: p.total, c: "#2de2e6" }
    ]
  })
</script>

<style lang="scss" scoped>
  .power {
    height: 226px;
  }

  .bar {
    display: grid;
    grid-template-columns: 74px 1fr 56px;
    align-items: center;
    gap: 10px;
    margin-bottom: 11px;
    font-size: 13.5px;
  }

  .track {
    height: 10px;
    overflow: hidden;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);

    i {
      display: block;
      height: 100%;
      border-radius: 2px;
      transition: width 0.8s ease;
    }
  }

  .num {
    font-size: 16px;
    text-align: right;
  }
</style>
