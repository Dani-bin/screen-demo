<!-- 今日事件：五类计数 + 最近 6 条（点一条 = 镜头飞到事件位置） -->
<template>
  <div
    class="card"
    style="left: 1434px; top: 448px; width: 450px; height: 348px"
  >
    <div class="hd">
      <Icon name="list" /><span class="t">今日事件</span>
      <span class="s"
        >共
        <b class="num" style="color: var(--ink); font-weight: normal">{{
          snap.counts.total
        }}</b>
        件 · 5 类</span
      >
    </div>
    <div class="types">
      <div v-for="t in TYPES" :key="t.k" class="type">
        <Icon :name="t.ic" :size="16" />
        <div class="v">{{ snap.counts[t.k] }}</div>
        <div class="l">{{ t.n }}</div>
      </div>
    </div>
    <div
      v-for="e in snap.events.slice(0, 6)"
      :key="e.id"
      class="ev"
      style="cursor: pointer"
      @click="$emit('pick', e)"
    >
      <span class="tm">{{ e.at }}</span>
      <span class="tt"
        ><em>{{ e.zone }}</em
        >{{ e.title }}</span
      >
      <span class="chip" :class="CLS[e.status]">{{ e.statusText }}</span>
    </div>
  </div>
</template>

<script setup>
  import Icon from "./Icon.vue"

  defineProps({ snap: { type: Object, required: true } })
  defineEmits(["pick"])
  const TYPES = [
    { k: "PT", n: "周界入侵", ic: "fence" },
    { k: "TH", n: "热源异常", ic: "flame" },
    { k: "FP", n: "消防通道", ic: "car" },
    { k: "FC", n: "外立面", ic: "building" },
    { k: "SR", n: "走失搜寻", ic: "person" }
  ]
  const CLS = {
    pending: "warn",
    dispatched: "",
    processing: "gold",
    review: "gold",
    closed: "done",
    false: "stale"
  }
</script>
