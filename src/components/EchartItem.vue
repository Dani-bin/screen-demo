<!--
 * @Author:
 * @Date: 2024-06-12 14:55:00
 * @Description:
-->
<template>
  <div class="relative echart-item">
    <div :id="echartId" class="echart-item-box"></div>
    <Loading v-if="!loaded" />
  </div>
</template>

<script setup>
import * as echarts from "echarts"
import "echarts-gl"
import { getScaleNum } from "@/utils/ruoyi.js"
import { inject, nextTick } from "vue"
const props = defineProps({
  echartId: {
    type: String
  },
  loaded: {
    type: Boolean,
    default: true
  },
  option: {
    type: Object,
    default: () => ({})
  }
})
const changeWindow = inject("changeWindow")
let myEchart = null

const removeEchat = () => {
  if (myEchart) {
    myEchart.clear()
    myEchart.dispose()
    myEchart = null
  }
}
const initEchart = () => {
  removeEchat()
  let options = props.option
  if (!options) return
  if (options.tooltip) {
    options.tooltip.backgroundColor = "rgba(30,39,71,0.4)"
    options.tooltip.borderColor = "#589BE3"
    options.tooltip.borderWidth = 1
    options.tooltip.padding = getScaleNum(10)
    options.tooltip.textStyle = {
      color: "#fff"
    }
  }
  myEchart = echarts.init(document.getElementById(props.echartId))
  myEchart.setOption(props.option, true)
}

watch(
  () => changeWindow.value,
  () => {
    initEchart()
  }
)
watch(
  () => props.option,
  () => {
    nextTick(() => {
      initEchart()
    })
  },
  { immediate: true }
)
</script>

<style lang="scss" scoped>
.echart-item {
  height: 100%;

  .echart-item-box {
    height: 100%;
    width: 100%;
  }
}
</style>
