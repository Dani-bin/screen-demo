<!--
  楼宇档案：名称、高度、层数、平面形态、面积、业态、电梯、数据接入（高度 / 层数 / 形态来自 OSM，其余为演示数据）
-->
<template>
  <section>
    <PanelTitle title="楼宇档案" />
    <div class="body">
      <dl class="profile">
        <div v-for="it in items" :key="it.k">
          <dt>{{ it.k }}</dt>
          <dd>{{ it.v }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    /** data/building.js 的 towerProfile(key) */
    profile: { type: Object, required: true }
  })

  const items = computed(() => {
    const p = props.profile
    return [
      { k: "楼宇名称", v: p.name },
      { k: "建筑高度", v: `${p.height} m` },
      { k: "楼层", v: `地上 ${p.levels} 层 · 地下 ${p.basement} 层` },
      { k: "平面形态", v: "椭圆平面 · 斜切屋顶" },
      { k: "建筑面积", v: `${p.area} 万 m²` },
      { k: "主要业态", v: "甲级写字楼" },
      { k: "电梯", v: `客梯 ${p.elevators[0]} · 货梯 ${p.elevators[1]}` },
      { k: "数据接入", v: "BA · 安防 · 能耗 · 消防" }
    ]
  })
</script>

<style lang="scss" scoped>
  .profile {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 12px 16px;
    margin: 0;
    padding: 14px 16px;
    border: 1px solid rgba(255, 198, 90, 0.55);
    background: linear-gradient(
      135deg,
      rgba(60, 40, 8, 0.45),
      rgba(8, 26, 56, 0.6)
    );

    dt {
      font-size: 12px;
      color: #8aa0bd;
    }

    dd {
      margin: 3px 0 0;
      font-size: 14px;
      color: #fff;
      white-space: nowrap;
    }
  }
</style>
