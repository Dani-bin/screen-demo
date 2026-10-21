<!-- 存栏结构：羊（母羊 / 公羊 / 育成 / 羔羊）、牛（母牛 / 公牛 / 育肥 / 犊牛），合计从各群明细加出来 -->
<template>
  <Card
    title="存栏结构"
    :hint="`冬羔配种 ${fmt(breed.done)} / ${fmt(breed.total)} 只母羊`"
    class="stock"
  >
    <div v-for="g in groups" :key="g.k" class="stk">
      <span class="stk-k">{{ g.k }}</span>
      <div class="stk-bar">
        <i
          v-for="p in g.parts"
          :key="p.n"
          :style="{ flex: p.v, background: p.c }"
          :title="p.n"
        ></i>
      </div>
      <div class="stk-l">
        <span v-for="p in g.parts" :key="p.n"
          ><b :style="{ background: p.c }"></b>{{ p.n }}
          <em>{{ fmt(p.v) }}</em></span
        >
        <span class="tot">{{ fmt(g.parts.reduce((a, p) => a + p.v, 0)) }}</span>
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import { fmt } from "../../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  const breed = computed(() => props.state.ops.find((o) => o.id === "breed"))
  const groups = computed(() => {
    const s = props.state.stock
    return [
      {
        k: "羊",
        parts: [
          { n: "基础母羊", v: s.sheep.ewe, c: "#2f8f4e" },
          { n: "种公羊", v: s.sheep.ram, c: "#1f3a2b" },
          { n: "育成羊", v: s.sheep.young, c: "#7fbf7a" },
          { n: "当年羔羊", v: s.sheep.lamb, c: "#c9e3b5" }
        ]
      },
      {
        k: "牛",
        parts: [
          { n: "基础母牛", v: s.cattle.cow, c: "#8a5a3a" },
          { n: "种公牛", v: s.cattle.bull, c: "#4a2f1f" },
          { n: "育肥牛", v: s.cattle.steer, c: "#c08a5a" },
          { n: "犊牛", v: s.cattle.calf, c: "#e8c9a6" }
        ]
      }
    ]
  })
</script>
