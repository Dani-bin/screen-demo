<!-- 场景悬浮标签：各设施上方的名称 + 实时数值，竖线连到锚点（锚点为 Blender 的 anchor_<key>，每帧随镜头更新） -->
<template>
  <div class="tags">
    <div
      v-for="t in tags"
      :key="t.key"
      class="tag"
      :style="{
        left: rem(t.x),
        top: rem(t.y),
        '--c': t.color,
        '--lift': rem(t.lift)
      }"
    >
      {{ t.name }}<b v-if="t.value" class="num">{{ t.value }}</b>
    </div>
  </div>
</template>

<script setup>
  import { rem } from "../utils"

  const props = defineProps({
    anchors: { type: Object, default: null },
    snap: { type: Object, required: true }
  })

  /**
   * 标签定义：颜色与三维灯带一致；value 从快照取；
   * lift 为竖线长度（设计稿 px）：相邻设施的标签错开高度，主视角下不互相遮挡；
   * 数值对照整屏效果图 03-dashboard-v1.png 里各标签的位置调过
   */
  const DEFS = [
    {
      key: "fuel",
      name: "加油加气站",
      color: "#ff9a3d",
      lift: 22,
      value: () => "12 枪"
    },
    {
      key: "swap",
      name: "换电站",
      color: "#2de2e6",
      lift: 18,
      value: (s) => `${s.swap.today} 次`
    },
    { key: "office", name: "办公楼 · 司机之家", color: "#4c8dff", lift: 22 },
    {
      key: "lng",
      name: "LNG 加气",
      color: "#b48cff",
      lift: 24,
      value: () => "4 枪"
    },
    {
      key: "charge",
      name: "重卡超充",
      color: "#3ddc97",
      lift: 34,
      value: (s) => `${s.charge.charging}/10`
    },
    {
      key: "power",
      name: "箱变 ×2",
      color: "#ff4d5a",
      lift: 36,
      value: (s) => `${Math.round(s.transformerLoad * 100)}%`
    },
    {
      key: "tank",
      name: "LNG 储罐",
      color: "#b48cff",
      lift: 30,
      value: (s) => `${Math.round(s.inventory.lng * 100)}%`
    }
  ]

  const tags = computed(() => {
    if (!props.anchors) return []
    return DEFS.filter((d) => props.anchors[d.key]).map((d) => ({
      ...d,
      ...props.anchors[d.key],
      value: d.value?.(props.snap)
    }))
  })
</script>

<style lang="scss" scoped>
  .tags {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  .tag {
    position: absolute;
    padding: 5px 10px;
    border: 1px solid var(--c);
    border-radius: 4px;
    background: rgba(6, 16, 34, 0.86);
    color: var(--c);
    font-size: 13px;
    white-space: nowrap;
    transform: translate(-50%, calc(-100% - var(--lift) - 4px));

    b {
      margin-left: 6px;
      font-size: 18px;
      font-weight: normal;
    }

    /* 竖线 + 锚点圆点 */
    &::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 100%;
      width: 1px;
      height: var(--lift);
      background: var(--c);
    }

    &::before {
      content: "";
      position: absolute;
      left: calc(50% - 4px);
      top: calc(100% + var(--lift) - 2px);
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--c);
      box-shadow: 0 0 10px var(--c);
    }
  }
</style>
