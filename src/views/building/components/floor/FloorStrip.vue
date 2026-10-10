<!--
  楼层条（场景右侧竖排）：当前层上下各 4 层，点击切换；只有办公层有精细模型，其它楼层置灰不可点
-->
<template>
  <div class="strip">
    <span
      v-for="f in items"
      :key="f.key"
      class="num"
      :class="{ on: f.key === current, off: !f.ok, alarm: f.alarm }"
      :title="
        f.ok ? `${f.key} · ${f.name}` : `${f.key} · ${f.name}（暂无楼层模型）`
      "
      @click="f.ok && f.key !== current && $emit('go', f.key)"
      >{{ f.key }}</span
    >
  </div>
</template>

<script setup>
  defineProps({
    items: { type: Array, required: true },
    current: { type: String, required: true }
  })
  defineEmits(["go"])
</script>

<style lang="scss" scoped>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 6px;

    span {
      width: 48px;
      padding: 3px 0;
      border: 1px solid rgba(74, 170, 255, 0.45);
      background: rgba(6, 30, 70, 0.75);
      text-align: center;
      font-size: 13px;
      color: #9cc4ec;
      cursor: pointer;

      &:hover {
        color: #fff;
        border-color: #4aa8ff;
      }

      &.alarm {
        color: #ff8a92;
      }

      &.off {
        opacity: 0.4;
        cursor: not-allowed;
      }

      &.on {
        border-color: #ffc65a;
        background: rgba(150, 100, 20, 0.6);
        color: #ffe6b0;
      }
    }
  }
</style>
