<!--
  顶部细条：楼盘名、定位、四个全盘指标、场景时钟（定稿：悬浮胶囊，不贴边）
  指标都从布局和销售数据派生：总户数、计容建面、容积率来自 layout.totals，去化率来自各栋明细汇总。
-->
<template>
  <header class="shell top">
    <div class="core">
      <div class="brand">
        <svg width="46" height="46" viewBox="0 0 46 46" fill="none">
          <circle
            cx="23"
            cy="23"
            r="21.5"
            stroke="#C9A86A"
            stroke-opacity=".6"
          />
          <path
            d="M12 29c3-3 5-3 8 0s5 3 8 0 4-3 6-1"
            stroke="#5AA9D6"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <path
            d="M14 26V15M20 26V10M27 26V17"
            stroke="#F3EBDD"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <path
            d="M12 34c3-3 5-3 8 0s5 3 8 0 4-3 6-1"
            stroke="#C9A86A"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <div>
          <div class="name">{{ layout.name }}</div>
          <div class="slogan">
            {{ layout.slogan
            }}<span class="eyebrow fake">虚构楼盘 · 效果示意</span>
          </div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="metrics">
        <div v-for="m in metrics" :key="m.k" class="metric">
          <div class="v num">
            {{ m.v }}<i>{{ m.u }}</i>
          </div>
          <div class="k">{{ m.k }}</div>
        </div>
      </div>
      <div class="sep"></div>
      <div class="clock">
        <svg
          width="30"
          height="30"
          viewBox="0 0 30 30"
          fill="none"
          stroke="#FFD27A"
          stroke-width="1.4"
          stroke-linecap="round"
        >
          <circle cx="15" cy="17" r="5" />
          <path
            d="M15 6v3M5.5 17h3M21.5 17h3M8.5 10.5l2 2M21.5 10.5l-2 2M5 24h20"
          />
        </svg>
        <div>
          <div class="t num">{{ time }}</div>
          <div class="d">{{ date }} · {{ period }}</div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup>
  import { fmt, totalSales } from "../utils.js"

  const props = defineProps({
    layout: { type: Object, required: true },
    time: { type: String, default: "" },
    date: { type: String, default: "" },
    period: { type: String, default: "" }
  })

  const metrics = computed(() => {
    const t = props.layout.totals
    const s = totalSales()
    return [
      { k: "总户数", v: fmt(s.units), u: "户" },
      { k: "计容建面", v: (t.gfa / 10000).toFixed(1), u: "万㎡" },
      { k: "容积率", v: t.far.toFixed(2), u: "" },
      { k: "去化率", v: (s.rate * 100).toFixed(1), u: "%" }
    ]
  })
</script>
