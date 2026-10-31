<!--
  底部胶囊切换条：四个视图页签、一天的时间滑块（06:00–22:00）、自动导览开关、复位
  时间滑块：真正的 <input type="range"> 透明地盖在渐变轨道上，旋钮是画出来的，保证触屏好拖。
-->
<template>
  <nav class="shell bottom">
    <div class="core">
      <div class="tabs">
        <div
          v-for="t in TABS"
          :key="t.id"
          class="tab"
          :class="{ on: tab === t.id }"
          @click="$emit('tab', t.id)"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            v-html="t.icon"
          ></svg>
          {{ t.name }}
        </div>
      </div>
      <div class="time">
        <svg
          class="ic"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"
          />
        </svg>
        <div class="track" :style="{ '--p': pct + '%' }">
          <span
            v-for="h in [6, 10, 14, 18, 22]"
            :key="h"
            class="lb"
            :style="{ left: ((h - 6) / 16) * 100 + '%' }"
            >{{ String(h).padStart(2, "0") }}:00</span
          >
          <div class="knob"></div>
          <input
            type="range"
            min="6"
            max="22"
            step="0.25"
            :value="hour"
            aria-label="一天中的时刻"
            @input="$emit('time', +$event.target.value)"
          />
        </div>
        <svg
          class="ic"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
        </svg>
        <div class="read num">
          {{ time }}<small>{{ period }}</small>
        </div>
      </div>
      <div class="btn" :class="{ on: touring }" @click="$emit('tour')">
        <span>自动导览</span>
        <small>{{ touring ? "播放中" : stops + " 段" }}</small>
        <span class="dot">
          <svg
            v-if="!touring"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M5 3l8 5-8 5z" />
          </svg>
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4 3h3v10H4zM9 3h3v10H9z" />
          </svg>
        </span>
      </div>
      <div class="btn round" title="复位" @click="$emit('reset')">
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 11a7 7 0 107-7H7M7 4L4.5 6.5M7 4L4.5 1.5" />
        </svg>
      </div>
    </div>
  </nav>
</template>

<script setup>
  const props = defineProps({
    tab: { type: String, default: "overview" },
    hour: { type: Number, default: 18 },
    time: { type: String, default: "" },
    period: { type: String, default: "" },
    touring: { type: Boolean, default: false },
    stops: { type: Number, default: 8 }
  })
  defineEmits(["tab", "time", "tour", "reset"])

  const pct = computed(
    () => ((Math.min(22, Math.max(6, props.hour)) - 6) / 16) * 100
  )

  // 页签图标：总览（罗盘）、楼栋、配套（定位）、景观（叶子）
  const TABS = [
    {
      id: "overview",
      name: "总览",
      icon: '<circle cx="11" cy="11" r="8" /><path d="M14.5 7.5l-2 5-5 2 2-5z" />'
    },
    {
      id: "building",
      name: "楼栋",
      icon: '<rect x="5" y="3" width="9" height="16" rx="1" /><path d="M14 8h4v11h-4M8 7h3M8 11h3M8 15h3" />'
    },
    {
      id: "amenity",
      name: "配套",
      icon: '<path d="M11 19s6-5.2 6-10a6 6 0 00-12 0c0 4.8 6 10 6 10z" /><circle cx="11" cy="9" r="2.2" />'
    },
    {
      id: "scenic",
      name: "景观",
      icon: '<path d="M11 19v-6M11 13c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6zM11 13c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6z" />'
    }
  ]
</script>
