<!--
  左上：候诊概况（待诊 / 复诊 / 过诊 / 已诊四个总数）+ 分时段候诊人数曲线
  曲线：实线 = 过去 2 小时的实际人数（待诊 + 复诊），虚线 = 未来 1 小时预测；圆点是此刻
-->
<template>
  <section class="overview">
    <header>
      <span class="pill">候诊概况</span>
      <em>截至 {{ hm(now) }}</em>
    </header>
    <div class="kpis">
      <div v-for="k in kpis" :key="k.label">
        <b :style="{ color: k.color }">{{ k.value }}<small>人</small></b>
        <span>{{ k.label }}</span>
      </div>
    </div>
    <div class="chart-head">
      <span>分时段候诊人数</span>
      <i>虚线为预测</i>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="chart">
      <line
        v-for="g in grid"
        :key="g"
        x1="0"
        :x2="W"
        :y1="g"
        :y2="g"
        class="grid"
      />
      <path :d="area" class="area" />
      <polyline :points="line" class="line" />
      <polyline :points="dash" class="dash" />
      <circle :cx="dot[0]" :cy="dot[1]" r="7" class="halo" />
      <circle :cx="dot[0]" :cy="dot[1]" r="3.5" class="dot" />
    </svg>
    <div class="ticks">
      <span
        v-for="t in ticks"
        :key="t.label"
        :style="{ left: `${(t.x / W) * 100}%` }"
        >{{ t.label }}</span
      >
    </div>
  </section>
</template>

<script setup>
  import { hm } from "../utils"

  const props = defineProps({
    totals: { type: Object, required: true },
    trend: { type: Object, required: true },
    now: { type: Number, required: true }
  })

  const W = 326
  const H = 78

  const kpis = computed(() => [
    { label: "待诊", value: props.totals.waiting, color: "#3b82f6" },
    { label: "复诊", value: props.totals.recheck, color: "#a855f7" },
    { label: "过诊", value: props.totals.missed, color: "#f43f5e" },
    { label: "已诊", value: props.totals.done, color: "#231942" }
  ])

  // 坐标换算：横轴从实际曲线第一个点到预测最后一个点，纵轴 0 到最大值的 1.2 倍
  const scale = computed(() => {
    const all = [...props.trend.actual, ...props.trend.forecast]
    const t0 = all[0][0]
    const t1 = all[all.length - 1][0]
    const vmax = Math.max(...all.map((p) => p[1])) * 1.2 || 1
    return ([t, v]) => [((t - t0) / (t1 - t0)) * W, H - (v / vmax) * (H - 4)]
  })
  const pts = (list) =>
    list
      .map((p) =>
        scale
          .value(p)
          .map((v) => v.toFixed(1))
          .join(",")
      )
      .join(" ")
  const line = computed(() => pts(props.trend.actual))
  const dash = computed(() => pts(props.trend.forecast))
  const area = computed(() => {
    const p = props.trend.actual.map(scale.value)
    return `M${p[0][0]},${H} ${p.map((q) => `L${q[0]},${q[1]}`).join(" ")} L${p[p.length - 1][0]},${H} Z`
  })
  const dot = computed(() =>
    scale.value(props.trend.actual[props.trend.actual.length - 1])
  )
  const grid = [H * 0.05, H * 0.5, H - 0.5]

  // 横轴刻度：整点
  const ticks = computed(() => {
    const all = [...props.trend.actual, ...props.trend.forecast]
    const t0 = all[0][0]
    const t1 = all[all.length - 1][0]
    const out = []
    const d = new Date(t0)
    d.setMinutes(0, 0, 0)
    for (let t = d.getTime() + 3600e3; t < t1; t += 3600e3)
      out.push({ x: ((t - t0) / (t1 - t0)) * W, label: hm(t) })
    return out
  })
</script>

<style lang="scss" scoped>
  @use "../styles/candy" as *;

  .overview {
    @include card;
    position: absolute;
    left: 40px;
    top: 96px;
    width: 370px;
    height: 260px;
    padding: 14px 20px 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    .pill {
      @include pill;
    }
    em {
      font-style: normal;
      font-size: 13px;
      color: $faint;
    }
  }
  .kpis {
    display: flex;
    margin-top: 12px;
    div {
      width: 84px;
      display: flex;
      flex-direction: column;
    }
    b {
      font-family: $num;
      font-size: 38px;
      font-weight: normal;
      line-height: 1;
      small {
        margin-left: 3px;
        font-family: "Source Han Sans CN";
        font-size: 13px;
        color: $sub;
      }
    }
    span {
      margin-top: 5px;
      font-size: 14px;
      color: $sub;
    }
  }
  .chart-head {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    font-size: 13px;
    color: $sub;
    i {
      font-style: normal;
      font-size: 12px;
      color: $faint;
    }
  }
  .chart {
    display: block;
    width: 326px;
    height: 78px;
    margin-top: 4px;
    overflow: visible;
    .grid {
      stroke: $track;
      stroke-width: 1;
    }
    .area {
      fill: rgba(108, 92, 231, 0.18);
    }
    .line {
      fill: none;
      stroke: $brand;
      stroke-width: 2.4;
      stroke-linejoin: round;
    }
    .dash {
      fill: none;
      stroke: $faint;
      stroke-width: 1.6;
      stroke-dasharray: 5 5;
    }
    .halo {
      fill: rgba(108, 92, 231, 0.25);
    }
    .dot {
      fill: $brand;
    }
  }
  .ticks {
    position: relative;
    height: 16px;
    margin-top: 2px;
    span {
      position: absolute;
      transform: translateX(-50%);
      font-family: $num;
      font-size: 11px;
      color: $faint;
    }
  }
</style>
