<!--
  无人机视角：可见光 / 红外两个小窗。画面不是这里画的——场景（CommunityScene.renderPov）用第二个相机把沙盘
  直接渲染进画布上这两块的位置，红外窗再过一遍"亮度 → 热像调色板"的着色器；这里只放窗框、HUD、识别框、打码块。
  识别框的位置由场景每帧算出来（目标投影到视角相机里），经 setBox 摆放。
-->
<template>
  <div v-show="info" class="povs no-pointer">
    <div ref="visRef" class="pov vis" style="left: 500px; top: 790px">
      <div class="hud">
        <i class="rec"></i><span>{{ info?.id }} · 可见光</span
        ><span class="r">4K · 12 FPS</span>
      </div>
      <div v-if="box.vis" class="box" :style="boxStyle(box.vis)">
        <span>{{ box.label }}</span>
      </div>
      <div class="mosaic" style="left: 214px; top: 120px"></div>
      <div class="badge">
        <Icon name="shield" :size="12" style="stroke: var(--gold-hi)" />已脱敏 ·
        车牌 / 人脸
      </div>
    </div>
    <div ref="irRef" class="pov ir" style="left: 1140px; top: 790px">
      <div class="hud">
        <i class="rec"></i><span>{{ info?.id }} · 红外</span
        ><span class="r">640×512</span>
      </div>
      <div
        v-if="box.ir"
        class="box"
        :style="{ ...boxStyle(box.ir), borderColor: '#ffd27a' }"
      >
        <span style="background: rgba(255, 210, 122, 0.95)">{{
          box.temp
        }}</span>
      </div>
      <div class="scale"></div>
      <span class="sc-l" style="top: 26px">40℃</span>
      <span class="sc-l" style="bottom: 24px">10℃</span>
      <div class="badge">
        <Icon name="shield" :size="12" style="stroke: var(--gold-hi)" />{{
          box.ir ? box.note : "红外巡航"
        }}
      </div>
    </div>
  </div>
</template>

<script setup>
  import { reactive, ref } from "vue"
  import Icon from "./Icon.vue"

  const visRef = ref(null)
  const irRef = ref(null)
  const info = ref(null) // { id }：当前取景的无人机，null = 都在机库，整块隐藏
  const box = reactive({
    vis: null,
    ir: null,
    label: "",
    temp: "",
    note: ""
  })

  /** 识别框：中心 + 大小（占窗口宽度的比例），从场景每帧传进来 */
  const boxStyle = (b) => ({
    left: `${b.x * 100}%`,
    top: `${b.y * 100}%`,
    width: `${b.w * 100}%`,
    height: `${b.h * 100}%`,
    transform: "translate(-50%, -50%)"
  })

  function set(state) {
    info.value = state.id ? { id: state.id } : null
    box.vis = state.vis ?? null
    box.ir = state.ir ?? null
    box.label = state.label ?? ""
    box.temp = state.temp ?? ""
    box.note = state.note ?? ""
  }
  defineExpose({ visRef, irRef, set })
</script>
