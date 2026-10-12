<!-- 油气库存：4 个埋地油罐液位、LNG 储罐液位（卸车时显示补液中）、CNG 储气压力 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <Fuel />
      <h3>油气库存</h3>
      <span class="unit">液位 / 压力</span>
    </div>
    <div v-for="r in rows" :key="r.name" class="row">
      <span class="n">{{ r.name }}</span>
      <div class="bar">
        <i :style="{ width: r.pct + '%', background: r.color }"></i>
      </div>
      <span class="p num" :style="{ color: r.warn ? 'var(--red)' : '' }">{{
        r.text
      }}</span>
    </div>
  </section>
</template>

<script setup>
  import { Fuel } from "lucide-vue-next"
  import { STATION } from "../data/station"

  const props = defineProps({ inv: { type: Object, required: true } })
  const rows = computed(() => {
    const i = props.inv
    const oil = i.tanks.map((t) => ({
      name: t.name,
      pct: t.level * 100,
      text: `${Math.round(t.level * 100)}%`,
      warn: t.level < 0.3,
      color:
        t.level < 0.3
          ? "#ff4d5a"
          : t.key.startsWith("g")
            ? "#ff9a3d"
            : "#ffc35a"
    }))
    return [
      ...oil,
      {
        name: i.lngFilling ? "LNG 储罐 ↑" : "LNG 储罐",
        pct: i.lng * 100,
        text: `${Math.round(i.lng * 100)}%`,
        warn: i.lng < 0.35,
        color: "#b48cff"
      },
      {
        name: "CNG 储气",
        pct: (i.cngMpa / STATION.cngMaxMpa) * 100,
        text: `${i.cngMpa.toFixed(1)} MPa`,
        color: "#4c8dff"
      }
    ]
  })
</script>

<style lang="scss" scoped>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
    font-size: 14px;
  }

  .n {
    width: 92px;
    color: var(--muted);
    white-space: nowrap;
  }

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
      transition: width 0.8s;
    }
  }

  .p {
    width: 76px;
    text-align: right;
    font-size: 16px;
  }
</style>
