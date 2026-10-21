<!-- 顶栏：品牌、6 张指标卡（带走势小图）、时钟与天气、功能导航 + 搜索 -->
<template>
  <header class="top">
    <div class="brand">
      <i class="logo"></i>
      <div>
        <h1>莫日格勒河示范牧场</h1>
        <p>智慧放牧 · 草畜平衡与畜群监管平台</p>
      </div>
    </div>
    <div class="clock">
      <b>{{ state.t.hms }}</b
      ><span>{{ state.t.date }} {{ state.t.week }}</span>
      <span class="cw">{{ w.sky }} {{ w.temp }}℃ · {{ w.wind }}</span>
    </div>
  </header>
  <div class="kpis">
    <div class="kpi">
      <span class="k">存栏</span>
      <div class="kv">
        <b>{{ fmt(r.head) }}<small>头只</small></b>
        <span class="kmix"
          ><i :style="{ flex: r.sheepHead }"></i
          ><i :style="{ flex: r.cattleHead * 5 }"></i
        ></span>
      </div>
      <span class="sub"
        >羊 {{ fmt(r.sheepHead) }} · 牛 {{ fmt(r.cattleHead) }}</span
      >
    </div>
    <div class="kpi ok">
      <span class="k">草畜平衡指数</span>
      <div class="kv">
        <b>{{ sign(r.balance) }}<small>%</small></b>
        <Spark
          :values="state.units.map((u) => u.balance)"
          color="#2f8f4e"
          :fill="false"
        />
      </div>
      <span class="sub">≤ 10% 不过牧</span>
    </div>
    <div class="kpi">
      <span class="k">草场 NDVI</span>
      <div class="kv">
        <b>{{ r.ndvi.toFixed(2) }}</b
        ><Spark :values="ndviToNow" color="#2f8f4e" />
      </div>
      <span class="sub">同比 {{ sign(r.ndvi - r.ndviLastYear, 2) }}</span>
    </div>
    <div class="kpi">
      <span class="k">羊群日均行走</span>
      <div class="kv">
        <b>{{ r.avgWalkKm.toFixed(1) }}<small>km</small></b
        ><Spark :values="hourly.walk" />
      </div>
      <span class="sub">调研常值 6–9 km/天</span>
    </div>
    <div class="kpi">
      <span class="k">项圈在线</span>
      <div class="kv">
        <b
          >{{ state.collars.online
          }}<small>/ {{ state.collars.total }}</small></b
        >
        <Spark :values="hourly.online" :fill="false" />
      </div>
      <span class="sub">低电量 {{ state.collars.lowBattery }}</span>
    </div>
    <div class="kpi" :class="{ bad: open }">
      <span class="k">今日告警</span>
      <div class="kv">
        <b>{{ events.length }}<small>条</small></b
        ><Spark :values="byHour" color="#e5484d" />
      </div>
      <span class="sub">未结束 {{ open }}</span>
    </div>
  </div>
  <nav class="tabs">
    <span
      v-for="t in TABS"
      :key="t.key"
      :class="{ on: t.key === tab }"
      @click="$emit('tab', t.key)"
      >{{ t.name }}</span
    >
    <label class="search" :class="{ miss }">
      <i></i>
      <input
        v-model="q"
        placeholder="搜索畜群 / 项圈 / 分区编号"
        @keydown.enter="find"
        @input="miss = false"
      />
    </label>
  </nav>
</template>

<script setup>
  import Spark from "./charts/Spark.vue"
  import { fmt, ndviSeries, sign } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    layout: { type: Object, required: true },
    /** 今日逐时序列：{ walk, online } */
    hourly: { type: Object, default: () => ({ walk: [], online: [] }) },
    events: { type: Array, default: () => [] },
    tab: { type: String, default: "overview" },
    /** 搜索回调：返回 false 表示没找到 */
    onSearch: { type: Function, default: () => true }
  })
  defineEmits(["tab"])

  const TABS = [
    { key: "overview", name: "综合态势" },
    { key: "grass", name: "草场长势" },
    { key: "rotation", name: "轮牧管理" },
    { key: "herds", name: "畜群定位" },
    { key: "devices", name: "饮水设备" },
    { key: "ops", name: "生产作业" },
    { key: "video", name: "视频监控" }
  ]

  const r = computed(() => props.state.ranch)
  const w = computed(() => props.state.weather)
  const nd = ndviSeries(props.layout)
  const ndviToNow = computed(() =>
    nd.y26.slice(0, nd.months.indexOf(props.state.t.month) + 1)
  )
  const open = computed(
    () => props.events.filter((e) => e.stage !== "resolved").length
  )
  const byHour = computed(() =>
    Array.from(
      { length: Math.floor(props.state.t.hours) + 1 },
      (_, h) => props.events.filter((e) => Math.floor(e.start) === h).length
    )
  )

  const q = ref("")
  const miss = ref(false)
  function find() {
    if (!q.value.trim()) return
    miss.value = props.onSearch(q.value.trim()) === false
  }
</script>
