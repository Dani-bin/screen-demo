<!--
 * @Author:
 * @Date: 2024-06-12 12:09:17
 * @Description:
-->
<template>
  <div class="echart-title flex items-center">
    <span class="title font-bold">{{ title }}</span>
  </div>
</template>

<script setup>
  const props = defineProps({
    title: {
      type: String
    }
  })
</script>

<style lang="scss" scoped>
  .echart-title {
    min-height: 38px;
    padding: 0 4px;
    margin-bottom: 6px;
    background: url("@/assets/images/title-bg.svg") no-repeat;
    background-size: cover;

    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: 1px;
      white-space: nowrap;
    }
  }
</style>
