<!--
  CTRL 场景控制台：六个视角按钮 + 自动导览开关（设计稿 #c-console 的移植）
  视角按钮 = scene.focus(视角)，当前视角高亮；自动导览开关 = scene.setTour，右边是「下一站」和本站剩余秒数
  （场景回调 onTour 时听场景的，没有回调就由 board 兜底循环显示）。无操作 45 秒自动开启导览，任何点击会暂停并重新计时。
-->
<template>
  <section class="card c-console">
    <h3 style="margin-bottom: 6px">
      <i>CTRL</i>场景控制台<em>点选切换视角 · 拖动画布环绕</em>
    </h3>
    <div class="btns">
      <button
        v-for="b in VIEW_BUTTONS"
        :key="b.key"
        type="button"
        class="btn"
        :class="{ on: activeView === b.key }"
        @click="focus(b.key)"
      >
        {{ b.name }}
      </button>
    </div>
    <div class="tour">
      <button
        type="button"
        class="tour-toggle"
        :class="{ off: !tour.on }"
        :title="tour.on ? '点击暂停自动导览' : '点击开启自动导览'"
        @click="toggleTour"
      >
        <span class="sw"></span
        ><span v-if="tour.on"
          >自动导览 · 下一站 {{ VIEW_NAME[tour.next] }}
          <span class="num" style="color: var(--ink)"
            >{{ tour.left }} s</span
          ></span
        ><span v-else>自动导览 · 点此开启</span>
      </button>
      <span class="bar"
        ><i
          :style="{
            width: pct + '%',
            background: 'var(--neon-cyan)',
            transition: 'width 1s linear'
          }"
        ></i
      ></span>
    </div>
  </section>
</template>

<script setup>
  import { VIEW_BUTTONS, VIEW_NAME } from "../store/board.js"

  const { activeView, focus, tour, toggleTour } = inject("board")
  // 本站已停留的比例
  const pct = computed(() =>
    tour.on && tour.dwell > 0
      ? Math.min(100, Math.max(0, (1 - tour.left / tour.dwell) * 100))
      : 0
  )
</script>
