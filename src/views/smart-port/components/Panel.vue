<!--
  面板外框（定稿 v1 的 .pn）：双层边框（外壳发丝线 + 内芯半透明底）、四角亮色角标、
  标题条（斜块标记 + 中文标题 + 英文副标 + 右侧工具）、标题下沿流光短线
-->
<template>
  <section class="pn" :class="{ fill }">
    <header class="pn-h">
      <i class="pn-mark"></i>
      <h3>{{ title }}</h3>
      <span class="pn-en">{{ en }}</span>
      <slot name="tools" />
    </header>
    <div class="pn-b"><slot /></div>
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i
    ><i class="corner br"></i>
  </section>
</template>

<script setup>
  defineProps({
    title: { type: String, default: "" },
    en: { type: String, default: "" },
    /** 最后一张卡：拉伸填满侧栏剩余高度 */
    fill: { type: Boolean, default: false }
  })
</script>
