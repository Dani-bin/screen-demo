<!--
  城市三维总览页
  ----------------------------------------------------------
  页面只负责布局、取数与事件转接；三维逻辑全部在 ./scene 下，
  不含任何 Vue 依赖，可独立调试。

  与应急指挥各页面完全独立：不加载百度地图、不使用 useSharedMap、
  不复用 Head.vue。
-->
<template>
  <div ref="pageRef" class="city-page">
    <div v-if="loading" class="scene-loading">城市场景构建中</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { fetchCityData } from "./data/cityData"

  const pageRef = ref(null)
  const loading = ref(true)
  const error = ref("")

  const info = ref({})
  const metrics = ref([])
  const tags = ref([])
  const flow = ref([])
  const spots = ref([])

  /** 几何数据路径：生产环境 base 为 /bi/，必须经 BASE_URL 拼接 */
  const GEOMETRY_URL = `${import.meta.env.BASE_URL}city/chengdu.json`

  /** 拉取预处理好的几何数据 */
  async function fetchGeometry() {
    const res = await fetch(GEOMETRY_URL)
    if (!res.ok) throw new Error(`几何数据请求失败：HTTP ${res.status}`)
    return res.json()
  }

  onMounted(async () => {
    try {
      const [data, geometry] = await Promise.all([
        fetchCityData(),
        fetchGeometry()
      ])
      info.value = data.info
      metrics.value = data.metrics
      tags.value = data.tags
      flow.value = data.flow
      spots.value = data.spots
      console.log("几何数据加载完成", {
        buildings: geometry.buildings.length,
        roads: geometry.roads.length
      })
    } catch (err) {
      console.error(err)
      error.value = "城市数据加载失败"
    } finally {
      loading.value = false
    }
  })
</script>

<style lang="scss" scoped>
  .city-page {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f6f3ec;
  }

  .scene-loading,
  .scene-error {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    letter-spacing: 3px;
    color: #2f8f96;
    background: #f6f3ec;
  }

  .scene-error {
    color: #c0392b;
  }
</style>
