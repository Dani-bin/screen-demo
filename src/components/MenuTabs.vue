<!--
 * @Author: 
 * @Date: 2025-08-18 16:18:04
 * @Description: 
-->
<template>
  <div class="absolute flex items-center justify-center tab-box">
    <div @click="handleTabClick('comprehensiveAnalysis')" class="tab-item"
      :class="{ active: isPath('comprehensiveAnalysis') }">
      综合分析
    </div>
    <div @click="handleTabClick('emergencyCommand')" class="tab-item" :class="{ active: isPath('emergencyCommand') }">
      应急指挥
    </div>
    <div class="empty-box"></div>
    <div @click="handleTabClick('safetyProduction')" class="tab-item" :class="{ active: isPath('safetyProduction') }">
      安全生产
    </div>
    <div @click="handleTabClick('disasterPrevention')" class="tab-item"
      :class="{ active: isPath('disasterPrevention') }">
      防灾减灾
    </div>
  </div>
</template>

<script setup>
const route = useRoute()
const router = useRouter()

const isPath = (p) => {
  return route.path.includes(p)
}

const handleTabClick = (tab) => {
  router.push(`/${tab}`)
}
</script>

<style lang="scss" scoped>
.tab-box {
  z-index: 99;
  top: 94px;
  width: 100%;
  gap: 50px;

  .empty-box {
    width: 1600px;
  }

  .tab-item {
    width: 276px;
    height: 86px;
    background: url("@/assets/images/tab-bg.svg") repeat center center;
    background-size: 100% 100%;

    &.active {
      background: url("@/assets/images/tab-bg-active.svg") no-repeat center center;
      background-size: 100% 100%;
      color: #ffffff;
    }

    &:hover {
      background: url("@/assets/images/tab-bg-active.svg") no-repeat center center;
      background-size: 100% 100%;
      color: #ffffff;
    }

    font-family: YouSheBiaoTiHei;
    font-weight: 400;
    font-size: 46px;
    line-height: 76px;
    text-align: center;
    letter-spacing: 2px;
    color: #d2f3ff;
    cursor: pointer;
  }
}
</style>
