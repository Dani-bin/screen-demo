<!-- 工单闭环：待确认 → 已派单 → 处置中 → 待复核 → 已办结，另有误报；处置率 = (已办结 + 误报) / 总数 -->
<template>
  <div
    class="card"
    style="left: 1434px; top: 808px; width: 450px; height: 144px"
  >
    <div class="hd">
      <Icon name="flow" /><span class="t">工单闭环</span>
      <span class="s"
        >处置率
        <b class="num" style="color: var(--gold-hi); font-weight: normal"
          >{{ (snap.doneRate * 100).toFixed(1) }}%</b
        >（已办结 + 误报）</span
      >
    </div>
    <div class="flow">
      <template v-for="(f, i) in FLOW" :key="f.k">
        <span v-if="i" class="ar">›</span>
        <div class="n">
          <div class="v" :style="{ color: f.c }">{{ snap.counts[f.k] }}</div>
          <div class="l">{{ f.l }}</div>
        </div>
      </template>
      <span class="ar" style="margin: 0 2px">|</span>
      <div class="n">
        <div class="v" style="color: var(--stale)">{{ snap.counts.false }}</div>
        <div class="l">误报</div>
      </div>
    </div>
    <div class="stack">
      <i
        v-for="s in STACK"
        :key="s.k"
        :style="{ flex: snap.counts[s.k], background: s.c }"
      ></i>
    </div>
  </div>
</template>

<script setup>
  import Icon from "./Icon.vue"

  defineProps({ snap: { type: Object, required: true } })
  const FLOW = [
    { k: "pending", l: "待确认", c: "var(--warn)" },
    { k: "dispatched", l: "已派单", c: "var(--ink)" },
    { k: "processing", l: "处置中", c: "var(--gold-hi)" },
    { k: "review", l: "待复核", c: "var(--gold)" },
    { k: "closed", l: "已办结", c: "var(--done)" }
  ]
  const STACK = [
    { k: "pending", c: "#e8b04a" },
    { k: "dispatched", c: "#f3ebdd" },
    { k: "processing", c: "#ffd27a" },
    { k: "review", c: "#c9a86a" },
    { k: "closed", c: "#7d7364" },
    { k: "false", c: "#4a4236" }
  ]
</script>
