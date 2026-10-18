<!-- 场景图例：随显示方式变化 -->
<template>
  <div v-if="items.length" class="legend">
    <div v-for="[c, t, k] in items" :key="t">
      <i :class="k" :style="{ background: c }"></i>{{ t }}
    </div>
  </div>
</template>

<script setup>
  const props = defineProps({
    /** surface / ghost / section / plant */
    set: { type: String, required: true }
  })
  const SETS = {
    surface: [
      ["rgba(210,200,255,.7)", "已采采空区（投影）"],
      ["#ffb450", "在采工作面"],
      ["#50ebf0", "待采 / 规划工作面"],
      ["#5adcff", "主要大巷", "line"],
      ["#c6ff5a", "瓦斯抽采钻场", "dot"]
    ],
    ghost: [
      ["#38c8ff", "进风巷道（亮条 = 风流）", "line"],
      ["#ff6a5a", "回风巷道", "line"],
      ["#8c7fb8", "采空区"],
      ["#ff9a3d", "在采工作面"],
      ["#53e8f0", "待采 / 规划"],
      ["#c6ff5a", "抽采钻孔", "line"],
      ["#3ddc97", "传感器（黄 = 预警）", "dot"],
      ["#9fd8ff", "井下人员", "dot"]
    ],
    section: [
      ["#0b0c0f", "煤层（实体煤）"],
      ["#3a3150", "采空区"],
      ["#7d76a0", "垮落带 / 裂隙带"],
      ["#ff9a3d", "综采工作面"],
      ["#38c8ff", "进风大巷断面", "dot"],
      ["#ff6a5a", "回风巷断面", "dot"]
    ],
    plant: []
  }
  // 通风瓦斯专题与透视用同一套图例
  SETS.vent = SETS.ghost
  const items = computed(() => SETS[props.set] || [])
</script>

<style lang="scss" scoped>
  .legend {
    position: absolute;
    right: 446px;
    bottom: 104px;
    z-index: 4;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 22px;
    color: var(--sub);
    border: 1px solid rgba(80, 160, 255, 0.2);
    border-radius: 3px;
    background: rgba(3, 10, 22, 0.66);
    pointer-events: none;
  }

  i {
    display: inline-block;
    width: 14px;
    height: 8px;
    margin-right: 6px;
    vertical-align: middle;
    border-radius: 1px;

    &.dot {
      width: 8px;
      height: 8px;
      margin: 0 9px 0 3px;
      border-radius: 50%;
    }

    &.line {
      height: 3px;
    }
  }
</style>
