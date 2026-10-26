<!-- 01 生产概况：日计划完成率环 + 今日 / 本班产量 + 两个工作面 -->
<template>
  <Panel no="01" title="生产概况" en="PRODUCTION">
    <div class="prod">
      <div class="prod-ring">
        <svg
          class="ring"
          :style="ringSize"
          :viewBox="`0 0 ${R.size} ${R.size}`"
        >
          <circle
            :cx="R.size / 2"
            :cy="R.size / 2"
            :r="R.r"
            stroke="var(--hair)"
            :stroke-width="R.w"
          />
          <circle
            :cx="R.size / 2"
            :cy="R.size / 2"
            :r="R.r"
            stroke="var(--coal)"
            :stroke-width="R.w"
            stroke-linecap="butt"
            :stroke-dasharray="`${R.c * Math.min(1, done)} ${R.c}`"
            :transform="`rotate(-90 ${R.size / 2} ${R.size / 2})`"
            style="filter: drop-shadow(0 0 4px var(--coal))"
          />
        </svg>
        <div>
          <b>{{ pct(done, 1) }}</b
          ><span>日计划完成</span>
        </div>
      </div>
      <dl class="prod-kv">
        <div>
          <dt>今日产量</dt>
          <dd class="coal">{{ fmt(k.outputToday) }}<i>t</i></dd>
        </div>
        <div>
          <dt>本班产量（{{ shiftFrom }} 起）</dt>
          <dd>{{ fmt(w.shiftTons) }}<i>t</i></dd>
        </div>
        <div>
          <dt>综采今日刀数</dt>
          <dd>{{ a.cutsToday }}<i>刀</i></dd>
        </div>
        <div>
          <dt>库存煤（3 个煤仓）</dt>
          <dd>{{ fmt(k.inventory) }}<i>t</i></dd>
        </div>
      </dl>
    </div>
    <div class="faces">
      <div class="face">
        <b>WF12301</b><span>综采面</span
        ><em class="ph" :class="{ dim: a.output < 1 }">{{ PHASE[a.phase] }}</em
        ><strong>{{ fmt(a.output) }}<i>t/h</i></strong>
      </div>
      <div class="face">
        <b>WF12305</b><span>掘进面</span
        ><em class="ph" :class="{ dim: b.output < 1 }">{{ PHASE[b.phase] }}</em
        ><strong>{{ fmt(b.output) }}<i>t/h</i></strong>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt, pct, rem } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  /** 工作面工序名 */
  const PHASE = {
    sump: "斜切进刀",
    cut: "割煤",
    end: "端头作业",
    stop: "停机",
    idle: "未生产",
    support: "支护"
  }
  // 环：半径 34、线宽 6（设计稿 px）
  const R = { r: 34, w: 6, size: 80, c: 2 * Math.PI * 34 }
  const ringSize = { width: rem(R.size), height: rem(R.size) }

  const k = computed(() => props.f.s.kpi)
  const a = computed(() => props.f.s.faces.WF12301)
  const b = computed(() => props.f.s.faces.WF12305)
  const done = computed(() => k.value.outputToday / props.f.planDay)
  const shiftFrom = computed(
    () => `${String(props.f.shift.start).padStart(2, "0")}:00`
  )
</script>
