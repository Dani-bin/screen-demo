<!--
  楼宇资产：按系统分类的资产件数（横向条形，条长按最大值归一）
-->
<template>
  <section>
    <PanelTitle title="楼宇资产">
      <template #extra>合计 {{ total.toLocaleString("en-US") }} 件</template>
    </PanelTitle>
    <div class="body">
      <div v-for="it in items" :key="it.name" class="row">
        <span class="name">{{ it.name }}</span>
        <span class="bar"
          ><i
            :style="{
              width: (it.value / max) * 100 + '%',
              background: it.color
            }"
          ></i
        ></span>
        <b class="num">{{ it.value.toLocaleString("en-US") }}</b>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  const props = defineProps({
    /** [{ name, value, color }] */
    items: { type: Array, required: true }
  })
  const total = computed(() => props.items.reduce((s, i) => s + i.value, 0))
  const max = computed(() => Math.max(...props.items.map((i) => i.value), 1))
</script>

<style lang="scss" scoped>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 28px;

    .name {
      width: 64px;
      font-size: 13px;
      color: #bcd3ee;
    }

    .bar {
      flex: 1;
      height: 6px;
      background: rgba(60, 100, 150, 0.25);

      i {
        display: block;
        height: 100%;
        box-shadow: 0 0 6px currentColor;
      }
    }

    b {
      width: 52px;
      font-size: 16px;
      font-weight: normal;
      text-align: right;
      color: #fff;
    }
  }
</style>
