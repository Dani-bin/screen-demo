<!--
  楼栋插牌与配套标签：DOM 元素，位置每帧按三维投影更新（直接改 transform，不走 Vue 响应式）
  插牌颜色 = 销售状态（可售 / 热销 / 售罄），选中的放大高亮；配套 / 景观图层下显示名称标签。
-->
<template>
  <div class="pins no-pointer">
    <div
      v-for="b in layout.buildings"
      :key="b.id"
      :ref="(el) => (pinEls[b.id] = el)"
      class="pin"
      :class="[
        saleOf(b.id).state,
        { sel: selectedId === b.id, hide: !showPins }
      ]"
      @click.stop="$emit('pick', b.id)"
    >
      {{ b.no }}
    </div>
    <div
      v-for="a in tags"
      :key="a.id"
      :ref="(el) => (tagEls[a.id] = el)"
      class="tag"
      :class="{ sel: selectedId === a.id }"
      @click.stop="$emit('pick', a.id)"
    >
      {{ a.name }}
    </div>
  </div>
</template>

<script setup>
  import { saleOf } from "../utils.js"

  const props = defineProps({
    layout: { type: Object, required: true },
    selectedId: { type: String, default: null },
    showPins: { type: Boolean, default: true },
    tags: { type: Array, default: () => [] }
  })
  defineEmits(["pick"])

  const pinEls = {}
  const tagEls = {}

  /**
   * 每帧调用：把每个插牌 / 标签放到对象顶部的屏幕位置
   * @param scene EstateScene @param toStage 画布 CSS 像素 → 舞台设计像素
   */
  function update(scene, toStage) {
    if (props.showPins) {
      for (const b of props.layout.buildings) {
        const el = pinEls[b.id]
        if (!el) continue
        const p = toStage(
          scene.projectPlan(b.cx, b.cy, scene.topOf(b.id) + 0.8)
        )
        el.style.display = p.visible ? "" : "none"
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
      }
    }
    for (const a of props.tags) {
      const el = tagEls[a.id]
      if (!el) continue
      const p = toStage(
        scene.projectPlan(a.cx, a.cy, Math.max(scene.topOf(a.id), 2) + 1)
      )
      el.style.display = p.visible ? "" : "none"
      el.style.transform = `translate(${(p.x - 18).toFixed(1)}px, ${p.y.toFixed(1)}px)`
    }
  }

  defineExpose({ update })
</script>
