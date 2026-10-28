<!-- 告警与事件：今日按类型统计（一行小标签）+ 最新告警（待处置的带 定位 / 派单 按钮） -->
<template>
  <Panel title="告警与事件" en="ALERTS" fill>
    <template #tools
      ><a class="pn-tool sel" title="切换筛选" @click="filter = FILTERS[filter]"
        >{{ filter }} ▾</a
      ></template
    >
    <div class="ev-chips">
      <em>今日 {{ today.length }} 条</em>
      <span v-for="[k, n] in kinds" :key="k"
        >{{ KIND_CN[k] || k }}<b>{{ n }}</b></span
      >
    </div>
    <div
      v-for="e in list.slice(0, limit)"
      :key="e.id"
      class="ev"
      :class="[e.level, e.status]"
      @click="$emit('event', e)"
    >
      <i class="ev-ic" v-html="ICON.alert"></i>
      <div class="ev-m">
        <div>
          <b>{{ e.title }}</b
          ><span class="code">{{ e.target }}</span>
        </div>
        <span>{{ e.desc }}</span>
      </div>
      <div class="ev-s">
        <em :class="`st-${e.status}`">{{ EV_STATUS[e.status] }}</em
        ><span>{{ hm(e.at) }}</span>
        <div v-if="e.status === 'pending'" class="ev-btn">
          <a @click.stop="$emit('event', e)">定位</a
          ><a class="pri" @click.stop="$emit('dispatch', e)">派单</a>
        </div>
      </div>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { EV_STATUS, ICON, KIND_CN, hm } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    limit: { type: Number, default: 4 }
  })
  defineEmits(["event", "dispatch"])
  const today = computed(() =>
    props.state.events.filter((e) => e.at >= props.state.clock.dayStart)
  )
  /** 列表筛选：全部 → 未结束 → 重要，点标题栏的下拉切换 */
  const FILTERS = { 全部: "未结束", 未结束: "重要", 重要: "全部" }
  const filter = ref("全部")
  const list = computed(() =>
    props.state.events.filter((e) =>
      filter.value === "未结束"
        ? e.status !== "resolved"
        : filter.value === "重要"
          ? e.level === "major"
          : true
    )
  )
  const kinds = computed(() => {
    const by = {}
    for (const e of today.value) by[e.kind] = (by[e.kind] || 0) + 1
    return Object.entries(by).sort((a, b) => b[1] - a[1])
  })
</script>
