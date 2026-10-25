<!--
  面板外壳：编号牌 + 中文标题 + 英文大写副标；双层边框（外壳发丝线 + 内芯）。样式在 styles/board.scss 的 .pn
-->
<template>
  <section class="pn">
    <header class="pn-hd">
      <b class="pn-no">{{ no }}</b>
      <h3>{{ title }}</h3>
      <em>{{ en }}</em>
      <slot name="tools"></slot>
    </header>
    <div class="pn-bd"><slot></slot></div>
  </section>
</template>

<script setup>
  defineProps({
    no: { type: String, required: true },
    title: { type: String, required: true },
    en: { type: String, default: "" }
  })
</script>
