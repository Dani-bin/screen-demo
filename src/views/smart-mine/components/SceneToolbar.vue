<!-- 场景工具条：地表 / 透视 / 剖切 / 复位（工业广场近景只有地表） -->
<template>
  <div class="toolbar">
    <button
      v-for="b in BUTTONS"
      :key="b.mode"
      :class="{ on: b.mode === mode }"
      :disabled="b.mode !== 'surface' && b.mode !== 'reset' && surfaceOnly"
      :title="b.tip"
      @click="b.mode === 'reset' ? $emit('reset') : $emit('mode', b.mode)"
    >
      <component :is="b.icon" class="ico" />{{ b.t }}
    </button>
  </div>
</template>

<script setup>
  import {
    Layers,
    Mountain,
    RotateCcw,
    SquareSplitVertical
  } from "lucide-vue-next"

  defineProps({
    mode: { type: String, required: true },
    surfaceOnly: { type: Boolean, default: false }
  })
  defineEmits(["mode", "reset"])
  const BUTTONS = [
    { mode: "surface", t: "地表", icon: Mountain, tip: "地表实景（航拍影像）" },
    {
      mode: "ghost",
      t: "透视",
      icon: Layers,
      tip: "地表半透明，显示井下巷道与工作面"
    },
    {
      mode: "section",
      t: "剖切",
      icon: SquareSplitVertical,
      tip: "沿在采工作面切开，看地层与采空区"
    },
    { mode: "reset", t: "复位", icon: RotateCcw, tip: "镜头回到默认视角" }
  ]
</script>

<style lang="scss" scoped>
  .toolbar {
    position: absolute;
    left: 446px;
    bottom: 104px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 46px;
    height: 50px;
    padding: 0;
    font-size: 12px;
    font-family: inherit;
    color: var(--sub);
    border: 1px solid rgba(80, 160, 255, 0.25);
    border-radius: 3px;
    background: rgba(3, 10, 22, 0.66);
    cursor: pointer;
    transition:
      color 0.2s,
      border-color 0.2s;

    &:hover:not(:disabled) {
      color: #fff;
    }

    &.on {
      color: var(--cyan);
      border-color: var(--cyan);
      box-shadow: inset 0 0 10px rgba(54, 224, 255, 0.25);
    }

    &:disabled {
      opacity: 0.3;
      cursor: default;
    }
  }

  .ico {
    width: 18px;
    height: 18px;
  }
</style>
