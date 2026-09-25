<!--
 * @Author: 张嘉彬
 * @Date: 2022-06-24 14:32:09
 * @Description:
-->
<template>
  <div class="loading-container">
    <div class="mask"></div>
    <div class="loadingSeven">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
</template>

<script setup>
// Loading component
</script>

<style lang="scss" scoped>
.mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(8, 24, 68, 0.6);
  z-index: 9999;
}

.loadingSeven {
  width: 0.6rem;
  height: 0.2rem;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 9999;
}

.loadingSeven span {
  display: inline-block;
  width: 0.04rem;
  height: 100%;
  border-radius: 0.04rem;
  background: #197ae4;
  margin-right: 0.06rem;
  animation: loadsaven 1.04s ease infinite;
}

@keyframes loadsaven {

  0%,
  100% {
    height: 0.1rem;
    background: #197ae4;
  }

  50% {
    height: 0.3rem;
    margin-top: -0.2rem;
    background: #29a3cc;
  }
}

.loadingSeven span:nth-child(2) {
  animation-delay: 0.13s;
}

.loadingSeven span:nth-child(3) {
  animation-delay: 0.26s;
}

.loadingSeven span:nth-child(4) {
  animation-delay: 0.39s;
}

.loadingSeven span:nth-child(5) {
  animation-delay: 0.52s;
}
</style>
