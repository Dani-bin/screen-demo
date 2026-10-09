<!-- 设备分布：八类设备数量（四列两行，每格底部一道类型色） -->
<template>
  <section>
    <PanelTitle title="设备分布">
      <template #extra>单位：台</template>
    </PanelTitle>
    <div class="body">
      <div class="grid">
        <div
          v-for="d in items"
          :key="d.name"
          class="it"
          :style="{ borderColor: d.color }"
        >
          <b class="num">{{ d.value }}</b>
          <span>{{ d.name }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"

  defineProps({
    items: { type: Array, required: true }
  })
</script>

<style lang="scss" scoped>
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .it {
    padding: 8px 0 6px;
    border-top: 2px solid;
    background: linear-gradient(
      180deg,
      rgba(20, 70, 140, 0.35),
      rgba(20, 70, 140, 0)
    );
    text-align: center;

    b {
      display: block;
      font-size: 22px;
      font-weight: normal;
      color: #fff;
    }

    span {
      font-size: 12px;
      color: #8aa0bd;
    }
  }
</style>
