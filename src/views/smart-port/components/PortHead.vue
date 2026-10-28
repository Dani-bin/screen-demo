<!-- 顶栏：标志 + 标题、功能导航、搜索、风速 / 潮位、时钟 -->
<template>
  <header class="hd">
    <div class="hd-l">
      <div class="logo" v-html="ICON.logo"></div>
      <div class="hd-title">
        <h1>洋山四期 · 智慧港口数字孪生</h1>
        <p>YANGSHAN PHASE IV · AUTOMATED CONTAINER TERMINAL · DIGITAL TWIN</p>
      </div>
    </div>
    <nav class="hd-nav">
      <a
        v-for="n in NAV"
        :key="n.key"
        :class="{ on: n.key === tab }"
        @click="$emit('tab', n.key)"
        >{{ n.name }}</a
      >
    </nav>
    <div class="hd-r">
      <label class="search">
        <i v-html="ICON.search"></i>
        <input
          v-model="q"
          placeholder="搜索船名 / 设备编号 / 箱区"
          @keydown.enter="$emit('search', q.trim())"
        />
      </label>
      <div class="hd-met">
        <i v-html="ICON.wind"></i><b>{{ fmt(m.wind, 1) }}</b
        ><i class="u">m/s</i
        ><em>{{ dirName(m.dir) }}风 · 阵风 {{ fmt(m.gust, 1) }}</em>
      </div>
      <div class="hd-met">
        <i v-html="ICON.tide"></i><b>{{ fmt(m.tide, 2) }}</b
        ><i class="u">m</i><em>潮位</em>
      </div>
      <div class="hd-clock">
        <b>{{ state.clock.hms }}</b>
        <span>{{ state.clock.date }} {{ state.clock.week }}</span>
      </div>
      <div class="hd-user" v-html="ICON.user"></div>
    </div>
  </header>
</template>

<script setup>
  import { ICON, dirName, fmt } from "../utils.js"

  const props = defineProps({
    state: { type: Object, required: true },
    tab: { type: String, default: "overview" }
  })
  defineEmits(["tab", "search"])
  /** 功能导航：每一项对应一个镜头 / 图层组合（index.vue 的 TABS） */
  const NAV = [
    { key: "overview", name: "综合态势" },
    { key: "vessel", name: "船舶作业" },
    { key: "equip", name: "设备协同" },
    { key: "yard", name: "堆场闸口" },
    { key: "alarm", name: "安全告警" }
  ]
  const q = ref("")
  const m = computed(() => props.state.met)
</script>
