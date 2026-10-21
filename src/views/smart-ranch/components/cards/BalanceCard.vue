<!-- 草畜平衡：全场指数仪表 + 实际 / 合理载畜量 + 10 个单元的对比条（超过 10% 标红） -->
<template>
  <Card
    title="草畜平衡"
    hint="1 牛 = 5 羊单位 · 日食干草 1.8 kg"
    class="balance"
  >
    <div class="bal2">
      <div class="bal-g">
        <Gauge :value="r.balance" />
        <div class="bal-v">
          <b>{{ sign(r.balance) }}%</b><span>草畜平衡指数</span>
        </div>
      </div>
      <div class="bal-n">
        <div>
          <span>实际载畜</span><b>{{ fmt(r.su) }}</b
          ><small>羊单位</small>
        </div>
        <div>
          <span>合理载畜</span><b>{{ fmt(r.capacity) }}</b
          ><small>羊单位</small>
        </div>
        <div>
          <span>超载单元</span><b class="badv">{{ over }}</b
          ><small>个 · &gt; 10%</small>
        </div>
      </div>
    </div>
    <div class="ubars">
      <div
        v-for="u in state.units"
        :key="u.id"
        class="ub-row"
        :class="{ over: u.balance > 10 }"
        @click="$emit('unit', u.id)"
      >
        <span class="ub-id">{{ u.id }}</span>
        <span class="ub-track">
          <i
            class="ub-cap"
            :style="{ width: `${(u.capacity / max) * 100}%` }"
          ></i>
          <i class="ub-su" :style="{ width: `${(u.su / max) * 100}%` }"></i>
        </span>
        <span class="ub-val">{{ sign(u.balance) }}%</span>
      </div>
    </div>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import Gauge from "../charts/Gauge.vue"
  import { fmt, sign } from "../../utils.js"

  const props = defineProps({ state: { type: Object, required: true } })
  defineEmits(["unit"])
  const r = computed(() => props.state.ranch)
  const over = computed(
    () => props.state.units.filter((u) => u.balance > 10).length
  )
  const max = computed(
    () =>
      Math.max(...props.state.units.map((u) => Math.max(u.su, u.capacity))) *
      1.05
  )
</script>
