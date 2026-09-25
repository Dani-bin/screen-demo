<!--
 * @Author:
 * @Date: 2024-06-12 18:18:29
 * @Description:
-->
<template>
  <div class="mini-progress">
    <div class="wrap">
      <div
        class="progress"
        :style="{
          width: percent + '%'
        }"
      />
    </div>
  </div>
</template>

<script>
  export default {
    name: "MiniProgress",
    props: ["percent"]
  }
</script>

<style lang="scss" scoped>
  .mini-progress {
    padding: 5px 0;
    position: relative;
    width: 100%;
    .wrap {
      background-color: #2c303e;
      height: 6px;
      border-radius: 6px;
      position: relative;
    }
    .progress {
      transition: all 0.4s cubic-bezier(0.08, 0.82, 0.17, 1) 0s;
      border-radius: 6px;
      background: linear-gradient(90deg, rgba(57, 8, 255, 0) 0%, #0080fe 100%);
      width: 0;
      height: 100%;
    }
  }
</style>
