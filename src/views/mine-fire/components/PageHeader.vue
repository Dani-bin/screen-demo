<!-- 顶栏：剧本时钟、井下人数、六个页签、标题、通讯 / 在线率 / 火警（定稿 v1.js header()） -->
<template>
  <header class="hd">
    <div class="hd-side l">
      <div class="hd-clock">
        <b>{{ st.hms }}</b>
        <span>{{ st.date.date }} {{ st.date.week }} · {{ st.date.shift }}</span>
      </div>
      <div class="hd-met">
        <Ic name="users" /><b>{{ st.people.underground }}</b
        ><i>井下在岗</i>
      </div>
    </div>
    <nav class="hd-nav l">
      <a
        v-for="t in TABS.slice(0, 3)"
        :key="t.key"
        :class="{
          on: tab === t.key,
          alert: t.key === 'fire' && fireOn && tab !== t.key
        }"
        @click="$emit('tab', t.key)"
        ><span>{{ t.name }}</span></a
      >
    </nav>
    <div class="hd-title">
      <h1>矿用区域智能防灭火与应急避灾平台</h1>
      <p>青崖煤矿 · 2# 煤层 · 井下硐室全氟己酮自动灭火</p>
    </div>
    <nav class="hd-nav">
      <a
        v-for="t in TABS.slice(3)"
        :key="t.key"
        :class="{ on: tab === t.key }"
        @click="$emit('tab', t.key)"
        ><span>{{ t.name }}</span></a
      >
    </nav>
    <div class="hd-side r">
      <div class="sys">
        <span class="chip"
          ><Ic name="signal" :size="14" style="color: var(--ok)" />通讯
          <b>{{ st.kpi.chambers }}/{{ st.kpi.chambers }}</b></span
        >
        <span class="chip"
          >在线率 <b>{{ st.kpi.onlineRate.toFixed(1) }}%</b></span
        >
        <span class="chip" :class="{ fire: fireOn }"
          ><i class="dot"></i>火警 <b>{{ fireOn ? 1 : 0 }}</b></span
        >
      </div>
    </div>
  </header>
</template>

<script setup>
  import Ic from "./Ic.vue"

  const props = defineProps({ st: Object, tab: String })
  defineEmits(["tab"])

  // 页签：每个页签对应一个默认三维焦点（见 index.vue 的 onTab）
  const TABS = [
    { key: "overview", name: "综合态势" },
    { key: "chambers", name: "硐室防护" },
    { key: "fire", name: "火情联动" },
    { key: "routes", name: "避灾路线" },
    { key: "ops", name: "设备运维" },
    { key: "replay", name: "历史回放" }
  ]
  // 火警进行中：确认后到现场复位前
  const fireOn = computed(() =>
    ["countdown", "sprayed"].includes(props.st.phase)
  )
</script>
