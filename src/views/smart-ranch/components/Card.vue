<!-- 面板卡片外框：标题 + 右侧提示 + 内容 -->
<template>
  <section class="card">
    <header>
      <h3>
        <slot name="title">{{ title }}</slot>
      </h3>
      <span v-if="hint || $slots.hint" class="hint"
        ><slot name="hint">{{ hint }}</slot></span
      >
    </header>
    <slot />
  </section>
</template>

<script setup>
  defineProps({
    title: { type: String, default: "" },
    hint: { type: String, default: "" }
  })
</script>
