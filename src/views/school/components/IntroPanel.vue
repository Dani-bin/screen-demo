<!-- 学校简介面板：正文引自百度百科词条 -->
<template>
  <section class="panel intro-panel">
    <h2 class="panel-title">
      学校简介
      <span class="title-en">Overview</span>
    </h2>
    <p v-for="(text, i) in info.paragraphs" :key="i" class="intro-text">
      {{ text }}
    </p>
    <blockquote class="intro-motto">"{{ info.motto }}"</blockquote>
  </section>
</template>

<script setup>
  defineProps({
    info: { type: Object, required: true }
  })
</script>

<style lang="scss" scoped>
  .intro-text {
    margin: 0 0 9px;
    font-size: 13.5px;
    line-height: 1.82;
    color: var(--school-ink-soft);
  }

  .intro-motto {
    margin: 2px 0 0;
    padding-left: 11px;
    border-left: 2px solid var(--school-panel-edge);
    font-size: 14px;
    line-height: 1.7;
    color: var(--school-brick);
  }
</style>
