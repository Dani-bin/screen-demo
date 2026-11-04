<!--
  底栏：隐私保护状态 + 五个剧情（点一个就跳过去播放）+ 自动导览 + 全天事件时间线（点一下跳到该时刻）+ 视角切换。
  互动要一眼看得出：剧情按钮带序号和播放标，当前剧情高亮；时间线上有播放头。
-->
<template>
  <div class="card bottombar">
    <div>
      <div class="hd" style="margin-bottom: 4px">
        <Icon name="shieldCheck" /><span class="t">隐私保护</span
        ><span class="s">已启用</span>
      </div>
      <div class="pill-row">
        <span class="chip gold">禁拍区 <b>3</b> 处</span>
        <span class="chip gold">画面脱敏 <b>开启</b></span>
        <span class="chip">飞行审批 <b>有效</b></span>
      </div>
    </div>
    <div>
      <div class="tour">
        <span
          v-for="(s, i) in STORIES"
          :key="s.key"
          class="chip"
          :class="{ on: activeStory === s.key }"
          style="cursor: pointer"
          @click="$emit('story', s.key)"
        >
          <Icon v-if="activeStory === s.key" name="play" :size="11" fill />
          <span v-else class="num" style="font-size: 12px">{{ i + 1 }}</span>
          {{ s.name }}
        </span>
        <span
          class="chip gold auto"
          style="cursor: pointer"
          @click="$emit('tour')"
        >
          <Icon :name="touring ? 'pause' : 'play'" :size="11" fill />
          {{ touring ? "导览中 · 点击停止" : "自动导览 · 45 s 无操作" }}
        </span>
      </div>
      <div ref="tlRef" class="tl" style="cursor: pointer" @click="onScrub">
        <div class="axis"></div>
        <div class="played" :style="{ width: x(snap.t) + 'px' }"></div>
        <div
          v-for="e in snap.events"
          :key="e.id"
          class="dot"
          :style="{
            left: x(mins(e.created)) + 'px',
            background: DOT[e.status],
            ...(e.type === 'SR'
              ? {
                  width: '16px',
                  height: '16px',
                  top: '6px',
                  boxShadow: '0 0 0 2px #ff5a5f'
                }
              : {})
          }"
        ></div>
        <span
          v-for="h in [0, 6, 12, 24]"
          :key="h"
          class="tk"
          :style="{ left: x(h * 60) + 'px' }"
          >{{ String(h).padStart(2, "0") }}:00</span
        >
        <div class="play" :style="{ left: x(snap.t) + 'px' }"></div>
        <span
          class="tk"
          :style="{ left: x(snap.t) + 'px', color: 'var(--gold-hi)' }"
          >{{ snap.clock }}</span
        >
      </div>
    </div>
    <div>
      <div class="hd" style="margin-bottom: 2px">
        <Icon name="eye" /><span class="t">视角</span
        ><span class="s">拖动画布环绕</span>
      </div>
      <div class="views">
        <span
          v-for="v in VIEWS"
          :key="v.key"
          class="chip"
          :class="{ on: view === v.key }"
          style="cursor: pointer"
          @click="$emit('view', v.key)"
          >{{ v.name }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ref } from "vue"
  import Icon from "./Icon.vue"
  import { STORIES } from "../sim/simulator.js"

  const props = defineProps({
    snap: { type: Object, required: true },
    activeStory: { type: String, default: null },
    touring: { type: Boolean, default: false },
    view: { type: String, default: "home" }
  })
  const emit = defineEmits(["story", "tour", "scrub", "view"])
  const tlRef = ref(null)
  const TLW = 932
  const x = (m) => (m / 1440) * TLW
  const mins = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
  const DOT = {
    pending: "#e8b04a",
    dispatched: "#f3ebdd",
    processing: "#ffd27a",
    review: "#c9a86a",
    closed: "#7d7364",
    false: "#4a4236"
  }
  const VIEWS = [
    { key: "home", name: "俯瞰沙盘" },
    { key: "UAV-01", name: "跟随 UAV-01" },
    { key: "UAV-03", name: "跟随 UAV-03" },
    { key: "hangar", name: "机库" }
  ]
  /** 点时间线：按点击位置换算成当天的分钟（舞台有缩放，用元素自己的矩形算比例） */
  function onScrub(e) {
    const r = tlRef.value.getBoundingClientRect()
    emit(
      "scrub",
      Math.max(0, Math.min(1439, ((e.clientX - r.left) / r.width) * 1440))
    )
  }
  void props
</script>
