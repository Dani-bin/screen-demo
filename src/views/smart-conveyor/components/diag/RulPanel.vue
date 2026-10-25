<!--
  D3 剩余寿命：放任不管时还能运行多少天（置信区间），以及"计划消缺"比"失效"提前多少 ——
  对照集控：集控只在失效那一刻（卡死 → 超温 / 烟雾保护）跳闸
-->
<template>
  <Panel no="D3" title="剩余寿命" en="RUL · REMAINING USEFUL LIFE">
    <template v-if="tr">
      <div class="rl">
        <div class="rl-big">
          <b>{{ fmt(rul.days, 1) }}</b
          ><span>天</span>
          <em>置信区间 {{ fmt(rul.lo, 1) }}–{{ fmt(rul.hi, 1) }} 天</em>
        </div>
        <div class="rl-bar">
          <div class="rl-track">
            <i
              class="ci"
              :style="{
                left: `${k(rul.lo)}%`,
                width: `${k(rul.hi) - k(rul.lo)}%`
              }"
            ></i>
            <u class="fix" :style="{ left: `${k(fixDays)}%` }"
              ><span>计划消缺</span></u
            >
            <u class="fail" :style="{ left: `${k(rul.days)}%` }"
              ><span>预计失效</span></u
            >
          </div>
          <div class="rl-ax">
            <span>现在</span><span>{{ fmt(maxD, 0) }} 天</span>
          </div>
        </div>
      </div>
      <p class="rl-note">
        <Ic name="bolt" />计划消缺比预计失效早
        <b>{{ fmt(rul.margin, 1) }}</b> 天 · 集控只能在失效时跳闸停车
      </p>
    </template>
    <p v-else class="none">选择劣化设备</p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt } from "../ui.js"
  import { rulOf } from "../../store/diag.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true },
    tr: { type: Object, default: null }
  })
  const DAY = 24 * 3600000
  const rul = computed(() => rulOf(props.tr, props.f.ms))
  const fixDays = computed(() => {
    const wo = props.w.tonight.find((x) => x.track === props.tr.id)
    return Math.max(0, ((wo ? wo.start : props.tr.tFix) - props.f.ms) / DAY)
  })
  const maxD = computed(() => Math.max(1, rul.value.hi * 1.15))
  const k = (d) => Math.min(100, (d / maxD.value) * 100)
</script>
