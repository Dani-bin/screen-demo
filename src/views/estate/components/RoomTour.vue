<!--
  样板间 VR 看房：点楼栋「进入样板间」后盖满窗口的浮层，里面内嵌官方 VR 看房页（见 data/room.js）。
  浮层在舞台之外（直接盖整个窗口），VR 页面能用满窗口；顶部一条细栏：楼栋名 / 说明 / 新窗口打开 / 关闭。
  - iframe 加 sandbox（只放开脚本、同源、弹窗、表单），第三方页面不能导航本页；allow 放开全屏和陀螺仪（手机 / 平板转动看房）。
  - 加载中显示进度提示；12 秒还没触发 load 就提示"可以在新窗口打开"（跨域 iframe 读不到失败原因，只能靠超时）。
  - Esc 或点遮罩外面关闭；打开期间页面把三维冻结（场景不再渲染，省 GPU），关闭后恢复。
-->
<template>
  <div class="room-overlay" @pointerdown.self="$emit('close')">
    <div class="shell room-shell">
      <div class="core room-core">
        <header class="room-head">
          <div class="room-title">
            <span class="eyebrow"
              >{{ b ? b.kindName : "样板间" }} · 样板间</span
            >
            <h2>{{ b ? b.name : "" }} · {{ tour.title }}</h2>
            <p>{{ tour.desc }}</p>
          </div>
          <div class="acts">
            <a
              class="iconbtn"
              :href="tour.url"
              target="_blank"
              rel="noopener noreferrer"
              title="在新窗口打开"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M9.5 2.5h4v4M13.5 2.5l-6 6M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4"
                />
              </svg>
            </a>
            <span
              class="iconbtn"
              title="退出样板间（Esc）"
              @click="$emit('close')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              >
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </span>
          </div>
        </header>
        <div class="room-view">
          <iframe
            :src="tour.url"
            title="样板间 VR 看房"
            allow="fullscreen; gyroscope; accelerometer; xr-spatial-tracking"
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerpolicy="no-referrer"
            @load="loaded = true"
          ></iframe>
          <div v-if="!loaded" class="room-wait">
            <i></i>
            <b>正在进入样板间…</b>
            <small v-if="slow"
              >加载较慢——也可以点右上角「新窗口打开」直接看</small
            >
          </div>
        </div>
        <footer class="room-foot">{{ tour.credit }}</footer>
      </div>
    </div>
  </div>
</template>

<script setup>
  import { ROOM_TOUR } from "../data/room.js"

  defineProps({
    // 当前选中的楼栋（布局里的一行），用来写标题；没有就只写"样板间"
    b: { type: Object, default: null }
  })
  const emit = defineEmits(["close"])

  // ?roomUrl=<链接> 临时换一个 VR 页面（只认 https）
  const q = new URLSearchParams(location.hash.split("?")[1] || "")
  const custom = q.get("roomUrl")
  const tour = {
    ...ROOM_TOUR,
    url: custom && /^https:\/\//.test(custom) ? custom : ROOM_TOUR.url
  }

  const loaded = ref(false)
  const slow = ref(false)
  let slowTimer = 0

  function onKey(e) {
    if (e.key === "Escape") emit("close")
  }

  onMounted(() => {
    window.addEventListener("keydown", onKey)
    slowTimer = setTimeout(() => (slow.value = true), 12000)
  })
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKey)
    clearTimeout(slowTimer)
  })
</script>
