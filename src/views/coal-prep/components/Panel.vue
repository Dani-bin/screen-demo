<!-- 面板外壳：编号徽标 + 中文标题 + （可选）标签 + 英文副标；内容放默认插槽 -->
<template>
  <section class="panel">
    <header class="ph">
      <b class="no">{{ no }}</b>
      <h3>{{ title }}</h3>
      <slot name="extra" />
      <i>{{ en }}</i>
    </header>
    <div class="pb"><slot /></div>
  </section>
</template>

<script setup>
  defineProps({
    no: { type: String, required: true },
    title: { type: String, required: true },
    en: { type: String, default: "" }
  })
</script>
