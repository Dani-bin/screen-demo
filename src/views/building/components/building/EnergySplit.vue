<!--
  分项能耗：今日空调 / 照明插座 / 动力 / 特殊用电（MWh，演示数据），环图 + 图例
-->
<template>
  <section>
    <PanelTitle title="分项能耗">
      <template #extra>今日 MWh</template>
    </PanelTitle>
    <div class="body energy">
      <div class="ring">
        <RingChart :items="items" :total="total" label="今日 MWh" />
      </div>
      <ul>
        <li v-for="it in items" :key="it.name">
          <i :style="{ background: it.color }"></i>{{ it.name }}
          <b class="num">{{ it.value }}</b
          ><small>MWh</small>
          <em class="num">{{ ((it.value / sum) * 100).toFixed(0) }}%</em>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import RingChart from "../RingChart.vue"

  const props = defineProps({
    /** [{ name, value, color }] */
    items: { type: Array, required: true }
  })
  const sum = computed(() => props.items.reduce((s, i) => s + i.value, 0))
  const total = computed(() => sum.value.toFixed(1))
</script>

<style lang="scss" scoped>
  .energy {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .ring {
    flex-shrink: 0;
    width: 140px;
    height: 140px;
  }

  ul {
    flex: 1;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: baseline;
      gap: 6px;
      height: 30px;
      font-size: 13px;
      color: #bcd3ee;

      i {
        width: 8px;
        height: 8px;
        align-self: center;
      }

      b {
        margin-left: auto;
        font-size: 18px;
        font-weight: normal;
        color: #fff;
      }

      small {
        font-size: 11px;
        color: #8aa0bd;
      }

      em {
        width: 34px;
        font-style: normal;
        font-size: 12px;
        text-align: right;
        color: #8aa0bd;
      }
    }
  }
</style>
