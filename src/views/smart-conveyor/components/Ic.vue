<!-- 细线图标：<Ic name="temp" />，颜色跟随 .ic 的 color -->
<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 图标是本文件内置的 SVG 字符串，不含外部输入 -->
  <i class="ic" v-html="ICON[name]"></i>
</template>

<script setup>
  import { ICON } from "./ui.js"

  defineProps({ name: { type: String, required: true } })
</script>
