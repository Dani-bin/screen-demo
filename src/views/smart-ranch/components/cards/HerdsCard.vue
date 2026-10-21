<!-- 畜群动态：10 个畜群的头数、所在分区、状态、今日行走、在线项圈；点一行飞到畜群 -->
<template>
  <Card title="畜群动态" hint="羊按群（头羊项圈）· 牛到单头" class="herds-card">
    <table class="herds">
      <thead>
        <tr>
          <th>畜群</th>
          <th>头数</th>
          <th>分区</th>
          <th>状态</th>
          <th>今日行走</th>
          <th>在线</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="h in state.herds"
          :key="h.id"
          :class="{ sel: h.id === selected }"
          @click="$emit('herd', h.id)"
        >
          <td><i class="hk" :class="h.kind"></i>{{ h.id }}</td>
          <td>{{ fmt(h.head) }}</td>
          <td>{{ h.paddock }}</td>
          <td>
            <em class="act" :class="h.activity">{{ ACT[h.activity] }}</em>
          </td>
          <td>{{ h.walkKm.toFixed(1) }} km</td>
          <td>{{ online(h) }}</td>
        </tr>
      </tbody>
    </table>
  </Card>
</template>

<script setup>
  import Card from "../Card.vue"
  import { ACT, fmt } from "../../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    selected: { type: String, default: "" }
  })
  defineEmits(["herd"])
  const online = (h) => {
    const n = h.kind === "sheep" ? 3 : h.head
    const off = props.state.collars.stale.filter((c) => c.herd === h.id).length
    return `${n - off}/${n}`
  }
</script>
