<!--
  学校三维可视化介绍页
  ----------------------------------------------------------
  页面只负责布局、取数与事件转接；三维逻辑全部在 ./scene 下，
  不含任何 Vue 依赖，可独立调试。

  与应急指挥各页面完全独立：不复用 Head.vue，两套业务互不影响。
-->
<template>
  <div ref="pageRef" class="school-page">
    <!-- 三维校园场景：铺满整页，所有面板浮于其上 -->
    <canvas ref="canvasRef" class="school-canvas"></canvas>

    <div v-if="loading" class="scene-loading">校园场景构建中</div>

    <SchoolHead :info="info" :playing="playing" />

    <div class="col-left">
      <IntroPanel :info="info" />
      <ScalePanel :metrics="metrics" />
    </div>

    <div class="col-right">
      <LandmarkPanel
        v-if="currentLandmark"
        :landmark="currentLandmark"
        :index="current"
      />
    </div>

    <TourProgress
      :landmarks="landmarks"
      :current="current"
      @select="handleSelectStop"
    />

    <div class="source-note">{{ sourceNote }}</div>

    <div class="operate-hint">
      拖动旋转 · 滚轮缩放 · 点击建筑查看<br />
      操作后暂停巡览，<em>15s</em> 无操作自动恢复
    </div>
  </div>
</template>

<script setup>
  import SchoolHead from "./components/SchoolHead.vue"
  import IntroPanel from "./components/IntroPanel.vue"
  import ScalePanel from "./components/ScalePanel.vue"
  import LandmarkPanel from "./components/LandmarkPanel.vue"
  import TourProgress from "./components/TourProgress.vue"
  import { SchoolScene } from "./scene/SchoolScene"
  import { fetchSchoolData } from "./data/schoolData"

  const pageRef = ref(null)
  const canvasRef = ref(null)

  const loading = ref(true)
  const info = ref({ name: "", subTitle: "", paragraphs: [], motto: "" })
  const metrics = ref([])
  const landmarks = ref([])
  const sourceNote = ref("")

  /** 当前停靠的地标索引 */
  const current = ref(0)
  /** 是否处于自动巡览状态 */
  const playing = ref(true)

  const currentLandmark = computed(() => landmarks.value[current.value] || null)

  /** 三维场景实例，不做成响应式：内部持有大量 WebGL 对象，无需被 Vue 代理 */
  let scene = null

  /** 点击底部导览栏，飞往指定地标 */
  const handleSelectStop = (index) => {
    if (scene) scene.gotoStop(index)
  }

  onMounted(async () => {
    const data = await fetchSchoolData()
    info.value = data.info
    metrics.value = data.metrics
    landmarks.value = data.landmarks
    sourceNote.value = data.sourceNote

    // 等面板渲染完成、容器尺寸确定后再创建场景，避免首帧按 0 尺寸初始化
    await nextTick()

    scene = new SchoolScene({
      canvas: canvasRef.value,
      container: pageRef.value,
      landmarks: data.landmarks,
      onStopChange: (index) => {
        current.value = index
      },
      onPlayingChange: (value) => {
        playing.value = value
      }
    })

    // 首帧渲染完成后再撤掉加载提示
    requestAnimationFrame(() => {
      loading.value = false
    })
  })

  onUnmounted(() => {
    if (scene) {
      scene.dispose()
      scene = null
    }
  })
</script>

<style lang="scss" scoped>
  .school-page {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #cbddea;

    /* 配色取自学校实拍照片：红砖 / 线脚白 / 屋顶灰蓝 */
    --school-brick: #a6503c;
    --school-brick-deep: #8c3f2e;
    --school-trim: #f7f3ec;
    --school-turf: #5e8f4e;
    --school-ink: #23282e;
    --school-ink-soft: #5c6570;
    --school-ink-faint: #8a929b;
    --school-panel: rgba(255, 253, 249, 0.86);
    --school-panel-edge: rgba(166, 80, 60, 0.22);
    --school-rule: rgba(35, 40, 46, 0.12);
    --school-chip-infer: #b8791f;
  }

  .school-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .scene-loading {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #dce9f0;
    font-size: 16px;
    letter-spacing: 3px;
    color: var(--school-brick);
  }

  .col-left,
  .col-right {
    position: absolute;
    top: 88px;
    z-index: 4;
    width: 420px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .col-left {
    left: 28px;
  }

  .col-right {
    right: 28px;
  }

  .source-note {
    position: absolute;
    bottom: 30px;
    left: 28px;
    z-index: 4;
    max-width: 420px;
    padding: 8px 12px;
    border-radius: 2px;
    background: rgba(255, 253, 249, 0.62);
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--school-ink-faint);
  }

  .operate-hint {
    position: absolute;
    bottom: 30px;
    right: 28px;
    z-index: 4;
    padding: 8px 12px;
    border-radius: 2px;
    background: rgba(255, 253, 249, 0.62);
    font-size: 12px;
    line-height: 1.8;
    text-align: right;
    color: var(--school-ink-soft);

    em {
      padding: 1px 5px;
      margin: 0 2px;
      border-radius: 2px;
      background: rgba(35, 40, 46, 0.08);
      font-style: normal;
      font-family: "DIN", sans-serif;
    }
  }
</style>

<!--
  面板外观为页面级共享样式，不加 scoped：
  子组件内部的 .panel-title 等元素拿不到父组件的 scoped 属性，
  因此统一挂在 .school-page 下，既能命中子组件内部，又不会泄漏到全局。
-->
<style lang="scss">
  .school-page {
    .panel {
      padding: 17px 19px;
      border: 1px solid var(--school-panel-edge);
      border-radius: 3px;
      background: var(--school-panel);
      backdrop-filter: blur(10px) saturate(1.1);
      box-shadow: 0 8px 28px rgba(35, 40, 46, 0.13);
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 14px;
      font-size: 19px;
      font-weight: 600;
      color: var(--school-brick-deep);

      &::before {
        content: "";
        flex: none;
        width: 3px;
        height: 17px;
        background: var(--school-brick);
      }
    }

    .title-en {
      margin-left: auto;
      font-family: "DIN", sans-serif;
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--school-ink-faint);
    }

    /* 数字统一用项目自带的 DIN，保证各面板数字观感一致 */
    .metric-value,
    .head-clock,
    .landmark-no,
    .stop-idx {
      font-family: "DIN", sans-serif;
    }
  }
</style>
