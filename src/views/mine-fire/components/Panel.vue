<!-- 面板外壳：双层边框 + 四角角标 + 标题条（定稿 v1.js 的 pn()） -->
<template>
  <section class="pn">
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i
    ><i class="corner br"></i>
    <header class="pn-h">
      <i class="pn-mark"></i>
      <h3>{{ title }}</h3>
      <span class="pn-en">{{ en }}</span>
      <span v-if="$slots.tool" class="pn-tool"><slot name="tool" /></span>
    </header>
    <div class="pn-b"><slot /></div>
  </section>
</template>

<script setup>
  defineProps({ title: String, en: String })
</script>
