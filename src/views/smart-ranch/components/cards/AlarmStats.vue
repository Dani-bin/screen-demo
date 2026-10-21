<!-- 告警统计：今日按类型的环图 + 24 h 分布柱 + 最近两条 -->
<template>
  <Card title="告警统计" class="astats">
    <div class="ast">
      <Donut :parts="parts" :r="28" :w="10">
        <b class="dn-v">{{ events.length }}</b
        ><span class="dn-k">今日</span>
      </Donut>
      <ul class="ast-l">
        <li v-for="k in kinds" :key="k">
          <i :style="{ background: KIND_COLOR[k] }"></i>{{ KIND_NAME[k]
          }}<b>{{ cnt[k] }}</b>
        </li>
      </ul>
      <div class="ast-h">
        <i
          v-for="(n, h) in hours"
          :key="h"
          :class="{ fut: h > now }"
          :style="{ height: `${(n / max) * 100}%` }"
        ></i>
        <div class="ast-x">
          <span>0时</span><span>6</span><span>12</span><span>18</span
          ><span>24</span>
        </div>
      </div>
    </div>
    <ul class="events mini">
      <li
        v-for="e in events.slice(0, 2)"
        :key="e.id"
        :class="[`lv-${e.level}`, { done: e.stage === 'resolved' }]"
        @click="$emit('event', e)"
      >
        <i>{{ KIND_ICON[e.kind] }}</i
        ><span class="ev-t">{{ e.title }}</span
        ><span class="ev-o">{{ e.target }}</span
        ><span class="ev-h">{{ hm(e.start) }}</span
        ><span class="ev-s">{{ STAGE[e.stage] }}</span>
      </li>
    </ul>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import Donut from "../charts/Donut.vue"
  import { hm, KIND_COLOR, KIND_ICON, KIND_NAME, STAGE } from "../../utils.js"

  const props = defineProps({
    /** 今日已发生的事件（新的在前） */
    events: { type: Array, default: () => [] },
    now: { type: Number, default: 0 }
  })
  defineEmits(["event"])
  const kinds = ["fence", "stray", "water", "battery", "offline"]
  const cnt = computed(() =>
    Object.fromEntries(
      kinds.map((k) => [k, props.events.filter((e) => e.kind === k).length])
    )
  )
  const parts = computed(() =>
    kinds.map((k) => ({ v: cnt.value[k], c: KIND_COLOR[k] }))
  )
  const hours = computed(() =>
    Array.from(
      { length: 24 },
      (_, h) => props.events.filter((e) => Math.floor(e.start) === h).length
    )
  )
  const max = computed(() => Math.max(...hours.value, 1))
</script>
