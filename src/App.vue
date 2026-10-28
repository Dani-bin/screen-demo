<!--
 * @Author:
 * @Date: 2024-06-11 11:04:25
 * @Description:
-->
<template>
  <div class="app-content">
    <router-view></router-view>
    <!-- 切换页面 / 加载三维模型时窗口顶部的进度条 -->
    <TopProgress />
  </div>
</template>
<script setup>
  import TopProgress from "@/components/TopProgress.vue"
</script>

<style scoped>
  .app-content {
    height: 100%;
    font-family: Noto Sans S Chinese;
    font-size: 16px;
  }
</style>
